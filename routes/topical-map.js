const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const aiService = require("../services/ai-service");
const { resolveApiKeys } = require("../services/api-key-pool");

// ===== Helper: Build AI prompt =====
function buildPrompt(seedKeyword, language, totalArticles) {
  const lang = language === "vi" ? "Tiếng Việt" : "English";
  return `Bạn là chuyên gia SEO Content Strategy. Tạo Topical Map (bản đồ nội dung) hoàn chỉnh theo cấu trúc Pillar-Cluster cho niche dựa trên seed keyword.

SEED KEYWORD: "${seedKeyword}"
NGÔN NGỮ OUTPUT: ${lang}
TỔNG SỐ BÀI MỤC TIÊU: khoảng ${totalArticles} bài

Yêu cầu:
1. Tạo 1 bài PILLAR (4000+ từ, bao quát toàn bộ chủ đề, keyword chính là seed keyword)
2. Tạo 3-5 CLUSTERS, mỗi cluster 3-6 bài viết supporting với từ khóa dài (long-tail)
3. searchIntent: informational | commercial | transactional | navigational
4. contentAngle: guide | list | review | comparison | definition | tutorial | cost | faq
5. priority: high | medium | low (high = nên làm trước)

Trả về CHỈ JSON hợp lệ, KHÔNG có text/markdown bọc ngoài:
{
  "pillar": {
    "title": "...",
    "keyword": "${seedKeyword}",
    "searchIntent": "informational",
    "estimatedWords": 4000,
    "description": "Mô tả ngắn về bài Pillar"
  },
  "clusters": [
    {
      "id": "cluster-1",
      "name": "Tên cluster",
      "description": "Mô tả cluster này giúp giải quyết gì",
      "searchIntent": "informational",
      "articles": [
        {
          "id": "art-1",
          "title": "Tiêu đề bài viết",
          "keyword": "từ khóa chính của bài",
          "searchIntent": "informational",
          "contentAngle": "guide",
          "estimatedWords": 2000,
          "priority": "high",
          "notes": "Gợi ý ngắn về hướng viết"
        }
      ]
    }
  ],
  "stats": {
    "totalArticles": ${totalArticles},
    "estimatedTotalWords": 45000,
    "clusters": 4
  }
}`;
}

// ===== Helper: Parse AI JSON response =====
function parseMapResponse(text) {
  // Strip markdown code blocks if present
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

  // Extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI không trả về JSON hợp lệ");

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate required fields
  if (!parsed.pillar || !parsed.clusters || !Array.isArray(parsed.clusters)) {
    throw new Error("Cấu trúc JSON thiếu pillar hoặc clusters");
  }

  // Compute actual stats
  const totalArticles = parsed.clusters.reduce((sum, c) => sum + (c.articles?.length || 0), 0);
  const totalWords = parsed.clusters.reduce(
    (sum, c) => sum + (c.articles || []).reduce((s, a) => s + (a.estimatedWords || 2000), 0),
    (parsed.pillar?.estimatedWords || 4000)
  );

  parsed.stats = {
    totalArticles,
    totalWords,
    clusters: parsed.clusters.length,
  };

  return parsed;
}

