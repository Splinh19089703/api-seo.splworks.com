const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const { validateArticle } = require("../services/content-validator");
const { resolveApiKeys } = require("../services/api-key-pool");

// In-memory set of cancelled clustering IDs (for stopping background processes)
const cancelledClusterings = new Set();

// Content angles for AI analysis
const CONTENT_ANGLES = [
  { value: "basic", label: "Cơ bản - Dành cho người mới bắt đầu" },
  { value: "advanced", label: "Chuyên sâu - Nội dung kỹ thuật cao" },
  { value: "guide", label: "Hướng dẫn - Step-by-step tutorial" },
  { value: "list", label: "Danh sách - Top 10, 20 cách..." },
  { value: "comparison", label: "So sánh - A vs B, đánh giá lựa chọn" },
  { value: "review", label: "Đánh giá - Review sản phẩm/dịch vụ" },
  { value: "definition", label: "Định nghĩa - Giải thích khái niệm" },
  { value: "casestudy", label: "Case Study - Ví dụ thực tế" },
  { value: "warning", label: "Cảnh báo - Sai lầm cần tránh" },
  { value: "cost", label: "Chi phí - Phân tích ROI, lợi ích" },
];

const SEARCH_INTENTS = [
  "informational",
  "transactional",
  "commercial",
  "navigational",
];

async function getProjectOr404(projectId, res, userId) {
  const project = userId
    ? await storage.getByIdForUser("projects", projectId, userId)
    : await storage.getById("projects", projectId);
  if (!project) {
    res.status(404).json({ error: "Không tìm thấy dự án" });
    return null;
  }
  return project;
}

async function getProjectOwnedRecordOr404(collection, id, projectId, res, notFound = "Not found", userId = null) {
  const item = userId
    ? await storage.getByIdForUser(collection, id, userId)
    : await storage.getById(collection, id);
  if (!item || item.projectId !== projectId) {
    res.status(404).json({ error: notFound });
    return null;
  }
  return item;
}

