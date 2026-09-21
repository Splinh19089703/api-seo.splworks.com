/**
 * social.js — Social Routes
 * Social SPLSEO — Phase 1: Facebook Integration
 *
 * ARCHITECTURE: Multi-tenant — Mỗi user tự nhập Page ID + Page Access Token.
 * Không có OAuth flow chung. Giống pattern WordPress/Blogger/Telegram trong publish.js.
 *
 * Routes:
 *   === Social Accounts ===
 *   GET    /api/social/accounts                 → Danh sách tài khoản
 *   GET    /api/social/accounts/:id             → Chi tiết 1 tài khoản
 *   POST   /api/social/accounts                 → Thêm tài khoản mới (nhập token)
 *   PUT    /api/social/accounts/:id             → Cập nhật tài khoản
 *   POST   /api/social/accounts/:id/test        → Test kết nối
 *   DELETE /api/social/accounts/:id             → Xóa tài khoản
 *
 *   === Share / Publish ===
 *   POST /api/social/share                      → Share link lên Page(s)
 *   POST /api/social/preview-url                → Preview OG data của URL
 *   POST /api/social/generate-caption           → AI viết caption Facebook từ link/title
 *
 *   === Batch Import URLs ===
 *   POST /api/social/import-urls                → Import list URL → queue
 *   GET  /api/social/queue                      → Danh sách queue
 *   PUT  /api/social/queue/:id                  → Cập nhật queue item
 *   DELETE /api/social/queue/:id                → Xóa queue item
 *   POST /api/social/queue/:id/publish          → Đăng ngay 1 item
 *
 *   === History ===
 *   GET  /api/social/history                    → Lịch sử share
 */

const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const facebookService = require("../services/facebook-service");
const { scrapeUrl, batchScrapeUrls } = require("../services/url-scraper");

// =====================================================================
// SOCIAL ACCOUNTS CRUD
// =====================================================================

/**
 * GET /accounts — List all connected social accounts
 */