// ===== GET /api/topical-map — list all maps =====
router.get("/", async (req, res) => {
  try {
    const maps = await storage.getAllForUser("topical-maps", req.userId);
    // Return newest first, omit heavy map data in list view
    const list = maps
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(({ map, ...rest }) => ({
        ...rest,
        stats: map?.stats || null,
      }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== GET /api/topical-map/:id — get single map =====
router.get("/:id", async (req, res) => {
  try {
    const map = await storage.getByIdForUser("topical-maps", req.params.id, req.userId);
    if (!map) return res.status(404).json({ error: "Topical map không tồn tại" });
    res.json(map);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== POST /api/topical-map — generate new map =====
router.post("/", async (req, res) => {
  try {
    const { seedKeyword, language = "vi", totalArticles = 20 } = req.body;
    if (!seedKeyword?.trim()) {
      return res.status(400).json({ error: "seedKeyword là bắt buộc" });
    }

    // Create record immediately with pending status
    const record = await storage.createForUser("topical-maps", {
      seedKeyword: seedKeyword.trim(),
      language,
      totalArticles,
      status: "pending",
      map: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, req.userId);

    // Return immediately — client will poll
    res.status(201).json(record);

    // Generate in background
    setImmediate(async () => {
      try {
        console.log(`[TopicalMap] Generating for "${seedKeyword}" (id: ${record.id})`);

        const settings = await storage.getSettings();
        const apiKeys = await resolveApiKeys(req.userId, req.license);

        const prompt = buildPrompt(seedKeyword.trim(), language, totalArticles);
        const aiResult = await aiService.generate(prompt, settings, { apiKeys });
        const mapData = parseMapResponse(aiResult);

        await storage.update("topical-maps", record.id, {
          status: "done",
          map: mapData,
          error: null,
          updatedAt: new Date().toISOString(),
        });

        console.log(
          `[TopicalMap] Done: ${mapData.stats.totalArticles} articles, ${mapData.stats.clusters} clusters`
        );
      } catch (e) {
        console.error(`[TopicalMap] Failed for "${seedKeyword}":`, e.message);
        await storage.update("topical-maps", record.id, {
          status: "failed",
          error: e.message,
          updatedAt: new Date().toISOString(),
        });
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== DELETE /api/topical-map/:id =====
router.delete("/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("topical-maps", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Topical map not found" });
    const deleted = await storage.delete("topical-maps", req.params.id);
    if (!deleted) return res.status(404).json({ error: "Topical map không tồn tại" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== POST /api/topical-map/:id/import-to-pipeline =====
router.post("/:id/import-to-pipeline", async (req, res) => {
  try {
    const { articleIds = [] } = req.body;
    if (!articleIds.length) {
      return res.status(400).json({ error: "Chưa chọn bài viết nào" });
    }

    const record = await storage.getByIdForUser("topical-maps", req.params.id, req.userId);
    if (!record) return res.status(404).json({ error: "Topical map không tồn tại" });
    if (record.status !== "done") {
      return res.status(400).json({ error: "Topical map chưa hoàn thành" });
    }

    const { map, seedKeyword } = record;

    // Flatten all articles from all clusters + pillar
    const allArticles = [];

    // Include pillar if selected
    if (articleIds.includes("pillar")) {
      allArticles.push({
        id: "pillar",
        title: map.pillar.title,
        keyword: map.pillar.keyword,
        searchIntent: map.pillar.searchIntent,
        contentAngle: "guide",
        estimatedWords: map.pillar.estimatedWords,
        isPillar: true,
      });
    }

    // Articles from clusters
    for (const cluster of map.clusters || []) {
      for (const art of cluster.articles || []) {
        if (articleIds.includes(art.id)) {
          allArticles.push({ ...art, clusterName: cluster.name });
        }
      }
    }

    // Create standalone-drafts for each selected article
    const created = [];
    for (const article of allArticles) {
      const draft = await storage.createForUser("standalone-drafts", {
        keyword: article.keyword,
        title: article.title,
        status: "draft",
        searchIntent: article.searchIntent || "informational",
        contentAngle: article.contentAngle || "guide",
        estimatedWords: article.estimatedWords || 2000,
        source: "topical-map",
        sourceMapId: record.id,
        sourceSeedKeyword: seedKeyword,
        clusterName: article.clusterName || (article.isPillar ? "Pillar" : ""),
        pipeline: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, req.userId);
      created.push(draft);
    }

    console.log(
      `[TopicalMap] Imported ${created.length} articles from "${seedKeyword}" to pipeline`
    );

    res.json({ success: true, created: created.length, drafts: created });
  } catch (e) {
    console.error("[TopicalMap] Import error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
