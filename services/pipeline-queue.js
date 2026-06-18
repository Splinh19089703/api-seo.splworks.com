/**
 * Pipeline Queue — Concurrency control for AI content pipelines
 * 
 * Prevents overloading shared API keys by limiting concurrent pipelines.
 * 
 * Global max concurrent: configurable via MAX_CONCURRENT_PIPELINES env (default: 5)
 * Per-user limits by plan:
 *   - Trial: 1 concurrent pipeline
 *   - Basic: 2
 *   - Pro: 3
 *   - Agency+: 5
 * 
 * Queue is FIFO with priority based on plan (paid users go first).
 * Auto-timeout: pipeline running > 10 min is auto-cancelled.
 */

const EventEmitter = require("events");

// Plan-based concurrency limits
const PLAN_CONCURRENCY = {
  trial: 1,
  basic: 2,
  pro: 3,
  agency: 5,
  unlimited: 5,
};

// Plan-based priority (lower = higher priority)
const PLAN_PRIORITY = {
  unlimited: 1,
  agency: 2,
  pro: 3,
  basic: 4,
  trial: 5,
};

const MAX_GLOBAL = parseInt(process.env.MAX_CONCURRENT_PIPELINES) || 5;
const PIPELINE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

class PipelineQueue extends EventEmitter {
  constructor() {
    super();
    this.running = new Map();    // taskId -> { userId, plan, startedAt, keyword }
    this.queue = [];             // { taskId, userId, plan, keyword, resolve, reject, addedAt }
    this.timeouts = new Map();   // taskId -> timeout handle
  }

  /**
   * Get current queue and running status
   */
  getStatus() {
    return {
      running: this.running.size,
      maxGlobal: MAX_GLOBAL,
      queued: this.queue.length,
      runningTasks: Array.from(this.running.entries()).map(([id, t]) => ({
        taskId: id,
        userId: t.userId,
        plan: t.plan,
        keyword: t.keyword,
        runningMs: Date.now() - t.startedAt,
      })),
      queuedTasks: this.queue.map((t, i) => ({
        position: i + 1,
        taskId: t.taskId,
        userId: t.userId,
        plan: t.plan,
        keyword: t.keyword,
        waitingMs: Date.now() - t.addedAt,
      })),
    };
  }

  /**
   * Count running pipelines for a specific user
   */
  _userRunningCount(userId) {
    let count = 0;
    for (const task of this.running.values()) {
      if (task.userId === userId) count++;
    }
    return count;
  }

  /**
   * Count queued tasks for a specific user
   */
  _userQueuedCount(userId) {
    return this.queue.filter(t => t.userId === userId).length;
  }

  /**
   * Try to start next queued task if capacity available
   */
  _tryStartNext() {
    if (this.queue.length === 0) return;
    if (this.running.size >= MAX_GLOBAL) return;

    // Find first eligible task in queue
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      const userMax = PLAN_CONCURRENCY[task.plan] || 1;
      const userRunning = this._userRunningCount(task.userId);

      if (userRunning < userMax) {
        // Remove from queue
        this.queue.splice(i, 1);

        // Add to running
        this.running.set(task.taskId, {
          userId: task.userId,
          plan: task.plan,
          keyword: task.keyword,
          startedAt: Date.now(),
        });

        // Set timeout
        const timeout = setTimeout(() => {
          console.warn(`[PipelineQueue] Task ${task.taskId} timed out after ${PIPELINE_TIMEOUT_MS / 1000}s`);
          this.complete(task.taskId);
        }, PIPELINE_TIMEOUT_MS);
        this.timeouts.set(task.taskId, timeout);

        console.log(`[PipelineQueue] ▶ Started task ${task.taskId} (${task.keyword}) for user ${task.userId} (${task.plan}). Running: ${this.running.size}/${MAX_GLOBAL}`);

        // Resolve the promise to let the pipeline start
        task.resolve();
        return;
      }
    }
  }

  /**
   * Request a pipeline slot. Returns a promise that resolves when slot is available.
   * @param {string} taskId — unique pipeline ID
   * @param {string} userId
   * @param {string} plan — license plan
   * @param {string} keyword — for logging
   * @returns {Promise<void>} — resolves when pipeline can start
   */
  async acquire(taskId, userId, plan = "trial", keyword = "") {
    const userMax = PLAN_CONCURRENCY[plan] || 1;
    const userRunning = this._userRunningCount(userId);
    const userQueued = this._userQueuedCount(userId);

    // Check per-user queue limit (prevent queue flooding)
    const maxQueue = userMax * 5; // Allow 5x concurrent limit in queue
    if (userQueued >= maxQueue) {
      throw new Error(`Đã có ${userQueued} bài đang chờ xử lý. Vui lòng đợi hoàn thành trước khi thêm mới.`);
    }

    // If capacity available, start immediately
    if (this.running.size < MAX_GLOBAL && userRunning < userMax) {
      this.running.set(taskId, {
        userId,
        plan,
        keyword,
        startedAt: Date.now(),
      });

      // Set timeout
      const timeout = setTimeout(() => {
        console.warn(`[PipelineQueue] Task ${taskId} timed out`);
        this.complete(taskId);
      }, PIPELINE_TIMEOUT_MS);
      this.timeouts.set(taskId, timeout);

      console.log(`[PipelineQueue] ▶ Immediate start ${taskId} (${keyword}). Running: ${this.running.size}/${MAX_GLOBAL}`);
      return;
    }

    // Queue with priority
    return new Promise((resolve, reject) => {
      const entry = {
        taskId,
        userId,
        plan,
        keyword,
        resolve,
        reject,
        addedAt: Date.now(),
        priority: PLAN_PRIORITY[plan] || 5,
      };

      // Insert sorted by priority (lower = higher priority)
      const insertIdx = this.queue.findIndex(t => t.priority > entry.priority);
      if (insertIdx === -1) {
        this.queue.push(entry);
      } else {
        this.queue.splice(insertIdx, 0, entry);
      }

      console.log(`[PipelineQueue] ⏳ Queued ${taskId} (${keyword}) at position ${insertIdx === -1 ? this.queue.length : insertIdx + 1}. Queue: ${this.queue.length}`);
    });
  }

  /**
   * Mark a pipeline as completed (success or failure).
   * Frees the slot and starts next queued task.
   */
  complete(taskId) {
    if (!this.running.has(taskId)) return;

    this.running.delete(taskId);

    // Clear timeout
    const timeout = this.timeouts.get(taskId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(taskId);
    }

    console.log(`[PipelineQueue] ✅ Completed ${taskId}. Running: ${this.running.size}/${MAX_GLOBAL}, Queue: ${this.queue.length}`);

    // Try to start next queued task
    this._tryStartNext();
  }

  /**
   * Cancel a queued (not yet running) task
   */
  cancel(taskId) {
    const idx = this.queue.findIndex(t => t.taskId === taskId);
    if (idx !== -1) {
      const task = this.queue.splice(idx, 1)[0];
      task.reject(new Error("Pipeline cancelled"));
      console.log(`[PipelineQueue] ❌ Cancelled queued task ${taskId}`);
      return true;
    }
    return false;
  }
}

// Singleton instance
const pipelineQueue = new PipelineQueue();

module.exports = pipelineQueue;
