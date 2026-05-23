const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "app.db");
const JSON_BACKUP_DIR = path.join(DATA_DIR); // where old .json files live

fs.ensureDirSync(DATA_DIR);

class Storage {
  constructor() {
    this.db = new Database(DB_PATH);
    // Enable WAL mode for better concurrent performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this._initTables();
    this._migrateFromJson();
  }

  /**
   * Create the generic collections table + settings table
   * Each "collection" is stored as rows in `collections` table
   * with the data stored as JSON text
   */
  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        collection TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_collection ON collections(collection);
      CREATE INDEX IF NOT EXISTS idx_collection_id ON collections(collection, id);
      CREATE INDEX IF NOT EXISTS idx_collection_created ON collections(collection, created_at);
      CREATE INDEX IF NOT EXISTS idx_collection_user ON collections(collection, json_extract(data, '$.userId'));

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '{}'
      );
    `);
  }

  /**
   * Auto-migrate existing JSON files to SQLite (one-time)
   */
  _migrateFromJson() {
    // Check if migration already done
    const count = this.db
      .prepare("SELECT COUNT(*) as c FROM collections")
      .get();
    if (count.c > 0) return; // Already has data

    const jsonFiles = [
      "projects",
      "articles",
      "kwplans",
      "audits",
      "api-keys",
      "wp-sites",
      "prompts",
      "videos",
      "links",
    ];

    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO collections (id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );

    const migrateMany = this.db.transaction((items, collection) => {
      for (const item of items) {
        const id = item.id || uuidv4();
        const createdAt = item.createdAt || new Date().toISOString();
        const updatedAt = item.updatedAt || new Date().toISOString();
        // Store everything except id/createdAt/updatedAt in data JSON
        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = item;
        insert.run(id, collection, JSON.stringify(rest), createdAt, updatedAt);
      }
    });

    for (const name of jsonFiles) {
      const filePath = path.join(JSON_BACKUP_DIR, `${name}.json`);
      if (fs.pathExistsSync(filePath)) {
        try {
          const items = fs.readJsonSync(filePath);
          if (Array.isArray(items) && items.length > 0) {
            migrateMany(items, name);
            console.log(
              `[Storage] Migrated ${items.length} items from ${name}.json`,
            );
          }
        } catch (e) {
          console.error(`[Storage] Failed to migrate ${name}.json:`, e.message);
        }
      }
    }

    // Migrate settings
    const settingsPath = path.join(JSON_BACKUP_DIR, "settings.json");
    if (fs.pathExistsSync(settingsPath)) {
      try {
        const settings = fs.readJsonSync(settingsPath);
        this.db
          .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
          .run("app", JSON.stringify(settings));
        console.log("[Storage] Migrated settings.json");
      } catch (e) {
        console.error("[Storage] Failed to migrate settings:", e.message);
      }
    }

    console.log("[Storage] ✅ Migration from JSON to SQLite complete!");
  }

  // ==================== CRUD API (same interface as before) ====================

  async getAll(collection) {
    const rows = this.db
      .prepare(
        "SELECT id, data, created_at, updated_at FROM collections WHERE collection = ? ORDER BY created_at DESC",
      )
      .all(collection);

    return rows.map((row) => ({
      id: row.id,
      ...JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get all items in a collection scoped to a specific user
   */
  async getAllForUser(collection, userId) {
    if (!userId) return [];
    const rows = this.db
      .prepare(
        `SELECT id, data, created_at, updated_at FROM collections 
         WHERE collection = ? AND json_extract(data, '$.userId') = ? 
         ORDER BY created_at DESC`,
      )
      .all(collection, userId);

    return rows.map((row) => ({
      id: row.id,
      ...JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Create a record with userId automatically injected
   */
  async createForUser(collection, data, userId) {
    return this.create(collection, { ...data, userId });
  }

  /**
   * Get by ID but verify it belongs to the user
   */
  async getByIdForUser(collection, id, userId) {
    if (!userId) return null;
    const item = await this.getById(collection, id);
    if (!item) return null;
    if (item.userId === userId) return item;
    return null; // Not owned by this user
  }

  /**
   * Migrate all legacy records (no userId) to a target userId.
   * Used to assign old data to admin account.
   * @param {string} targetUserId - The userId to assign to legacy records
   * @returns {{ migrated: number, collections: Object }} Summary of migration
   */
  migrateOrphanedRecords(targetUserId) {
    if (!targetUserId) throw new Error("targetUserId is required");

    const rows = this.db
      .prepare(
        `SELECT id, collection, data FROM collections 
         WHERE json_extract(data, '$.userId') IS NULL`
      )
      .all();

    const updateStmt = this.db.prepare(
      `UPDATE collections SET data = ?, updated_at = ? WHERE id = ?`
    );

    const now = new Date().toISOString();
    const summary = {};

    const runMigration = this.db.transaction(() => {
      for (const row of rows) {
        const data = JSON.parse(row.data);
        data.userId = targetUserId;
        updateStmt.run(JSON.stringify(data), now, row.id);
        summary[row.collection] = (summary[row.collection] || 0) + 1;
      }
    });
    runMigration();

    console.log(`[Storage] ✅ Migrated ${rows.length} orphaned records to userId: ${targetUserId}`, summary);
    return { migrated: rows.length, collections: summary };
  }


  async getById(collection, id) {
    const row = this.db
      .prepare(
        "SELECT id, data, created_at, updated_at FROM collections WHERE collection = ? AND id = ?",
      )
      .get(collection, id);

    if (!row) return null;
    return {
      id: row.id,
      ...JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(collection, data) {
    const id = data.id || uuidv4();
    const now = new Date().toISOString();
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = data;

    this.db
      .prepare(
        "INSERT INTO collections (id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, collection, JSON.stringify(rest), now, now);

    return { id, ...rest, createdAt: now, updatedAt: now };
  }

  async update(collection, id, data) {
    const existing = await this.getById(collection, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const { id: _id, createdAt: _c, updatedAt: _u, ...existingData } = existing;
    const { id: _id2, createdAt: _c2, updatedAt: _u2, ...newData } = data;
    const merged = { ...existingData, ...newData };

    this.db
      .prepare(
        "UPDATE collections SET data = ?, updated_at = ? WHERE collection = ? AND id = ?",
      )
      .run(JSON.stringify(merged), now, collection, id);

    return { id, ...merged, createdAt: existing.createdAt, updatedAt: now };
  }

  async delete(collection, id) {
    const result = this.db
      .prepare("DELETE FROM collections WHERE collection = ? AND id = ?")
      .run(collection, id);
    return result.changes > 0;
  }

  /**
   * Delete all rows in a collection where data fields match the filter.
   * @param {string} collection - Collection name
   * @param {Object} filter - { key: value } pairs to match against row data
   * @returns {number} Number of deleted rows
   */
  async deleteByFilter(collection, filter) {
    const rows = this.db
      .prepare("SELECT id, data FROM collections WHERE collection = ?")
      .all(collection);

    const deleteStmt = this.db.prepare(
      "DELETE FROM collections WHERE collection = ? AND id = ?"
    );

    let count = 0;
    const runDeletes = this.db.transaction(() => {
      for (const row of rows) {
        const data = JSON.parse(row.data);
        let match = true;
        for (const [k, v] of Object.entries(filter)) {
          if (data[k] !== v) { match = false; break; }
        }
        if (match) {
          deleteStmt.run(collection, row.id);
          count++;
        }
      }
    });
    runDeletes();
    return count;
  }

  /**
   * Query rows with JSON field filtering + pagination.
   * Uses SQLite json_extract() for efficient server-side filtering.
   * @param {string} collection - Collection name
   * @param {Object} filter - { key: value } pairs matched against JSON data fields
   * @param {Object} options - { limit, offset, sort, fields }
   * @returns {Array} Matched rows
   */
  async getByFilter(collection, filter = {}, { limit = 50, offset = 0, sort = 'DESC', lightweight = false } = {}) {
    let query;
    if (lightweight) {
      // Lightweight mode: return only metadata fields from JSON, not full data blob
      query = `SELECT id, created_at, updated_at,
        json_extract(data, '$.status') as status,
        json_extract(data, '$.wpPostId') as wpPostId,
        json_extract(data, '$.wpPostTitle') as wpPostTitle,
        json_extract(data, '$.wordCountBefore') as wordCountBefore,
        json_extract(data, '$.wordCountAfter') as wordCountAfter,
        json_extract(data, '$.changePercentage') as changePercentage,
        json_extract(data, '$.rewriteMode') as rewriteMode,
        json_extract(data, '$.usedProvider') as usedProvider,
        json_extract(data, '$.scheduledAt') as scheduledAt,
        json_extract(data, '$.pushedAt') as pushedAt
      FROM collections WHERE collection = ?`;
    } else {
      query = `SELECT id, data, created_at, updated_at FROM collections WHERE collection = ?`;
    }
    const params = [collection];

    for (const [key, value] of Object.entries(filter)) {
      query += ` AND json_extract(data, '$.${key}') = ?`;
      params.push(value);
    }

    query += ` ORDER BY created_at ${sort === 'ASC' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(...params);

    if (lightweight) {
      return rows.map(row => ({
        id: row.id,
        status: row.status,
        wpPostId: row.wpPostId,
        wpPostTitle: row.wpPostTitle,
        wordCountBefore: row.wordCountBefore,
        wordCountAfter: row.wordCountAfter,
        changePercentage: row.changePercentage,
        rewriteMode: row.rewriteMode,
        usedProvider: row.usedProvider,
        scheduledAt: row.scheduledAt,
        pushedAt: row.pushedAt,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }

    return rows.map(row => ({
      id: row.id,
      ...JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Count rows matching filter (without loading data).
   * @param {string} collection - Collection name
   * @param {Object} filter - { key: value } pairs
   * @returns {number} Count
   */
  async countByFilter(collection, filter = {}) {
    let query = `SELECT COUNT(*) as c FROM collections WHERE collection = ?`;
    const params = [collection];
    for (const [key, value] of Object.entries(filter)) {
      query += ` AND json_extract(data, '$.${key}') = ?`;
      params.push(value);
    }
    return this.db.prepare(query).get(...params).c;
  }

  /**
   * Check if any row exists matching filter.
   * @param {string} collection - Collection name
   * @param {Object} filter - { key: value } pairs
   * @returns {boolean}
   */
  async existsByFilter(collection, filter = {}) {
    return (await this.countByFilter(collection, filter)) > 0;
  }

  // ==================== Settings (key-value store) ====================

  // Settings cache (C3 — Performance: 60s TTL)
  _settingsCache = null;
  _settingsCacheTime = 0;
  _SETTINGS_TTL = 60000; // 1 minute

  async getSettings() {
    // Return cached if fresh
    if (this._settingsCache && (Date.now() - this._settingsCacheTime) < this._SETTINGS_TTL) {
      return this._settingsCache;
    }
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("app");
    const result = row ? JSON.parse(row.value) : this._defaultSettings();
    // Populate cache
    this._settingsCache = result;
    this._settingsCacheTime = Date.now();
    return result;
  }

  async saveSettings(settings) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run("app", JSON.stringify(settings));
    // Invalidate cache on write
    this._settingsCache = null;
    this._settingsCacheTime = 0;
    return settings;
  }

  _defaultSettings() {
    return {
      theme: "dark",
      aiProvider: {
        mode: "fallback",
        fallbackOrder: "gemini",
        textRouting: "auto-free",
        imageRouting: "auto-best",
        gemini: {
          textModel: "gemini-2.5-flash",
          imageModel: "imagen-4.0-fast-generate-001",
          thumbnailImageModel: "imagen-4.0-fast-generate-001",
          sectionImageModel: "imagen-4.0-fast-generate-001",
          timeout: 120,
        },
        openai: {
          textModel: "gpt-4o-mini",
          imageModel: "gpt-image-1",
          thumbnailImageModel: "gpt-image-1",
          sectionImageModel: "gpt-image-1",
          timeout: 120,
        },
        openrouter: {
          textModel: "google/gemini-2.5-flash",
          imageModel: "google/gemini-2.5-flash-preview-image",
          thumbnailImageModel: "google/gemini-2.5-flash-preview-image",
          sectionImageModel: "google/gemini-2.5-flash-preview-image",
          timeout: 120,
        },
      },
      processing: { batchSize: 5, maxRetries: 3, stuckTimeout: 30 },
      queue: { ai: 1, youtube: 2, media: 3, publishing: 2 },
    };
  }

  /**
   * Delete all expired response cache records.
   */
  async clearExpiredCache() {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `DELETE FROM collections 
       WHERE collection = 'response-cache' 
       AND json_extract(data, '$.expiresAt') < ?`
    ).run(now);
    return result.changes;
  }

  /**
   * Clear all cache records.
   */
  async clearAllCache() {
    const result = this.db.prepare(
      `DELETE FROM collections WHERE collection = 'response-cache'`
    ).run();
    return result.changes;
  }

  // Graceful shutdown
  close() {
    this.db.close();
  }
}

module.exports = new Storage();
