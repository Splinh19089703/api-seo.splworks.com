/**
 * One-time migration script: Assign all orphaned records (no userId) to admin user.
 * 
 * Usage: node scripts/migrate-legacy.js <adminUserId>
 * Example: node scripts/migrate-legacy.js 69d85309a645ec237736b3f4
 */

const path = require("path");

// Manually init storage with the same DB path
const Database = require("better-sqlite3");
const DB_PATH = path.join(__dirname, "..", "data", "app.db");

console.log(`[Migration] Opening database: ${DB_PATH}`);
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const targetUserId = process.argv[2];
if (!targetUserId) {
  console.error("❌ Cần cung cấp adminUserId làm argument.");
  console.error("   Usage: node scripts/migrate-legacy.js <adminUserId>");
  process.exit(1);
}

console.log(`[Migration] Target userId: ${targetUserId}`);

// Find all orphaned records
const rows = db
  .prepare(
    `SELECT id, collection, data FROM collections 
     WHERE json_extract(data, '$.userId') IS NULL`
  )
  .all();

console.log(`[Migration] Tìm thấy ${rows.length} records không có userId.`);

if (rows.length === 0) {
  console.log("✅ Không có gì cần migrate. Tất cả records đã có userId.");
  process.exit(0);
}

// Summary by collection
const summary = {};
rows.forEach((r) => {
  summary[r.collection] = (summary[r.collection] || 0) + 1;
});
console.log("[Migration] Phân bổ theo collection:", summary);

// Run migration in a transaction
const updateStmt = db.prepare(
  `UPDATE collections SET data = ?, updated_at = ? WHERE id = ?`
);
const now = new Date().toISOString();

const runMigration = db.transaction(() => {
  for (const row of rows) {
    const data = JSON.parse(row.data);
    data.userId = targetUserId;
    updateStmt.run(JSON.stringify(data), now, row.id);
  }
});

runMigration();

console.log(`\n✅ Đã migrate ${rows.length} records thành công!`);
console.log("   Tất cả dữ liệu cũ giờ thuộc về userId:", targetUserId);
console.log("   Chi tiết:", summary);

db.close();
