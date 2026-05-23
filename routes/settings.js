const express = require("express");
const router = express.Router();
const axios = require("axios");
const storage = require("../services/storage");
const wpService = require("../services/wp-service");
const aiService = require("../services/ai-service");

// GET settings
router.get("/", async (req, res) => {
  try {
    const settings = await storage.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update settings
router.put("/", async (req, res) => {
  try {
    const current = await storage.getSettings();
    const updated = { ...current, ...req.body };
    await storage.saveSettings(updated);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === API Keys ===
router.get("/api-keys", async (req, res) => {
  try {
    const keys = await storage.getAllForUser("api-keys", req.userId);
    const keysWithCooldown = keys.map((k) => {
      const cooldownUntil = aiService.cooldowns?.[k.id];
      let cooldownSecondsLeft = 0;
      if (cooldownUntil && cooldownUntil > Date.now()) {
        cooldownSecondsLeft = Math.ceil((cooldownUntil - Date.now()) / 1000);
      }
      return {
        ...k,
        cooldownSecondsLeft,
      };
    });
    res.json(keysWithCooldown);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api-keys", async (req, res) => {
  try {
    const key = await storage.createForUser("api-keys", {
      name: req.body.name,
      provider: req.body.provider,
      apiKey: req.body.apiKey,
      dailyLimit: req.body.dailyLimit || 1500,
      priority: req.body.priority || 1,
      active: req.body.active !== false,
      usageToday: 0,
    }, req.userId);
    res.status(201).json(key);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api-keys/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("api-keys", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Key not found" });
    await storage.delete("api-keys", req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/api-keys/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("api-keys", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Key not found" });
    const updated = await storage.update("api-keys", req.params.id, {
      name: req.body.name,
      provider: req.body.provider,
      apiKey: req.body.apiKey,
      dailyLimit: req.body.dailyLimit,
      priority: req.body.priority,
      active: req.body.active,
    });
    if (!updated) return res.status(404).json({ error: "Key not found" });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test an API key without saving it
router.post("/api-keys/test", async (req, res) => {
  const { provider, apiKey } = req.body;
  if (!provider || !apiKey)
    return res
      .status(400)
      .json({ success: false, message: "Provider và API key là bắt buộc" });

  try {
    if (provider === "gemini") {
      const resp = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { timeout: 10000 },
      );
      if (resp.data?.models)
        return res.json({
          success: true,
          message: `✅ Gemini API key hoạt động! (${resp.data.models.length} models khả dụng)`,
        });
      return res.json({ success: false, message: "❌ Key không hợp lệ" });
    }

    if (provider === "openai") {
      const resp = await axios.get("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      });
      if (resp.data?.data)
        return res.json({
          success: true,
          message: "✅ OpenAI API key hoạt động!",
        });
      return res.json({ success: false, message: "❌ Key không hợp lệ" });
    }

    if (provider === "openrouter") {
      const resp = await axios.get("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      });
      if (resp.data?.data)
        return res.json({
          success: true,
          message: "✅ OpenRouter API key hoạt động!",
        });
      return res.json({ success: false, message: "❌ Key không hợp lệ" });
    }

    res.json({ success: false, message: "Provider không được hỗ trợ" });
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    res.json({ success: false, message: `❌ Lỗi: ${msg}` });
  }
});

// === WordPress Sites ===
router.get("/wp-sites", async (req, res) => {
  try {
    const sites = await storage.getAllForUser("wp-sites", req.userId);
    res.json(sites);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/wp-sites", async (req, res) => {
  try {
    const site = await storage.createForUser("wp-sites", {
      name: req.body.name,
      siteUrl: req.body.siteUrl,
      username: req.body.username,
      appPassword: req.body.appPassword,
      // SPLSEO Plugin connection (optional, preferred over App Password)
      pluginApiKey: req.body.pluginApiKey || null,
      webhookSecret: req.body.webhookSecret || null,
      connectionMode: req.body.pluginApiKey ? 'plugin' : 'rest-api',
      pluginCapabilities: null,
      categories: [],
      lastTestOk: null,
      lastTestAt: null,
      lastTestMessage: null,
    }, req.userId);
    res.status(201).json(site);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /wp-sites/:id/test-plugin — Test SPLSEO Plugin connection
router.post("/wp-sites/:id/test-plugin", async (req, res) => {
  try {
    const site = await storage.getByIdForUser("wp-sites", req.params.id, req.userId);
    if (!site) return res.status(404).json({ error: "Site not found" });
    if (!site.pluginApiKey) return res.status(400).json({ error: "Plugin API Key chưa được cấu hình" });

    const result = await wpService.connectViaPlugin(site);

    await storage.update("wp-sites", req.params.id, {
      connectionMode: result.success ? 'plugin' : site.connectionMode,
      pluginCapabilities: result.success ? result.capabilities : null,
      lastTestOk: result.success,
      lastTestAt: new Date().toISOString(),
      lastTestMessage: result.success ? `✅ Plugin v${result.plugin_version} — ${result.capabilities?.seo_plugin || 'no SEO plugin'}${result.capabilities?.woocommerce ? ' + WooCommerce' : ''}` : result.message,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /wp-sites/:id — Edit site credentials inline (Task 4)
router.put("/wp-sites/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("wp-sites", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Site not found" });

    const updates = {
      name: req.body.name ?? existing.name,
      siteUrl: req.body.siteUrl ?? existing.siteUrl,
      username: req.body.username ?? existing.username,
      // Only update password if a new one is provided
      ...(req.body.appPassword ? { appPassword: req.body.appPassword } : {}),
      // Plugin API fields (Sprint 14)
      ...(req.body.pluginApiKey !== undefined ? { pluginApiKey: req.body.pluginApiKey } : {}),
      ...(req.body.webhookSecret !== undefined ? { webhookSecret: req.body.webhookSecret } : {}),
      // Reset test status when credentials change
      lastTestOk: null,
      lastTestAt: null,
      lastTestMessage: "Thông tin đã thay đổi — cần kiểm tra lại",
    };

    const updated = await storage.update("wp-sites", req.params.id, updates);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/wp-sites/:id/test", async (req, res) => {
  try {
    const site = await storage.getByIdForUser("wp-sites", req.params.id, req.userId);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const result = await wpService.testConnection(site);

    // Persist test result so UI can show status badge without re-testing
    await storage.update("wp-sites", req.params.id, {
      lastTestOk: result.success,
      lastTestAt: new Date().toISOString(),
      lastTestMessage: result.message,
    });

    res.json(result);
  } catch (error) {
    const msg = error.message;
    const ownedSite = await storage.getByIdForUser("wp-sites", req.params.id, req.userId);
    if (!ownedSite) {
      return res.status(404).json({ success: false, message: "Site not found" });
    }
    // Persist failure too
    try {
      await storage.update("wp-sites", req.params.id, {
        lastTestOk: false,
        lastTestAt: new Date().toISOString(),
        lastTestMessage: `❌ ${msg}`,
      });
    } catch {}
    res.status(500).json({ success: false, message: `❌ ${msg}` });
  }
});

router.post("/wp-sites/:id/sync-categories", async (req, res) => {
  try {
    const site = await storage.getByIdForUser("wp-sites", req.params.id, req.userId);
    if (!site) return res.status(404).json({ error: "Site not found" });
    const categories = await wpService.syncCategories(site);
    await storage.update("wp-sites", req.params.id, { categories });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/wp-sites/:id", async (req, res) => {
  try {
    const site = await storage.getByIdForUser("wp-sites", req.params.id, req.userId);
    if (!site) return res.status(404).json({ error: "Site not found" });
    await storage.delete("wp-sites", req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Prompt Templates ===
router.get("/prompts", async (req, res) => {
  try {
    let prompts = await storage.getAllForUser("prompts", req.userId);
    if (prompts.length === 0) {
      // Seed default prompts
      const defaults = [
        {
          name: "Phân tích chuẩn",
          type: "research",
          isDefault: true,
          content:
            "Xác định search intent chính xác - Phân tích đối tượng mục tiêu - Tìm các từ khóa liên quan (LSI keywords) - Liệt kê các câu hỏi người đọc có thể có - Xác định các điểm chính cần bao quát",
        },
        {
          name: "Phong cách chuẩn",
          type: "write-article",
          isDefault: true,
          content:
            "PHONG CÁCH VIẾT: Giọng văn tự nhiên, lôi cuốn như đang chia sẻ với bạn đọc - Mở đầu bằng 1 câu hook - Xen kẽ ví dụ thực tế, con số minh họa - Liên kết tự giữa các phần mượt, có transition tự nhiên - KHÔNG viết theo kiểu template/công thức",
        },
        {
          name: "Thumbnail chuẩn",
          type: "thumbnail",
          isDefault: true,
          content:
            "PHONG CÁCH: Thiết kế chuyên nghiệp, hiện đại, bắt mắt - Bảng màu sống động nhưng hài hòa - Điểm nhấn thị giác liên quan chủ đề - Phong cách minh họa hoặc ảnh chuyên nghiệp",
        },
        {
          name: "Section Image chuẩn",
          type: "section-image",
          isDefault: true,
          content:
            "PHONG CÁCH: Minh họa cụ thể, trực quan liên quan đến nội dung section - Phong cách hiện đại, chuyên nghiệp - Phù hợp với các ảnh section khác trong bài",
        },
      ];
      for (const d of defaults) {
        await storage.createForUser("prompts", d, req.userId);
      }
      prompts = await storage.getAllForUser("prompts", req.userId);
    }
    res.json(prompts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/prompts", async (req, res) => {
  try {
    const prompt = await storage.createForUser("prompts", {
      name: req.body.name,
      type: req.body.type,
      content: req.body.content,
      isDefault: req.body.isDefault || false,
    }, req.userId);
    res.status(201).json(prompt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/prompts/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("prompts", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Prompt not found" });
    const { userId: _userId, ...updates } = req.body;
    const prompt = await storage.update("prompts", req.params.id, updates);
    if (!prompt) return res.status(404).json({ error: "Prompt not found" });
    res.json(prompt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/prompts/:id", async (req, res) => {
  try {
    const prompt = await storage.getByIdForUser("prompts", req.params.id, req.userId);
    if (!prompt) return res.status(404).json({ error: "Prompt not found" });
    await storage.delete("prompts", req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Admin: Migrate Legacy Data ===
// Assigns all orphaned records (no userId) to the current logged-in user
router.post("/migrate-legacy-data", async (req, res) => {
  try {
    const targetUserId = req.userId;
    if (!targetUserId || targetUserId === "unknown") {
      return res.status(400).json({ error: "Không xác định được userId. Hãy đăng nhập trước." });
    }
    const result = storage.migrateOrphanedRecords(targetUserId);
    res.json({ 
      success: true, 
      message: `Đã chuyển ${result.migrated} records cho userId: ${targetUserId}`,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Clear Cache ===
router.post("/clear-cache", async (req, res) => {
  try {
    const deletedCount = await storage.clearAllCache();
    res.json({ success: true, message: `Đã xóa thành công ${deletedCount} phản hồi lưu trong bộ nhớ đệm.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
