const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const publishService = require("../services/publish-service");

// ===== Publishing Accounts CRUD =====

// GET all accounts
router.get("/accounts", async (req, res) => {
  try {
    const accounts = await storage.getAllForUser("publishing-accounts", req.userId);
    // Hide sensitive credentials in list view
    const safe = accounts.map(a => ({
      ...a,
      credentials: Object.fromEntries(
        Object.entries(a.credentials || {}).map(([k, v]) =>
          [k, typeof v === "string" && v.length > 4 ? v.substring(0, 4) + "••••" : v]
        )
      ),
    }));
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET single account (full credentials for edit)
router.get("/accounts/:id", async (req, res) => {
  try {
    const account = await storage.getByIdForUser("publishing-accounts", req.params.id, req.userId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json(account);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST create account
router.post("/accounts", async (req, res) => {
  try {
    const account = await storage.createForUser("publishing-accounts", {
      platform: req.body.platform,
      name: req.body.name || req.body.platform,
      active: req.body.active !== false,
      credentials: req.body.credentials || {},
      defaults: req.body.defaults || { status: "draft" },
      stats: { totalPublished: 0, lastPublished: null },
    }, req.userId);
    res.status(201).json(account);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT update account
router.put("/accounts/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("publishing-accounts", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Account not found" });
    const { userId: _userId, ...updates } = req.body;
    const updated = await storage.update("publishing-accounts", req.params.id, updates);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE account
router.delete("/accounts/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("publishing-accounts", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Account not found" });
    await storage.delete("publishing-accounts", req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST test connection
router.post("/accounts/:id/test", async (req, res) => {
  try {
    const account = await storage.getByIdForUser("publishing-accounts", req.params.id, req.userId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const result = await publishService.testConnection(account);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: `❌ Lỗi: ${e.message}` });
  }
});

// POST sync categories
router.post("/accounts/:id/categories", async (req, res) => {
  try {
    const account = await storage.getByIdForUser("publishing-accounts", req.params.id, req.userId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const categories = await publishService.getCategories(account);
    await storage.update("publishing-accounts", req.params.id, { categories });
    res.json(categories);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Publish Now =====

router.post("/now", async (req, res) => {
  try {
    const { articleId, articleType, projectId, accounts: accountIds, options } = req.body;
    if (!articleId || !accountIds?.length) {
      return res.status(400).json({ error: "articleId và accounts là bắt buộc" });
    }

    // Load article data
    let article;
    if (articleType === "project" && projectId) {
      const project = await storage.getByIdForUser("projects", projectId, req.userId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const raw = await storage.getByIdForUser("articles", articleId, req.userId);
      if (!raw || raw.projectId !== projectId) return res.status(404).json({ error: "Article not found" });
      article = {
        title: raw.pipeline?.outline?.data?.title || raw.title || raw.keyword,
        content: raw.pipeline?.content?.data?.html || "",
        metaTitle: raw.pipeline?.outline?.data?.title || "",
        metaDescription: raw.pipeline?.outline?.data?.metaDescription || "",
        focusKeyword: raw.keyword || "",
        thumbnailUrl: raw.pipeline?.thumbnail?.url || null,
      };
    } else {
      // Standalone draft
      const draft = await storage.getByIdForUser("standalone-drafts", articleId, req.userId);
      if (!draft) return res.status(404).json({ error: "Draft not found" });
      article = {
        title: draft.pipeline?.outline?.title || draft.keyword,
        content: draft.pipeline?.content?.html || "",
        metaTitle: draft.pipeline?.outline?.title || "",
        metaDescription: draft.pipeline?.outline?.metaDescription || "",
        focusKeyword: draft.keyword || "",
        thumbnailUrl: draft.pipeline?.thumbnail?.url || null,
      };
    }

    if (!article.content) {
      return res.status(400).json({ error: "Bài viết chưa có nội dung." });
    }

    // Publish to each account
    const results = [];
    for (const accountId of accountIds) {
      const account = await storage.getByIdForUser("publishing-accounts", accountId, req.userId);
      if (!account) {
        results.push({ accountId, success: false, error: "Account not found" });
        continue;
      }

      // --- License: Multi-platform feature check ---
      if (account.platform !== "wordpress" && !req.license?.features?.multiPlatform) {
        results.push({
          accountId,
          accountName: account.name,
          platform: account.platform,
          success: false,
          error: `Đăng lên ${account.platform} cần gói Pro trở lên`,
          code: "FEATURE_LOCKED",
          feature: "multiPlatform",
          currentPlan: req.license?.plan,
        });
        continue;
      }

      try {
        // Upload thumbnail for WordPress
        let featuredMediaId = null;
        if (article.thumbnailUrl && account.platform === "wordpress") {
          try {
            const uploaded = await publishService.uploadImage(account, article.thumbnailUrl, article.title);
            featuredMediaId = uploaded.id;
          } catch (imgErr) {
            console.warn(`[Publish] Thumbnail upload failed for ${account.name}: ${imgErr.message}`);
          }
        }

        const pubArticle = { ...article, featuredMediaId };
        const result = await publishService.publish(account, pubArticle, options || {});

        // Save history
        await storage.createForUser("publishing-history", {
          articleId,
          articleType: articleType || "standalone",
          projectId: projectId || null,
          accountId: account.id,
          accountName: account.name,
          platform: account.platform,
          status: "success",
          result,
          error: null,
          publishedAt: new Date().toISOString(),
        }, req.userId);

        // Update account stats
        await storage.update("publishing-accounts", account.id, {
          stats: {
            totalPublished: (account.stats?.totalPublished || 0) + 1,
            lastPublished: new Date().toISOString(),
          },
        });

        results.push({ accountId, accountName: account.name, platform: account.platform, success: true, ...result });

        // ===== Auto Indexer: Submit published URL to Bing/Google =====
        const publishedUrl = result?.url || result?.link || result?.postUrl;
        if (publishedUrl && projectId) {
          try {
            const project = await storage.getByIdForUser("projects", projectId, req.userId);
            const indexingCfg = project?.config?.indexing;
            if (indexingCfg?.autoIndexOnPublish) {
              const indexerRoute = require("./indexer");
              setImmediate(() => indexerRoute.autoIndex(projectId, [publishedUrl], req.userId));
              console.log(`[Publish] Auto-index queued for: ${publishedUrl}`);
            }
          } catch (idxErr) {
            console.warn("[Publish] Auto-index trigger failed:", idxErr.message);
          }

          // ===== Auto Social Share: Share published URL to connected Facebook Pages =====
          setImmediate(async () => {
            try {
              const socialAccounts = await storage.getAllForUser("social-accounts", req.userId);
              const autoShareAccounts = socialAccounts.filter(a => a.platform === "facebook" && a.active && a.autoShare);
              if (!autoShareAccounts.length) return;

              const facebookService = require("../services/facebook-service");
              for (const fb of autoShareAccounts) {
                const creds = fb.credentials || {};
                const pageId = creds.pageId || fb.pageId;
                const pageToken = creds.pageToken;
                if (!pageId || !pageToken) continue;
                try {
                  const shareResult = await facebookService.publishLink(pageId, pageToken, {
                    link: publishedUrl,
                    message: article.metaDescription || article.title || "",
                  });
                  // Save to social history
                  await storage.createForUser("social-history", {
                    accountId: fb.id,
                    accountName: fb.pageName,
                    platform: "facebook",
                    type: "link",
                    link: publishedUrl,
                    message: article.metaDescription || article.title || "",
                    status: "success",
                    result: shareResult,
                    error: null,
                    source: "auto-publish",
                    sharedAt: new Date().toISOString(),
                  }, req.userId);
                  // Update stats
                  await storage.update("social-accounts", fb.id, {
                    stats: { totalShared: (fb.stats?.totalShared || 0) + 1, lastShared: new Date().toISOString() },
                  });
                  console.log(`[Publish] Auto-shared to FB: ${fb.pageName}`);
                } catch (fbErr) {
                  console.warn(`[Publish] Auto-share to ${fb.pageName} failed: ${fbErr.message}`);
                }
              }
            } catch (socialErr) {
              console.warn("[Publish] Auto social share failed:", socialErr.message);
            }
          });
        }
      } catch (pubErr) {
        // Save failed history
        await storage.createForUser("publishing-history", {
          articleId,
          articleType: articleType || "standalone",
          projectId: projectId || null,
          accountId: account.id,
          accountName: account.name,
          platform: account.platform,
          status: "failed",
          result: null,
          error: pubErr.message,
          publishedAt: new Date().toISOString(),
        }, req.userId);
        results.push({ accountId, accountName: account.name, platform: account.platform, success: false, error: pubErr.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: successCount > 0,
      message: `Đăng thành công ${successCount}/${results.length} nền tảng`,
      results,
    });
  } catch (e) {
    console.error("[Publish] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== History =====

router.get("/history", async (req, res) => {
  try {
    let history = await storage.getAllForUser("publishing-history", req.userId);
    // Optional filters
    if (req.query.platform) history = history.filter(h => h.platform === req.query.platform);
    if (req.query.status) history = history.filter(h => h.status === req.query.status);
    // Sort newest first
    history.sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
    res.json(history.slice(0, 100));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/history/:articleId", async (req, res) => {
  try {
    const all = await storage.getAllForUser("publishing-history", req.userId);
    const filtered = all.filter(h => h.articleId === req.params.articleId);
    filtered.sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