router.param("projectId", async (req, res, next, projectId) => {
  try {
    const project = await storage.getByIdForUser("projects", projectId, req.userId);
    if (!project) return res.status(404).json({ error: "Không tìm thấy dự án" });
    req.project = project;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function inferContentAngle(intent, plannerType, keyword = "") {
  const kw = keyword.toLowerCase();
  if (intent === "commercial") return /so sánh| vs |khác nhau/.test(kw) ? "comparison" : "review";
  if (intent === "transactional") return /giá|chi phí|bao nhiêu/.test(kw) ? "cost" : "review";
  if (intent === "local") return "local";
  if (plannerType === "expanded" && /cách|hướng dẫn|làm sao|như thế nào/.test(kw)) return "tutorial";
  if (/là gì|định nghĩa/.test(kw)) return "definition";
  if (/top \d|tốt nhất|danh sách/.test(kw)) return "list";
  return "guide";
}

function estimateWordsForPlannerCluster(keywordCount, intent, plannerType) {
  let base = 1800;
  if (intent === "commercial" || intent === "transactional") base = 2200;
  if (plannerType === "main") base += 500;
  return Math.min(4200, base + Math.max(0, keywordCount - 1) * 180);
}

// ===== KW Plans =====
// GET all plans for a project
router.get("/:projectId/kwplans", async (req, res) => {
  try {
    const plans = await storage.getAllForUser("kwplans", req.userId);
    const filtered = plans.filter((p) => p.projectId === req.params.projectId);
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET single plan
router.get("/:projectId/kwplans/:planId", async (req, res) => {
  try {
    const plan = await storage.getByIdForUser("kwplans", req.params.planId, req.userId);
    if (!plan || plan.projectId !== req.params.projectId)
      return res.status(404).json({ error: "Not found" });
    res.json(plan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST create plan (simple - no AI grouping here)
router.post("/:projectId/kwplans", async (req, res) => {
  try {
    const project = await getProjectOr404(req.params.projectId, res, req.userId);
    if (!project) return;

    const { name, description, keywords, scheduleMode } = req.body;
    const kwList = (keywords || "")
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);

    const clusters = [];
    if (kwList.length > 0) {
      const pillarKw = kwList[0];
      const clusterKws = kwList.slice(1);
      clusters.push({
        id: Date.now().toString(),
        name: pillarKw,
        pillarKeyword: pillarKw,
        searchIntent: "informational",
        contentAngle: "basic",
        estimatedWords: 3500,
        keywords: [
          { keyword: pillarKw, type: "pillar", contentAngle: "basic", estimatedWords: 3500, status: "pending" },
          ...clusterKws.map((kw) => ({
            keyword: kw, type: "cluster",
            contentAngle: CONTENT_ANGLES[Math.floor(Math.random() * CONTENT_ANGLES.length)].value,
            estimatedWords: 1500 + Math.floor(Math.random() * 1500), status: "pending",
          })),
        ],
      });
    }

    const plan = await storage.createForUser("kwplans", {
      projectId: req.params.projectId,
      name: name || "KW Plan",
      description: description || "",
      status: "analyzed",
      scheduleMode: scheduleMode || "immediate",
      originalKeywords: kwList, clusters,
      totalKeywords: kwList.length,
      articlesCreated: 0, articlesPublished: 0,
    }, req.userId);

    const plans = await storage.getAllForUser("kwplans", req.userId);
    const count = plans.filter((p) => p.projectId === req.params.projectId).length;
    await storage.update("projects", req.params.projectId, { kwPlans: count });

    res.status(201).json(plan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST import keywords from Keyword Planner into a project
router.post("/:projectId/keywords/import", async (req, res) => {
  try {
    const project = await storage.getByIdForUser("projects", req.params.projectId, req.userId);
    if (!project) return res.status(404).json({ error: "Không tìm thấy dự án" });

    const {
      keywords = [],
      source = "keyword-planner",
      seedKeyword = "",
      mode = "raw",
    } = req.body;

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: "Cần ít nhất 1 từ khóa." });
    }

    const seen = new Set();
    const normalized = keywords
      .map((item) => {
        const keyword = String(item.keyword || item.query || item.text || "").trim();
        if (!keyword) return null;
        const key = keyword.toLowerCase();
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          keyword,
          volume: Number(item.volume || 0),
          kd: Number(item.kd || 0),
          cpc: Number(item.cpc || 0),
          intent: item.intent || "informational",
          type: item.type || "related",
          source: item.source || source,
          metricSource: item.metricSource || "",
          confidence: Number(item.confidence || 0),
          opportunity: Number(item.opportunity || 0),
          trend: Array.isArray(item.trend) ? item.trend : [],
          wordCount: Number(item.wordCount || keyword.split(/\s+/).length),
        };
      })
      .filter(Boolean);

    if (normalized.length === 0) {
      return res.status(400).json({ error: "Không có từ khóa hợp lệ." });
    }

    const imported = await storage.createForUser("project-keywords", {
      projectId: req.params.projectId,
      source,
      seedKeyword,
      mode,
      keywords: normalized,
      totalKeywords: normalized.length,
      importedAt: new Date().toISOString(),
    }, req.userId);

    if (mode !== "kwplan") {
      return res.status(201).json({ import: imported });
    }

    const grouped = new Map();
    normalized.forEach((kw) => {
      const groupKey = `${kw.intent || "informational"}:${kw.type || "related"}`;
      if (!grouped.has(groupKey)) grouped.set(groupKey, []);
      grouped.get(groupKey).push(kw);
    });

    const clusters = Array.from(grouped.entries()).map(([groupKey, kws], groupIndex) => {
      const sorted = [...kws].sort((a, b) =>
        (b.opportunity || 0) - (a.opportunity || 0) ||
        (b.volume || 0) - (a.volume || 0)
      );
      const pillar = sorted[0];
      const [intent, plannerType] = groupKey.split(":");
      const contentAngle = inferContentAngle(intent, plannerType, pillar.keyword);

      return {
        id: `${Date.now()}_${groupIndex}`,
        name: pillar.keyword,
        pillarKeyword: pillar.keyword,
        searchIntent: intent || "informational",
        contentAngle,
        estimatedWords: estimateWordsForPlannerCluster(sorted.length, intent, plannerType),
        keywords: sorted.map((kw, index) => ({
          keyword: kw.keyword,
          volume: kw.volume || 0,
          kd: kw.kd || 0,
          cpc: kw.cpc || 0,
          intent: kw.intent || "informational",
          metricSource: kw.metricSource || "",
          confidence: kw.confidence || 0,
          opportunity: kw.opportunity || 0,
          plannerType: kw.type || "related",
          plannerSource: kw.source || source,
          type: index === 0 ? "pillar" : "cluster",
          contentAngle,
          estimatedWords: index === 0 ? 2800 : 1600,
          status: "pending",
        })),
      };
    });

    const plan = await storage.createForUser("kwplans", {
      projectId: req.params.projectId,
      name: seedKeyword ? `Keyword Planner: ${seedKeyword}` : "Keyword Planner Import",
      description: `Nhập ${normalized.length} từ khóa từ Keyword Planner.`,
      status: "analyzed",
      scheduleMode: "immediate",
      source,
      importId: imported.id,
      originalKeywords: normalized.map((kw) => kw.keyword),
      clusters,
      totalKeywords: normalized.length,
      articlesCreated: 0,
      articlesPublished: 0,
    }, req.userId);

    const plans = await storage.getAllForUser("kwplans", req.userId);
    const count = plans.filter((p) => p.projectId === req.params.projectId).length;
    await storage.update("projects", req.params.projectId, { kwPlans: count });

    res.status(201).json({ import: imported, plan });
  } catch (e) {
    console.error("[Keyword Import] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== AI KEYWORD CLUSTERING (Standalone Tool - 2-Step Algorithm) =====

// GET all clustering results for a project
router.get("/:projectId/clustering", async (req, res) => {
  try {
    const all = await storage.getAllForUser("clusterings", req.userId);
    const filtered = all.filter((c) => c.projectId === req.params.projectId);
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET single clustering result
router.get("/:projectId/clustering/:clusteringId", async (req, res) => {
  try {
    const item = await storage.getByIdForUser("clusterings", req.params.clusteringId, req.userId);
    if (!item || item.projectId !== req.params.projectId)
      return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST cancel a running clustering
router.post("/:projectId/clustering/:clusteringId/cancel", async (req, res) => {
  try {
    const clustering = await getProjectOwnedRecordOr404(
      "clusterings",
      req.params.clusteringId,
      req.params.projectId,
      res,
    );
    if (!clustering) return;

    cancelledClusterings.add(req.params.clusteringId);
    await storage.update("clusterings", req.params.clusteringId, {
      status: "cancelled",
      progress: { step: 0, message: "Đã tạm dừng bởi người dùng.", percent: 0 },
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE clustering result
router.delete("/:projectId/clustering/:clusteringId", async (req, res) => {
  try {
    const clustering = await getProjectOwnedRecordOr404(
      "clusterings",
      req.params.clusteringId,
      req.params.projectId,
      res,
    );
    if (!clustering) return;

    // Also cancel if it's still running
    cancelledClusterings.add(req.params.clusteringId);
    await storage.delete("clusterings", req.params.clusteringId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST start AI clustering (2-Step Algorithm)
router.post("/:projectId/clustering", async (req, res) => {
  try {
    const project = await getProjectOr404(req.params.projectId, res, req.userId);
    if (!project) return;

    const { keywords } = req.body; // [{keyword, volume}]
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: "Cần ít nhất 1 keyword." });
    }

    // Create clustering record immediately
    const clustering = await storage.createForUser("clusterings", {
      projectId: req.params.projectId,
      status: "processing",
      totalKeywords: keywords.length,
      originalKeywords: keywords,
      clusters: [],
      pillars: [],
      progress: { step: 1, message: "Đang phân tích chủ đề lõi (Extracting Pillars)...", percent: 5 },
      createdAt: new Date().toISOString(),
    }, req.userId);

    res.status(201).json(clustering);

    // ===== BACKGROUND AI CLUSTERING (Professional Single-Pass) =====
    (async () => {
      try {
        const aiService = require("../services/ai-service");
        const rawSettings = await storage.getSettings();
        const apiKeys = await resolveApiKeys(req.userId, req.license);

        // Helper: check if this clustering was cancelled
        const isCancelled = () => cancelledClusterings.has(clustering.id);
        const throwIfCancelled = () => {
          if (isCancelled()) {
            cancelledClusterings.delete(clustering.id);
            throw new Error("__CANCELLED__");
          }
        };

        // Override timeout to 300s for clustering (large prompts need more time)
        const settings = JSON.parse(JSON.stringify(rawSettings));
        if (settings.aiProvider) {
          ["gemini", "openai", "openrouter"].forEach(p => {
            if (settings.aiProvider[p]) settings.aiProvider[p].timeout = 300;
          });
        }

        // ---- HELPER: Robust JSON extraction from AI response ----
        const extractJSON = (text) => {
          if (!text || typeof text !== 'string') return null;
          // 1. Try to extract from markdown code block first
          const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e) { /* continue */ }
          }
          // 2. Try to find the outermost valid JSON object
          let depth = 0, start = -1;
          for (let i = 0; i < text.length; i++) {
            if (text[i] === '{') { if (depth === 0) start = i; depth++; }
            else if (text[i] === '}') {
              depth--;
              if (depth === 0 && start >= 0) {
                try { return JSON.parse(text.substring(start, i + 1)); } catch (e) { start = -1; /* try next */ }
              }
            }
          }
          // 3. Fallback: greedy regex
          try {
            const m = text.match(/\{[\s\S]*\}/);
            if (m) return JSON.parse(m[0]);
          } catch (e) { /* give up */ }
          return null;
        };

        const normalizeName = (name) => (name || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[\[\]()]/g, '');

        // ================================================================
        //  PROFESSIONAL SINGLE-PASS KEYWORD CLUSTERING
        //  Methodology: SurferSEO + Ahrefs Parent Topic + KeywordInsights
        //  Key principle: Group keywords that should target the SAME page
        //  Criteria: Same search intent + SERP similarity
        // ================================================================

        const allKwText = keywords.map(k => `- ${k.keyword} (${k.volume || 0})`).join("\n");

        // Determine optimal cluster count range
        const minClusters = Math.max(3, Math.ceil(keywords.length / 20));
        const maxClusters = Math.max(minClusters + 5, Math.ceil(keywords.length / 5));

        // ---- STEP 1: SINGLE-PASS AI CLUSTERING ----
        // One prompt that both creates groups AND assigns keywords simultaneously
        // This eliminates the #1 bug: pillar name mismatches between steps

        const buildClusteringPrompt = (kwText, kwCount, existingGroups = null) => {
          const existingContext = existingGroups ? `
CÁC NHÓM ĐÃ CÓ TỪ BATCH TRƯỚC (hãy thêm từ khoá vào các nhóm này nếu phù hợp, hoặc tạo nhóm mới nếu cần):
${existingGroups.map((g, i) => `${i+1}. "${g.name}" (${g.searchIntent}) — ${g.description}`).join("\n")}
` : '';

          return `Bạn là chuyên gia SEO với 15+ năm kinh nghiệm tại thị trường Việt Nam. Nhiệm vụ: Phân nhóm ${kwCount} từ khoá dưới đây theo phương pháp chuẩn quốc tế (SurferSEO / Ahrefs Parent Topic).

NGUYÊN TẮC NHÓM TỪ KHOÁ CHUẨN SEO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. MỖI NHÓM = 1 BÀI VIẾT duy nhất trên website. Các từ khoá trong cùng nhóm phải CÓ THỂ target cùng 1 URL.
2. TIÊU CHÍ NHÓM: 2 từ khoá được gộp nếu và chỉ nếu:
   a) Cùng SEARCH INTENT (ví dụ: đều muốn mua, hoặc đều muốn tìm hiểu)
   b) Google sẽ hiển thị KẾT QUẢ TƯƠNG TỰ cho cả 2 (SERP Similarity)
   c) Người dùng search 2 từ đó sẽ HÀI LÒNG với cùng 1 bài viết

3. PHÂN LOẠI SEARCH INTENT (bắt buộc cho mỗi nhóm):
   • informational — tìm hiểu kiến thức, hỏi "là gì", "cách", "tại sao", hướng dẫn, so sánh kiến thức
   • commercial — đánh giá/so sánh trước khi mua, "tốt nhất", "top", review, "nên mua"
   • transactional — muốn mua ngay, "giá", "mua ở đâu", "bán", "cho thuê", "đặt hàng"
   • navigational — tìm website/thương hiệu cụ thể, tên brand, tên công ty
   • local — liên quan địa điểm, "ở đâu", "tại HCM", "gần đây", sân/quán/cửa hàng

4. QUY TẮC TÁCH NHÓM — KHÔNG gộp các trường hợp sau:
   ✗ Khác intent: "giá vợt pickleball" (transactional) ≠ "cách chọn vợt pickleball" (informational)
   ✗ Khác loại sản phẩm: "vợt" ≠ "giày" ≠ "bóng" ≠ "quần áo" ≠ "phụ kiện"
   ✗ Khác đối tượng: "cho người mới" ≠ "cho chuyên nghiệp"
   ✗ Thương hiệu cụ thể vs chung: "vợt Joola" ≠ "vợt pickleball tốt nhất"
   ✗ Khác format nội dung: "luật pickleball" (guide) ≠ "bài tập pickleball" (tutorial)

5. QUY TẮC GỘP — NÊN gộp các trường hợp:
   ✓ Từ đồng nghĩa: "vợt pickleball tốt nhất" + "top vợt pickleball" + "review vợt pickleball"
   ✓ Biến thể có/không dấu: "pickleball" + "pickle ball"
   ✓ Số ít/nhiều + long-tail: "giày pickleball" + "giày chơi pickleball" + "giày pickleball nam"
   ✓ Cùng topic + intent: "cách đánh pickleball" + "kỹ thuật đánh pickleball" + "học đánh pickleball"

6. CONTENT ANGLE cho mỗi nhóm:
   • guide — hướng dẫn chi tiết, "cách...", "hướng dẫn..."
   • list — danh sách "top 10", "X cách", "X loại"
   • review — đánh giá sản phẩm, so sánh
   • comparison — A vs B
   • definition — "...là gì", giải thích khái niệm
   • tutorial — bài tập, video hướng dẫn
   • local — địa điểm, bản đồ
   • cost — giá cả, chi phí, bảng giá

7. ĐẶT TÊN NHÓM: Tên nhóm = từ khoá có Search Volume CAO NHẤT trong nhóm đó (đây là Primary Keyword).
8. UNCATEGORIZED: Chỉ dùng cho từ khoá rác thật sự (<3% tổng). Cố gắng phân loại TỐI ĐA.
${existingContext}
DANH SÁCH TỪ KHOÁ (keyword — volume):
${kwText}

Trả về ĐÚNG JSON, KHÔNG bọc trong markdown code block, KHÔNG có text nào khác:
{
  "clusters": [
    {
      "name": "Tên nhóm = primary keyword (volume cao nhất)",
      "description": "Mô tả ngắn về nội dung bài viết cho nhóm này",
      "searchIntent": "informational",
      "contentAngle": "guide",
      "keywords": [
        { "keyword": "từ khoá chính xác", "volume": 1000 },
        { "keyword": "từ khoá liên quan", "volume": 500 }
      ]
    }
  ]
}`;
        };

        // Chunk keywords if > 150 (AI struggles with very long lists)
        const CHUNK_SIZE = 150;
        const allClusters = [];

        if (keywords.length <= CHUNK_SIZE) {
          // ---- SMALL SET: Single pass ----
          console.log(`[AI-Cluster] Step 1: Single-pass clustering ${keywords.length} keywords...`);
          throwIfCancelled();
          await storage.update("clusterings", clustering.id, {
            progress: { step: 1, message: `Đang phân tích và nhóm ${keywords.length} từ khoá...`, percent: 15 },
          });

          const prompt = buildClusteringPrompt(allKwText, keywords.length);
          const result = await aiService.generate(prompt, settings, { apiKeys });
          throwIfCancelled();

          const parsed = extractJSON(result);
          if (parsed && parsed.clusters && Array.isArray(parsed.clusters)) {
            allClusters.push(...parsed.clusters);
            console.log(`[AI-Cluster] Step 1 done: ${parsed.clusters.length} clusters created`);
          } else {
            console.error("[AI-Cluster] Step 1: Failed to parse. Raw (first 1000):", result.substring(0, 1000));
            await storage.update("clusterings", clustering.id, {
              status: "failed",
              progress: { step: 1, message: "AI không trả về được kết quả nhóm. Thử lại.", percent: 0 },
            });
            return;
          }
        } else {
          // ---- LARGE SET: Chunked clustering with merge ----
          const chunks = [];
          // Shuffle keywords by volume desc first, then split — ensures high-volume kws establish groups early
          const sorted = [...keywords].sort((a, b) => (b.volume || 0) - (a.volume || 0));
          for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
            chunks.push(sorted.slice(i, i + CHUNK_SIZE));
          }

          console.log(`[AI-Cluster] Step 1: Chunked clustering — ${chunks.length} batches of ~${CHUNK_SIZE} keywords`);

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkText = chunk.map(k => `- ${k.keyword} (${k.volume || 0})`).join("\n");
            const percent = 10 + Math.round(((i + 1) / chunks.length) * 50);

            await storage.update("clusterings", clustering.id, {
              progress: { step: 1, message: `Đang nhóm batch ${i + 1}/${chunks.length} (${chunk.length} từ khoá)...`, percent },
            });

            throwIfCancelled();
            // Pass existing groups from previous chunks so AI can merge into them
            const existingGroups = i > 0 ? allClusters.map(c => ({
              name: c.name,
              description: c.description,
              searchIntent: c.searchIntent,
            })) : null;

            const prompt = buildClusteringPrompt(chunkText, chunk.length, existingGroups);
            const result = await aiService.generate(prompt, settings, { apiKeys });
            throwIfCancelled();

            const parsed = extractJSON(result);
            if (parsed && parsed.clusters && Array.isArray(parsed.clusters)) {
              // Merge new clusters into existing ones
              for (const newCluster of parsed.clusters) {
                const existingIdx = allClusters.findIndex(c =>
                  normalizeName(c.name) === normalizeName(newCluster.name)
                );
                if (existingIdx >= 0) {
                  // Merge keywords into existing cluster (avoid duplicates)
                  const existing = allClusters[existingIdx];
                  const existingKws = new Set(existing.keywords.map(k => k.keyword.toLowerCase()));
                  for (const kw of (newCluster.keywords || [])) {
                    if (!existingKws.has(kw.keyword.toLowerCase())) {
                      existing.keywords.push(kw);
                    }
                  }
                } else {
                  allClusters.push(newCluster);
                }
              }
              console.log(`[AI-Cluster] Batch ${i + 1}/${chunks.length}: +${parsed.clusters.length} clusters (total: ${allClusters.length})`);
            } else {
              console.error(`[AI-Cluster] Batch ${i + 1} parse failed. Raw (first 500):`, result?.substring(0, 500));
            }
          }

          if (allClusters.length === 0) {
            await storage.update("clusterings", clustering.id, {
              status: "failed",
              progress: { step: 1, message: "AI không trả về được kết quả nhóm sau tất cả batches. Thử lại.", percent: 0 },
            });
            return;
          }
        }

        // ---- STEP 2: CATCH MISSING KEYWORDS ----
        // Check which keywords were not allocated by AI
        const allocatedKws = new Set();
        allClusters.forEach(c => {
          (c.keywords || []).forEach(k => allocatedKws.add(k.keyword.toLowerCase()));
        });
        const missingKws = keywords.filter(k => !allocatedKws.has(k.keyword.toLowerCase()));

        if (missingKws.length > 0) {
          console.log(`[AI-Cluster] Step 2: ${missingKws.length}/${keywords.length} keywords missing. Re-allocating...`);
          await storage.update("clusterings", clustering.id, {
            progress: { step: 2, message: `Đang phân bổ ${missingKws.length} từ khoá bị sót...`, percent: 65 },
          });

          if (missingKws.length <= 80) {
            // Small number — try to allocate in one shot
            const missingText = missingKws.map(k => `- ${k.keyword} (${k.volume || 0})`).join("\n");
            const clusterList = allClusters.map((c, i) => `${i+1}. "${c.name}" (${c.searchIntent}) — ${c.description}`).join("\n");

            const reallocPrompt = `Phân bổ ${missingKws.length} từ khoá dưới đây vào 1 trong các nhóm đã có, hoặc tạo nhóm mới nếu không phù hợp.

NHÓM HIỆN CÓ:
${clusterList}

TỪ KHOÁ CẦN PHÂN BỔ:
${missingText}

QUY TẮC: Mỗi từ khoá thuộc ĐÚNG 1 nhóm. GIỮ NGUYÊN tên nhóm. Ưu tiên nhóm hiện có. Chỉ tạo nhóm mới khi thật cần.

Trả về ĐÚNG JSON, KHÔNG markdown:
{
  "allocations": [
    { "keyword": "từ khoá", "volume": 100, "group": "Tên nhóm chính xác" }
  ],
  "newGroups": [
    {
      "name": "Tên nhóm mới nếu cần",
      "description": "Mô tả",
      "searchIntent": "informational",
      "contentAngle": "guide",
      "keywords": [{ "keyword": "kw", "volume": 100 }]
    }
  ]
}`;
            try {
              throwIfCancelled();
              const result = await aiService.generate(reallocPrompt, settings, { apiKeys });
              const parsed = extractJSON(result);
              if (parsed) {
                // Process allocations to existing groups
                if (parsed.allocations) {
                  for (const a of parsed.allocations) {
                    const targetName = a.group || a.pillar;
                    const target = allClusters.find(c => c.name === targetName) ||
                                   allClusters.find(c => normalizeName(c.name) === normalizeName(targetName));
                    if (target) {
                      if (!target.keywords.some(k => k.keyword.toLowerCase() === a.keyword.toLowerCase())) {
                        target.keywords.push({ keyword: a.keyword, volume: a.volume || 0 });
                      }
                    }
                  }
                }
                // Process new groups
                if (parsed.newGroups && Array.isArray(parsed.newGroups)) {
                  for (const ng of parsed.newGroups) {
                    if (ng.keywords && ng.keywords.length > 0) {
                      allClusters.push(ng);
                    }
                  }
                }
              }
            } catch (e) {
              console.error("[AI-Cluster] Step 2 realloc error:", e.message);
            }
          }

          // Final check — anything still missing goes to Uncategorized
          const finalAllocated = new Set();
          allClusters.forEach(c => {
            (c.keywords || []).forEach(k => finalAllocated.add(k.keyword.toLowerCase()));
          });
          const stillMissing = keywords.filter(k => !finalAllocated.has(k.keyword.toLowerCase()));
          if (stillMissing.length > 0) {
            // Find or create uncategorized group
            let uncatCluster = allClusters.find(c => c.name === "[Uncategorized]");
            if (!uncatCluster) {
              uncatCluster = {
                name: "[Uncategorized]",
                description: "Từ khoá chưa phân loại hoặc không liên quan",
                searchIntent: "other",
                contentAngle: "basic",
                keywords: [],
              };
              allClusters.push(uncatCluster);
            }
            stillMissing.forEach(k => {
              uncatCluster.keywords.push({ keyword: k.keyword, volume: k.volume || 0 });
            });
            console.log(`[AI-Cluster] Step 2: ${stillMissing.length} keywords → [Uncategorized]`);
          }
        }

        console.log(`[AI-Cluster] Pre-SERP: ${allClusters.length} clusters, ${allClusters.reduce((s, c) => s + (c.keywords?.length || 0), 0)} keywords allocated`);

        // ---- BUILD FINAL CLUSTERS ----
        const finalClusters = allClusters
          .filter(c => c.keywords && c.keywords.length > 0)
          .map(c => {
            // Sort by volume descending; HIGHEST VOLUME = pillar keyword
            const kws = [...c.keywords].sort((a, b) => (b.volume || 0) - (a.volume || 0));
            const totalVolume = kws.reduce((s, k) => s + (k.volume || 0), 0);
            return {
              id: Date.now().toString() + Math.random().toString(36).substring(7),
              name: c.name,
              description: c.description || "",
              pillarKeyword: kws[0].keyword,
              searchIntent: c.searchIntent || "informational",
              contentAngle: c.contentAngle || "guide",
              totalVolume,
              keywords: kws.map((k, idx) => ({
                keyword: k.keyword,
                volume: k.volume || 0,
                type: idx === 0 ? "pillar" : "cluster",
              })),
            };
          });

        // Deduplicate keywords across clusters (if AI duplicated)
        const seenKeywords = new Set();
        for (const cluster of finalClusters) {
          cluster.keywords = cluster.keywords.filter(k => {
            const key = k.keyword.toLowerCase();
            if (seenKeywords.has(key)) return false;
            seenKeywords.add(key);
            return true;
          });
          // Recalculate
          cluster.totalVolume = cluster.keywords.reduce((s, k) => s + (k.volume || 0), 0);
          if (cluster.keywords.length > 0) {
            cluster.pillarKeyword = cluster.keywords[0].keyword;
            cluster.keywords[0].type = "pillar";
          }
        }

        // Remove empty clusters after dedup
        const nonEmptyClusters = finalClusters.filter(c => c.keywords.length > 0);

        // Sort: [Uncategorized] last, rest by volume desc
        nonEmptyClusters.sort((a, b) => {
          if (a.name === "[Uncategorized]") return 1;
          if (b.name === "[Uncategorized]") return -1;
          return (b.totalVolume || 0) - (a.totalVolume || 0);
        });

        // Replace finalClusters content
        finalClusters.length = 0;
        finalClusters.push(...nonEmptyClusters);

        // ---- STEP 3: Re-classify Uncategorized if > 5% of total ----
        const uncatCluster = finalClusters.find(c => c.name === "[Uncategorized]");
        let uncatKws = uncatCluster ? uncatCluster.keywords.map(k => ({ keyword: k.keyword, volume: k.volume || 0 })) : [];
        const uncatThreshold = Math.max(5, Math.ceil(keywords.length * 0.05));

        if (uncatKws.length > uncatThreshold) {
          console.log(`[AI-Cluster] Step 3: Re-classifying ${uncatKws.length} uncategorized keywords...`);
          throwIfCancelled();
          await storage.update("clusterings", clustering.id, {
            progress: { step: 3, message: `Đang tái phân loại ${uncatKws.length} từ khoá chưa nhóm...`, percent: 75 },
          });

          const uncatText = uncatKws.map(k => `- ${k.keyword} (${k.volume || 0})`).join("\n");
          const existingClusterList = finalClusters
            .filter(c => c.name !== "[Uncategorized]")
            .map((c, i) => `${i+1}. "${c.name}" (${c.searchIntent}) — ${c.description}`).join("\n");

          const step3Prompt = `Bạn là chuyên gia SEO. Dưới đây là ${uncatKws.length} từ khoá bị phân loại là "Uncategorized" từ bước trước. Nhiệm vụ: Tạo NHÓM MỚI hoặc chuyển vào nhóm hiện có.

QUY TẮC:
1. Phân tích và tạo các nhóm mới phù hợp. Tên nhóm = từ khoá volume cao nhất.
2. Từ khoá THẬT SỰ rác (sai chính tả, spam) → để riêng nhóm "[Blacklist - Từ khoá loại bỏ]".
3. CỐ GẮNG tạo ít nhất 2-5 nhóm mới từ danh sách này.
4. Có thể chuyển từ khoá vào nhóm hiện có nếu phù hợp.

CÁC NHÓM HIỆN CÓ:
${existingClusterList}

TỪ KHOÁ CẦN TÁI PHÂN LOẠI:
${uncatText}

Trả về ĐÚNG JSON, KHÔNG markdown:
{
  "newGroups": [
    {
      "name": "Tên nhóm mới",
      "description": "Mô tả",
      "searchIntent": "informational | commercial | transactional",
      "contentAngle": "guide | list | review | definition",
      "keywords": [{ "keyword": "từ khoá", "volume": 100 }]
    }
  ],
  "reclassified": [
    { "keyword": "từ khoá", "volume": 100, "group": "Tên nhóm hiện có" }
  ]
}`;

          try {
            const step3Result = await aiService.generate(step3Prompt, settings, { apiKeys });
            const parsed = extractJSON(step3Result);
            if (parsed) {
              // Reclassify to existing clusters
              if (parsed.reclassified && Array.isArray(parsed.reclassified)) {
                const reclassifiedSet = new Set();
                parsed.reclassified.forEach(r => {
                  const targetName = r.group || r.pillar;
                  const target = finalClusters.find(c => c.name === targetName) ||
                                 finalClusters.find(c => normalizeName(c.name) === normalizeName(targetName));
                  if (target) {
                    if (!target.keywords.some(k => k.keyword.toLowerCase() === r.keyword.toLowerCase())) {
                      target.keywords.push({ keyword: r.keyword, volume: r.volume || 0, type: "cluster" });
                      target.totalVolume = (target.totalVolume || 0) + (r.volume || 0);
                    }
                    reclassifiedSet.add(r.keyword.toLowerCase());
                  }
                });
                uncatKws = uncatKws.filter(k => !reclassifiedSet.has(k.keyword.toLowerCase()));
              }

              // Create new groups
              if (parsed.newGroups && Array.isArray(parsed.newGroups)) {
                parsed.newGroups.forEach(ng => {
                  if (!ng.keywords || ng.keywords.length === 0) return;
                  const kws = [...ng.keywords].sort((a, b) => (b.volume || 0) - (a.volume || 0));
                  finalClusters.push({
                    id: Date.now().toString() + Math.random().toString(36).substring(7),
                    name: ng.name || kws[0].keyword,
                    description: ng.description || "",
                    pillarKeyword: kws[0].keyword,
                    searchIntent: ng.searchIntent || "informational",
                    contentAngle: ng.contentAngle || ng.suggestedAngle || "guide",
                    totalVolume: kws.reduce((s, k) => s + (k.volume || 0), 0),
                    keywords: kws.map((k, idx) => ({
                      keyword: k.keyword,
                      volume: k.volume || 0,
                      type: idx === 0 ? "pillar" : "cluster",
                    })),
                  });
                  // Remove from uncategorized
                  const newGroupSet = new Set(ng.keywords.map(k => k.keyword.toLowerCase()));
                  uncatKws = uncatKws.filter(k => !newGroupSet.has(k.keyword.toLowerCase()));
                });
              }
              console.log(`[AI-Cluster] Step 3: Reclassified ${parsed.reclassified?.length || 0}, new groups ${parsed.newGroups?.length || 0}, remaining uncat: ${uncatKws.length}`);
            } else {
              console.error("[AI-Cluster] Step 3: Failed to parse. Raw (first 500):", step3Result.substring(0, 500));
            }
          } catch (e) {
            console.error("[AI-Cluster] Step 3 error:", e.message);
          }

          // Update uncategorized cluster with remaining
          if (uncatCluster) {
            uncatCluster.keywords = uncatKws.map(k => ({ keyword: k.keyword, volume: k.volume || 0, type: "cluster" }));
            uncatCluster.totalVolume = uncatKws.reduce((s, k) => s + (k.volume || 0), 0);
            if (uncatCluster.keywords.length === 0) {
              // Remove empty uncategorized
              const idx = finalClusters.indexOf(uncatCluster);
              if (idx >= 0) finalClusters.splice(idx, 1);
            }
          }
          console.log(`[AI-Cluster] Step 3 done: ${uncatKws.length} still uncategorized`);
        }

        // Final sort
        finalClusters.sort((a, b) => {
          if (a.name === "[Uncategorized]") return 1;
          if (b.name === "[Uncategorized]") return -1;
          return (b.totalVolume || 0) - (a.totalVolume || 0);
        });

        // ---- STEP 4: SERP Verification (Optional - requires Serper API key) ----
        let serpVerified = false;
        let serpData = null;
        const serperKeys = apiKeys.filter(k => k.provider === "serper" && k.active && k.apiKey);

        if (serperKeys.length > 0) {
          try {
            const serpService = require("../services/serp-service");

            // Select keywords to verify: all pillar kws + top volume from big clusters
            const kwsToVerify = serpService.selectKeywordsForVerification(finalClusters, 50);
            console.log(`[AI-Cluster] Step 4: SERP verifying ${kwsToVerify.length} keywords...`);
            throwIfCancelled();

            await storage.update("clusterings", clustering.id, {
              progress: { step: 4, message: `Đang search Google xác minh ${kwsToVerify.length} từ khoá chính...`, percent: 80 },
            });

            // Batch search on Google
            const serpResults = await serpService.batchSearch(kwsToVerify, apiKeys, { country: "vn", lang: "vi" });

            if (serpResults && serpResults.length > 0) {
              // Build SERP-based clusters (overlap >= 3 URLs)
              const serpClusters = serpService.clusterBySERP(serpResults, 3);
              serpData = { results: serpResults, clusters: serpClusters };
              console.log(`[AI-Cluster] Step 4 done: SERP found ${serpClusters.length} overlap groups`);

              // ---- STEP 5: AI Merge & Finalize ----
              await storage.update("clusterings", clustering.id, {
                progress: { step: 5, message: "AI đang so sánh và tối ưu hóa nhóm dựa trên SERP data...", percent: 90 },
              });

              // Build SERP summary for AI
              const serpSummary = serpResults.map(r => {
                return `- "${r.keyword}": Intent=${r.detectedIntent}, Top URLs: ${r.urls.slice(0, 3).join(", ")}${r.features.ads ? " [CÓ ADS]" : ""}${r.features.shopping ? " [CÓ SHOPPING]" : ""}${r.features.localPack ? " [CÓ LOCAL PACK]" : ""}`;
              }).join("\n");

              const serpOverlapSummary = [];
              for (let i = 0; i < serpResults.length; i++) {
                for (let j = i + 1; j < serpResults.length; j++) {
                  const overlap = serpService.calculateOverlap(serpResults[i], serpResults[j]);
                  if (overlap >= 2) {
                    serpOverlapSummary.push(`"${serpResults[i].keyword}" ↔ "${serpResults[j].keyword}": ${overlap} URLs trùng`);
                  }
                }
              }

              const currentClustersText = finalClusters.map((c, i) => {
                return `${i + 1}. ${c.name} (Pillar: ${c.pillarKeyword}, Intent: ${c.searchIntent}, ${c.keywords.length} kws, Vol: ${c.totalVolume})`;
              }).join("\n");

              const mergePrompt = `Bạn là chuyên gia SEO. Dưới đây là 2 nguồn dữ liệu:

**A. NHÓM TỪ AI (hiện tại):**
${currentClustersText}

**B. DỮ LIỆU SERP THỰC TẾ (từ Google Search):**
${serpSummary}

**C. SERP OVERLAP (từ khoá có kết quả trùng nhau trên Google):**
${serpOverlapSummary.length > 0 ? serpOverlapSummary.join("\n") : "Không có overlap đáng kể"}

NHIỆM VỤ: Dựa trên cả 2 nguồn, đưa ra các ĐIỀU CHỈNH cho bản clustering:

QUY TẮC:
1. Nếu 2 nhóm có SERP overlap cao (≥3 URLs trùng) → GỘP chúng lại.
2. Nếu SERP intent khác với AI intent → SỬA intent cho đúng.
3. Nếu Pillar keyword sai (keyword volume thấp hơn keyword khác trong nhóm) → ĐỔI pillar.
4. Chỉ đề xuất thay đổi CẦN THIẾT, không thay đổi nếu AI đã đúng.

Trả về JSON (KHÔNG text khác):
{
  "adjustments": [
    {
      "type": "merge",
      "clusters": ["Tên nhóm A", "Tên nhóm B"],
      "newName": "Tên nhóm gộp",
      "reason": "Lý do"
    },
    {
      "type": "changeIntent",
      "cluster": "Tên nhóm",
      "newIntent": "commercial",
      "reason": "Lý do"
    },
    {
      "type": "changePillar",
      "cluster": "Tên nhóm",
      "newPillar": "từ khoá mới",
      "reason": "Lý do"
    }
  ],
  "summary": "Tóm tắt 1 dòng thay đổi"
}`;

              try {
                const mergeResult = await aiService.generate(mergePrompt, settings, { apiKeys });
                const parsed = extractJSON(mergeResult);
                if (parsed) {
                  const adjustments = parsed.adjustments || [];

                  // Apply adjustments
                  for (const adj of adjustments) {
                    if (adj.type === "merge" && adj.clusters?.length >= 2) {
                      // Find clusters to merge (with fuzzy matching)
                      const toMerge = adj.clusters.map(name => {
                        return finalClusters.find(c => c.name === name) ||
                               finalClusters.find(c => normalizeName(c.name) === normalizeName(name));
                      }).filter(Boolean);
                      if (toMerge.length >= 2) {
                        // Merge all into first cluster
                        const target = toMerge[0];
                        target.name = adj.newName || target.name;
                        target.serpMerged = true;
                        for (let m = 1; m < toMerge.length; m++) {
                          // Move keywords, avoid duplicates
                          toMerge[m].keywords.forEach(kw => {
                            if (!target.keywords.find(tk => tk.keyword.toLowerCase() === kw.keyword.toLowerCase())) {
                              target.keywords.push({ ...kw, type: "cluster" });
                            }
                          });
                          // Mark for removal
                          toMerge[m]._remove = true;
                        }
                        // Re-sort and re-calculate
                        target.keywords.sort((a, b) => (b.volume || 0) - (a.volume || 0));
                        target.keywords[0].type = "pillar";
                        target.pillarKeyword = target.keywords[0].keyword;
                        target.totalVolume = target.keywords.reduce((s, k) => s + (k.volume || 0), 0);
                      }
                    } else if (adj.type === "changeIntent") {
                      const cluster = finalClusters.find(c => c.name === adj.cluster) ||
                                      finalClusters.find(c => normalizeName(c.name) === normalizeName(adj.cluster));
                      if (cluster) {
                        cluster.searchIntent = adj.newIntent;
                        cluster.serpVerified = true;
                      }
                    } else if (adj.type === "changePillar") {
                      const cluster = finalClusters.find(c => c.name === adj.cluster) ||
                                      finalClusters.find(c => normalizeName(c.name) === normalizeName(adj.cluster));
                      if (cluster && adj.newPillar) {
                        cluster.pillarKeyword = adj.newPillar;
                        // Re-sort keywords to put new pillar first
                        const idx = cluster.keywords.findIndex(k => k.keyword.toLowerCase() === adj.newPillar.toLowerCase());
                        if (idx >= 0) {
                          cluster.keywords.forEach(k => k.type = "cluster");
                          cluster.keywords[idx].type = "pillar";
                          const [pillarKw] = cluster.keywords.splice(idx, 1);
                          cluster.keywords.unshift(pillarKw);
                        }
                        cluster.serpVerified = true;
                      }
                    }
                  }

                  // Remove merged clusters
                  const beforeCount = finalClusters.length;
                  for (let i = finalClusters.length - 1; i >= 0; i--) {
                    if (finalClusters[i]._remove) finalClusters.splice(i, 1);
                  }

                  serpVerified = true;
                  console.log(`[AI-Cluster] Step 5 done: ${adjustments.length} adjustments applied, ${beforeCount} → ${finalClusters.length} clusters`);
                } else {
                  console.error("[AI-Cluster] Step 5: Failed to parse merge JSON. Raw (first 500):", mergeResult.substring(0, 500));
                }
              } catch (e) {
                console.error("[AI-Cluster] Step 5 error:", e.message);
              }
            }
          } catch (e) {
            console.error("[AI-Cluster] Step 4 SERP error:", e.message);
          }
        } else {
          console.log("[AI-Cluster] No Serper API key, skipping SERP verification (Steps 4-5)");
        }

        // ---- FINAL UPDATE ----
        // Re-sort after potential merges
        finalClusters.sort((a, b) => {
          if (a.name === "[Uncategorized]") return 1;
          if (b.name === "[Uncategorized]") return -1;
          return (b.totalVolume || 0) - (a.totalVolume || 0);
        });
        const totalAllocated = finalClusters.reduce((s, c) => s + c.keywords.length, 0);

        // Mark verified clusters
        if (serpVerified) {
        finalClusters.forEach(c => {
            if (!c.serpVerified && c.name !== "[Uncategorized]") c.serpVerified = false;
          });
        }

        await storage.update("clusterings", clustering.id, {
          status: "done",
          clusters: finalClusters,
          totalClusters: finalClusters.length,
          totalAllocated,
          serpVerified,
          serpData: serpData ? { queriesUsed: serpData.results.length, serpClusters: serpData.clusters.length } : null,
          progress: {
            step: serpVerified ? 6 : 4,
            message: `Hoàn tất! ${finalClusters.length} nhóm, ${totalAllocated} từ khoá.${serpVerified ? " ✅ SERP Verified" : ""}`,
            percent: 100
          },
          completedAt: new Date().toISOString(),
        });
        console.log(`[AI-Cluster] Done! ${finalClusters.length} clusters, ${totalAllocated} kws.${serpVerified ? " SERP verified." : ""}`);

      } catch (err) {
        if (err.message === "__CANCELLED__") {
          console.log(`[AI-Cluster] Clustering ${clustering.id} was cancelled by user.`);
          return; // Status already set by cancel endpoint
        }
        console.error("[AI-Cluster] Background error:", err);
        await storage.update("clusterings", clustering.id, {
          status: "failed",
          progress: { step: 0, message: "Lỗi: " + err.message, percent: 0 },
        });
      }
    })();

  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// Helper: Generate AI titles for clusters
async function generateTitlesForClusters(clusters, settings, apiKeys) {
  const aiService = require("../services/ai-service");
  const titleMap = {}; // keyword -> suggestedTitle

  // Process each cluster separately (better context per cluster)
  for (const cluster of clusters) {
    if (!cluster.keywords || cluster.keywords.length === 0) continue;

    const kwList = cluster.keywords.map(k =>
      `- "${k.keyword}" (Volume: ${k.volume || 0}, Type: ${k.type || "cluster"})`
    ).join("\n");

    const prompt = `Bạn là chuyên gia SEO content Việt Nam. Tạo TIÊU ĐỀ BÀI VIẾT tối ưu SEO cho từng keyword dưới đây.

THÔNG TIN NHÓM:
- Tên nhóm: "${cluster.name}"
- Search Intent: ${cluster.searchIntent}
- Content Angle: ${cluster.contentAngle || "guide"}
- Pillar Keyword: "${cluster.pillarKeyword}"

DANH SÁCH KEYWORDS:
${kwList}

QUY TẮC TẠO TIÊU ĐỀ:
1. Tiêu đề 50-70 ký tự, chứa keyword chính ở đầu
2. Dựa theo search intent:
   - informational → "Hướng dẫn...", "Cẩm nang...", "[Keyword]: Tất Tần Tật Từ A-Z"
   - commercial → "Top X...", "So Sánh...", "Đánh Giá..."
   - transactional → "Mua...", "Giá...", "Bảng Giá..."
   - navigational → giữ nguyên tên thương hiệu/sản phẩm
3. Pillar keyword → tiêu đề bao quát, toàn diện hơn
4. Cluster keywords → tiêu đề cụ thể, chi tiết hơn
5. KHÔNG trùng lặp pattern giữa các tiêu đề trong cùng nhóm
6. Thêm năm hiện tại [2026] nếu phù hợp (guide, review, comparison)
7. Viết tiếng Việt tự nhiên, hấp dẫn click

Trả về ĐÚNG JSON, KHÔNG markdown:
{
  "titles": {
    "keyword1": "Tiêu đề gợi ý cho keyword1",
    "keyword2": "Tiêu đề gợi ý cho keyword2"
  }
}`;

    try {
      const result = await aiService.generate(prompt, settings, { apiKeys });
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.titles) {
          for (const kw of cluster.keywords) {
            const title = parsed.titles[kw.keyword] ||
              Object.entries(parsed.titles).find(([k]) =>
                k.toLowerCase().trim() === kw.keyword.toLowerCase().trim()
              )?.[1];
            if (title) titleMap[kw.keyword] = title;
          }
        }
      }
    } catch (e) {
      console.error(`[AI-Titles] Error for cluster "${cluster.name}":`, e.message);
    }
  }

  return titleMap;
}

// POST save clustering result as a KW Plan
router.post("/:projectId/clustering/:clusteringId/save-plan", async (req, res) => {
  try {
    const clustering = await storage.getByIdForUser("clusterings", req.params.clusteringId, req.userId);
    if (!clustering || clustering.projectId !== req.params.projectId)
      return res.status(404).json({ error: "Not found" });
    if (clustering.status !== "done")
      return res.status(400).json({ error: "Clustering chưa hoàn tất." });

    const { planName } = req.body;
    const clusteringSrc = (clustering.clusters || []).filter(c => c.name !== "[Uncategorized]");

    // Step 1: Generate AI titles
    let titleMap = {};
    try {
      const settings = await storage.getSettings();
      const apiKeys = await resolveApiKeys(req.userId, req.license);
      const hasAiKey = apiKeys.some(k =>
        ["openrouter", "gemini", "openai"].includes(k.provider) && k.active && k.apiKey
      );

      if (hasAiKey) {
        console.log(`[Save-Plan] Generating AI titles for ${clusteringSrc.length} clusters...`);
        titleMap = await generateTitlesForClusters(clusteringSrc, settings, apiKeys);
        console.log(`[Save-Plan] Generated ${Object.keys(titleMap).length} titles.`);
      } else {
        console.log("[Save-Plan] No AI key available, skipping title generation.");
      }
    } catch (e) {
      console.error("[Save-Plan] Title generation failed, continuing without titles:", e.message);
    }

    // Step 2: Build plan clusters with titles
    const clusters = clusteringSrc.map(c => ({
      id: c.id,
      name: c.name,
      pillarKeyword: c.pillarKeyword,
      searchIntent: c.searchIntent,
      contentAngle: c.contentAngle,
      estimatedWords: c.contentAngle === "guide" ? 3000 : 2000,
      keywords: c.keywords.map(k => ({
        keyword: k.keyword,
        volume: k.volume || 0,
        type: k.type || "cluster",
        contentAngle: c.contentAngle || "basic",
        estimatedWords: k.type === "pillar" ? 3500 : 1500,
        suggestedTitle: titleMap[k.keyword] || null,
        status: "pending",
      })),
    }));

    const totalKw = clusters.reduce((s, c) => s + c.keywords.length, 0);

    const plan = await storage.createForUser("kwplans", {
      projectId: req.params.projectId,
      name: planName || clustering.name || "AI Clustered Plan",
      description: `Auto-generated from AI clustering (${clustering.totalClusters} groups)`,
      status: "analyzed",
      scheduleMode: "immediate",
      originalKeywords: clustering.originalKeywords?.map(k => k.keyword) || [],
      clusters,
      totalKeywords: totalKw,
      articlesCreated: 0,
      articlesPublished: 0,
    }, req.userId);

    // Update project kwPlans count

    const project = await storage.getByIdForUser("projects", req.params.projectId, req.userId);
    if (project) {
      const plans = await storage.getAllForUser("kwplans", req.userId);
      const count = plans.filter((p) => p.projectId === req.params.projectId).length;
      await storage.update("projects", req.params.projectId, { kwPlans: count });
    }

    res.status(201).json(plan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST re-generate AI titles for an existing KW Plan
router.post("/:projectId/kwplans/:planId/generate-titles", async (req, res) => {
  try {
    const plan = await storage.getByIdForUser("kwplans", req.params.planId, req.userId);
    if (!plan || plan.projectId !== req.params.projectId)
      return res.status(404).json({ error: "Plan not found" });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    const clustersWithVolume = (plan.clusters || []).map(c => ({
      ...c,
      keywords: c.keywords.map(k => ({ ...k, volume: k.volume || 0 })),
    }));

    const titleMap = await generateTitlesForClusters(clustersWithVolume, settings, apiKeys);

    const updatedClusters = (plan.clusters || []).map(c => ({
      ...c,
      keywords: c.keywords.map(k => ({
        ...k,
        suggestedTitle: titleMap[k.keyword] || k.suggestedTitle || null,
      })),
    }));

    const updatedPlan = await storage.update("kwplans", req.params.planId, {
      clusters: updatedClusters,
    });

    res.json(updatedPlan);
  } catch (e) {
    console.error("[Generate-Titles] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT update plan (add cluster, edit keyword, etc.)
router.put("/:projectId/kwplans/:planId", async (req, res) => {
  try {
    const plan = await storage.update("kwplans", req.params.planId, req.body);
    if (!plan) return res.status(404).json({ error: "Not found" });
    res.json(plan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE plan
router.delete("/:projectId/kwplans/:planId", async (req, res) => {
  try {
    await storage.delete("kwplans", req.params.planId);

    const project = await storage.getByIdForUser("projects", req.params.projectId, req.userId);
    if (project) {
      const plans = await storage.getAllForUser("kwplans", req.userId);
      const count = plans.filter(
        (p) => p.projectId === req.params.projectId,
      ).length;
      await storage.update("projects", req.params.projectId, {
        kwPlans: count,
      });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Articles =====
router.get("/:projectId/articles", async (req, res) => {
  try {
    const articles = await storage.getAllForUser("articles", req.userId);
    const filtered = articles.filter(
      (a) => a.projectId === req.params.projectId,
    );
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:projectId/articles/:articleId", async (req, res) => {
  try {
    const article = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
    );
    if (!article) return;
    res.json(article);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST create articles from selected keywords
router.post("/:projectId/articles", async (req, res) => {
  try {
    const project = await getProjectOr404(req.params.projectId, res, req.userId);
    if (!project) return;

    // --- License: Article limit check ---
    const limit = req.license?.limits?.maxArticlesPerMonth || 0;
    const used = req.usage?.articlesCreated || 0;
    const { keywords, mode } = req.body;
    const requestCount = (keywords || []).length;
    if (used + requestCount > limit) {
      return res.status(403).json({
        error: `Đã dùng ${used}/${limit} bài tháng này. Không thể tạo thêm ${requestCount} bài. Nâng cấp gói để tạo thêm.`,
        code: "ARTICLE_LIMIT",
        limit, used, requested: requestCount,
        currentPlan: req.license?.plan,
      });
    }

    const created = [];
    for (const kw of keywords || []) {
      const article = await storage.createForUser("articles", {
        projectId: req.params.projectId,
        title: kw.keyword,
        keyword: kw.keyword,
        source: mode || "keyword",
        contentAngle: kw.contentAngle || "basic",
        estimatedWords: kw.estimatedWords || 2000,
        clusterId: kw.clusterId || null,
        pipeline: {
          research: { status: "pending", data: null },
          outline: { status: "pending", data: null },
          content: { status: "pending", data: null },
          thumbnail: { status: "pending", url: null },
          sections: { status: "pending", images: [] },
          publish: { status: "pending", wpPostId: null, wpUrl: null },
        },
        status: "processing",
        searchIntent: kw.searchIntent || "informational",
        contentType: "blog",
        tokenUsage: { research: 0, outline: 0, content: 0, total: 0 },
      });
      created.push(article);
    }
    // Update project article count
    const allArticles = await storage.getAllForUser("articles", req.userId);
    const count = allArticles.filter(
      (a) => a.projectId === req.params.projectId,
    ).length;
    await storage.update("projects", req.params.projectId, { articles: count });
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST import WP posts as articles (for pipeline processing / internal linking)
router.post("/:projectId/articles/import-wp", async (req, res) => {
  try {
    const { posts, siteId } = req.body;
    if (!posts || !Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ error: "Cần ít nhất 1 bài viết WP để import." });
    }

    // Resolve WP site for fetching content
    let wpSite = null;
    if (siteId) {
      const sites = await storage.getAllForUser("wp-sites", req.userId);
      wpSite = sites.find(s => s.id === siteId);
    }

    // Check for duplicates — skip WP posts already imported (cross-check articles + drafts)
    const existingArticles = await storage.getAllForUser("articles", req.userId);
    const existingDrafts = await storage.getAllForUser("standalone-drafts", req.userId);
    
    // Build sets for fast lookup
    const existingWpIds = new Set(
      existingArticles
        .filter(a => a.projectId === req.params.projectId && a.wpPostId)
        .map(a => String(a.wpPostId))
    );
    // Also check drafts that may have been published to WP
    const draftWpIds = new Set(
      existingDrafts
        .filter(d => d.pipeline?.publish?.wpPostId)
        .map(d => String(d.pipeline.publish.wpPostId))
    );
    // Normalize titles for fuzzy matching
    const existingTitles = new Set(
      existingArticles
        .filter(a => a.projectId === req.params.projectId)
        .map(a => (a.title || "").toLowerCase().trim())
    );

    const created = [];
    const skipped = [];

    for (const post of posts) {
      const wpId = String(post.wpPostId || post.id);
      const postTitle = (post.title || "").toLowerCase().trim();
      
      // Skip if already imported by wpPostId
      if (existingWpIds.has(wpId)) {
        skipped.push({ title: post.title, reason: "Đã import trước đó (wpPostId trùng)" });
        continue;
      }
      // Skip if this WP post was created from a Pipeline draft
      if (draftWpIds.has(wpId)) {
        skipped.push({ title: post.title, reason: "Bài viết đã tạo từ Pipeline" });
        continue;
      }
      // Skip if title matches existing article (fuzzy duplicate)
      if (postTitle && existingTitles.has(postTitle)) {
        skipped.push({ title: post.title, reason: "Tiêu đề trùng với bài đã có" });
        continue;
      }

      // Fetch full content from WP API if not provided
      let postContent = post.content || "";
      if (!postContent && wpSite) {
        try {
          const siteBase = (wpSite.url || wpSite.siteUrl).replace(/\/$/, "");
          const wpPostId = post.wpPostId || post.id;
          const wpRes = await fetch(
            `${siteBase}/wp-json/wp/v2/posts/${wpPostId}?_fields=id,content,featured_media`,
            {
              headers: {
                "Authorization": "Basic " + Buffer.from(`${wpSite.username}:${wpSite.appPassword}`).toString("base64"),
              },
              signal: AbortSignal.timeout(15000),
            }
          );
          if (wpRes.ok) {
            const wpData = await wpRes.json();
            postContent = wpData.content?.rendered || "";
          }
        } catch (fetchErr) {
          console.warn(`[Articles] Could not fetch content for WP post ${post.wpPostId || post.id}:`, fetchErr.message);
        }
      }

      // Extract keyword from title (simple: use cleaned title)
      const keyword = (post.title || "").replace(/\s*[-–|]\s*.*$/, "").trim() || post.title;

      // Count words from content
      const contentText = (postContent).replace(/<[^>]*>/g, "");
      const wordCount = contentText.split(/\s+/).filter(Boolean).length;

      const article = await storage.createForUser("articles", {
        projectId: req.params.projectId,
        title: post.title || "Untitled",
        keyword,
        source: "wp-import",
        wpPostId: post.wpPostId || post.id,
        wpUrl: post.url || post.link || "",
        wpSlug: post.slug || "",
        originalContent: postContent,
        originalWordCount: wordCount,
        contentAngle: "basic",
        estimatedWords: wordCount || 2000,
        pipeline: {
          research: { status: "skipped", data: null },
          outline: { status: "skipped", data: null },
          content: { status: "imported", data: { html: postContent, wordCount, readingTime: Math.ceil(wordCount / 200), mode: "wp-import" } },
          thumbnail: { status: post.thumbnailUrl ? "done" : "pending", url: post.thumbnailUrl || null },
          sections: { status: "pending", images: [] },
          publish: {
            status: "published",
            wpPostId: post.wpPostId || post.id,
            wpUrl: post.url || post.link || "",
          },
        },
        status: "imported",
        searchIntent: "informational",
        contentType: "blog",
        tokenUsage: { research: 0, outline: 0, content: 0, total: 0 },
      });
      created.push(article);
    }

    // Update project article count
    const allArticles = await storage.getAllForUser("articles", req.userId);
    const count = allArticles.filter(
      (a) => a.projectId === req.params.projectId,
    ).length;
    await storage.update("projects", req.params.projectId, { articles: count });

    console.log(`[Articles] Imported ${created.length} WP posts, skipped ${skipped.length} duplicates`);
    res.status(201).json({ created, skipped, totalArticles: count });
  } catch (e) {
    console.error("[Articles] Import WP error:", e);
    res.status(500).json({ error: e.message });
  }
});

// PUT update article
router.put("/:projectId/articles/:articleId", async (req, res) => {
  try {
    const existing = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
    );
    if (!existing) return;

    const article = await storage.update(
      "articles",
      req.params.articleId,
      req.body,
    );
    if (!article) return res.status(404).json({ error: "Not found" });
    res.json(article);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE article — CASCADE xóa publishing history liên quan
router.delete("/:projectId/articles/:articleId", async (req, res) => {
  try {
    const articleId = req.params.articleId;
    const article = await getProjectOwnedRecordOr404(
      "articles",
      articleId,
      req.params.projectId,
      res,
      "Article not found",
    );
    if (!article) return;

    // 1. Xóa publishing history liên quan
    const historyDeleted = await storage.deleteByFilter("publishing-history", { articleId });
    if (historyDeleted > 0) {
      console.log(`[Articles] Cascade deleted ${historyDeleted} publishing-history for article ${articleId}`);
    }

    // 2. Xóa article
    await storage.delete("articles", articleId);

    // 3. Cập nhật count trên project
    const allArticles = await storage.getAllForUser("articles", req.userId);
    const count = allArticles.filter(
      (a) => a.projectId === req.params.projectId,
    ).length;
    await storage.update("projects", req.params.projectId, { articles: count });
    res.json({ success: true, historyDeleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST generate thumbnail for article
router.post("/:projectId/articles/:articleId/thumbnail", async (req, res) => {
  try {
    const article = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
      "Article not found",
    );
    if (!article) return;

    // Update status to generating
    await storage.update("articles", req.params.articleId, {
      pipeline: {
        ...article.pipeline,
        thumbnail: { status: "generating", url: null },
      },
    });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);
    const aiService = require("../services/ai-service");

    // Gather rich context from article data
    const keyword = article.keyword || article.title;
    const research = article.pipeline?.research?.data || {};
    const outline = article.pipeline?.outline?.data || {};
    const contentData = article.pipeline?.content?.data || {};
    const articleTitle =
      outline.title || research.suggestedTitle || article.title || keyword;

    // Get project info for niche context

    const project = await storage.getByIdForUser("projects", req.params.projectId, req.userId);
    const niche = project?.niche || project?.name || "";

    // Build comprehensive content context
    const sectionHeadings = (outline.sections || [])
      .map((s) => s.heading)
      .join(", ");
    const keyPoints = (outline.sections || [])
      .flatMap((s) => s.keyPoints || [])
      .slice(0, 6)
      .join(", ");

    // Extract a preview from actual content if available
    let contentPreview = "";
    if (contentData.html) {
      contentPreview = contentData.html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 300);
    }

    let imagePrompt;
    try {
      const promptResult = await aiService.generate(
        `You are a visual director for a blog. Based on this article, create a SHORT but HIGHLY SPECIFIC image prompt (max 30 words, in English) for a blog thumbnail.

ARTICLE TITLE: "${articleTitle}"
KEYWORD: "${keyword}"
NICHE/INDUSTRY: "${niche}"
TARGET AUDIENCE: ${research.targetAudience || "Vietnamese readers"}
MAIN SECTIONS: ${sectionHeadings || "N/A"}
KEY POINTS: ${keyPoints || "N/A"}
${contentPreview ? `CONTENT PREVIEW: ${contentPreview}` : ""}

Rules:
- The image MUST visually represent the SPECIFIC topic of this article, not a generic concept
- Be CONCRETE and SPECIFIC. Examples:
  • For "Xe điện VinFast VF8 2024" → "sleek white VinFast VF8 electric SUV on modern Vietnamese highway, cinematic lighting"
  • For "Cách trồng cà chua tại nhà" → "fresh ripe tomatoes growing in a home garden pot on sunny balcony, close-up macro"  
  • For "Top 10 laptop văn phòng" → "modern slim laptop on minimalist desk with coffee cup, productivity workspace, soft natural light"
- Style: professional photo or high-quality 3D render, bright clean lighting
- NO text, NO watermarks, NO human faces, NO logos
- Include lighting/mood descriptor (e.g. "warm golden hour", "soft studio light", "dramatic contrast")

Return ONLY the prompt, nothing else.`,
        settings,
        { apiKeys },
      );
      imagePrompt = promptResult
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\n/g, " ")
        .substring(0, 400);
    } catch (e) {
      // Fallback: build a more descriptive prompt directly
      imagePrompt = `Professional high quality photo representing "${articleTitle}", ${niche ? `${niche} industry, ` : ""}modern clean design, bright studio lighting, detailed, no text, no watermark`;
    }

    // Step 2: Generate image
    const imageUrl = await aiService.generateImage(imagePrompt, settings, {
      width: 1200,
      height: 630,
      apiKeys,
    });

    // Update article with thumbnail URL
    await storage.update("articles", req.params.articleId, {
      pipeline: {
        ...article.pipeline,
        thumbnail: { status: "done", url: imageUrl, prompt: imagePrompt },
      },
    });

    res.json({ success: true, url: imageUrl, prompt: imagePrompt });
  } catch (error) {
    // Mark as failed
    const article = await storage.getByIdForUser("articles", req.params.articleId, req.userId);
    if (article) {
      await storage.update("articles", req.params.articleId, {
        pipeline: {
          ...article.pipeline,
          thumbnail: { status: "failed", url: null, error: error.message },
        },
      });
    }
    console.error("[Thumbnail] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST generate section images for article
router.post(
  "/:projectId/articles/:articleId/section-images",
  async (req, res) => {
    try {
      const article = await storage.getByIdForUser("articles", req.params.articleId, req.userId);
      if (!article) return res.status(404).json({ error: "Article not found" });

      const outline = article.pipeline?.outline?.data || {};
      const sections = outline.sections || [];
      if (sections.length === 0) {
        return res
          .status(400)
          .json({ error: "Cần tạo outline trước khi tạo ảnh sections" });
      }

      // Update status to generating
      await storage.update("articles", req.params.articleId, {
        pipeline: {
          ...article.pipeline,
          sections: { status: "generating", images: [] },
        },
      });

      const settings = await storage.getSettings();
      const apiKeys = await resolveApiKeys(req.userId, req.license);
      const aiService = require("../services/ai-service");

      // Get context
      const keyword = article.keyword || article.title;
      const research = article.pipeline?.research?.data || {};
      const articleTitle =
        outline.title || research.suggestedTitle || article.title || keyword;
  
    const project = await storage.getByIdForUser("projects", req.params.projectId, req.userId);
      const niche = project?.niche || project?.name || "";

      // Smart Selection: Pick 3-4 most visual sections instead of all
      let selectedSections = sections;
      if (sections.length > 4) {
        try {
          const selectionPrompt = `Given these article sections, pick the 3-4 that would benefit MOST from a visual/image illustration. Return ONLY a JSON array of indices (0-indexed).

Sections:
${sections.map((s, i) => `${i}: ${s.heading}`).join("\n")}

Rules:
- Pick sections with physical/visual topics (products, places, processes, comparisons)
- SKIP abstract/definition sections  
- Always include the first major topic section
- Return format: [0, 2, 5] (just the array, nothing else)`;

          const selResult = await aiService.generate(selectionPrompt, settings, { apiKeys });
          const indices = JSON.parse(selResult.match(/\[[\d,\s]+\]/)?.[0] || "[]");
          if (indices.length >= 2 && indices.length <= 5) {
            selectedSections = indices.map(i => sections[i]).filter(Boolean);
            console.log(`[Section-Images] Smart selected ${selectedSections.length}/${sections.length} sections`);
          }
        } catch (e) {
          // Fallback: pick first, middle, and last sections
          const mid = Math.floor(sections.length / 2);
          selectedSections = [sections[0], sections[mid], sections[sections.length - 1]].filter(Boolean);
          console.log(`[Section-Images] Fallback selection: 3/${sections.length} sections`);
        }
      }

      const sectionImages = [];

      // Generate image for selected sections
      for (const section of selectedSections) {
        try {
          const sectionHeading = section.heading || "";
          const sectionKeyPoints = (section.keyPoints || []).join(", ");
          const subsectionHeadings = (section.subsections || [])
            .map((s) => s.heading)
            .join(", ");

          // Generate specific prompt for this section
          let sectionPrompt;
          try {
            const promptResult = await aiService.generate(
              `You are a visual director. Create a SHORT, SPECIFIC image prompt (max 25 words, English) for a blog section illustration.

ARTICLE: "${articleTitle}"
SECTION HEADING: "${sectionHeading}"
KEY POINTS: ${sectionKeyPoints || "N/A"}
SUBSECTIONS: ${subsectionHeadings || "N/A"}
NICHE: "${niche}"

Rules:
- The image MUST visually represent THIS SPECIFIC SECTION's content
- Be CONCRETE (e.g. for section "Cách bảo dưỡng pin" → "close-up lithium battery with maintenance tools, clean workshop, soft lighting")
- Style: professional photo/illustration, clean and modern
- NO text, NO watermarks, NO faces, NO logos
- Different from thumbnail - focus on section-specific detail

Return ONLY the prompt.`,
              settings,
              { apiKeys },
            );
            sectionPrompt = promptResult
              .trim()
              .replace(/^["']|["']$/g, "")
              .replace(/\n/g, " ")
              .substring(0, 300);
          } catch (e) {
            sectionPrompt = `Professional illustration of ${sectionHeading.replace(/^H[23]:\s*/i, "")}, ${niche ? `${niche} context, ` : ""}clean modern style, bright lighting, no text`;
          }

          // Generate the image
          const imageUrl = await aiService.generateImage(
            sectionPrompt,
            settings,
            {
              width: 800,
              height: 450,
              apiKeys,
            },
          );

          sectionImages.push({
            sectionHeading,
            prompt: sectionPrompt,
            url: imageUrl,
            status: "done",
          });

          console.log(
            `[Section-Image] Generated for: ${sectionHeading.substring(0, 40)}`,
          );
        } catch (e) {
          sectionImages.push({
            sectionHeading: section.heading || "",
            prompt: null,
            url: null,
            status: "failed",
            error: e.message,
          });
          console.error(
            `[Section-Image] Failed for: ${section.heading}:`,
            e.message,
          );
        }
      }

      // Save all section images
      await storage.update("articles", req.params.articleId, {
        pipeline: {
          ...article.pipeline,
          sections: {
            status: "done",
            images: sectionImages,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      res.json({ success: true, images: sectionImages });
    } catch (error) {
      const article = await storage.getByIdForUser("articles", req.params.articleId, req.userId);
      if (article) {
        await storage.update("articles", req.params.articleId, {
          pipeline: {
            ...article.pipeline,
            sections: {
              status: "failed",
              images: [],
              error: error.message,
            },
          },
        });
      }
      console.error("[Section-Images] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  },
);

// ===== AI PIPELINE ENDPOINTS =====

// POST generate research for article
router.post("/:projectId/articles/:articleId/research", async (req, res) => {
  try {
    const article = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
      "Article not found",
    );
    if (!article) return;

    await storage.update("articles", req.params.articleId, {
      pipeline: {
        ...article.pipeline,
        research: { status: "processing", data: null },
      },
    });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);
    const aiService = require("../services/ai-service");
    const keyword = article.keyword || article.title;

    // Get project niche for context

    const project = await storage.getByIdForUser("projects", req.params.projectId, req.userId);
    const niche = project?.niche || project?.name || "";
    const suggestedTitle = article.suggestedTitle || article.title || keyword;

    const prompt = `Bạn là chuyên gia SEO content Việt Nam top 1. Thực hiện NGHIÊN CỨU CHUYÊN SÂU cho keyword dưới đây.

KEYWORD: "${keyword}"
NICHE/NGÀNH: "${niche}"
TIÊU ĐỀ DỰ KIẾN: "${suggestedTitle}"
CONTENT ANGLE: ${article.contentAngle || "guide"}
SEARCH INTENT: ${article.searchIntent || "informational"}

Phân tích theo 5 BƯỚC:

BƯỚC 1 — PHÂN TÍCH CẠNH TRANH:
- 3 loại bài viết phổ biến nhất cho keyword này (format, độ dài, góc tiếp cận)
- Content gaps: competitors thiếu gì? Người đọc cần gì mà chưa ai viết?
- Điểm mạnh/yếu của top 3 bài xếp hạng cao nhất

BƯỚC 2 — LSI & RELATED KEYWORDS:
- 10 từ khóa LSI (đồng nghĩa, liên quan ngữ nghĩa)
- 5 long-tail keywords có search volume tiềm năng
- 5 People Also Ask (câu hỏi thực tế người dùng tìm)

BƯỚC 3 — ĐỐI TƯỢNG MỤC TIÊU:
- Level kiến thức (beginner/intermediate/expert)
- 3 pain points cụ thể
- 3 misconceptions phổ biến (hiểu sai, tin sai)
- Hành vi tìm kiếm: người đọc muốn gì sau khi đọc xong?

BƯỚC 4 — CHIẾN LƯỢC NỘI DUNG:
- Unique angle: điểm khác biệt bài viết này SO VỚI competitors
- Hook strategy: cách mở bài hấp dẫn (storytelling, số liệu shock, câu hỏi)
- CTA direction: kêu gọi hành động phù hợp search intent
- Tone of voice recommendation

BƯỚC 5 — SEO METADATA:
- Title SEO tối ưu (50-60 ký tự, keyword ở đầu)
- Meta description hấp dẫn (120-160 ký tự)
- Estimated word count phù hợp
- Difficulty assessment

Trả về ĐÚNG JSON, KHÔNG markdown:
{
  "searchIntent": "informational|transactional|commercial|navigational",
  "difficulty": "easy|medium|hard",
  "competitorAnalysis": {
    "topFormats": ["format1", "format2", "format3"],
    "avgWordCount": 2500,
    "contentGaps": ["gap1", "gap2", "gap3"],
    "strengths": "Điểm mạnh competitors",
    "weaknesses": "Điểm yếu competitors"
  },
  "lsiKeywords": ["lsi1", "lsi2", "lsi3", "lsi4", "lsi5", "lsi6", "lsi7", "lsi8", "lsi9", "lsi10"],
  "longTailKeywords": ["lt1", "lt2", "lt3", "lt4", "lt5"],
  "peopleAlsoAsk": ["q1?", "q2?", "q3?", "q4?", "q5?"],
  "targetAudience": {
    "level": "beginner|intermediate|expert",
    "painPoints": ["pain1", "pain2", "pain3"],
    "misconceptions": ["mis1", "mis2", "mis3"],
    "desiredOutcome": "Kết quả người đọc mong muốn"
  },
  "contentStrategy": {
    "uniqueAngle": "Điểm khác biệt bài viết",
    "hookStrategy": "Cách mở bài hấp dẫn",
    "ctaDirection": "Kêu gọi hành động",
    "toneOfVoice": "Gợi ý tone"
  },
  "suggestedTitle": "Tiêu đề SEO tối ưu",
  "suggestedMetaDescription": "Meta description 120-160 ký tự",
  "relatedKeywords": ["rk1", "rk2", "rk3", "rk4", "rk5", "rk6", "rk7"],
  "questionsToAnswer": ["q1?", "q2?", "q3?", "q4?", "q5?"],
  "targetAudienceText": "Mô tả đối tượng 2-3 câu",
  "competitorInsights": "Tóm tắt cạnh tranh 2-3 câu",
  "contentAngle": "guide",
  "estimatedWords": 2500
}`;

    const result = await aiService.generate(prompt, settings, { apiKeys });

    let researchData = {};
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) researchData = JSON.parse(jsonMatch[0]);
      // Backward compat: ensure targetAudience string exists
      if (!researchData.targetAudience && researchData.targetAudienceText) {
        researchData.targetAudience = researchData.targetAudienceText;
      } else if (researchData.targetAudience && typeof researchData.targetAudience === "object") {
        researchData.targetAudienceText = researchData.targetAudience.desiredOutcome || "";
        // Keep the object under targetAudienceObj and put text in targetAudience for backward compat
        researchData.targetAudienceObj = researchData.targetAudience;
        researchData.targetAudience = `${researchData.targetAudienceObj.level} — ${researchData.targetAudienceObj.desiredOutcome || ""}`;
      }
    } catch (e) {
      researchData = { rawResponse: result };
    }

    await storage.update("articles", req.params.articleId, {
      pipeline: {
        ...article.pipeline,
        research: { status: "done", data: researchData },
      },
    });

    res.json({ success: true, data: researchData });
  } catch (error) {
    const article = await storage.getByIdForUser("articles", req.params.articleId, req.userId);
    if (article) {
      await storage.update("articles", req.params.articleId, {
        pipeline: {
          ...article.pipeline,
          research: { status: "failed", data: null, error: error.message },
        },
      });
    }
    console.error("[Research] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST generate outline for article
router.post("/:projectId/articles/:articleId/outline", async (req, res) => {
  try {
    const article = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
      "Article not found",
    );
    if (!article) return;

    await storage.update("articles", req.params.articleId, {
      pipeline: {
        ...article.pipeline,
        outline: { status: "processing", data: null },
      },
    });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);
    const aiService = require("../services/ai-service");
    const keyword = article.keyword || article.title;
    const research = article.pipeline?.research?.data || {};

    // Rich context from upgraded research
    const competitorAnalysis = research.competitorAnalysis || {};
    const contentStrategy = research.contentStrategy || {};
    const lsiKeywords = research.lsiKeywords || research.relatedKeywords || [];
    const contentGaps = competitorAnalysis.contentGaps || [];
    const peopleAlsoAsk = research.peopleAlsoAsk || research.questionsToAnswer || [];
    const targetAudienceObj = research.targetAudienceObj || {};
    const suggestedTitle = research.suggestedTitle || article.suggestedTitle || article.title || keyword;

    const prompt = `Bạn là content strategist SEO Việt Nam hàng đầu. Tạo DÀN Ý CHIẾN LƯỢC cho bài viết.

KEYWORD: "${keyword}"
TIÊU ĐỀ (đã duyệt): "${suggestedTitle}"
SEARCH INTENT: ${research.searchIntent || "informational"}
CONTENT ANGLE: ${research.contentAngle || article.contentAngle || "guide"}
TARGET WORD COUNT: ${article.estimatedWords || research.estimatedWords || 2500} từ
⚠️ GIỚI HẠN SỐ TỪ: Tổng wordCount tất cả sections PHẢI nằm trong khoảng ${Math.round((article.estimatedWords || research.estimatedWords || 2500) * 0.9)} - ${Math.round((article.estimatedWords || research.estimatedWords || 2500) * 1.1)} từ. TUYỆT ĐỐI KHÔNG vượt quá ${Math.round((article.estimatedWords || research.estimatedWords || 2500) * 1.1)} từ.

DỮ LIỆU NGHIÊN CỨU:
- LSI Keywords: ${lsiKeywords.slice(0, 10).join(", ")}
- Content Gaps (competitors thiếu): ${contentGaps.join("; ") || "N/A"}
- People Also Ask: ${peopleAlsoAsk.slice(0, 5).join("; ")}
- Unique Angle: ${contentStrategy.uniqueAngle || "N/A"}
- Hook Strategy: ${contentStrategy.hookStrategy || "N/A"}
- Target Audience Level: ${targetAudienceObj.level || "beginner"}
- Pain Points: ${(targetAudienceObj.painPoints || []).join("; ")}

CHIẾN LƯỢC TẠO DÀN Ý:
1. Tiêu đề sử dụng "${suggestedTitle}" đã được user chấp nhận — KHÔNG thay đổi nếu đã tốt
2. Mỗi content gap → tạo 1 section riêng (lợi thế cạnh tranh)
3. People Also Ask → thêm vào FAQ hoặc tạo sections riêng nếu đủ dài
4. LSI keywords → phân bổ tự nhiên vào các sections (ghi rõ LSI nào cho section nào)
5. Keyword chính PHẢI xuất hiện ở: Section 1, Section 3-4, Section cuối
6. Mỗi section cần có "actionable takeaway" — reader được gì sau khi đọc?
7. ⚠️ TỔNG wordCount tất cả sections + subsections PHẢI = ${article.estimatedWords || research.estimatedWords || 2500} từ (±10%). Chia đều wordCount cho sections.

Trả về ĐÚNG JSON:
{
  "title": "${suggestedTitle}",
  "metaDescription": "Meta description 120-160 ký tự, keyword ở đầu",
  "sections": [
    {
      "heading": "H2: Tiêu đề section (chứa keyword/LSI tự nhiên)",
      "type": "h2",
      "wordCount": 350,
      "keyPoints": ["Điểm chính 1", "Điểm chính 2"],
      "lsiTargets": ["lsi keyword cho section này"],
      "actionableTip": "Mẹo thực tế reader có thể áp dụng",
      "subsections": [
        {
          "heading": "H3: Tiêu đề subsection",
          "type": "h3",
          "wordCount": 200,
          "keyPoints": ["Điểm chính"]
        }
      ]
    }
  ],
  "totalEstimatedWords": ${article.estimatedWords || research.estimatedWords || 2500},
  "faq": [
    { "question": "Câu hỏi từ People Also Ask?", "answerHint": "Gợi ý trả lời schema-ready" }
  ],
  "keywordDistribution": {
    "primary": ["section index 0, 3, last"],
    "lsi": {"lsi_keyword": [1, 4]}
  }
}

⚠️ QUAN TRỌNG: Tạo số sections phù hợp để tổng wordCount = ${article.estimatedWords || research.estimatedWords || 2500} từ (±10%). Nếu target thấp (< 2000 từ) → chỉ cần 4-6 sections. Nếu target cao (> 3000 từ) → 8-10 sections.
FAQ tối thiểu 5 câu (ưu tiên People Also Ask).
Chỉ trả JSON.`;

    const result = await aiService.generate(prompt, settings, { apiKeys });

    let outlineData = {};
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) outlineData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      outlineData = { rawResponse: result };
    }

    await storage.update("articles", req.params.articleId, {
      title: outlineData.title || article.title,
      pipeline: {
        ...article.pipeline,
        outline: { status: "done", data: outlineData },
      },
    });

    res.json({ success: true, data: outlineData });
  } catch (error) {
    const article = await storage.getByIdForUser("articles", req.params.articleId, req.userId);
    if (article) {
      await storage.update("articles", req.params.articleId, {
        pipeline: {
          ...article.pipeline,
          outline: { status: "failed", data: null, error: error.message },
        },
      });
    }
    console.error("[Outline] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST generate content for article (supports mode: "basic" or "quality")
router.post("/:projectId/articles/:articleId/content", async (req, res) => {
  try {
    const article = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
      "Article not found",
    );
    if (!article) return;

    // --- License: Article limit check ---
    const artLimit = req.license?.limits?.maxArticlesPerMonth || 0;
    const artUsed = req.usage?.articlesCreated || 0;
    if (artUsed >= artLimit) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${artLimit} bài/tháng. Nâng cấp gói để tạo thêm.`,
        code: "ARTICLE_LIMIT",
        limit: artLimit, used: artUsed,
        currentPlan: req.license?.plan,
      });
    }

    const mode = req.body?.mode || "basic"; // "basic" = fast 1-prompt, "quality" = section-by-section

    await storage.update("articles", req.params.articleId, {
      pipeline: {
        ...article.pipeline,
        content: { status: "processing", data: null, mode },
      },
    });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);
    const aiService = require("../services/ai-service");
    const keyword = article.keyword || article.title;
    const research = article.pipeline?.research?.data || {};
    const outline = article.pipeline?.outline?.data || {};
    const contentStrategy = research.contentStrategy || {};
    const targetAudienceObj = research.targetAudienceObj || {};

    // Common rules for both modes
    const CREATIVE_RULES = `
QUY TẮC VIẾT SÁNG TẠO (BẮT BUỘC):
1. Viết bằng HTML (dùng <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <table>)
2. KHÔNG dùng <h1> (H1 là title)
3. Dùng tiếng Việt 100%, SEO-friendly

HOOK & STORYTELLING:
- Mở đầu bằng tình huống thực tế / câu hỏi gây tò mò / số liệu bất ngờ
- ${contentStrategy.hookStrategy || "Mở bài hấp dẫn, đặt vấn đề ngay câu đầu"}
- Đoạn đầu tiên PHẢI chứa keyword chính trong 100 từ đầu

DATA-DRIVEN:
- Chèn số liệu, phần trăm, thống kê cụ thể (ít nhất 5 data points)
- Nếu là ước tính, ghi rõ "theo ước tính" hoặc "khoảng..."
- Dùng <table> khi so sánh 2+ đối tượng (bắt buộc nếu content angle là comparison)

ACTIONABLE CONTENT:
- Mỗi section H2 PHẢI có ít nhất 1 tip/mẹo thực tế
- Dùng <blockquote> cho 💡 Pro Tips, ⚠️ Lưu ý quan trọng, ✅ Mẹo hay
- Cuối mỗi section: 1 câu tóm tắt takeaway

MISCONCEPTION BUSTING (nếu có):
${(targetAudienceObj.misconceptions || []).length > 0 ? 
  `- Phá bỏ hiểu lầm: ${targetAudienceObj.misconceptions.join("; ")}` : 
  "- Nếu có hiểu lầm phổ biến, tạo section riêng để clarify"}

TONE & VOICE:
- Ngôi "bạn" xuyên suốt — KHÔNG dùng "mình", "tôi", "chúng tôi"
- Thông tin trước, cảm xúc sau — ưu tiên facts hữu ích, số liệu cụ thể
- Văn phong chuẩn mực, chuyên nghiệp, chỉn chu, trang nhã, đúng tầm vóc doanh nghiệp B2B
- Mỗi đoạn <p> tối đa 80 từ — dễ đọc trên mobile
- Dùng <ul>/<ol> cho danh sách — không viết gạch đầu dòng trong <p>

TỪ TUYỆT ĐỐI KHÔNG DÙNG:
"thiên đường", "tuyệt vời không thể tả", "không thể bỏ qua", "must-visit",
"vô cùng ấn tượng", "cực kỳ đẹp", "đẹp đến mê hồn", "hút hồn",
"check-in sống ảo", "trải nghiệm đáng nhớ", "đẳng cấp", "đừng bỏ lỡ",
"tốc độ bàn thờ", "cắt cổ", "chém giá", "dỏm", "ngậm đắng nuốt cay", "chậm như rùa", "giữ con tấm", "nói bừa", "bốc phét"

XỬ LÝ GIÁ CẢ (nếu có):
- KHÔNG ghi giá cố định, luôn ghi range: "khoảng X - Y"
- Thêm ghi chú: <em>Giá tham khảo, có thể thay đổi.</em>

CẤU TRÚC:
- Chèn LSI/related keywords tự nhiên
- Mỗi section có internal link placeholder [INTERNAL_LINK: anchor text]
- Cuối bài có FAQ section dùng schema-ready format

Chỉ trả HTML content, không markdown, không explanation.`;

    let htmlContent = "";

    if (mode === "quality") {
      // ============ QUALITY MODE: Section-by-section ============
      const totalTarget = article.estimatedWords || outline.totalEstimatedWords || 2500;
      const faqCount = (outline.faq || []).length;
      const introWords = Math.min(250, Math.round(totalTarget * 0.1));
      const faqWords = faqCount > 0 ? Math.min(faqCount * 60, Math.round(totalTarget * 0.15)) : 0;
      const sectionsWordBudget = totalTarget - introWords - faqWords;
      const sections = outline.sections || [];
      const outlineTotalSectionWords = sections.reduce((sum, s) => sum + (s.wordCount || 350), 0);
      const scaleFactor = outlineTotalSectionWords > 0 ? sectionsWordBudget / outlineTotalSectionWords : 1;

      console.log(`[Content-Quality] Budget: total=${totalTarget}, intro=${introWords}, sectionsBudget=${sectionsWordBudget}, faq=${faqWords}, scale=${scaleFactor.toFixed(2)}`);
      console.log(`[Content-Quality] Generating ${sections.length} sections for "${keyword}"...`);
      const allLSI = research.lsiKeywords || research.relatedKeywords || [];
      let previousContent = ""; // Context accumulator

      const introParagraphs = Math.max(1, Math.ceil(introWords / 75));
      // Section 0: Introduction/Hook
      const introPrompt = `Bạn là copywriter SEO Việt Nam top 1. Viết PHẦN MỞ BÀI cho bài viết.

Keyword: "${keyword}"
Title: ${outline.title || article.title}
${contentStrategy.hookStrategy ? `Hook Strategy: ${contentStrategy.hookStrategy}` : ""}
Target Audience: ${research.targetAudience || "Người đọc Việt Nam"}
${targetAudienceObj.painPoints ? `Pain Points: ${targetAudienceObj.painPoints.join("; ")}` : ""}

QUY TẮC E-E-A-T & ĐỘ DÀI:
- Độ dài mục tiêu: Tối thiểu ${introWords} từ (khoảng 200-250 từ).
- Keyword chính "${keyword}" xuất hiện tự nhiên trong 50 từ đầu tiên.
- Mở đầu bằng hook lôi cuốn (insight thực chiến / số liệu ấn tượng / tình huống thực tế).
- Nêu bật lợi ích và giá trị cốt lõi bài viết đem lại.
- Kết thúc bằng câu chuyển tiếp mượt mà sang nội dung chính.
- Viết HTML (<p>, <strong>, <em>), KHÔNG <h1>, KHÔNG <h2>.
Chỉ trả HTML.`;

      try {
        const introResult = await aiService.generate(introPrompt, settings, { apiKeys });
        htmlContent += introResult.replace(/```html?\n?/gi, "").replace(/```\n?$/gi, "").trim() + "\n\n";
        previousContent = htmlContent.replace(/<[^>]*>/g, " ").substring(0, 500);
      } catch (e) {
        console.error("[Content-Quality] Intro failed:", e.message);
      }

      // Each H2 section
      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        const sectionLSI = sec.lsiTargets || allLSI.slice(i * 2, i * 2 + 2);
        const subsText = (sec.subsections || []).map(sub => `  - ${sub.heading}: ${(sub.keyPoints || []).join(", ")}`).join("\n");

        const targetWords = Math.max(180, Math.round((sec.wordCount || 300) * scaleFactor));
        const minSectionWords = Math.round(targetWords * 0.85);
        const maxSectionWords = Math.round(targetWords * 1.15);

        const sectionPrompt = `Bạn là chuyên gia Content SEO E-E-A-T hàng đầu. Viết NỘI DUNG CHUYÊN SÂU cho 1 section.

KEYWORD CHÍNH: "${keyword}"
SECTION: ${sec.heading}
KEY POINTS: ${(sec.keyPoints || []).join(", ")}
SUBSECTIONS:
${subsText || "Không có subsection"}
${sec.actionableTip ? `ACTIONABLE TIP: ${sec.actionableTip}` : ""}
LSI KEYWORDS cho section này: ${sectionLSI.join(", ")}

⭐ TIÊU CHUẨN E-E-A-T & ĐỘ DÀI PHÂN BỔ:
- Dung lượng mục tiêu: Khoảng ${targetWords} từ (tối thiểu ${minSectionWords} từ, tối đa ${maxSectionWords} từ).
- ⚠️ QUAN TRỌNG: Viết sâu sắc, súc tích, giải thích đúng trọng tâm. Không viết lan man vượt quá ${maxSectionWords} từ.
- 1. Phân tích chi tiết, giải thích rõ nguyên lý và quy trình thực chiến.
- 2. BẮT BUỘC có ít nhất 1 <blockquote> với lưu ý chuyên gia/mẹo thực chiến (> 💡 **Lưu ý chuyên gia:** ...).
- 3. BẮT BUỘC có Bảng biểu so sánh (HTML <table>) hoặc danh sách nếu có phân loại/thông số.
- 4. Chèn LSI keywords tự nhiên và chính xác.

NỘI DUNG ĐÃ VIẾT TRƯỚC ĐÓ (để liên kết mạch lạc):
"${previousContent.substring(0, 300)}..."

QUY TẮC:
- Viết HTML: <h2> cho heading chính, <h3> cho subsections, <p>, <ul>, <ol>, <strong>, <blockquote>, <table>
- Kết thúc section bằng 1 câu chuyển tiếp
Chỉ trả HTML.`;

        try {
          const secResult = await aiService.generate(sectionPrompt, settings, { apiKeys });
          const cleanSec = secResult.replace(/```html?\n?/gi, "").replace(/```\n?$/gi, "").trim();
          htmlContent += cleanSec + "\n\n";
          previousContent = cleanSec.replace(/<[^>]*>/g, " ").substring(0, 500);
          console.log(`[Content-Quality] Section ${i + 1}/${sections.length}: ${sec.heading.substring(0, 40)}`);
        } catch (e) {
          console.error(`[Content-Quality] Section ${i + 1} failed:`, e.message);
          htmlContent += `<h2>${sec.heading.replace(/^H[23]:\s*/i, "")}</h2>\n<p>[Lỗi tạo nội dung section này]</p>\n\n`;
        }
      }

      // FAQ section
      if (outline.faq?.length > 0) {
        const faqPrompt = `Viết phần FAQ cho bài viết SEO. Keyword: "${keyword}".

Danh sách FAQ:
${outline.faq.map((f, i) => `${i + 1}. ${f.question} — Gợi ý: ${f.answerHint || ""}`).join("\n")}

QUY TẮC:
- HTML format: <h2>Câu Hỏi Thường Gặp</h2> rồi mỗi QA dùng <h3>Q</h3><p>A</p>
- Mỗi câu trả lời tối đa ${Math.round(faqWords / Math.max(faqCount, 1))} từ, trực tiếp, có giá trị\r
- ⚠️ Tổng FAQ tối đa ${faqWords} từ — KHÔNG viết dài hơn
- Schema-ready format
Chỉ trả HTML.`;

        try {
          const faqResult = await aiService.generate(faqPrompt, settings, { apiKeys });
          htmlContent += faqResult.replace(/```html?\n?/gi, "").replace(/```\n?$/gi, "").trim();
        } catch (e) {
          console.error("[Content-Quality] FAQ failed:", e.message);
        }
      }

    } else {
      // ============ BASIC MODE: Fast 1-prompt ============
      const sectionsText = (outline.sections || [])
        .map((s, i) => {
          const subs = (s.subsections || [])
            .map(sub => `  - ${sub.heading} (~${sub.wordCount || 200} từ): ${(sub.keyPoints || []).join(", ")}`)
            .join("\n");
          return `${i + 1}. ${s.heading} (~${s.wordCount || 300} từ)\n   Key points: ${(s.keyPoints || []).join(", ")}\n${subs}`;
        })
        .join("\n\n");

      const totalWordsTarget = article.estimatedWords || outline.totalEstimatedWords || 2500;

      const prompt = `Bạn là chuyên gia Content SEO E-E-A-T #1 Việt Nam. Viết bài viết toàn diện, chuyên sâu chuẩn E-E-A-T dưới dạng HTML hoàn chỉnh.

📌 TỪ KHÓA CHÍNH: "${keyword}"
📌 TIÊU ĐỀ BÀI VIẾT: ${outline.title || article.title}
🎯 ĐỐI TƯỢNG ĐỌC: ${research.targetAudience || "Người đọc Việt Nam"}
🔑 LSI KEYWORDS: ${(research.lsiKeywords || research.relatedKeywords || []).join(", ")}
${contentStrategy.uniqueAngle ? `GÓC TIẾP CẬN ĐỘC ĐÁO: ${contentStrategy.uniqueAngle}` : ""}

📋 DÀN Ý BẮT BUỘC TRIỂN KHAI ĐẦY ĐỦ CÁC HEADING:
${sectionsText || "Viết tự do theo keyword"}

❓ FAQ:
${(outline.faq || []).map(f => `Q: ${f.question}\nA hint: ${f.answerHint}`).join("\n")}

⭐ TIÊU CHUẨN E-E-A-T & ĐỘ DÀI BẮT BUỘC:
- TỔNG SỐ TỪ: TỐI THIỂU ${totalWordsTarget} TỪ (Tuyệt đối không viết ngắn hoặc tóm tắt sơ sài).
- Keyword chính xuất hiện trong 50-100 từ đầu tiên.
- Phân tích chi tiết từng heading, giải thích rõ nguyên lý thực tiễn, chia sẻ kinh nghiệm thực tế.
- BẮT BUỘC có ít nhất 1-2 Bảng so sánh (HTML <table>), các danh sách <ul>/<ol>, và các khối trích dẫn lưu ý (> <blockquote>).
- Kết thúc bằng FAQ Schema và Kết luận kêu gọi hành động (CTA).

${CREATIVE_RULES}`;

      const result = await aiService.generate(prompt, settings, { apiKeys });
      htmlContent = result;
    }

    // ====== Clean up HTML — KHÔNG cắt intro trước H2 ======
    htmlContent = htmlContent
      .replace(/```html?\n?/gi, "")
      .replace(/```\n?$/gi, "")
      .trim();

    if (!htmlContent.includes("<")) {
      htmlContent = "<p>" + htmlContent.replace(/\n\n+/g, "</p><p>") + "</p>";
    } else {
      const firstTagIdx = htmlContent.search(/(<h[1-6]|<p|<ul|<ol|<div|<section)/i);
      if (firstTagIdx > 0) {
        const beforeFirst = htmlContent.substring(0, firstTagIdx).trim();
        if (!beforeFirst.includes("<")) {
          htmlContent = htmlContent.substring(firstTagIdx);
        }
      }
    }

    const wordCount = htmlContent.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
    const readingTime = Math.ceil(wordCount / 200);

    const contentData = {
      html: htmlContent,
      wordCount,
      readingTime,
      mode,
      generatedAt: new Date().toISOString(),
    };

    // Auto-validate content quality
    const articleTitle = outline.title || article.title || keyword;
    const qualityResult = validateArticle(htmlContent, articleTitle, article.contentAngle || "guide", { keyword });
    console.log(`[Content-${mode}] ${wordCount} words, QC: ${qualityResult.score}/100, Passed: ${qualityResult.passed}`);

    await storage.update("articles", req.params.articleId, {
      pipeline: {
        ...article.pipeline,
        content: { status: "done", data: contentData },
        quality: qualityResult,
      },
      // Auto set approval status to pending review
      approvalStatus: "pending",
    });

    res.json({ success: true, data: contentData, quality: qualityResult });
  } catch (error) {
    const article = await storage.getByIdForUser("articles", req.params.articleId, req.userId);
    if (article) {
      await storage.update("articles", req.params.articleId, {
        pipeline: {
          ...article.pipeline,
          content: { status: "failed", data: null, error: error.message },
        },
      });
    }
    console.error("[Content] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST approve/reject article
router.post("/:projectId/articles/:articleId/approve", async (req, res) => {
  try {
    const article = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
      "Article not found",
    );
    if (!article) return;

    const { action, reviewNotes } = req.body; // action: "approve", "reject", "revision"
    const validActions = ["approve", "reject", "revision"];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Use: ${validActions.join(", ")}` });
    }

    const statusMap = {
      approve: "approved",
      reject: "rejected",
      revision: "revision",
    };

    const updated = await storage.update("articles", req.params.articleId, {
      approvalStatus: statusMap[action],
      reviewNotes: reviewNotes || "",
      reviewedAt: new Date().toISOString(),
      status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "processing",
    });

    console.log(`[Approval] Article ${req.params.articleId}: ${action} ${reviewNotes ? `— "${reviewNotes}"` : ""}`);
    res.json({ success: true, article: updated });
  } catch (e) {
    console.error("[Approval] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST publish article to WordPress (draft or publish)
router.post("/:projectId/articles/:articleId/publish-wp", async (req, res) => {
  try {
    const article = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
      "Article not found",
    );
    if (!article) return;

    const contentHtml = article.pipeline?.content?.data?.html;
    if (!contentHtml) {
      return res.status(400).json({ error: "Chưa có nội dung bài viết. Cần generate content trước." });
    }

    const forcePublish = req.body.forcePublish === true;
    const outlineForQC = article.pipeline?.outline?.data || {};
    const titleForQC = outlineForQC.title || article.title || article.keyword || "";
    const quality = validateArticle(
      contentHtml,
      titleForQC,
      article.contentAngle || "guide",
      { keyword: article.keyword || "" },
    );
    if (!quality.passed && !forcePublish) {
      await storage.update("articles", req.params.articleId, {
        pipeline: { ...article.pipeline, quality },
      });
      return res.status(422).json({
        error: "Bài chưa đạt chuẩn QC. Sửa lỗi rồi thử lại hoặc dùng forcePublish: true.",
        qc: quality,
        issues: quality.issues,
        warnings: quality.warnings,
      });
    }

    const project = await storage.getByIdForUser("projects", req.params.projectId, req.userId);
    const wpConfig = project?.config?.publishing?.wordpress;
    if (!wpConfig || !wpConfig.siteUrl) {
      return res.status(400).json({ error: "Chưa cấu hình WordPress. Vào Settings > Publishing để cấu hình." });
    }

    const wpService = require("../services/wp-service");
    const outlineData = article.pipeline?.outline?.data || {};
    const researchData = article.pipeline?.research?.data || {};
    const seoTitle = outlineData.title || researchData.suggestedTitle || article.title || article.keyword;
    const metaDesc = outlineData.metaDescription || researchData.suggestedMetaDescription || "";
    const thumbnailUrl = article.pipeline?.thumbnail?.url;
    const wpStatus = req.body.status || "draft"; // default to draft
    const categoryIds = req.body.categories || [];

    // Upload thumbnail to WordPress if available
    let featuredMediaId = null;
    if (thumbnailUrl) {
      try {
        const uploaded = await wpService.uploadImage(wpConfig, thumbnailUrl, seoTitle);
        featuredMediaId = uploaded.id;
        console.log(`[Publish-WP] Thumbnail uploaded: ${uploaded.url}`);
      } catch (imgErr) {
        console.warn(`[Publish-WP] Thumbnail upload failed (skipping): ${imgErr.message}`);
      }
    }

    // Publish to WordPress
    const result = await wpService.publish(wpConfig, {
      title: seoTitle,
      content: contentHtml,
      metaTitle: seoTitle,
      metaDescription: metaDesc,
      focusKeyword: article.keyword,
      status: wpStatus,
      categories: categoryIds,
      featuredMediaId,
    });

    // Update article pipeline with publish info
    await storage.update("articles", req.params.articleId, {
      pipeline: {
        ...article.pipeline,
        publish: {
          status: "done",
          wpPostId: result.id,
          wpLink: result.link,
          wpStatus: result.status,
          publishedAt: new Date().toISOString(),
        },
      },
      status: wpStatus === "publish" ? "published" : "draft",
    });

    console.log(`[Publish-WP] Article ${req.params.articleId} → ${result.link} (${result.status})`);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[Publish-WP] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== YouTube Videos =====
router.get("/:projectId/videos", async (req, res) => {
  try {
    const videos = await storage.getAllForUser("videos", req.userId);
    const filtered = videos.filter((v) => v.projectId === req.params.projectId);
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST add videos (single, bulk, playlist)
router.post("/:projectId/videos", async (req, res) => {
  try {
    const { mode, urls, playlistUrl, getTranscript } = req.body;
    const urlList =
      mode === "single"
        ? [urls]
        : (urls || "")
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean);
    const created = [];
    for (const url of urlList) {
      // Extract video ID from URL
      const videoId = extractVideoId(url);
      const video = await storage.createForUser("videos", {
        projectId: req.params.projectId,
        url,
        videoId,
        title: `Video ${videoId || url.substring(0, 30)}`,
        status: getTranscript ? "fetching_transcript" : "added",
        transcript: null,
        thumbnailUrl: videoId
          ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
          : null,
      }, req.userId);
      created.push(video);
    }
    // Update project video count
    const allVideos = await storage.getAllForUser("videos", req.userId);
    const count = allVideos.filter(
      (v) => v.projectId === req.params.projectId,
    ).length;
    await storage.update("projects", req.params.projectId, { videos: count });
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE video
router.delete("/:projectId/videos/:videoId", async (req, res) => {
  try {
    await storage.delete("videos", req.params.videoId);
    const allVideos = await storage.getAllForUser("videos", req.userId);
    const count = allVideos.filter(
      (v) => v.projectId === req.params.projectId,
    ).length;
    await storage.update("projects", req.params.projectId, { videos: count });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Knowledge Base =====
router.get("/:projectId/knowledgebases", async (req, res) => {
  try {
    const kbs = await storage.getAllForUser("knowledgebases", req.userId);
    const filtered = kbs.filter((k) => k.projectId === req.params.projectId);
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:projectId/knowledgebases", async (req, res) => {
  try {
    const kb = await storage.createForUser("knowledgebases", {
      projectId: req.params.projectId,
      name: req.body.name,
      description: req.body.description || "",
      documents: [],
      documentCount: 0,
    }, req.userId);
    res.status(201).json(kb);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:projectId/knowledgebases/:kbId", async (req, res) => {
  try {
    await storage.delete("knowledgebases", req.params.kbId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Internal Links =====
router.post("/:projectId/internal-links/scan", async (req, res) => {
  try {
    const articles = await storage.getAllForUser("articles", req.userId);
    // Include articles with content done OR imported from WP
    const contentReady = articles.filter(
      (a) =>
        a.projectId === req.params.projectId &&
        (a.pipeline?.content?.status === "done" || a.pipeline?.content?.status === "imported" || a.pipeline?.publish?.status === "done" || a.pipeline?.publish?.status === "published"),
    );
    if (contentReady.length < 2) {
      return res.json({
        success: false,
        error: "Cần ít nhất 2 bài viết có nội dung (đã tạo content hoặc đã publish)",
        suggestions: [],
      });
    }
    // Simulate link suggestions
    const suggestions = [];
    for (let i = 0; i < contentReady.length; i++) {
      for (let j = i + 1; j < contentReady.length; j++) {
        const aTitle = contentReady[i].pipeline?.outline?.data?.title || contentReady[i].title;
        const bTitle = contentReady[j].pipeline?.outline?.data?.title || contentReady[j].title;
        const aLink = contentReady[i].pipeline?.publish?.wpLink || null;
        const bLink = contentReady[j].pipeline?.publish?.wpLink || null;
        suggestions.push({
          from: { id: contentReady[i].id, title: aTitle, wpLink: aLink, keyword: contentReady[i].keyword },
          to: { id: contentReady[j].id, title: bTitle, wpLink: bLink, keyword: contentReady[j].keyword },
          anchor: contentReady[j].keyword || bTitle,
          relevance: (Math.random() * 40 + 60).toFixed(0) + "%",
          status: contentReady[j].pipeline?.publish?.status === "done" ? "published" : "draft",
        });
      }
    }
    res.json({ success: true, suggestions, count: suggestions.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST apply auto internal links — Ring/Chain linking (kiểu admin-Sila)
// Thuật toán: Xây dựng vòng tròn A→B→C→...→A
// Mỗi bài link đến bài kế tiếp trong vòng + cross-links cùng cluster
router.post("/:projectId/internal-links/apply", async (req, res) => {
  try {
    const maxLinksPerArticle = req.body.maxLinks || 3;
    const articles = await storage.getAllForUser("articles", req.userId);
    const contentReady = articles.filter(
      (a) =>
        a.projectId === req.params.projectId &&
        (a.pipeline?.content?.status === "done" || a.pipeline?.content?.status === "imported") &&
        (a.pipeline?.content?.data?.html || a.pipeline?.content?.data || a.originalContent),
    );

    if (contentReady.length < 2) {
      return res.json({
        success: false,
        error: "Cần ít nhất 2 bài viết có nội dung để tạo internal links",
        applied: 0,
      });
    }

    // Build article metadata index
    const articleMeta = contentReady.map((a) => ({
      id: a.id,
      keyword: a.keyword || "",
      title: a.pipeline?.outline?.data?.title || a.title || a.keyword,
      slug: (a.keyword || a.title || "")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF-]/gi, ""),
      clusterId: a.clusterId || null,
    }));

    // Helper: inject a link for targetMeta's keyword into html
    function injectLink(html, targetMeta) {
      // Don't double-link
      if (html.includes(`data-internal-link="${targetMeta.id}"`)) {
        return { html, success: false };
      }

      // Build anchor candidates: keyword first, then title 
      const anchors = [targetMeta.keyword, targetMeta.title].filter(
        (t) => t && t.length >= 3,
      );

      for (const term of anchors) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Match in paragraph text only — avoid matching inside HTML tags, <a>, <h2>, <h3>
        // The regex ensures we match text NOT inside a tag attribute or inside an anchor
        const regex = new RegExp(
          `(?<=>[^<]*)(${escaped})(?=[^<]*<)`,
          "i",
        );

        const match = html.match(regex);
        if (match) {
          const anchor = match[1];
          const linkHref = `/article/${targetMeta.slug}`;
          const tag = `<a href="${linkHref}" data-internal-link="${targetMeta.id}" title="${targetMeta.title}">${anchor}</a>`;
          // Replace FIRST occurrence only
          html = html.replace(regex, tag);
          return { html, success: true, anchor };
        }
      }

      // Fallback: if keyword not found in text, insert a contextual link at end of first <p>
      const firstPEnd = html.indexOf("</p>");
      if (firstPEnd > 0) {
        const linkHref = `/article/${targetMeta.slug}`;
        const tag = ` (<a href="${linkHref}" data-internal-link="${targetMeta.id}" title="${targetMeta.title}">Xem thêm: ${targetMeta.keyword}</a>)`;
        html = html.substring(0, firstPEnd) + tag + html.substring(firstPEnd);
        return { html, success: true, anchor: targetMeta.keyword, fallback: true };
      }

      return { html, success: false };
    }

    let totalLinksAdded = 0;
    const results = [];
    const linkLog = []; // Track the ring chain

    // ====== STEP 1: Build the ring chain ======
    // Order: bài 0 → bài 1 → bài 2 → ... → bài N-1 → bài 0
    // This guarantees every article has at least 1 outbound + 1 inbound internal link
    const ringOrder = [...contentReady]; // Could be sorted by cluster for better topical flow

    // Sort by cluster if available, so articles in same cluster are adjacent in ring
    ringOrder.sort((a, b) => {
      const ca = a.clusterId || "";
      const cb = b.clusterId || "";
      return ca.localeCompare(cb);
    });

    // Track links added per article
    const articleLinksCount = {};
    ringOrder.forEach((a) => (articleLinksCount[a.id] = 0));

    // Store modified HTML per article
    const htmlStore = {};
    ringOrder.forEach((a) => {
      htmlStore[a.id] = a.pipeline.content.data.html;
    });

    // Ring linking: each article[i] links to article[(i+1) % N]
    for (let i = 0; i < ringOrder.length; i++) {
      const current = ringOrder[i];
      const nextIdx = (i + 1) % ringOrder.length;
      const next = ringOrder[nextIdx];
      const nextMeta = articleMeta.find((m) => m.id === next.id);

      const result = injectLink(htmlStore[current.id], nextMeta);
      if (result.success) {
        htmlStore[current.id] = result.html;
        articleLinksCount[current.id]++;
        totalLinksAdded++;
        linkLog.push({
          from: articleMeta.find((m) => m.id === current.id)?.title,
          to: nextMeta.title,
          anchor: result.anchor,
          type: "ring",
          fallback: result.fallback || false,
        });
      }
    }

    // ====== STEP 2: Cross-cluster links (bonus) ======
    // If articles share the same cluster, add extra links between them (up to maxLinksPerArticle)
    for (let i = 0; i < ringOrder.length; i++) {
      const current = ringOrder[i];
      if (articleLinksCount[current.id] >= maxLinksPerArticle) continue;

      const currentMeta = articleMeta.find((m) => m.id === current.id);
      
      // Find sibling articles in same cluster (not the ring-next one)
      const ringNextId = ringOrder[(i + 1) % ringOrder.length].id;
      const siblings = ringOrder.filter(
        (a) =>
          a.id !== current.id &&
          a.id !== ringNextId &&
          a.clusterId &&
          a.clusterId === current.clusterId,
      );

      for (const sibling of siblings) {
        if (articleLinksCount[current.id] >= maxLinksPerArticle) break;
        const sibMeta = articleMeta.find((m) => m.id === sibling.id);
        
        const result = injectLink(htmlStore[current.id], sibMeta);
        if (result.success) {
          htmlStore[current.id] = result.html;
          articleLinksCount[current.id]++;
          totalLinksAdded++;
          linkLog.push({
            from: currentMeta?.title,
            to: sibMeta.title,
            anchor: result.anchor,
            type: "cluster",
            fallback: result.fallback || false,
          });
        }
      }
    }

    // ====== STEP 3: Save all modified articles ======
    for (const article of ringOrder) {
      const linksAdded = articleLinksCount[article.id];
      if (linksAdded > 0) {
        const updatedContent = {
          ...article.pipeline.content.data,
          html: htmlStore[article.id],
          internalLinksApplied: linksAdded,
          internalLinksAppliedAt: new Date().toISOString(),
          linkingMode: "ring",
        };
        await storage.update("articles", article.id, {
          pipeline: {
            ...article.pipeline,
            content: { status: "done", data: updatedContent },
          },
        });
        results.push({
          articleId: article.id,
          title: articleMeta.find((m) => m.id === article.id)?.title,
          linksAdded,
        });
      }
    }

    console.log(`[Internal-Links] Ring: ${ringOrder.length} articles, ${totalLinksAdded} total links`);
    linkLog.forEach((l) =>
      console.log(`  ${l.type === "ring" ? "🔗" : "🔀"} ${l.from} → ${l.to} [${l.anchor}]${l.fallback ? " (fallback)" : ""}`),
    );

    res.json({
      success: true,
      mode: "ring",
      totalLinksAdded,
      articlesModified: results.length,
      ringSize: ringOrder.length,
      details: results,
      chain: linkLog,
    });
  } catch (e) {
    console.error("[Internal-Links] Apply error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST push internal-linked content to WordPress
// Updates existing WP posts with new content that includes internal links
router.post("/:projectId/internal-links/push-wp", async (req, res) => {
  try {
    const articles = await storage.getAllForUser("articles", req.userId);
    const linkedArticles = articles.filter(
      (a) =>
        a.projectId === req.params.projectId &&
        a.pipeline?.content?.data?.internalLinksApplied > 0 &&
        a.pipeline?.publish?.wpPostId
    );

    if (linkedArticles.length === 0) {
      return res.json({
        success: false,
        error: "Không có bài viết nào có internal links + wpPostId để push",
        pushed: 0,
      });
    }

    // Resolve WP site
    const projects = await storage.getAllForUser("projects", req.userId);
    const project = projects.find((p) => p.id === req.params.projectId);
    const wpSiteId = project?.wpSiteId || req.body.siteId;
    if (!wpSiteId) {
      return res.status(400).json({ error: "Chưa cấu hình WP Site cho dự án" });
    }

    const sites = await storage.getAllForUser("wp-sites", req.userId);
    const site = sites.find((s) => s.id === wpSiteId);
    if (!site) {
      return res.status(404).json({ error: "Không tìm thấy WP Site" });
    }

    const siteBase = (site.url || site.siteUrl).replace(/\/$/, "");
    const authHeader = "Basic " + Buffer.from(`${site.username}:${site.appPassword}`).toString("base64");

    const pushed = [];
    const errors = [];

    for (const article of linkedArticles) {
      try {
        const wpPostId = article.pipeline.publish.wpPostId;
        const contentHtml = article.pipeline.content.data.html;
        
        // Convert internal links: /article/slug → actual WP URLs
        let finalHtml = contentHtml;
        // Replace data-internal-link hrefs with actual WP URLs from linked articles
        const linkRegex = /href="\/article\/[^"]*"\s+data-internal-link="([^"]*)"/g;
        let match;
        while ((match = linkRegex.exec(contentHtml)) !== null) {
          const targetId = match[1];
          const targetArticle = articles.find((a) => a.id === targetId);
          if (targetArticle?.pipeline?.publish?.wpUrl || targetArticle?.wpUrl) {
            const realUrl = targetArticle.pipeline?.publish?.wpUrl || targetArticle.wpUrl;
            finalHtml = finalHtml.replace(
              match[0],
              `href="${realUrl}" data-internal-link="${targetId}"`
            );
          }
        }

        // Auto-discover REST API URL
        async function resolveWpApiUrl(basePath) {
          const candidates = [
            `${siteBase}/wp-json/wp/v2${basePath}`,
            `${siteBase}/wp/wp-json/wp/v2${basePath}`,
          ];
          for (const url of candidates) {
            try {
              const probe = await fetch(url, {
                method: "HEAD",
                headers: { "Authorization": authHeader },
                signal: AbortSignal.timeout(5000),
              });
              if (probe.ok || probe.status === 401) return url;
            } catch {}
          }
          return `${siteBase}/?rest_route=/wp/v2${basePath}`;
        }

        const apiUrl = await resolveWpApiUrl(`/posts/${wpPostId}`);
        const wpRes = await fetch(apiUrl, {
          method: "PUT",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: finalHtml,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (wpRes.ok) {
          const wpData = await wpRes.json();
          // Mark as pushed
          await storage.update("articles", article.id, {
            pipeline: {
              ...article.pipeline,
              content: {
                ...article.pipeline.content,
                data: {
                  ...article.pipeline.content.data,
                  wpPushedAt: new Date().toISOString(),
                },
              },
            },
          });
          pushed.push({
            id: article.id,
            title: article.title,
            wpPostId,
            linksAdded: article.pipeline.content.data.internalLinksApplied,
          });
        } else {
          const err = await wpRes.text();
          errors.push({ id: article.id, title: article.title, error: err });
        }
      } catch (err) {
        errors.push({ id: article.id, title: article.title, error: err.message });
      }
    }

    console.log(`[Internal-Links] Push WP: ${pushed.length} success, ${errors.length} errors`);
    res.json({
      success: true,
      pushed: pushed.length,
      errors: errors.length,
      details: pushed,
      errorDetails: errors,
    });
  } catch (e) {
    console.error("[Internal-Links] Push WP error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST push single article content to WP (update existing or create new)
router.post("/:projectId/articles/:articleId/push-wp", async (req, res) => {
  try {
    const article = await getProjectOwnedRecordOr404(
      "articles",
      req.params.articleId,
      req.params.projectId,
      res,
      "Bài viết không tồn tại",
    );
    if (!article) return;

    const contentHtml = article.pipeline?.content?.data?.html || article.originalContent;
    if (!contentHtml) {
      return res.status(400).json({ error: "Bài viết chưa có nội dung để push" });
    }

    // Resolve WP site
    const projects = await storage.getAllForUser("projects", req.userId);
    const project = projects.find((p) => p.id === req.params.projectId);
    const wpSiteId = project?.wpSiteId || req.body.siteId;
    if (!wpSiteId) {
      return res.status(400).json({ error: "Chưa cấu hình WP Site cho dự án" });
    }

    const sites = await storage.getAllForUser("wp-sites", req.userId);
    const site = sites.find((s) => s.id === wpSiteId);
    if (!site) return res.status(404).json({ error: "Không tìm thấy WP Site" });

    const siteBase = (site.url || site.siteUrl).replace(/\/$/, "");
    const authHeader = "Basic " + Buffer.from(`${site.username}:${site.appPassword}`).toString("base64");

    const wpPostId = article.pipeline?.publish?.wpPostId || article.wpPostId;
    const seoTitle = article.pipeline?.outline?.data?.title || article.title;
    
    // Helper: Resolve correct WP REST API base URL
    // Tries: /wp-json/ → /wp/wp-json/ → ?rest_route= (query fallback)
    async function resolveWpApiUrl(basePath) {
      const candidates = [
        `${siteBase}/wp-json/wp/v2${basePath}`,
        `${siteBase}/wp/wp-json/wp/v2${basePath}`,
      ];
      for (const url of candidates) {
        try {
          const probe = await fetch(url, {
            method: "HEAD",
            headers: { "Authorization": authHeader },
            signal: AbortSignal.timeout(5000),
          });
          if (probe.ok || probe.status === 401) return url;
        } catch {}
      }
      // Fallback: query param mode (always works)
      return `${siteBase}/?rest_route=/wp/v2${basePath}`;
    }

    const apiUrl = wpPostId
      ? await resolveWpApiUrl(`/posts/${wpPostId}`)
      : await resolveWpApiUrl("/posts");

    const postData = wpPostId
      ? { content: contentHtml, title: seoTitle }
      : { content: contentHtml, title: seoTitle, status: req.body.wpStatus || "draft" };

    const wpRes = await fetch(apiUrl, {
      method: wpPostId ? "PUT" : "POST",
      headers: { "Authorization": authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(postData),
      signal: AbortSignal.timeout(30000),
    });

    if (!wpRes.ok) {
      const err = await wpRes.text();
      console.error(`[Articles] Push WP failed (${wpRes.status}): ${err.substring(0, 200)}`);
      return res.status(wpRes.status).json({ error: `WP API error (${wpRes.status}): ${err.substring(0, 300)}` });
    }

    const wpData = await wpRes.json();
    
    // Update article with WP info
    await storage.update("articles", article.id, {
      pipeline: {
        ...article.pipeline,
        publish: {
          ...article.pipeline?.publish,
          status: "done",
          wpPostId: wpData.id,
          wpUrl: wpData.link,
          wpStatus: wpData.status,
          publishedAt: new Date().toISOString(),
        },
      },
      wpPostId: wpData.id,
      wpUrl: wpData.link,
    });

    console.log(`[Articles] ${wpPostId ? "Updated" : "Created"} WP post #${wpData.id}: ${seoTitle}`);
    res.json({
      success: true,
      action: wpPostId ? "updated" : "created",
      wpPostId: wpData.id,
      wpUrl: wpData.link,
      wpStatus: wpData.status,
    });
  } catch (e) {
    console.error("[Articles] Push WP error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== CONTENT QUALITY VALIDATION =====

// POST validate article content quality
router.post(
  "/:projectId/articles/:articleId/validate",
  async (req, res) => {
    try {
      const article = await getProjectOwnedRecordOr404(
        "articles",
        req.params.articleId,
        req.params.projectId,
        res,
        "Article not found",
      );
      if (!article) return;

      const contentHtml = article.pipeline?.content?.data?.html;
      if (!contentHtml) {
        return res
          .status(400)
          .json({ error: "Chưa có content — cần generate content trước" });
      }

      const outline = article.pipeline?.outline?.data || {};
      const articleTitle = outline.title || article.title || article.keyword;
      const qualityResult = validateArticle(
        contentHtml,
        articleTitle,
        article.contentAngle || "guide",
        { keyword: article.keyword || "" },
      );

      // Save quality result to pipeline
      await storage.update("articles", req.params.articleId, {
        pipeline: {
          ...article.pipeline,
          quality: qualityResult,
        },
      });

      console.log(
        `[QC] Article ${req.params.articleId}: ${qualityResult.score}/100 — ${qualityResult.passed ? "PASSED" : "FAILED"}`,
      );
      res.json({ success: true, quality: qualityResult });
    } catch (error) {
      console.error("[QC] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  },
);

function extractVideoId(url) {
  if (!url) return null;
  const match = url.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/);
  return match ? match[1] : null;
}

module.exports = router;


