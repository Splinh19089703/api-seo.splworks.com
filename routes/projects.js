const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const axios = require("axios");

// Default project config
function defaultConfig() {
  return {
    // Tab: Thông tin
    slug: "",
    language: { video: "auto", article: "vi" },
    autoTranslate: true,
    active: true,

    // Tab: YouTube
    youtubeApiKey: "",

    // Tab: Đăng bài
    publishing: {
      platform: "wordpress",
      wordpress: {
        url: "",
        username: "",
        appPassword: "",
        defaultStatus: "publish",
        authorId: 1,
        categoryMode: "default",
        fixedCategory: "",
      },
    },

    // Tab: Prompts AI
    prompts: {
      analysisPromptId: "",
      analysisCustom: "",
      blogPromptId: "",
      blogCustom: "",
    },

    // Tab: Hình ảnh
    images: {
      thumbnailEnabled: true,
      thumbnailStyle: "",
      sectionImages: false,
      autoResize: false,
      referenceImages: [],
    },

    // Tab: AI Provider
    ai: { useGlobal: true, providers: [] },

    // Tab: Knowledge Base
    knowledgeBase: { enableRAG: false },

    // Tab: Tự động
    automation: { requireReview: true, pingSitemap: true },

    // Tab: Nâng cao
    advanced: {
      serpAnalysis: false,
      contentBrief: false,
      contentRefresh: false,
    },

    // Tab: Indexing
    indexing: {
      autoIndexOnPublish: true,       // Tự động submit sau khi publish
      bingIndexNowKey: "",            // Bing IndexNow API key
      googleServiceAccount: null,     // Google Service Account JSON (object)
      siteHost: "",                   // Domain, vd: example.com
    },
  };
}

