/**
 * queue.js — Publish Queue backend
 * Sprint 12 / T3
 *
 * Routes:
 *   GET    /api/queue              → list tất cả queue items
 *   POST   /api/queue              → thêm item vào queue
 *   PUT    /api/queue/:id          → cập nhật (reschedule, site...)
 *   DELETE /api/queue/:id          → xóa item
 *   POST   /api/queue/:id/publish  → publish ngay lập tức
 *
 * Cron: kiểm tra mỗi 60s, publish bài đến hạn
 */

const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const wpService = require("../services/wp-service");

// ============================================================
// HELPERS
// ============================================================

/**
 * Thực sự publish 1 queue item lên WordPress
 */
async function publishQueueItem(item) {
  const { sourceType, sourceId, siteId, wpStatus } = item;
  const userId = item.userId;

  // Lấy site WP
  const site = await storage.getByIdForUser("wp-sites", siteId, userId);
  if (!site) throw new Error(`WP site "${siteId}" không tìm thấy`);

  let title, content, metaTitle, metaDescription, focusKeyword, slug, thumbnailUrl;

  if (sourceType === "draft") {
    const draft = await storage.getByIdForUser("standalone-drafts", sourceId, userId);
    if (!draft) throw new Error(`Draft "${sourceId}" không tìm thấy`);
    const pipeline = draft.pipeline || {};
    const outline = pipeline.outline || {};
    const contentData = pipeline.content || {};
    title = outline.title || draft.keyword;
    content = contentData.html || "";
    metaTitle = outline.title || draft.keyword;
    metaDescription = outline.metaDescription || "";
    focusKeyword = outline.focusKeyword || draft.keyword;
    slug = draft.keyword
      ? draft.keyword.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-").replace(/-+/g, "-").trim()
      : "";
    thumbnailUrl = pipeline.thumbnail?.url;
  } else if (sourceType === "project-article") {
    // Project article
    const articles = await storage.getAll("articles");
    const article = articles.find(a => a.id === sourceId);
    const project = article?.projectId
      ? await storage.getByIdForUser("projects", article.projectId, userId)
      : null;
    if (article && !project) throw new Error(`Article "${sourceId}" khÃ´ng tÃ¬m tháº¥y`);
    if (!article) throw new Error(`Article "${sourceId}" không tìm thấy`);
    const pipeline = article.pipeline || {};
    const outline = pipeline.outline?.data || {};
    const contentData = pipeline.content?.data || {};
    title = outline.title || article.keyword;
    content = contentData.html || "";
    metaTitle = outline.title || article.keyword;
    metaDescription = outline.metaDescription || "";
    focusKeyword = article.keyword;
    slug = article.keyword
      ? article.keyword.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-").replace(/-+/g, "-").trim()
      : "";
    thumbnailUrl = pipeline.thumbnail?.url;
  } else {
    throw new Error(`sourceType "${sourceType}" không được hỗ trợ`);
  }

  if (!content) throw new Error("Bài viết chưa có nội dung HTML");

  // Upload thumbnail nếu có
  let featuredMediaId = null;
  if (thumbnailUrl && !thumbnailUrl.startsWith("data:")) {
    try {
      const media = await wpService.uploadImage(site, thumbnailUrl, title);
      featuredMediaId = media.id;
    } catch (e) {
      console.warn(`[Queue] Thumbnail upload failed: ${e.message}`);
    }
  }

  const result = await wpService.publish(site, {
    title, content, slug,
    status: wpStatus || "publish",
    featuredMediaId,
    metaTitle, metaDescription, focusKeyword,
  });

  return {
    wpPostId: result.id,
    wpLink: result.link,
    wpStatus: result.status,
    siteId: site.id,
    siteName: site.name,
    siteUrl: site.siteUrl,
    publishedAt: new Date().toISOString(),
  };
}

// ============================================================
// CRON — chạy mỗi 60 giây, tự publish bài đến hạn
// ============================================================

let cronInterval = null;

