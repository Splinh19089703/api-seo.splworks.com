import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api";

// ─── Global Task Queue Context ────────────────────────────────────────────────
// F4: Persists across all pages — Tổng quan, Projects, etc.
// Each task: { id, type, status, projectId, projectName, title, progress, result, error, createdAt, navigateTo }

const TaskQueueContext = createContext(null);

export function TaskQueueProvider({ children }) {
  // tasks: Map<taskId, taskObject>
  const [tasks, setTasks] = useState({});
  const taskIdCounter = useRef(0);
  const tasksRef = useRef(tasks);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Generate unique task ID
  const genId = () => {
    taskIdCounter.current += 1;
    return `task_${Date.now()}_${taskIdCounter.current}`;
  };

  // Update a specific task
  const updateTask = useCallback((taskId, updates) => {
    setTasks(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], ...updates, updatedAt: Date.now() }
    }));
  }, []);

  // Add a new task
  const addTask = useCallback((taskData) => {
    const id = genId();
    const task = {
      id,
      type: "rewrite", // default type
      status: "pending",
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...taskData,
    };
    setTasks(prev => ({ ...prev, [id]: task }));
    return id;
  }, []);

  // Remove a task
  const removeTask = useCallback((taskId) => {
    setTasks(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }, []);

  // Clear completed/errored tasks
  const clearFinished = useCallback(() => {
    setTasks(prev => {
      const kept = {};
      Object.entries(prev).forEach(([k, v]) => {
        if (v.status === "running" || v.status === "pending") kept[k] = v;
      });
      return kept;
    });
  }, []);

  // ─── Rewrite Task Runner ────────────────────────────────────────────────
  const startRewriteTask = useCallback(async (opts) => {
    const {
      wpPostId, siteId, article, projectId, projectName = "",
      keyword = "", tone = "professional", autoPush = false,
      navigateTo = null, // e.g., "/projects/xxx" — click to navigate
    } = opts;

    const taskId = addTask({
      type: "rewrite",
      status: "running",
      projectId,
      projectName,
      title: article?.title || `Post #${wpPostId}`,
      wpPostId,
      siteId,
      article,
      navigateTo,
      progress: 10,
    });

    try {
      // Step 1: Rewrite
      updateTask(taskId, { progress: 30, statusText: "Đang viết lại..." });
      const res = await api.post("/audit/rewrite-article", {
        content: article.content, mode: "full", keyword, tone
      });
      updateTask(taskId, { progress: 70, result: res.rewritten, statusText: "Viết xong!" });

      // Step 2: Auto-push if requested
      if (autoPush && siteId && wpPostId) {
        updateTask(taskId, { progress: 80, statusText: "Đang push lên WP..." });
        await api.post("/audit/update-article", { siteId, wpPostId, content: res.rewritten });
        // Save history
        try {
          const wordsBefore = article.wordCount || 0;
          const wordsAfter = res.rewritten.split(/\s+/).filter(Boolean).length;
          await api.post("/audit/rewrite-history", {
            projectId, wpPostId, wpPostTitle: article.title || "",
            wpPostUrl: article.url || "", originalContent: article.content || "",
            rewrittenContent: res.rewritten, rewriteMode: "full",
            sectionsChanged: [], keyword, tone,
            wordCountBefore: wordsBefore, wordCountAfter: wordsAfter,
            changePercentage: wordsBefore > 0 ? Math.round(Math.abs(wordsAfter - wordsBefore) / wordsBefore * 100) : 0,
            usedProvider: "",
          });
        } catch (e) { console.warn("[TaskQueue] History save error:", e.message); }
        updateTask(taskId, { status: "done", progress: 100, statusText: "Đã push lên WP", pushed: true });
      } else {
        updateTask(taskId, { status: "done", progress: 100, statusText: "Hoàn thành — chờ push", pushed: false });
      }
    } catch (e) {
      updateTask(taskId, { status: "error", error: e.message, statusText: "Lỗi: " + e.message });
    }
    return taskId;
  }, [addTask, updateTask]);

  // Batch rewrite — sequential
  const startBatchRewrite = useCallback(async (postIds, siteId, projectId, projectName, opts = {}) => {
    const taskIds = [];
    for (const postId of postIds) {
      // Check if already running
      const existing = Object.values(tasksRef.current).find(
        t => t.wpPostId === postId && t.status === "running"
      );
      if (existing) continue;

      try {
        const article = await api.get(`/audit/wp-posts/${siteId}/${postId}`);
        const tid = await startRewriteTask({
          wpPostId: postId, siteId, article, projectId, projectName,
          navigateTo: `/projects/${projectId}`,
          ...opts,
        });
        taskIds.push(tid);
      } catch (e) {
        const tid = addTask({
          type: "rewrite", status: "error", projectId, projectName,
          title: `Post #${postId}`, error: e.message, wpPostId: postId,
        });
        taskIds.push(tid);
      }
    }
    return taskIds;
  }, [startRewriteTask, addTask]);

  // ─── Getters ────────────────────────────────────────────────────────────
  const getTasksByProject = useCallback((projectId) => {
    return Object.values(tasks).filter(t => t.projectId === projectId);
  }, [tasks]);

  const getRunningTasks = useCallback(() => {
    return Object.values(tasks).filter(t => t.status === "running" || t.status === "pending");
  }, [tasks]);

  const getAllTasks = useCallback(() => {
    return Object.values(tasks).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [tasks]);

  // Push a completed task to WordPress
  const pushTaskToWP = useCallback(async (taskId) => {
    const task = tasksRef.current[taskId];
    if (!task || !task.result || !task.siteId || !task.wpPostId) return;
    updateTask(taskId, { status: "running", progress: 85, statusText: "Đang push lên WP..." });
    try {
      await api.post("/audit/update-article", {
        siteId: task.siteId, wpPostId: task.wpPostId, content: task.result
      });
      // Save history
      try {
        const wordsBefore = task.article?.wordCount || 0;
        const wordsAfter = task.result.split(/\s+/).filter(Boolean).length;
        await api.post("/audit/rewrite-history", {
          projectId: task.projectId, wpPostId: task.wpPostId,
          wpPostTitle: task.title || "", wpPostUrl: task.article?.url || "",
          originalContent: task.article?.content || "",
          rewrittenContent: task.result, rewriteMode: "full",
          sectionsChanged: [], keyword: "", tone: "professional",
          wordCountBefore: wordsBefore, wordCountAfter: wordsAfter,
          changePercentage: wordsBefore > 0 ? Math.round(Math.abs(wordsAfter - wordsBefore) / wordsBefore * 100) : 0,
          usedProvider: "",
        });
      } catch (e) { console.warn("[TaskQueue] History save:", e.message); }
      updateTask(taskId, { status: "done", progress: 100, statusText: "✅ Đã push lên WP", pushed: true });
    } catch (e) {
      updateTask(taskId, { status: "done", progress: 100, statusText: "Push lỗi: " + e.message, pushed: false });
    }
  }, [updateTask]);

  // Push all completed (unpushed) tasks
  const pushAllDone = useCallback(async (filterProjectId = null) => {
    const doneTasks = Object.values(tasksRef.current).filter(t =>
      t.status === "done" && !t.pushed && t.result && t.siteId && t.wpPostId
      && (!filterProjectId || t.projectId === filterProjectId)
    );
    for (const t of doneTasks) {
      await pushTaskToWP(t.id);
    }
  }, [pushTaskToWP]);

  const value = {
    tasks,
    addTask,
    updateTask,
    removeTask,
    clearFinished,
    startRewriteTask,
    startBatchRewrite,
    getTasksByProject,
    getRunningTasks,
    getAllTasks,
    pushTaskToWP,
    pushAllDone,
  };

  return (
    <TaskQueueContext.Provider value={value}>
      {children}
    </TaskQueueContext.Provider>
  );
}

export function useTaskQueue() {
  const ctx = useContext(TaskQueueContext);
  if (!ctx) throw new Error("useTaskQueue must be used within TaskQueueProvider");
  return ctx;
}

// ─── TaskQueueWidget: Compact widget for sidebar/header ─────────────────────
// Shows running task count + can expand to see all
export function TaskQueueWidget({ projectId = null }) {
  const { getAllTasks, getTasksByProject, clearFinished, removeTask, pushTaskToWP, pushAllDone } = useTaskQueue();
  const [expanded, setExpanded] = useState(false);

  const tasks = projectId ? getTasksByProject(projectId) : getAllTasks();
  const running = tasks.filter(t => t.status === "running");
  const doneTasks = tasks.filter(t => t.status === "done");
  const unpushed = doneTasks.filter(t => !t.pushed && t.result && t.siteId);
  const totalCount = tasks.length;

  if (totalCount === 0) return null;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 14, overflow: "hidden", marginBottom: 16,
    }}>
      {/* Header — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "12px 16px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
          background: running.length > 0
            ? "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.05) 100%)"
            : unpushed.length > 0
              ? "linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(251,191,36,0.04) 100%)"
              : "rgba(16,185,129,0.04)",
          transition: "background 0.2s",
        }}
      >
        <span style={{ fontSize: 16 }}>
          {running.length > 0 ? "⚡" : unpushed.length > 0 ? "📝" : "✅"}
        </span>
        <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
          {running.length > 0 ? "Công việc đang chạy" : unpushed.length > 0 ? "Chờ push lên WP" : "Công việc hoàn thành"}
        </span>
        {running.length > 0 && (
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 10,
            background: "rgba(99,102,241,0.15)", color: "#818cf8", fontWeight: 700,
            animation: "pulse 1.5s infinite",
          }}>
            {running.length} đang xử lý
          </span>
        )}
        {unpushed.length > 0 && (
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 10,
            background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 700,
          }}>
            {unpushed.length} chờ push
          </span>
        )}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          · {totalCount} tổng
        </span>
        <div style={{ flex: 1 }} />
        {/* Push All button */}
        {unpushed.length > 0 && (
          <button
            className="btn btn-sm"
            style={{
              background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
              color: "#fff", border: "none", fontWeight: 600, fontSize: 10, padding: "4px 10px",
              boxShadow: "0 2px 6px rgba(245,158,11,0.25)",
            }}
            onClick={(e) => { e.stopPropagation(); pushAllDone(projectId); }}
          >
            🚀 Push tất cả ({unpushed.length})
          </button>
        )}
        <button className="btn btn-sm btn-secondary" style={{ fontSize: 10, padding: "3px 8px" }}
          onClick={(e) => { e.stopPropagation(); clearFinished(); }}>
          🗑 Dọn
        </button>
        <span style={{
          fontSize: 12, color: "var(--text-muted)",
          transition: "transform 0.2s",
          transform: expanded ? "rotate(180deg)" : "rotate(0)",
        }}>▼</span>
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {/* Expanded task list */}
      {expanded && (
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {tasks.map(task => (
            <TaskRow key={task.id} task={task} onRemove={() => removeTask(task.id)} onPush={() => pushTaskToWP(task.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TaskRow: Single task in the list ───────────────────────────────────────
function TaskRow({ task, onRemove, onPush }) {
  const statusIcons = {
    pending: "🕐", running: "⏳", done: "✅", error: "❌",
  };
  const statusColors = {
    pending: "var(--text-muted)", running: "#818cf8", done: "#10b981", error: "#ef4444",
  };

  const canPush = task.status === "done" && !task.pushed && task.result && task.siteId && task.wpPostId;

  return (
    <div
      style={{
        padding: "10px 16px", borderTop: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 10,
        background: task.status === "error" ? "rgba(239,68,68,0.04)"
          : canPush ? "rgba(245,158,11,0.04)" : "transparent",
        cursor: task.navigateTo ? "pointer" : "default",
        transition: "background 0.15s",
      }}
      onClick={() => {
        if (task.navigateTo) {
          window.location.hash = "";
          window.location.href = task.navigateTo;
        }
      }}
      onMouseEnter={e => { if (task.navigateTo) e.currentTarget.style.background = "rgba(59,130,246,0.04)"; }}
      onMouseLeave={e => {
        e.currentTarget.style.background = task.status === "error" ? "rgba(239,68,68,0.04)"
          : canPush ? "rgba(245,158,11,0.04)" : "transparent";
      }}
    >
      {/* Status icon */}
      <span style={{ fontSize: 14, flexShrink: 0 }}>
        {canPush ? "📝" : statusIcons[task.status] || "⏳"}
      </span>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--text)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {task.title}
          {task.projectName && (
            <span style={{
              fontSize: 9, padding: "1px 6px", borderRadius: 4,
              background: "rgba(255,255,255,0.06)", color: "var(--text-muted)",
            }}>
              {task.projectName}
            </span>
          )}
          {/* Push status badge */}
          {task.status === "done" && (
            <span style={{
              fontSize: 9, padding: "1px 6px", borderRadius: 4, fontWeight: 600,
              background: task.pushed ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
              color: task.pushed ? "#10b981" : "#f59e0b",
            }}>
              {task.pushed ? "✅ Đã push" : "⏳ Chưa push"}
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: statusColors[task.status], marginTop: 1 }}>
          {task.statusText || task.status}
          {task.navigateTo && task.status === "done" && (
            <span style={{ marginLeft: 6, opacity: 0.7 }}>Click để xem →</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {task.status === "running" && (
        <div style={{
          width: 60, height: 4, background: "rgba(255,255,255,0.08)",
          borderRadius: 2, overflow: "hidden", flexShrink: 0,
        }}>
          <div style={{
            height: "100%", borderRadius: 2,
            background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
            width: `${task.progress || 0}%`, transition: "width 0.5s",
          }} />
        </div>
      )}

      {/* Push to WP button — only for completed, unpushed tasks */}
      {canPush && (
        <button
          className="btn btn-sm"
          onClick={(e) => { e.stopPropagation(); onPush?.(); }}
          style={{
            background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
            color: "#fff", border: "none", fontWeight: 600,
            fontSize: 10, padding: "4px 10px", flexShrink: 0,
            boxShadow: "0 2px 6px rgba(245,158,11,0.25)",
          }}
        >
          🚀 Push WP
        </button>
      )}

      {/* Remove button (for finished tasks) */}
      {(task.status === "done" || task.status === "error") && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            background: "none", border: "none", color: "var(--text-muted)",
            fontSize: 12, cursor: "pointer", padding: "2px 4px", flexShrink: 0,
            opacity: 0.5, transition: "opacity 0.2s",
          }}
          onMouseEnter={e => e.target.style.opacity = 1}
          onMouseLeave={e => e.target.style.opacity = 0.5}
          title="Xóa"
        >✕</button>
      )}
    </div>
  );
}

export default TaskQueueContext;