// GET all projects
router.get("/", async (req, res) => {
  try {
    const projects = await storage.getAllForUser("projects", req.userId);
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single project
router.get("/:id", async (req, res) => {
  try {
    const project = await storage.getByIdForUser("projects", req.params.id, req.userId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    // Merge defaults for missing config keys
    project.config = { ...defaultConfig(), ...(project.config || {}) };
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create project
router.post("/", async (req, res) => {
  try {
    // --- License: Project limit check ---
    const maxProjects = req.license?.limits?.maxProjects || 0;
    const allProjects = await storage.getAllForUser("projects", req.userId);
    if (allProjects.length >= maxProjects) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${maxProjects} dự án. Nâng cấp gói để tạo thêm.`,
        code: "PROJECT_LIMIT",
        limit: maxProjects,
        used: allProjects.length,
        currentPlan: req.license?.plan,
      });
    }

    const config = defaultConfig();
    config.slug = (req.body.name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const project = await storage.createForUser("projects", {
      name: req.body.name,
      description: req.body.description || "",
      domain: req.body.domain || "",
      status: "active",
      articles: 0,
      published: 0,
      pending: 0,
      videos: 0,
      kwPlans: 0,
      config,
    }, req.userId);
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update project
router.put("/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("projects", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Project not found" });
    const { userId: _userId, ...updates } = req.body;
    const project = await storage.update("projects", req.params.id, updates);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST clone project
router.post("/:id/clone", async (req, res) => {
  try {
    // --- License: Project limit check ---
    const maxProjects = req.license?.limits?.maxProjects || 0;
    const allProjects = await storage.getAllForUser("projects", req.userId);
    if (allProjects.length >= maxProjects) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${maxProjects} dự án. Nâng cấp gói để tạo thêm.`,
        code: "PROJECT_LIMIT",
        limit: maxProjects,
        used: allProjects.length,
        currentPlan: req.license?.plan,
      });
    }

    const source = await storage.getByIdForUser("projects", req.params.id, req.userId);
    if (!source) return res.status(404).json({ error: "Project not found" });
    const cloned = await storage.createForUser("projects", {
      name: `${source.name} (copy)`,
      description: source.description,
      domain: source.domain,
      status: "active",
      articles: 0,
      published: 0,
      pending: 0,
      videos: 0,
      kwPlans: 0,
      config: { ...defaultConfig(), ...(source.config || {}) },
    }, req.userId);
    res.status(201).json(cloned);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST test WordPress connection
router.post("/:id/test-wordpress", async (req, res) => {
  try {
    const project = await storage.getByIdForUser("projects", req.params.id, req.userId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const wp = project.config?.publishing?.wordpress;
    if (!wp?.url || !wp?.username || !wp?.appPassword) {
      return res.json({
        success: false,
        error: "Chưa cấu hình WordPress đầy đủ",
      });
    }
    const baseUrl = wp.url.replace(/\/+$/, "");
    const response = await axios.get(
      `${baseUrl}/wp-json/wp/v2/posts?per_page=1`,
      {
        auth: { username: wp.username, password: wp.appPassword },
        timeout: 10000,
      },
    );
    res.json({
      success: true,
      message: `Kết nối thành công! (${response.status})`,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.response?.data?.message || error.message,
    });
  }
});

// GET project checklist
router.get("/:id/checklist", async (req, res) => {
  try {
    const project = await storage.getByIdForUser("projects", req.params.id, req.userId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const config = { ...defaultConfig(), ...(project.config || {}) };
    const wp = config.publishing?.wordpress;
    const wpSiteId = config.publishing?.wpSiteId;

    // Check API keys from settings
    const settings = await storage.getAllForUser("api-keys", req.userId);
    const hasApiKey = settings && settings.length > 0;

    // Check WordPress — either direct config OR shared WP site
    let wpOk = !!(wp?.url && wp?.username && wp?.appPassword);
    let wpDesc = wp?.url ? `${wp.url}` : "Chưa nhập URL WordPress";

    if (!wpOk && wpSiteId) {
      // Check shared WP site from Settings
      const wpSite = await storage.getByIdForUser("wp-sites", wpSiteId, req.userId);
      if (wpSite && wpSite.siteUrl) {
        wpOk = !!(wpSite.siteUrl && wpSite.username && wpSite.appPassword);
        wpDesc = wpSite.name || wpSite.siteUrl;
      }
    }

    const items = [
      {
        key: "apiKey",
        label: "API Key AI",
        description: hasApiKey
          ? `${settings.length} key hoạt động`
          : "Chưa có API key",
        ok: hasApiKey,
      },
      {
        key: "wordpress",
        label: "WordPress",
        description: wpDesc,
        ok: wpOk,
      },
      {
        key: "images",
        label: "Hình ảnh",
        description: config.images?.thumbnailEnabled
          ? "Thumbnail: Bật"
          : "Thumbnail: Tắt",
        ok: true,
        warning: !config.images?.thumbnailEnabled,
      },
      {
        key: "publishing",
        label: "Quy trình xuất bản",
        description: config.automation?.requireReview
          ? "Chờ duyệt trước khi đăng"
          : "Tự động đăng",
        ok: true,
      },
    ];

    const completed = items.filter((i) => i.ok).length;
    res.json({ items, completed, total: items.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET project children count (for delete confirmation UI)
router.get("/:id/stats", async (req, res) => {
  try {
    const id = req.params.id;
    const project = await storage.getByIdForUser("projects", id, req.userId);
    if (!project) return res.status(404).json({ error: "Không tìm thấy dự án" });

    const childCollections = [
      { key: "articles", label: "bài viết" },
      { key: "videos", label: "video" },
      { key: "kwplans", label: "keyword plan" },
      { key: "clusterings", label: "AI clustering" },
      { key: "project-keywords", label: "keyword import" },
      { key: "knowledgebases", label: "knowledge base" },
      { key: "internal-links", label: "liên kết nội bộ" },
    ];

    const stats = {};
    for (const col of childCollections) {
      const all = await storage.getAll(col.key);
      stats[col.key] = all.filter((item) => item.projectId === id).length;
    }
    res.json({ projectId: id, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE project — CASCADE xóa tất cả dữ liệu con
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const project = await storage.getByIdForUser("projects", id, req.userId);
    if (!project) return res.status(404).json({ error: "Không tìm thấy dự án" });

    // Capture article IDs before deleting child rows so related history can be removed too.
    const projectArticles = await storage.getByFilter("articles", { projectId: id }, { limit: 100000 });
    const articleIds = new Set(projectArticles.map((a) => a.id));

    // 1. Xóa tất cả dữ liệu con thuộc project
    const childCollections = [
      "articles",
      "videos",
      "kwplans",
      "clusterings",
      "project-keywords",
      "knowledgebases",
      "internal-links",
      "rewrite-history",
    ];

    const deletedCounts = {};
    for (const col of childCollections) {
      const count = await storage.deleteByFilter(col, { projectId: id });
      if (count > 0) deletedCounts[col] = count;
    }

    // 2. Xóa publishing history liên quan đến articles của project
    const allHistory = await storage.getAll("publishing-history");
    let historyDeleted = 0;
    for (const h of allHistory) {
      if (articleIds.has(h.articleId)) {
        await storage.delete("publishing-history", h.id);
        historyDeleted++;
      }
    }
    if (historyDeleted > 0) deletedCounts["publishing-history"] = historyDeleted;

    // 3. Xóa project
    await storage.delete("projects", id);

    console.log(`[Projects] Cascade deleted project ${id}:`, deletedCounts);
    res.json({ success: true, deleted: deletedCounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
