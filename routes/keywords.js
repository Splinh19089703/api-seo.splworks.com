const express = require("express");
const router = express.Router();
const axios = require("axios");
const storage = require("../services/storage");
const aiService = require("../services/ai-service");
const { resolveApiKeys } = require("../services/api-key-pool");

const COUNTRY_CONFIGS = {
  vn: {
    gl: "VN",
    hl: "vi",
    label: "Việt Nam",
    languageName: "Tiếng Việt",
    modifiers: ["tốt nhất", "rẻ nhất", "giá", "review", "đánh giá", "so sánh", "mua ở đâu", "chính hãng", "tại Hà Nội", "tại TP.HCM"],
    questionPrefixes: ["là gì", "như thế nào", "tại sao", "khi nào", "ở đâu", "bao nhiêu", "cách", "hướng dẫn", "có nên"],
    alphaPrefixes: "abcdefghijklmnopqrstuvwxyz".split("").slice(0, 10),
    volumeFactor: 1,
    cpcFactor: 1,
  },
  us: {
    gl: "US",
    hl: "en",
    label: "United States",
    languageName: "English",
    modifiers: ["best", "cheap", "price", "review", "reviews", "comparison", "near me", "buy", "official", "top rated"],
    questionPrefixes: ["what is", "how to", "why", "when", "where", "how much", "guide", "should I"],
    alphaPrefixes: "abcdefghijklmnopqrstuvwxyz".split("").slice(0, 12),
    volumeFactor: 3.2,
    cpcFactor: 3.5,
  },
  sg: {
    gl: "SG",
    hl: "en",
    label: "Singapore",
    languageName: "English",
    modifiers: ["best", "cheap", "price", "review", "comparison", "near me", "Singapore", "SG", "buy", "official"],
    questionPrefixes: ["what is", "how to", "why", "where", "how much", "guide", "should I"],
    alphaPrefixes: "abcdefghijklmnopqrstuvwxyz".split("").slice(0, 10),
    volumeFactor: 0.65,
    cpcFactor: 2.4,
  },
};

function getCountryConfig(country = "vn", language) {
  const key = String(country || "vn").toLowerCase();
  const config = COUNTRY_CONFIGS[key] || COUNTRY_CONFIGS.vn;
  return {
    ...config,
    key,
    hl: language && language !== "auto" ? language : config.hl,
  };
}

/**
 * Keyword Planner Routes
 *
 * Important: Google Suggest does not provide real volume/KD/CPC.
 * Metrics returned here are deterministic estimates with explicit metricSource/confidence,
 * so users can use them for prioritization without mistaking them for paid keyword-tool data.
 */