function startQueueCron() {
  if (cronInterval) return; // already running
  cronInterval = setInterval(async () => {
    try {
      const items = await storage.getAll("publish-queue");
      const now = new Date();
      const pending = items.filter(item =>
        item.status === "scheduled" &&
        item.scheduledAt &&
        new Date(item.scheduledAt) <= now
      );

      for (const item of pending) {
        console.log(`[Queue-Cron] Publishing "${item.title}" → ${item.siteName}...`);
        try {
          // Mark as publishing
          await storage.update("publish-queue", item.id, {
            status: "publishing",
            updatedAt: new Date().toISOString(),
          });

          const publishResult = await publishQueueItem(item);

          await storage.update("publish-queue", item.id, {
            status: "published",
            publishResult,
            updatedAt: new Date().toISOString(),
          });
          console.log(`[Queue-Cron] ✅ Published: ${publishResult.wpLink}`);
        } catch (e) {
          console.error(`[Queue-Cron] ❌ Failed "${item.title}": ${e.message}`);
          await storage.update("publish-queue", item.id, {
            status: "failed",
            errorMessage: e.message,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      console.error("[Queue-Cron] Error:", e.message);
    }
  }, 60 * 1000); // 60 giây

  console.log("[Queue-Cron] ✅ Started (check every 60s)");
}

// Khởi động cron ngay khi module được load
startQueueCron();

// ============================================================
// ROUTES
// ============================================================

// GET /api/queue — list tất cả queue items
router.get("/", async (req, res) => {
  try {
    const items = await storage.getAllForUser("publish-queue", req.userId);
    // Sort: scheduled trước → published sau
    items.sort((a, b) => {
      const order = { publishing: 0, scheduled: 1, failed: 2, published: 3 };
      if ((order[a.status] ?? 9) !== (order[b.status] ?? 9))
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      return new Date(a.scheduledAt || a.createdAt) - new Date(b.scheduledAt || b.createdAt);
    });
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/queue — thêm item vào queue
router.post("/", async (req, res) => {
  try {
    const { sourceType, sourceId, siteId, scheduledAt, wpStatus, title, keyword } = req.body;

    if (!sourceType || !sourceId || !siteId || !scheduledAt) {
      return res.status(400).json({ error: "sourceType, sourceId, siteId, scheduledAt là bắt buộc" });
    }

    // Validate site
    const site = await storage.getByIdForUser("wp-sites", siteId, req.userId);
    if (sourceType === "draft") {
      const draft = await storage.getByIdForUser("standalone-drafts", sourceId, req.userId);
      if (!draft) return res.status(404).json({ error: "Draft khÃ´ng tÃ¬m tháº¥y" });
    } else if (sourceType === "project-article") {
      const article = await storage.getById("articles", sourceId);
      const project = article?.projectId
        ? await storage.getByIdForUser("projects", article.projectId, req.userId)
        : null;
      if (!article || !project) return res.status(404).json({ error: "Article khÃ´ng tÃ¬m tháº¥y" });
    }
    if (!site) return res.status(404).json({ error: "WP site không tìm thấy" });

    // Check duplicate
    const existing = await storage.getAllForUser("publish-queue", req.userId);
    const dup = existing.find(i => i.sourceId === sourceId && i.status === "scheduled");
    if (dup) {
      return res.status(409).json({ error: "Bài viết này đã có lịch đăng. Xóa lịch cũ trước.", existingId: dup.id });
    }

    const item = await storage.createForUser("publish-queue", {
      sourceType,      // "draft" | "project-article"
      sourceId,
      siteId,
      siteName: site.name,
      siteUrl: site.siteUrl,
      scheduledAt,     // ISO string
      wpStatus: wpStatus || "publish",  // "publish" | "draft"
      title: title || keyword || sourceId,
      keyword: keyword || "",
      status: "scheduled",
    }, req.userId);

    console.log(`[Queue] Scheduled: "${item.title}" → ${site.name} at ${scheduledAt}`);
    res.status(201).json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/queue/:id — cập nhật (reschedule)
router.put("/:id", async (req, res) => {
  try {
    const item = await storage.getByIdForUser("publish-queue", req.params.id, req.userId);
    if (!item) return res.status(404).json({ error: "Queue item không tìm thấy" });
    if (item.status === "published") {
      return res.status(400).json({ error: "Không thể sửa bài đã đăng" });
    }

    const { scheduledAt, siteId, wpStatus } = req.body;
    const updates = { updatedAt: new Date().toISOString(), status: "scheduled" };
    if (scheduledAt) updates.scheduledAt = scheduledAt;
    if (wpStatus) updates.wpStatus = wpStatus;
    if (siteId) {
      const site = await storage.getByIdForUser("wp-sites", siteId, req.userId);
      if (!site) return res.status(404).json({ error: "WP site không tìm thấy" });
      updates.siteId = siteId;
      updates.siteName = site.name;
      updates.siteUrl = site.siteUrl;
    }

    const updated = await storage.update("publish-queue", req.params.id, updates);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/queue/:id — xóa item
router.delete("/:id", async (req, res) => {
  try {
    const item = await storage.getByIdForUser("publish-queue", req.params.id, req.userId);
    if (!item) return res.status(404).json({ error: "Queue item khÃ´ng tÃ¬m tháº¥y" });
    await storage.delete("publish-queue", req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/queue/:id/publish — publish ngay
router.post("/:id/publish", async (req, res) => {
  try {
    const item = await storage.getByIdForUser("publish-queue", req.params.id, req.userId);
    if (!item) return res.status(404).json({ error: "Queue item không tìm thấy" });

    await storage.update("publish-queue", item.id, {
      status: "publishing",
      updatedAt: new Date().toISOString(),
    });

    const publishResult = await publishQueueItem(item);

    await storage.update("publish-queue", item.id, {
      status: "published",
      publishResult,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, ...publishResult });
  } catch (e) {
    await storage.update("publish-queue", req.params.id, {
      status: "failed",
      errorMessage: e.message,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

// GET /api/queue/stats — thống kê
router.get("/stats", async (req, res) => {
  try {
    const items = await storage.getAllForUser("publish-queue", req.userId);
    res.json({
      total: items.length,
      scheduled: items.filter(i => i.status === "scheduled").length,
      publishing: items.filter(i => i.status === "publishing").length,
      published: items.filter(i => i.status === "published").length,
      failed: items.filter(i => i.status === "failed").length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
