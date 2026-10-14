const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const wpService = require("../services/wp-service");
const aiService = require("../services/ai-service");
const { resolveApiKeys } = require("../services/api-key-pool");

/**
 * Helper: Get WP site config with plugin API key
 */
async function getPluginSite(req) {
  const siteId = req.query.siteId || req.body?.siteId;
  if (!siteId) throw new Error("siteId là bắt buộc");

  const site = await storage.getByIdForUser("wp-sites", siteId, req.userId);
  if (!site) throw new Error("WP site không tồn tại");
  if (!site.pluginApiKey) throw new Error("Site chưa kết nối qua SPLSEO Plugin. Vào Cài đặt → WP Sites để thêm Plugin API Key.");

  return site;
}

/**
 * Helper: Generate WooCommerce product description via AI
 */
async function generateProductContent(req, { productName, attributes, category, tone, length, focusKeyword, language }) {
  const attrText = attributes && attributes.length > 0
    ? attributes.map(a => `- ${a.name}: ${Array.isArray(a.options) ? a.options.join(", ") : a.options}`).join("\n")
    : "Không có thuộc tính cụ thể";

  const toneMap = {
    professional: "chuyên nghiệp, đáng tin cậy",
    friendly: "thân thiện, gần gũi",
    sales: "thuyết phục, kêu gọi hành động",
    technical: "kỹ thuật, chi tiết",
  };
  const toneDesc = toneMap[tone] || toneMap.professional;
  const wordCount = length === "short" ? "100-150" : length === "long" ? "400-600" : "200-300";

  const prompt = `Viết mô tả sản phẩm WooCommerce cho sản phẩm "${productName}".

Danh mục: ${category || "Chung"}
Thuộc tính sản phẩm:
${attrText}

${focusKeyword ? `Focus keyword SEO: "${focusKeyword}" — phải xuất hiện tự nhiên trong mô tả.` : ""}

YÊU CẦU:
- Ngôn ngữ: ${language || "Tiếng Việt"}
- Giọng điệu: ${toneDesc}
- Độ dài: ${wordCount} từ
- Sử dụng HTML headings (h3, h4), danh sách (ul/li), bold cho các đặc điểm quan trọng
- Mở đầu bằng 1-2 câu giới thiệu hấp dẫn
- Liệt kê ưu điểm nổi bật
- Kết thúc bằng lời kêu gọi hành động (CTA)
- KHÔNG nhắc "sản phẩm này" quá nhiều, dùng tên sản phẩm tự nhiên

Trả về JSON:
{
  "description": "HTML mô tả đầy đủ",
  "short_description": "Mô tả ngắn 1-2 câu (plain text)",
  "seo_title": "SEO title (max 60 ký tự)",
  "seo_description": "Meta description (max 160 ký tự)",
  "focus_keyword": "Focus keyword gợi ý"
}`;

  const settings = await storage.getUserSettings(req.userId);
  const keys = await resolveApiKeys(req.userId, req.license);
  const raw = await aiService.generate(prompt, settings, keys, { feature: "woo-description" });

  let parsed = {};
  if (raw && typeof raw === "string") {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {}
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  }

  return {
    description: parsed.description || (typeof raw === "string" ? raw : ""),
    short_description: parsed.short_description || "",
    seo_title: parsed.seo_title || productName,
    seo_description: parsed.seo_description || "",
    focus_keyword: parsed.focus_keyword || focusKeyword || productName,
  };
}

// ===========================
// Plugin Connection
// ===========================

/**
 * POST /api/woo/connect — Test plugin connection
 */
router.post("/connect", async (req, res) => {
  try {
    const site = await getPluginSite(req);
    const result = await wpService.connectViaPlugin(site);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===========================
// Products
// ===========================

/**
 * GET /api/woo/products — List WooCommerce products
 */
router.get("/products", async (req, res) => {
  try {
    const site = await getPluginSite(req);
    const result = await wpService.getProducts(site, {
      page: req.query.page,
      perPage: req.query.per_page,
      search: req.query.search,
      category: req.query.category,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/woo/product/:id — Get single product detail
 */
router.get("/product/:id", async (req, res) => {
  try {
    const site = await getPluginSite(req);
    const result = await wpService.getProduct(site, req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/woo/product-stats — Product stats
 */
router.get("/product-stats", async (req, res) => {
  try {
    const site = await getPluginSite(req);
    const result = await wpService.getProductStats(site);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// AI Product Description
// ===========================

/**
 * POST /api/woo/generate-description — AI generate product description
 */
router.post("/generate-description", async (req, res) => {
  try {
    const { productName } = req.body;

    if (!productName) {
      return res.status(400).json({ error: "productName là bắt buộc" });
    }

    const result = await generateProductContent(req, req.body);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/woo/bulk-generate — Batch generate descriptions
 */
router.post("/bulk-generate", async (req, res) => {
  try {
    const { siteId, productIds, tone, length, language } = req.body;

    if (!siteId || !productIds || !Array.isArray(productIds)) {
      return res.status(400).json({ error: "siteId và productIds[] là bắt buộc" });
    }

    const site = await storage.getByIdForUser("wp-sites", siteId, req.userId);
    if (!site || !site.pluginApiKey) {
      return res.status(400).json({ error: "Site chưa kết nối plugin" });
    }

    const results = [];
    for (const pid of productIds) {
      try {
        const product = await wpService.getProduct(site, pid);
        const generated = await generateProductContent(req, {
          productName: product.name,
          attributes: product.attributes,
          category: product.categories?.[0] || "",
          tone: tone || "professional",
          length: length || "medium",
          language: language || "Tiếng Việt",
        });

        results.push({ productId: pid, name: product.name, success: true, ...generated });
      } catch (err) {
        results.push({ productId: pid, success: false, error: err.message });
      }
    }

    res.json({ results, total: productIds.length, success: results.filter(r => r.success).length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/woo/push — Push generated description to WP product
 */
router.post("/push", async (req, res) => {
  try {
    const { siteId, productId, description, shortDescription, seo } = req.body;

    if (!siteId || !productId) {
      return res.status(400).json({ error: "siteId và productId là bắt buộc" });
    }

    const site = await storage.getByIdForUser("wp-sites", siteId, req.userId);
    if (!site || !site.pluginApiKey) {
      return res.status(400).json({ error: "Site chưa kết nối plugin" });
    }

    const result = await wpService.updateProduct(site, productId, {
      description,
      short_description: shortDescription,
      seo: seo || {},
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
