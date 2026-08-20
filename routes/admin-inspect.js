const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const licenseClient = require("../services/license-client");
const { licenseGuard } = require("../middleware/license-guard");

// Apply licenseGuard to all admin inspect routes
router.use(licenseGuard);

// Middleware: Admin Only verification
function adminOnly(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({
      error: "Chỉ quản trị viên mới có quyền truy cập trang này",
      code: "FORBIDDEN",
    });
  }
  next();
}

router.use(adminOnly);

/**
 * GET /api/admin/users
 * Lists all registered users with their license status and SQLite activity aggregates
 */
router.get("/users", async (req, res) => {
  try {
    let licenseUsers = [];
    let licenseMap = {};
    let usageMap = {};

    // 1. Fetch from License Server
    try {
      const response = await licenseClient.adminGetUsers(req.authToken);
      if (response && Array.isArray(response.users)) {
        licenseUsers = response.users;
      }
      if (response && Array.isArray(response.licenses)) {
        for (const lic of response.licenses) {
          const uId = String(lic.userId || "");
          if (uId && (!licenseMap[uId] || lic.status === "active")) {
            licenseMap[uId] = lic;
          }
        }
      }
      if (response && Array.isArray(response.usages)) {
        for (const usg of response.usages) {
          const licId = String(usg.licenseId || "");
          if (licId) usageMap[licId] = usg;
        }
      }
    } catch (err) {
      console.warn("[AdminInspect] Could not fetch users from license server:", err.message || err);
    }

    // 2. Fetch activity aggregates from SQLite app.db
    const aggregates = await storage.getAdminUserAggregates();

    // 3. Merge users
    const userMap = new Map();

    for (const u of licenseUsers) {
      const uId = String(u._id || u.id);
      const lic = licenseMap[uId] || null;
      const currentUsage = lic ? (usageMap[String(lic._id || lic.id)] || null) : null;
      const stats = aggregates[uId] || {
        projectsCount: 0,
        articlesCount: 0,
        draftsCount: 0,
        auditsCount: 0,
        wpSitesCount: 0,
        errorArticlesCount: 0,
      };

      userMap.set(uId, {
        id: uId,
        email: u.email,
        name: u.name || (u.email ? u.email.split("@")[0] : "Khách hàng"),
        role: u.role || "user",
        avatarUrl: u.avatarUrl || null,
        createdAt: u.createdAt || null,
        license: lic
          ? {
              id: lic._id || lic.id,
              plan: lic.plan || "trial",
              period: lic.period || "trial",
              status: lic.status || "active",
              expiresAt: lic.expiresAt || null,
              limits: lic.limits || {},
            }
          : null,
        usage: currentUsage
          ? {
              articlesCreated: currentUsage.articlesCreated || 0,
              articlesPublished: currentUsage.articlesPublished || 0,
              aiCalls: currentUsage.aiCalls || 0,
            }
          : { articlesCreated: 0, articlesPublished: 0, aiCalls: 0 },
        stats,
      });
    }

    // 4. Include any userIds that exist in SQLite but not in License Server (e.g. dev-user or orphaned records)
    for (const [uId, stats] of Object.entries(aggregates)) {
      if (uId && !userMap.has(uId)) {
        userMap.set(uId, {
          id: uId,
          email: uId === "dev-user" ? "dev@splseo.vn" : `user_${uId.slice(0, 8)}@splseo.local`,
          name: uId === "dev-user" ? "Developer Mode" : `User (${uId.slice(0, 6)}...)`,
          role: uId === "dev-user" ? "admin" : "user",
          avatarUrl: null,
          createdAt: null,
          license: null,
          usage: { articlesCreated: 0, articlesPublished: 0, aiCalls: 0 },
          stats,
        });
      }
    }

    const usersList = Array.from(userMap.values()).sort((a, b) => {
      // Sort users with errors or most activity first, then by date
      if (b.stats.errorArticlesCount !== a.stats.errorArticlesCount) {
        return b.stats.errorArticlesCount - a.stats.errorArticlesCount;
      }
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    res.json({
      success: true,
      total: usersList.length,
      users: usersList,
    });
  } catch (error) {
    console.error("[AdminInspect] Error listing users:", error);
    res.status(500).json({ error: "Lỗi khi lấy danh sách user: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/summary
 * Detailed activity breakdown for a specific user
 */
router.get("/users/:userId/summary", async (req, res) => {
  try {
    const { userId } = req.params;
    const projects = await storage.getAllForUser("projects", userId);
    const drafts = await storage.getAllForUser("standalone-drafts", userId);
    const audits = await storage.getAllForUser("audits", userId);
    const wpSites = await storage.getAllForUser("wp-sites", userId);
    const allArticles = await storage.getArticlesForUserAdmin(userId);

    const errorArticles = allArticles.filter(
      (a) => a.status === "error" || a.error || (a.generationLogs && a.generationLogs.some(l => l.status === "error"))
    );

    const errorDrafts = drafts.filter(
      (d) => d.status === "error" || d.error
    );

    res.json({
      success: true,
      userId,
      summary: {
        projectsCount: projects.length,
        articlesCount: allArticles.length,
        draftsCount: drafts.length,
        auditsCount: audits.length,
        wpSitesCount: wpSites.length,
        totalErrors: errorArticles.length + errorDrafts.length,
        errorArticlesCount: errorArticles.length,
        errorDraftsCount: errorDrafts.length,
      },
      recentErrors: [
        ...errorArticles.map(a => ({ type: "article", id: a.id, title: a.title || a.keyword, error: a.error || "Lỗi tạo bài", date: a.updatedAt || a.createdAt, projectId: a.projectId, projectName: a.projectName })),
        ...errorDrafts.map(d => ({ type: "draft", id: d.id, title: d.title || d.keyword || d.topic, error: d.error || "Lỗi pipeline", date: d.updatedAt || d.createdAt })),
      ].slice(0, 10),
    });
  } catch (error) {
    console.error("[AdminInspect] Error fetching user summary:", error);
    res.status(500).json({ error: "Lỗi lấy tóm tắt user: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/credits
 * Returns detailed credits, limits, monthly usage history, and SQLite content metrics
 */
router.get("/users/:userId/credits", async (req, res) => {
  try {
    const { userId } = req.params;
    let license = null;
    let usageHistory = [];

    try {
      const resp = await licenseClient.adminGetUserCredits(req.authToken, userId);
      if (resp) {
        license = resp.license;
        usageHistory = resp.usageHistory || [];
      }
    } catch (err) {
      console.warn("[AdminInspect] Could not fetch credits from license server:", err.message);
    }

    // SQLite aggregates
    const allArticles = await storage.getArticlesForUserAdmin(userId);
    const drafts = await storage.getAllForUser("standalone-drafts", userId);
    const audits = await storage.getAllForUser("audits", userId);
    const projects = await storage.getAllForUser("projects", userId);

    let totalWords = 0;
    let totalImages = 0;
    let publishedArticles = 0;
    let failedArticles = 0;

    for (const a of allArticles) {
      totalWords += parseInt(a.wordCount) || 0;
      if (a.thumbnail) totalImages++;
      if (Array.isArray(a.images)) totalImages += a.images.length;
      if (a.status === "published" || a.wpPostId) publishedArticles++;
      if (a.status === "error" || a.error) failedArticles++;
    }

    for (const d of drafts) {
      totalWords += parseInt(d.wordCount) || 0;
      if (d.thumbnail) totalImages++;
      if (Array.isArray(d.images)) totalImages += d.images.length;
      if (d.status === "published") publishedArticles++;
      if (d.status === "error" || d.error) failedArticles++;
    }

    res.json({
      success: true,
      userId,
      license,
      usageHistory,
      currentUsage: usageHistory[0] || { articlesCreated: 0, articlesPublished: 0, aiCalls: 0 },
      sqliteMetrics: {
        totalWords,
        totalImages,
        totalArticles: allArticles.length,
        totalDrafts: drafts.length,
        totalProjects: projects.length,
        totalAudits: audits.length,
        publishedArticles,
        failedArticles,
      },
    });
  } catch (error) {
    console.error("[AdminInspect] Error getting user credits:", error);
    res.status(500).json({ error: error.message || "Lỗi lấy thống kê credit" });
  }
});

/**
 * GET /api/admin/users/:userId/projects
 * List all projects belonging to a user with article statistics
 */
router.get("/users/:userId/projects", async (req, res) => {
  try {
    const { userId } = req.params;
    const projects = await storage.getAllForUser("projects", userId);
    const allArticles = await storage.getArticlesForUserAdmin(userId);

    const articlesByProject = {};
    for (const art of allArticles) {
      if (art.projectId) {
        if (!articlesByProject[art.projectId]) {
          articlesByProject[art.projectId] = { total: 0, published: 0, errors: 0, draft: 0 };
        }
        articlesByProject[art.projectId].total++;
        if (art.status === "published") articlesByProject[art.projectId].published++;
        else if (art.status === "error" || art.error) articlesByProject[art.projectId].errors++;
        else articlesByProject[art.projectId].draft++;
      }
    }

    const projectsWithStats = projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      language: p.language,
      active: p.active !== false,
      publishing: {
        platform: p.publishing?.platform || "wordpress",
        wordpressUrl: p.publishing?.wordpress?.url || "",
      },
      stats: articlesByProject[p.id] || { total: 0, published: 0, errors: 0, draft: 0 },
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    res.json({ success: true, projects: projectsWithStats });
  } catch (error) {
    console.error("[AdminInspect] Error listing user projects:", error);
    res.status(500).json({ error: "Lỗi khi lấy danh sách dự án: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/projects/:projectId/articles
 * List all articles in a project
 */
router.get("/users/:userId/projects/:projectId/articles", async (req, res) => {
  try {
    const { userId, projectId } = req.params;
    const articles = await storage.getArticlesForUserAdmin(userId, projectId);

    res.json({
      success: true,
      projectId,
      total: articles.length,
      articles: articles.map(a => ({
        id: a.id,
        title: a.title,
        keyword: a.keyword,
        status: a.status || "draft",
        wordCount: a.wordCount || 0,
        seoScore: a.seoScore || null,
        error: a.error || null,
        publishedUrl: a.publishedUrl || null,
        hasContent: Boolean(a.content || a.html),
        hasOutline: Boolean(a.outline),
        hasImages: Boolean(a.thumbnailUrl || (a.sectionImages && a.sectionImages.length > 0)),
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    });
  } catch (error) {
    console.error("[AdminInspect] Error listing project articles:", error);
    res.status(500).json({ error: "Lỗi khi lấy bài viết dự án: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/articles/:articleId
 * Full read-only view of a project article
 */
router.get("/users/:userId/articles/:articleId", async (req, res) => {
  try {
    const { articleId } = req.params;
    const article = await storage.getById("articles", articleId);
    if (!article) {
      return res.status(404).json({ error: "Không tìm thấy bài viết" });
    }

    res.json({
      success: true,
      article,
    });
  } catch (error) {
    console.error("[AdminInspect] Error getting article detail:", error);
    res.status(500).json({ error: "Lỗi khi lấy chi tiết bài viết: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/drafts
 * Standalone drafts of a user
 */
router.get("/users/:userId/drafts", async (req, res) => {
  try {
    const { userId } = req.params;
    const drafts = await storage.getAllForUser("standalone-drafts", userId);

    res.json({
      success: true,
      total: drafts.length,
      drafts: drafts.map(d => ({
        id: d.id,
        title: d.title || d.keyword || d.topic || "Bài viết không tiêu đề",
        keyword: d.keyword || d.topic || "",
        currentStep: d.currentStep || 1,
        status: d.status || "draft",
        error: d.error || null,
        wordCount: d.wordCount || 0,
        hasContent: Boolean(d.article || d.content || d.html),
        hasImages: Boolean(d.thumbnail || (d.images && d.images.length > 0)),
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (error) {
    console.error("[AdminInspect] Error listing drafts:", error);
    res.status(500).json({ error: "Lỗi lấy danh sách draft: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/drafts/:draftId
 * Full read-only view of a standalone draft
 */
router.get("/users/:userId/drafts/:draftId", async (req, res) => {
  try {
    const { draftId } = req.params;
    const draft = await storage.getById("standalone-drafts", draftId);
    if (!draft) {
      return res.status(404).json({ error: "Không tìm thấy draft" });
    }

    res.json({
      success: true,
      draft,
    });
  } catch (error) {
    console.error("[AdminInspect] Error getting draft detail:", error);
    res.status(500).json({ error: "Lỗi khi lấy chi tiết draft: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/audits
 * SEO audit reports of a user
 */
router.get("/users/:userId/audits", async (req, res) => {
  try {
    const { userId } = req.params;
    const audits = await storage.getAllForUser("audits", userId);

    res.json({
      success: true,
      total: audits.length,
      audits: audits.map(a => ({
        id: a.id,
        url: a.url,
        score: a.score || a.overallScore || 0,
        totalIssues: a.issues ? a.issues.length : (a.stats?.totalIssues || 0),
        status: a.status || "completed",
        error: a.error || null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    });
  } catch (error) {
    console.error("[AdminInspect] Error listing audits:", error);
    res.status(500).json({ error: "Lỗi lấy danh sách audit: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/audits/:auditId
 * Full read-only view of an audit report
 */
router.get("/users/:userId/audits/:auditId", async (req, res) => {
  try {
    const { auditId } = req.params;
    const audit = await storage.getById("audits", auditId);
    if (!audit) {
      return res.status(404).json({ error: "Không tìm thấy báo cáo audit" });
    }

    res.json({
      success: true,
      audit,
    });
  } catch (error) {
    console.error("[AdminInspect] Error getting audit detail:", error);
    res.status(500).json({ error: "Lỗi lấy chi tiết audit: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/kwplans
 * Keyword plans & clusters of a user
 */
router.get("/users/:userId/kwplans", async (req, res) => {
  try {
    const { userId } = req.params;
    const kwplans = await storage.getAllForUser("kwplans", userId);

    res.json({
      success: true,
      total: kwplans.length,
      kwplans,
    });
  } catch (error) {
    console.error("[AdminInspect] Error listing kwplans:", error);
    res.status(500).json({ error: "Lỗi lấy keyword plans: " + error.message });
  }
});

/**
 * GET /api/admin/users/:userId/wp-sites
 * Connected WP sites of a user (passwords masked)
 */
router.get("/users/:userId/wp-sites", async (req, res) => {
  try {
    const { userId } = req.params;
    const sites = await storage.getAllForUser("wp-sites", userId);

    const safeSites = sites.map(s => ({
      id: s.id,
      name: s.name,
      siteUrl: s.siteUrl,
      username: s.username,
      appPassword: s.appPassword ? "******** (Đã ẩn)" : "(Chưa có)",
      status: s.status || "active",
      categoriesCount: Array.isArray(s.categories) ? s.categories.length : 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    res.json({
      success: true,
      total: safeSites.length,
      sites: safeSites,
    });
  } catch (error) {
    console.error("[AdminInspect] Error listing wp-sites:", error);
    res.status(500).json({ error: "Lỗi lấy danh sách wp-sites: " + error.message });
  }
});

module.exports = router;