router.post("/suggest", async (req, res) => {
  try {
    const { keyword, language, country = "vn" } = req.body;
    if (!keyword) return res.status(400).json({ error: "keyword là bắt buộc" });

    const countryConfig = getCountryConfig(country, language);
    const suggestions = await getGoogleSuggestions(keyword, countryConfig);
    res.json({ keyword, country: countryConfig.key, countryLabel: countryConfig.label, suggestions, total: suggestions.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/related", async (req, res) => {
  try {
    const { keyword, count = 50, language = "Tiếng Việt", niche = "" } = req.body;
    if (!keyword) return res.status(400).json({ error: "keyword là bắt buộc" });

    const prompt = `Bạn là chuyên gia SEO Việt Nam. Cho từ khóa chính: "${keyword}"${niche ? ` trong lĩnh vực "${niche}"` : ""}.

Hãy tạo danh sách tối đa ${count} từ khóa liên quan, gồm:
- main: biến thể trực tiếp của từ khóa chính
- related: cùng chủ đề nhưng góc nhìn khác
- expanded: long-tail, câu hỏi, so sánh, local
- lsi: ngữ nghĩa liên quan

Ngôn ngữ: ${language}

Trả về JSON array, mỗi item:
{
  "keyword": "từ khóa thực tế",
  "type": "main|related|expanded|lsi",
  "intent": "informational|transactional|navigational|commercial",
  "reason": "vì sao keyword này liên quan"
}

Không bịa volume/KD/CPC. CHỈ trả JSON array.`;

    const result = await generateJSON(prompt, req.userId, req.license);
    const keywords = Array.isArray(result) ? result : (result?.keywords || []);

    res.json({
      keyword,
      keywords: normalizeKeywordList(keywords, {
        seedKeyword: keyword,
        source: "ai",
        metricSource: "ai_estimated",
      }),
      total: keywords.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/research", async (req, res) => {
  try {
    const { keyword, language, country = "vn", niche = "" } = req.body;
    if (!keyword) return res.status(400).json({ error: "keyword là bắt buộc" });
    const countryConfig = getCountryConfig(country, language);

    const [suggestResult, aiResult] = await Promise.allSettled([
      getGoogleSuggestions(keyword, countryConfig),
      generateAiKeywords(keyword, countryConfig, niche, req.userId, req.license),
    ]);

    const allKeywords = [];
    const seen = new Set();

    if (suggestResult.status === "fulfilled") {
      const googleKeywords = suggestResult.value.map((kw) => ({
        keyword: kw,
        type: kw.toLowerCase().includes(keyword.toLowerCase()) ? "main" : "related",
        intent: guessIntent(kw),
        source: "google_suggest",
        metricSource: "estimated_from_google_suggest",
      }));
      addUniqueKeywords(allKeywords, seen, normalizeKeywordList(googleKeywords, {
        seedKeyword: keyword,
        source: "google_suggest",
        metricSource: "estimated_from_google_suggest",
        countryConfig,
      }));
    }

    if (aiResult.status === "fulfilled") {
      addUniqueKeywords(allKeywords, seen, normalizeKeywordList(aiResult.value, {
        seedKeyword: keyword,
        source: "ai",
        metricSource: "ai_estimated",
        countryConfig,
      }));
    }

    allKeywords.sort((a, b) => {
      if ((b.confidence || 0) !== (a.confidence || 0)) return (b.confidence || 0) - (a.confidence || 0);
      if ((b.opportunity || 0) !== (a.opportunity || 0)) return (b.opportunity || 0) - (a.opportunity || 0);
      return (b.volume || 0) - (a.volume || 0);
    });

    const avgVolume = allKeywords.length > 0
      ? Math.round(allKeywords.reduce((sum, k) => sum + (k.volume || 0), 0) / allKeywords.length)
      : 0;
    const avgKd = allKeywords.length > 0
      ? Math.round(allKeywords.reduce((sum, k) => sum + (k.kd || 0), 0) / allKeywords.length)
      : 0;

    res.json({
      keyword,
      country: countryConfig.key,
      countryLabel: countryConfig.label,
      keywords: allKeywords,
      total: allKeywords.length,
      metricNotice: `Volume/KD/CPC là ước lượng theo thị trường ${countryConfig.label} từ Google Suggest (${countryConfig.gl}/${countryConfig.hl}) + AI, không phải dữ liệu từ Google Keyword Planner trả phí.`,
      stats: {
        total: allKeywords.length,
        avgVolume,
        avgKd,
        byType: {
          main: allKeywords.filter(k => k.type === "main").length,
          related: allKeywords.filter(k => k.type === "related").length,
          expanded: allKeywords.filter(k => k.type === "expanded").length,
          lsi: allKeywords.filter(k => k.type === "lsi").length,
        },
        bySource: {
          googleSuggest: allKeywords.filter(k => k.source === "google_suggest").length,
          ai: allKeywords.filter(k => k.source === "ai").length,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/export", async (req, res) => {
  try {
    const { keywords, filename = "keyword-research" } = req.body;
    if (!keywords || !Array.isArray(keywords)) {
      return res.status(400).json({ error: "keywords array là bắt buộc" });
    }

    const headers = [
      "Keyword", "Type", "Volume", "KD", "CPC", "Intent", "Opportunity",
      "Confidence", "Metric Source", "Word Count", "Source"
    ];
    const rows = keywords.map(kw => [
      csvCell(kw.keyword),
      csvCell(kw.type),
      kw.volume ?? "",
      kw.kd ?? "",
      kw.cpc ?? "",
      csvCell(kw.intent),
      kw.opportunity ?? "",
      kw.confidence ?? "",
      csvCell(kw.metricSource),
      kw.wordCount ?? "",
      csvCell(kw.source),
    ].join(","));

    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");

    const safeAscii = String(filename || "keyword-research")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .replace(/[^a-zA-Z0-9_.-]/g, "_");
    const encodedName = encodeURIComponent(`${filename || "keyword-research"}.csv`);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeAscii}.csv"; filename*=UTF-8''${encodedName}`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function generateAiKeywords(keyword, countryConfig, niche, userId, license = null) {
  const prompt = `Bạn là chuyên gia SEO Việt Nam. Cho từ khóa SEO: "${keyword}"${niche ? ` (lĩnh vực: ${niche})` : ""}.

Tạo danh sách tối đa 80 từ khóa liên quan, chia thành:
- main: biến thể trực tiếp của từ khóa chính
- related: cùng chủ đề, góc nhìn khác
- expanded: long-tail, câu hỏi, so sánh, local
- lsi: semantic/đồng nghĩa/liên quan ngữ nghĩa

Thị trường mục tiêu: ${countryConfig.label}
Ngôn ngữ: ${countryConfig.languageName}

Yêu cầu:
- Từ khóa phải thực tế, có khả năng có người tìm kiếm.
- Ưu tiên cách người dùng tại ${countryConfig.label} thật sự tìm kiếm, bao gồm biến thể địa phương nếu phù hợp.
- Không trộn ngôn ngữ/thị trường khác nếu không cần thiết.
- Không lặp.
- Không bịa volume/KD/CPC.

Trả về JSON array:
[{"keyword":"...","type":"main|related|expanded|lsi","intent":"informational|transactional|navigational|commercial","reason":"..."}]

CHỈ trả JSON array.`;

  const result = await generateJSON(prompt, userId, license);
  return Array.isArray(result) ? result : (result?.keywords || []);
}

async function generateJSON(prompt, userId, license = null) {
  const settings = await storage.getSettings();
  const apiKeys = await resolveApiKeys(userId, license);
  const text = await aiService.generate(prompt, settings, { apiKeys });
  const parsed = extractJSON(text);
  if (!parsed) throw new Error("AI không trả về JSON hợp lệ");
  return parsed;
}

function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try { return JSON.parse(text.slice(arrayStart, arrayEnd + 1)); } catch {}
  }
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try { return JSON.parse(text.slice(objectStart, objectEnd + 1)); } catch {}
  }
  return null;
}

function addUniqueKeywords(target, seen, items) {
  for (const item of items) {
    const key = normalizeKey(item.keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(item);
  }
}

function normalizeKeywordList(items, context) {
  return (items || [])
    .map((item) => normalizeKeywordItem(item, context))
    .filter(Boolean);
}

function normalizeKeywordItem(item, context) {
  const keyword = String(item.keyword || item.query || item.text || "").trim();
  if (!keyword) return null;
  const type = normalizeType(item.type);
  const intent = normalizeIntent(item.intent || item.search_intent || guessIntent(keyword));
  const metricSource = item.metricSource || context.metricSource || "estimated";
  const countryConfig = context.countryConfig || COUNTRY_CONFIGS.vn;
  const volume = estimateVolume(keyword, context.seedKeyword, context.source, type, intent, countryConfig);
  const kd = estimateKD(keyword, type, intent, countryConfig);
  const cpc = estimateCPC(keyword, intent, countryConfig);
  const confidence = estimateConfidence(keyword, context.seedKeyword, context.source, item.reason);
  const opportunity = estimateOpportunity(volume, kd, confidence, intent);

  return {
    keyword,
    type,
    volume,
    kd,
    cpc,
    intent,
    opportunity,
    confidence,
    metricSource,
    metricLabel: metricSource.includes("google") ? "Ước lượng từ Google Suggest" : "Ước lượng AI",
    country: countryConfig.key,
    countryLabel: countryConfig.label,
    wordCount: keyword.split(/\s+/).filter(Boolean).length,
    source: context.source || item.source || "ai",
    reason: item.reason || "",
    trend: generateTrend(keyword, volume),
  };
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeType(type) {
  if (["main", "related", "expanded", "lsi"].includes(type)) return type;
  return "related";
}

function normalizeIntent(intent) {
  if (["informational", "transactional", "navigational", "commercial", "local"].includes(intent)) return intent;
  return "informational";
}

async function fetchOneSuggest(q, countryConfig) {
  const url = `https://www.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}&hl=${countryConfig.hl}&gl=${countryConfig.gl}`;
  try {
    const resp = await axios.get(url, {
      timeout: 4000,
      responseType: "arraybuffer",
    });
    const text = Buffer.from(resp.data).toString("latin1");
    const parsed = JSON.parse(text);
    return (parsed?.[1] || []).slice(0, 10);
  } catch {
    return [];
  }
}

async function getGoogleSuggestions(keyword, countryConfig = COUNTRY_CONFIGS.vn) {
  const kw = keyword.trim();
  const nowYear = new Date().getFullYear();
  const questionPrefixes = countryConfig.questionPrefixes;
  const alphaPrefixes = countryConfig.alphaPrefixes;
  const modifiers = [...countryConfig.modifiers, String(nowYear), String(nowYear + 1)];

  const queries = [
    kw,
    ...questionPrefixes.map(q => `${kw} ${q}`),
    ...questionPrefixes.map(q => `${q} ${kw}`),
    ...alphaPrefixes.map(a => `${kw} ${a}`),
    ...modifiers.map(m => `${kw} ${m}`),
  ];

  const BATCH = 5;
  const seen = new Set([kw.toLowerCase()]);
  const results = [];

  for (let i = 0; i < queries.length && results.length < 120; i += BATCH) {
    const batch = queries.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(batch.map(q => fetchOneSuggest(q, countryConfig)));
    for (const r of batchResults) {
      if (r.status !== "fulfilled") continue;
      for (const s of r.value) {
        const norm = normalizeKey(s);
        if (!seen.has(norm) && s.length > 2) {
          seen.add(norm);
          results.push(s);
        }
      }
    }
    if (i + BATCH < queries.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

function guessIntent(keyword) {
  const kw = keyword.toLowerCase();
  if (/mua ngay|đặt hàng|order|shop online|cửa hàng|liên hệ|hotline/.test(kw)) return "transactional";
  if (/mua|giá|bán|rẻ|tốt nhất|top \d|so sánh|review|đánh giá|nên mua|có tốt không|chính hãng/.test(kw)) return "commercial";
  if (/gần đây|tại hcm|tại hà nội|ở đâu|địa chỉ|quận \d|huyện|tỉnh/.test(kw)) return "local";
  if (/là gì|cách|hướng dẫn|tại sao|như thế nào|bao nhiêu|khi nào|có nên|lợi ích|tác dụng|ưu điểm/.test(kw)) return "informational";
  if (/trang web|website|app|ứng dụng|đăng nhập|tải về|download/.test(kw)) return "navigational";
  return "informational";
}

function hashNumber(input, min, max) {
  let hash = 2166136261;
  const str = String(input || "");
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = (hash >>> 0) / 4294967295;
  return Math.round(min + normalized * (max - min));
}

function estimateVolume(keyword, seedKeyword, source, type, intent, countryConfig = COUNTRY_CONFIGS.vn) {
  const words = keyword.split(/\s+/).filter(Boolean).length;
  let base = source === "google_suggest" ? 900 : 450;
  base *= countryConfig.volumeFactor || 1;
  if (type === "main") base *= 1.8;
  if (type === "expanded" || words >= 5) base *= 0.55;
  if (type === "lsi") base *= 0.45;
  if (intent === "transactional" || intent === "commercial") base *= 1.25;
  if (normalizeKey(keyword).includes(normalizeKey(seedKeyword))) base *= 1.2;
  const variance = hashNumber(`${countryConfig.key}:${keyword}`, 65, 145) / 100;
  return Math.max(20, Math.round(base * variance / 10) * 10);
}

function estimateKD(keyword, type, intent, countryConfig = COUNTRY_CONFIGS.vn) {
  const words = keyword.split(/\s+/).filter(Boolean).length;
  let kd = hashNumber(`${countryConfig.key}:${keyword}`, 18, 62);
  if (countryConfig.key === "us") kd += 8;
  if (countryConfig.key === "sg") kd += 3;
  if (type === "main") kd += 10;
  if (intent === "commercial" || intent === "transactional") kd += 8;
  if (words >= 5) kd -= 12;
  if (/giá|mua|review|tốt nhất|so sánh/.test(keyword.toLowerCase())) kd += 4;
  return Math.max(5, Math.min(85, Math.round(kd)));
}

function estimateCPC(keyword, intent, countryConfig = COUNTRY_CONFIGS.vn) {
  const kw = keyword.toLowerCase();
  let base = 0.1;
  if (intent === "transactional") base = 1.5;
  else if (intent === "commercial") base = 0.8;
  else if (intent === "informational") base = 0.15;
  if (/bảo hiểm|tài chính|vay|ngân hàng|đầu tư/.test(kw)) base *= 3;
  if (/phần mềm|hosting|vps|cloud|crm/.test(kw)) base *= 2;
  if (/du lịch|khách sạn|vé máy bay/.test(kw)) base *= 1.8;
  if (/sức khỏe|thuốc|bệnh viện|thẩm mỹ/.test(kw)) base *= 2.2;
  const variance = hashNumber(`${countryConfig.key}:${keyword}`, 75, 130) / 100;
  return +(base * (countryConfig.cpcFactor || 1) * variance).toFixed(2);
}

function estimateConfidence(keyword, seedKeyword, source, reason) {
  let confidence = source === "google_suggest" ? 82 : 62;
  if (normalizeKey(keyword).includes(normalizeKey(seedKeyword))) confidence += 8;
  if (reason) confidence += 4;
  if (keyword.split(/\s+/).length >= 6) confidence -= 4;
  return Math.max(35, Math.min(95, confidence));
}

function estimateOpportunity(volume, kd, confidence, intent) {
  const intentBoost = intent === "commercial" || intent === "transactional" ? 8 : 0;
  return Math.max(0, Math.min(100, Math.round((volume / 35) - (kd * 0.65) + (confidence * 0.55) + intentBoost)));
}

function generateTrend(keyword, volume) {
  const base = Math.max(10, Math.min(100, Math.round(volume / 20)));
  return Array.from({ length: 12 }, (_, i) => {
    const wave = Math.sin((i / 11) * Math.PI * 2) * hashNumber(`${keyword}-wave`, 4, 14);
    const drift = hashNumber(`${keyword}-${i}`, -8, 8);
    return Math.max(5, Math.round(base + wave + drift));
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

module.exports = router;