router.get("/accounts", async (req, res) => {
  try {
    const accounts = await storage.getAllForUser("social-accounts", req.userId);
    // Hide tokens in list view (chỉ show 8 ký tự cuối)
    const safe = accounts.map((a) => ({
      ...a,
      credentials: a.credentials
        ? Object.fromEntries(
            Object.entries(a.credentials).map(([k, v]) => [
              k,
              typeof v === "string" && v.length > 8
                ? "••••" + v.slice(-8)
                : v,
            ])
          )
        : {},
    }));
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /accounts/:id — Get single account (full credentials for edit)
 */
router.get("/accounts/:id", async (req, res) => {
  try {
    const account = await storage.getByIdForUser(
      "social-accounts",
      req.params.id,
      req.userId
    );
    if (!account)
      return res.status(404).json({ error: "Tài khoản không tìm thấy" });
    res.json(account);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /accounts — Create new social account
 * Body: { platform, name, credentials: { pageId, pageToken }, autoShare }
 */
router.post("/accounts", async (req, res) => {
  try {
    const { platform, name, credentials, autoShare } = req.body;

    if (!platform)
      return res.status(400).json({ error: "Platform là bắt buộc" });
    if (!credentials)
      return res.status(400).json({ error: "Credentials là bắt buộc" });

    // Validate based on platform
    if (platform === "facebook") {
      if (!credentials.pageId || !credentials.pageToken) {
        return res.status(400).json({
          error: "Page ID và Page Access Token là bắt buộc",
        });
      }
    }

    // Auto-fetch page info if Facebook
    let pageInfo = {};
    if (platform === "facebook") {
      try {
        const info = await facebookService.getPageInfo(
          credentials.pageId,
          credentials.pageToken
        );
        pageInfo = {
          pageName: info.name || name || "Facebook Page",
          pageAvatar: info.picture?.data?.url || null,
          fanCount: info.fan_count || 0,
          category: info.category || "",
          pageLink: info.link || "",
        };
      } catch (err) {
        // Non-blocking: still save even if info fetch fails
        console.warn("[Social] Could not fetch page info:", err.message);
        pageInfo = {
          pageName: name || `Page ${credentials.pageId}`,
          pageAvatar: null,
          fanCount: 0,
          category: "",
        };
      }
    }

    const account = await storage.createForUser(
      "social-accounts",
      {
        platform,
        name: pageInfo.pageName || name || platform,
        credentials,
        // Flatten key fields for easy access
        pageId: credentials.pageId || null,
        pageName: pageInfo.pageName || name || platform,
        pageAvatar: pageInfo.pageAvatar || null,
        fanCount: pageInfo.fanCount || 0,
        category: pageInfo.category || "",
        active: true,
        autoShare: autoShare || false,
        stats: { totalShared: 0, lastShared: null },
      },
      req.userId
    );

    res.status(201).json(account);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /accounts/:id — Update account settings
 */
router.put("/accounts/:id", async (req, res) => {
  try {
    const account = await storage.getByIdForUser(
      "social-accounts",
      req.params.id,
      req.userId
    );
    if (!account)
      return res.status(404).json({ error: "Tài khoản không tìm thấy" });

    const allowedFields = [
      "active",
      "autoShare",
      "name",
      "credentials",
      "pageName",
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    // If credentials updated with pageToken, re-fetch page info
    if (updates.credentials?.pageToken && updates.credentials?.pageId) {
      try {
        const info = await facebookService.getPageInfo(
          updates.credentials.pageId,
          updates.credentials.pageToken
        );
        updates.pageName = info.name || account.pageName;
        updates.pageAvatar = info.picture?.data?.url || account.pageAvatar;
        updates.fanCount = info.fan_count || account.fanCount;
        updates.category = info.category || account.category;
        updates.pageId = updates.credentials.pageId;
      } catch {}
    }

    updates.updatedAt = new Date().toISOString();
    const updated = await storage.update(
      "social-accounts",
      req.params.id,
      updates
    );
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /accounts/:id/test — Test connection
 */
router.post("/accounts/:id/test", async (req, res) => {
  try {
    const account = await storage.getByIdForUser(
      "social-accounts",
      req.params.id,
      req.userId
    );
    if (!account)
      return res.status(404).json({ error: "Tài khoản không tìm thấy" });

    const creds = account.credentials || {};

    if (account.platform === "facebook") {
      const result = await facebookService.testConnection(
        creds.pageId || account.pageId,
        creds.pageToken
      );

      // If test success, update page info
      if (result.success && result.pageInfo) {
        await storage.update("social-accounts", account.id, {
          pageName: result.pageInfo.name || account.pageName,
          pageAvatar: result.pageInfo.picture || account.pageAvatar,
          fanCount: result.pageInfo.fanCount || account.fanCount,
          category: result.pageInfo.category || account.category,
        });
      }

      res.json(result);
    } else {
      res.json({
        success: false,
        message: `${account.platform} chưa được hỗ trợ`,
      });
    }
  } catch (e) {
    res.json({ success: false, message: `Lỗi: ${e.message}` });
  }
});

/**
 * DELETE /accounts/:id — Remove social account
 */
router.delete("/accounts/:id", async (req, res) => {
  try {
    const account = await storage.getByIdForUser(
      "social-accounts",
      req.params.id,
      req.userId
    );
    if (!account)
      return res.status(404).json({ error: "Tài khoản không tìm thấy" });
    await storage.delete("social-accounts", req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// SHARE / PUBLISH
// =====================================================================

/**
 * POST /share — Share a link to one or more Facebook Pages
 * Body: { accountIds: string[], link: string, message?: string, type?: "link"|"photo"|"text" }
 */
router.post("/share", async (req, res) => {
  try {
    const { accountIds, link, message, type = "link" } = req.body;

    if (!accountIds?.length) {
      return res
        .status(400)
        .json({ error: "Vui lòng chọn ít nhất 1 tài khoản" });
    }
    if (type === "link" && !link) {
      return res.status(400).json({ error: "Link là bắt buộc" });
    }
    if (type === "text" && !message) {
      return res
        .status(400)
        .json({ error: "Nội dung bài viết là bắt buộc" });
    }

    const results = [];

    for (const accountId of accountIds) {
      const account = await storage.getByIdForUser(
        "social-accounts",
        accountId,
        req.userId
      );
      if (!account) {
        results.push({
          accountId,
          success: false,
          error: "Tài khoản không tìm thấy",
        });
        continue;
      }

      const creds = account.credentials || {};
      const pageId = creds.pageId || account.pageId;
      const pageToken = creds.pageToken;

      if (!pageId || !pageToken) {
        results.push({
          accountId,
          accountName: account.pageName,
          success: false,
          error: "Thiếu Page ID hoặc Page Token",
        });
        continue;
      }

      try {
        let result;
        if (account.platform === "facebook") {
          if (type === "photo") {
            result = await facebookService.publishPhoto(pageId, pageToken, {
              url: link,
              caption: message || "",
            });
          } else if (type === "text") {
            result = await facebookService.publishTextPost(
              pageId,
              pageToken,
              { message }
            );
          } else {
            result = await facebookService.publishLink(pageId, pageToken, {
              link,
              message: message || "",
            });
          }
        } else {
          throw new Error(`Platform ${account.platform} chưa được hỗ trợ`);
        }

        // Save to history
        await storage.createForUser(
          "social-history",
          {
            accountId,
            accountName: account.pageName,
            platform: account.platform,
            type,
            link: link || null,
            message: message || null,
            status: "success",
            result,
            error: null,
            sharedAt: new Date().toISOString(),
          },
          req.userId
        );

        // Update stats
        await storage.update("social-accounts", accountId, {
          stats: {
            totalShared: (account.stats?.totalShared || 0) + 1,
            lastShared: new Date().toISOString(),
          },
        });

        results.push({
          accountId,
          accountName: account.pageName,
          platform: account.platform,
          success: true,
          ...result,
        });
      } catch (pubErr) {
        const errorMsg =
          pubErr.response?.data?.error?.message || pubErr.message;

        await storage.createForUser(
          "social-history",
          {
            accountId,
            accountName: account.pageName,
            platform: account.platform,
            type,
            link: link || null,
            message: message || null,
            status: "failed",
            result: null,
            error: errorMsg,
            sharedAt: new Date().toISOString(),
          },
          req.userId
        );

        results.push({
          accountId,
          accountName: account.pageName,
          platform: account.platform,
          success: false,
          error: errorMsg,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    res.json({
      success: successCount > 0,
      message: `Chia sẻ thành công ${successCount}/${results.length} tài khoản`,
      results,
    });
  } catch (e) {
    console.error("[Social] Share error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /preview-url — Scrape a URL and return OG preview data
 */
router.post("/preview-url", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL là bắt buộc" });
    const ogData = await scrapeUrl(url);
    res.json(ogData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /generate-caption — AI generate engaging Facebook caption
 * Body: { url, title, description, tone }
 */
router.post("/generate-caption", async (req, res) => {
  try {
    const { url, title, description, tone = "engaging" } = req.body;
    if (!title && !url && !description) {
      return res.status(400).json({ error: "Cần cung cấp link hoặc tiêu đề bài viết" });
    }

    const aiService = require("../services/ai-service");
    const settings = (await storage.getForUser("settings", "ai", req.userId)) || {};

    const prompt = `Bạn là chuyên gia Social Media Marketing hàng đầu. Hãy viết 1 caption Facebook cực kỳ cuốn hút, giữ chân người xem và kích thích tương tác, click vào xem bài viết.

THÔNG TIN BÀI VIẾT:
- Tiêu đề: "${title || ""}"
- Tóm tắt/Nội dung chính: "${description || ""}"
- Đường dẫn bài viết: ${url || ""}

YÊU CẦU ĐỊNH DẠNG:
1. Hook mở đầu (1-2 câu): Giật tít, tò mò, đánh trúng insight hoặc nỗi đau, có emoji ấn tượng (🔥, 💡, 🚀, 📌, ⚠️).
2. Tóm tắt giá trị (3-4 gạch đầu dòng): Mỗi gạch đầu dòng ngắn gọn (1 dòng), dùng emoji dẫn đầu (ví dụ: 👉, ✅, ⭐).
3. Lời kêu gọi hành động (CTA): Mời đọc chi tiết bài viết (ví dụ: "👉 Chi tiết xem tại bài viết bên dưới 👇").
4. Hashtags: 3 - 5 hashtags tiếng Việt phù hợp (có dấu và không dấu).

LƯU Ý:
- Tuyệt đối tự nhiên, tiếng Việt chuẩn, không xưng hô máy móc hay chào hỏi khách sáo.
- Trả về DUY NHẤT nội dung caption hoàn chỉnh, không kèm giải thích hay ghi chú thêm.`;

    const caption = await aiService.generate(prompt, settings, {});
    res.json({ caption: caption ? caption.trim() : "" });
  } catch (e) {
    console.error("[Social] Generate caption error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// BATCH IMPORT URLs → SOCIAL QUEUE
// =====================================================================

/**
 * POST /import-urls — Import list of URLs into social queue
 */
router.post("/import-urls", async (req, res) => {
  try {
    const {
      urls = [],
      accountIds = [],
      scheduleType = "scheduled",
      intervalMinutes = 30,
      useAI = false,
      startAt,
    } = req.body;

    if (!urls.length)
      return res.status(400).json({ error: "Vui lòng nhập ít nhất 1 URL" });
    if (!accountIds.length)
      return res
        .status(400)
        .json({ error: "Vui lòng chọn ít nhất 1 tài khoản" });

    const validUrls = urls
      .map((u) => u.trim())
      .filter(
        (u) => u && (u.startsWith("http://") || u.startsWith("https://"))
      );

    if (!validUrls.length) {
      return res.status(400).json({
        error:
          "Không có URL hợp lệ (phải bắt đầu bằng http:// hoặc https://)",
      });
    }

    // Batch scrape OG data
    const ogDataList = await batchScrapeUrls(validUrls, 3);

    let baseTime = startAt ? new Date(startAt) : new Date();
    if (scheduleType === "immediate") baseTime = new Date();

    const queueItems = [];

    for (let i = 0; i < validUrls.length; i++) {
      const url = validUrls[i];
      const ogData = ogDataList[i] || {
        title: url,
        description: "",
        image: null,
      };
      const scheduledAt = new Date(
        baseTime.getTime() + i * intervalMinutes * 60 * 1000
      );

      for (const accountId of accountIds) {
        const item = await storage.createForUser(
          "social-queue",
          {
            platform: "facebook",
            accountId,
            url,
            ogData,
            message: "",
            useAI,
            status:
              scheduleType === "immediate" && i === 0
                ? "pending"
                : "scheduled",
            scheduledAt: scheduledAt.toISOString(),
            publishedAt: null,
            result: null,
            error: null,
          },
          req.userId
        );
        queueItems.push(item);
      }
    }

    res.json({
      success: true,
      message: `Đã thêm ${queueItems.length} bài vào hàng đợi (${validUrls.length} URL × ${accountIds.length} tài khoản)`,
      totalItems: queueItems.length,
      firstScheduledAt: queueItems[0]?.scheduledAt,
      lastScheduledAt: queueItems[queueItems.length - 1]?.scheduledAt,
    });
  } catch (e) {
    console.error("[Social] Import URLs error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// SOCIAL QUEUE
// =====================================================================

router.get("/queue", async (req, res) => {
  try {
    let items = await storage.getAllForUser("social-queue", req.userId);
    if (req.query.status)
      items = items.filter((i) => i.status === req.query.status);
    items.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/queue/:id", async (req, res) => {
  try {
    const item = await storage.getByIdForUser(
      "social-queue",
      req.params.id,
      req.userId
    );
    if (!item) return res.status(404).json({ error: "Không tìm thấy" });
    if (item.status === "published")
      return res.status(400).json({ error: "Không thể sửa bài đã đăng" });

    const allowedFields = ["message", "scheduledAt", "useAI", "status"];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    const updated = await storage.update(
      "social-queue",
      req.params.id,
      updates
    );
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/queue/:id", async (req, res) => {
  try {
    const item = await storage.getByIdForUser(
      "social-queue",
      req.params.id,
      req.userId
    );
    if (!item) return res.status(404).json({ error: "Không tìm thấy" });
    await storage.delete("social-queue", req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/queue/:id/publish", async (req, res) => {
  try {
    const item = await storage.getByIdForUser(
      "social-queue",
      req.params.id,
      req.userId
    );
    if (!item) return res.status(404).json({ error: "Không tìm thấy" });
    if (item.status === "published")
      return res.status(400).json({ error: "Bài này đã được đăng" });

    const account = await storage.getByIdForUser(
      "social-accounts",
      item.accountId,
      req.userId
    );
    if (!account)
      return res
        .status(404)
        .json({ error: "Tài khoản social không tìm thấy" });

    const creds = account.credentials || {};
    const pageId = creds.pageId || account.pageId;
    const pageToken = creds.pageToken;

    try {
      const result = await facebookService.publishLink(pageId, pageToken, {
        link: item.url,
        message: item.message || item.ogData?.title || "",
      });

      await storage.update("social-queue", item.id, {
        status: "published",
        publishedAt: new Date().toISOString(),
        result,
        error: null,
      });

      await storage.createForUser(
        "social-history",
        {
          accountId: account.id,
          accountName: account.pageName,
          platform: account.platform,
          type: "link",
          link: item.url,
          message: item.message,
          status: "success",
          result,
          error: null,
          source: "queue",
          sharedAt: new Date().toISOString(),
        },
        req.userId
      );

      await storage.update("social-accounts", account.id, {
        stats: {
          totalShared: (account.stats?.totalShared || 0) + 1,
          lastShared: new Date().toISOString(),
        },
      });

      res.json({ success: true, ...result });
    } catch (pubErr) {
      const errorMsg =
        pubErr.response?.data?.error?.message || pubErr.message;
      await storage.update("social-queue", item.id, {
        status: "failed",
        error: errorMsg,
      });
      res.json({ success: false, error: errorMsg });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// SOCIAL HISTORY
// =====================================================================

router.get("/history", async (req, res) => {
  try {
    let history = await storage.getAllForUser("social-history", req.userId);
    if (req.query.platform)
      history = history.filter((h) => h.platform === req.query.platform);
    if (req.query.status)
      history = history.filter((h) => h.status === req.query.status);
    history.sort(
      (a, b) =>
        new Date(b.sharedAt || b.createdAt) -
        new Date(a.sharedAt || a.createdAt)
    );
    res.json(history.slice(0, 100));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
