const express = require("express");
const router = express.Router();
const path = require("path");
const storage = require("../services/storage");
const aiService = require("../services/ai-service");
const wpService = require("../services/wp-service");
const imageStore = require("../services/image-store");
const { validateArticle } = require("../services/content-validator");

/**
 * Helper: Insert generated section images (<figure>) into article HTML after matching H2 headings.
 * Idempotent: removes old .article-section-image figures and [IMG: ...] placeholders before inserting.
 */
function insertSectionImagesIntoHtml(rawHtml, sectionImages = [], keyword = "") {
  if (!rawHtml || typeof rawHtml !== "string") {
    return { html: rawHtml || "", insertedCount: 0 };
  }

  // Strip leftover [IMG: ...] placeholders and previously auto-inserted section figures
  let html = rawHtml
    .replace(/<p[^>]*>\s*\[IMG:[^\]]*\]\s*<\/p>/gi, "")
    .replace(/\[IMG:[^\]]*\]/gi, "")
    .replace(/\n?<figure class="article-section-image"[\s\S]*?<\/figure>\n?/gi, "");

  const validImages = (sectionImages || []).filter(i => i && i.status === "done" && i.url);
  if (validImages.length === 0) {
    return { html, insertedCount: 0 };
  }

  let insertedCount = 0;
  const usedH2Matches = new Set();

  for (const img of validImages) {
    const heading = (img.sectionHeading || "").trim();
    const cleanHeading = heading
      .replace(/^(?:phần|chương|bước|mục)\s*\d+[:.\s-]*/i, "")
      .replace(/^(?:[IVXLC]+|\d+(?:\.\d+)*)[:.)\s-]+/i, "")
      .trim();

    let matchedH2 = null;

    if (cleanHeading) {
      const escapedHeading = cleanHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const h2Regex = new RegExp(`(<h2[^>]*>[\\s\\S]*?${escapedHeading}[\\s\\S]*?<\\/h2>)`, "i");
      const m = html.match(h2Regex);
      if (m && !usedH2Matches.has(m[0])) {
        matchedH2 = m[0];
      }
    }

    // Fallback: pick the next H2 in the article that hasn't received an image yet
    if (!matchedH2) {
      const allH2s = html.match(/<h2[^>]*>[\s\S]*?<\/h2>/gi) || [];
      for (const h2 of allH2s) {
        if (!usedH2Matches.has(h2)) {
          matchedH2 = h2;
          break;
        }
      }
    }

    if (matchedH2) {
      usedH2Matches.add(matchedH2);
      const plainH2Text = matchedH2.replace(/<[^>]*>/g, "").trim();
      const displayCaption = heading || plainH2Text;
      const altText = keyword ? `${displayCaption} - ${keyword}` : displayCaption;

      const figureHtml = `\n<figure class="article-section-image" style="margin: 24px 0; text-align: center;">\n  <img src="${img.url}" alt="${altText.replace(/"/g, "&quot;")}" loading="lazy" title="${displayCaption.replace(/"/g, "&quot;")}" width="800" height="500" style="max-width: 100%; height: auto; border-radius: 8px;">\n  <figcaption style="font-size: 14px; color: #666; margin-top: 8px; font-style: italic;">${displayCaption}</figcaption>\n</figure>\n`;

      html = html.replace(matchedH2, matchedH2 + figureHtml);
      insertedCount++;
    }
  }

  return { html, insertedCount };
}
const { resolveApiKeys } = require("../services/api-key-pool");
const pipelineQueue = require("../services/pipeline-queue");
const { checkAiCredits, consumeCredits } = require("../middleware/ai-credit-tracker");
const { reportArticleCreated } = require("../middleware/license-middleware");

// Reuse existing modules (co-located in services/scraper/)
const Crawler = require("../services/scraper/crawler");
const Analyzer = require("../services/scraper/analyzer");
const BulkCrawler = require("../services/scraper/bulk-crawler");
const PromptGenerator = require("../services/scraper/prompt-generator");

const crawler = new Crawler();
const analyzer = new Analyzer();
const bulkCrawler = new BulkCrawler();
const promptGen = new PromptGenerator();

// ===== AI KEYWORD CLUSTERING (Standalone) =====
router.post("/analyze-keywords", checkAiCredits("text"), async (req, res) => {
  try {
    const { keywords } = req.body; // string, one keyword per line
    const kwList = (keywords || "").split("\n").map(k => k.trim()).filter(Boolean);
    if (kwList.length === 0) return res.status(400).json({ error: "Cần ít nhất 1 keyword" });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    const kwText = kwList.map(k => `- ${k}`).join("\n");

    const prompt = `Bạn là chuyên gia SEO 15+ năm kinh nghiệm tại thị trường Việt Nam. Phân nhóm ${kwList.length} từ khoá dưới đây.

NGUYÊN TẮC NHÓM:
1. MỖI NHÓM = 1 BÀI VIẾT duy nhất. Các từ khoá cùng nhóm phải target cùng 1 URL.
2. TIÊU CHÍ: Cùng search intent + Google hiển thị kết quả tương tự
3. SEARCH INTENT: informational | commercial | transactional | navigational | local
4. CONTENT ANGLE: guide | list | review | comparison | definition | tutorial | local | cost
5. KHÔNG gộp: khác intent, khác sản phẩm, khác đối tượng, khác brand
6. NÊN gộp: từ đồng nghĩa, biến thể dấu, long-tail, cùng topic+intent
7. TÊN NHÓM = keyword chính (primary keyword) của nhóm

DANH SÁCH:
${kwText}

Trả về ĐÚNG JSON, KHÔNG markdown:
{
  "clusters": [
    {
      "name": "tên nhóm = primary keyword",
      "description": "mô tả ngắn",
      "searchIntent": "informational",
      "contentAngle": "guide",
      "estimatedWords": 2500,
      "keywords": [
        { "keyword": "từ khoá chính xác", "type": "pillar" },
        { "keyword": "biến thể", "type": "cluster" }
      ]
    }
  ]
}`;

    const result = await aiService.generate(prompt, settings, { apiKeys });
    
    // Parse JSON
    let parsed;
    try {
      const codeBlock = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock) parsed = JSON.parse(codeBlock[1].trim());
      else {
        let depth = 0, start = -1;
        for (let i = 0; i < result.length; i++) {
          if (result[i] === '{') { if (depth === 0) start = i; depth++; }
          else if (result[i] === '}') { depth--; if (depth === 0 && start >= 0) { try { parsed = JSON.parse(result.substring(start, i + 1)); break; } catch { start = -1; } } }
        }
        if (!parsed) parsed = JSON.parse(result.match(/\{[\s\S]*\}/)?.[0] || "{}");
      }
    } catch { parsed = { clusters: [] }; }

    // Add IDs to clusters and keywords
    const clusters = (parsed.clusters || []).map((c, ci) => ({
      ...c,
      id: `c_${Date.now()}_${ci}`,
      keywords: (c.keywords || []).map((k, ki) => ({
        ...k,
        id: `k_${Date.now()}_${ci}_${ki}`,
        status: "pending",
      })),
    }));

    // Check for unclustered keywords
    const allocated = new Set();
    clusters.forEach(c => (c.keywords || []).forEach(k => allocated.add(k.keyword.toLowerCase())));
    const missing = kwList.filter(k => !allocated.has(k.toLowerCase()));
    if (missing.length > 0) {
      clusters.push({
        id: `c_${Date.now()}_uncategorized`,
        name: "Từ khoá chưa phân loại",
        description: "Các từ khoá chưa được AI nhóm",
        searchIntent: "informational",
        contentAngle: "guide",
        estimatedWords: 2000,
        keywords: missing.map((k, i) => ({ keyword: k, type: "cluster", id: `k_unc_${i}`, status: "pending" })),
      });
    }

    res.json({ clusters, totalKeywords: kwList.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== HELPER: Resolve prompt theo priority Project → Global → Hardcode =====
/**
 * @param {string} step - "outline" | "content" | "thumbnail" | "section_image"
 * @param {object|null} project - project object (có thể null cho standalone drafts)
 * @param {object} storage - storage service
 * @returns {Promise<string|null>} - prompt content, hoặc null nếu dùng hardcode
 */
async function resolvePrompt(step, project, storage, userId) {
  // 1. Project-level prompt
  if (project?.prompts?.[step]?.enabled && project.prompts[step].content?.trim()) {
    return project.prompts[step].content;
  }
  // 2. Global default prompt
  try {
    const globals = await storage.getAllForUser("prompts", userId);
    const global = globals.find(p => p.type === step && p.isDefault);
    if (global?.content?.trim()) return global.content;
  } catch {}
  // 3. Null = use hardcoded fallback in caller
  return null;
}

// ===== AUTO-PIPELINE: Run all 6 steps for a standalone draft =====

router.post("/drafts/:id/auto-pipeline", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    // --- License: Article limit check ---
    const limit = req.license?.limits?.maxArticlesPerMonth || 0;
    const used = req.usage?.articlesCreated || 0;
    if (used >= limit) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${limit} bài/tháng. Nâng cấp gói để tạo thêm.`,
        code: "ARTICLE_LIMIT",
        limit, used,
        currentPlan: req.license?.plan,
      });
    }

    // Lấy config từ request hoặc từ draft.contentConfig (bulk)
    const pipelineMode = req.body.mode || draft.contentConfig?.mode || "basic";
    const pipelineWordCount = parseInt(req.body.targetWordCount) || parseInt(draft.contentConfig?.targetWordCount) || 2000;

    // Lưu contentConfig vào draft để tham chiếu sau
    await storage.update("standalone-drafts", req.params.id, {
      contentConfig: { mode: pipelineMode, targetWordCount: pipelineWordCount },
      updatedAt: new Date().toISOString(),
    });

    // Return immediately, run pipeline in background
    const queueStatus = pipelineQueue.getStatus();
    res.json({ success: true, message: "Pipeline đang chạy...", mode: pipelineMode, targetWordCount: pipelineWordCount, queuePosition: queueStatus.queued + 1 });


    // ---- BACKGROUND PIPELINE ----
    (async () => {
      const id = req.params.id;
      const keyword = draft.keyword;
      const plan = req.license?.plan || "trial";
      let pipeline = draft.pipeline || {};

      // Wait for pipeline queue slot
      try {
        await pipelineQueue.acquire(id, req.userId, plan, keyword);
      } catch (queueErr) {
        console.error(`[Auto-Pipeline] ${keyword}: Queue rejected - ${queueErr.message}`);
        await storage.update("standalone-drafts", id, {
          pipeline: { ...pipeline, autoStep: "error", error: queueErr.message },
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      const updateStatus = async (status, pipelineUpdate) => {
        pipeline = { ...pipeline, ...pipelineUpdate };
        await storage.update("standalone-drafts", id, { status, pipeline, updatedAt: new Date().toISOString() });
      };

      try {
        // STEP 1: Research
        await updateStatus("research", { autoStep: "research" });
        const researchResult = await bulkCrawler.crawlByKeyword(keyword, 5);
        const analyses = (researchResult || []).map(r => analyzer.analyze(r)).filter(Boolean);
        const bulkAnalysis = researchResult?.length ? analyzer.analyzeBulk(researchResult) : null;
        const research = {
          keyword,
          articles: (researchResult || []).map((r, i) => ({
            title: r.title, url: r.url,
            wordCount: r.stats?.wordCount || 0, headings: r.headings?.length || 0,
            score: analyses[i]?.qualityScore || 0,
          })),
          analysis: bulkAnalysis,
        };
        await updateStatus("research", { research });
        console.log(`[Auto-Pipeline] ${keyword}: Research done`);

        // STEP 2: Outline
        await updateStatus("outline", { autoStep: "outline" });
        const settings = await storage.getSettings();
        const apiKeys = await resolveApiKeys(req.userId, req.license);

        // Load project prompts nếu draft thuộc project
        const project = draft.projectId
          ? await storage.getByIdForUser("projects", draft.projectId, req.userId).catch(() => null)
          : null;
        const customOutlinePrompt = await resolvePrompt("outline", project, storage, req.userId);
        const now = new Date();
        const dateContext = `[Ngữ cảnh: Thông tin cập nhật đến tháng ${now.getMonth() + 1}/${now.getFullYear()}. KHÔNG cần nhắc năm trong tiêu đề hay nội dung trừ khi chủ đề yêu cầu.]`;

        const targetWordsForOutline = pipelineWordCount || 2000;
        const suggestedH2 = targetWordsForOutline <= 1200 ? "4-5" : targetWordsForOutline <= 2200 ? "5-6" : targetWordsForOutline <= 3200 ? "7-8" : "8-10";

        let outlinePrompt;
        if (customOutlinePrompt) {
          // Substitute variables in project/global prompt
          outlinePrompt = customOutlinePrompt
            .replace(/\{keyword\}/g, keyword)
            .replace(/\{date\}/g, dateContext);
          if (draft.customPrompt) outlinePrompt += `\n\n📝 YÊU CẦU RIÊNG: ${draft.customPrompt}`;
          if (research.analysis) outlinePrompt += `\n\n📊 DỮ LIỆU: Đã phân tích ${research.analysis.totalArticles || 0} bài top Google`;
          outlinePrompt += `\n\n📊 FORMAT OUTPUT (JSON):\n{ "title": "...", "metaDescription": "...", "focusKeyword": "${keyword}",\n  "outline": [ { "tag": "h2", "text": "...", "hint": "..." } ],\n  "faq": [ { "question": "...", "answer": "..." } ] }`;
        } else {
          // Hardcoded fallback
          outlinePrompt = `Bạn là chuyên gia SEO #1 Việt Nam. Tạo OUTLINE chi tiết cho bài viết về "${keyword}".\n${dateContext}\n📋 YÊU CẦU:\n1. Title Tag (tối đa 60 ký tự, chứa keyword chính, KHÔNG thêm năm trừ khi keyword có chứa năm)\n2. Meta Description (tối đa 160 ký tự, hấp dẫn)\n3. Cấu trúc H2: Tạo chính xác ${suggestedH2} thẻ H2 logic theo Search Intent (phù hợp với độ dài bài viết ${targetWordsForOutline} từ)\n4. FAQ 4-5 câu hỏi thực tế\n${draft.customPrompt ? `\n📝 YÊU CẦU RIÊNG: ${draft.customPrompt}` : ""}\n${research.analysis ? `\n📊 DỮ LIỆU: Đã phân tích ${research.analysis.totalArticles || 0} bài top Google` : ""}\n\n📊 FORMAT OUTPUT (JSON):\n{ "title": "...", "metaDescription": "...", "focusKeyword": "${keyword}",\n  "outline": [ { "tag": "h2", "text": "...", "hint": "..." } ],\n  "faq": [ { "question": "...", "answer": "..." } ], "schema": "Article" }`;
        }

        const outlineResult = await aiService.generate(outlinePrompt, settings, { apiKeys });
        let outline;
        try {
          const m = outlineResult.match(/```json\n?([\s\S]*?)\n?```/) || outlineResult.match(/\{[\s\S]*\}/);
          outline = JSON.parse(m ? (m[1] || m[0]) : outlineResult);
        } catch { outline = { raw: outlineResult }; }
        await updateStatus("outline", { outline });
        console.log(`[Auto-Pipeline] ${keyword}: Outline done (${customOutlinePrompt ? "project/global" : "hardcode"} prompt)`);

        // STEP 3: Content (mode-aware)
        await updateStatus("content", { autoStep: "content" });
        const customContentPrompt = await resolvePrompt("content", project, storage, req.userId);
        // Đọc lại draft để lấy contentConfig (có thể đã được set từ bulk)
        const freshDraftForConfig = await storage.getByIdForUser("standalone-drafts", id, req.userId);
        const contentMode = pipelineMode || freshDraftForConfig?.contentConfig?.mode || "basic";
        const contentWordCount = pipelineWordCount || freshDraftForConfig?.contentConfig?.targetWordCount || 2000;

        let rawContent;
        if (contentMode === "quality") {
          // Quality mode: viết từng section chuyên sâu chuẩn E-E-A-T với ngân sách từ chuẩn xác
          const h2Sections = (outline.outline || []).filter(s => s.tag === "h2");
          const totalTarget = contentWordCount || 2000;
          const introWords = Math.min(200, Math.round(totalTarget * 0.08));
          const faqCount = (outline.faq || []).length;
          const faqWords = faqCount > 0 ? Math.min(300, faqCount * 50) : 0;
          const conclWords = 150;
          const sectionsBudget = Math.max(400, totalTarget - introWords - faqWords - conclWords);
          const perSectionWords = Math.max(180, Math.round(sectionsBudget / Math.max(h2Sections.length, 1)));
          const minSecWords = Math.round(perSectionWords * 0.85);
          const maxSecWords = Math.round(perSectionWords * 1.15);

          const parts = [];
          const introP = `Bạn là chuyên gia hàng đầu về "${keyword}". Viết phần MỞ ĐẦU chuyên nghiệp, hấp dẫn chuẩn E-E-A-T (khoảng ${introWords} từ, tiếng Việt) cho bài viết "${outline.title || keyword}".
- Keyword chính "${keyword}" xuất hiện tự nhiên trong 50 từ đầu tiên.
- Mở đầu bằng hook lôi cuốn (thực trạng, số liệu hoặc insight đắt giá).
- Nêu rõ lợi ích và giá trị người đọc nhận được từ bài viết này.
- Format Markdown, không dùng thẻ <h1>.`;
          const intro = await aiService.generate(introP, settings, { apiKeys });
          parts.push(intro.trim());

          for (const sec of h2Sections) {
            const secP = `Bạn là chuyên gia SEO & Content E-E-A-T. Viết section chi tiết "## ${sec.text}" cho bài "${outline.title || keyword}".
- Từ khóa chính: "${keyword}"
- Gợi ý chủ đề: ${sec.hint || ""}
- YÊU CẦU ĐỘ DÀI PHÂN BỔ: Khoảng ${perSectionWords} từ (tối thiểu ${minSecWords} từ, tối đa ${maxSecWords} từ).
- ⚠️ QUAN TRỌNG: Viết sâu sắc, súc tích, giải thích đúng trọng tâm. Không viết lan man vượt quá ${maxSecWords} từ.
- TIÊU CHUẨN E-E-A-T & ĐỘ SÂU:
  1. Phân tích chi tiết, giải thích rõ bản chất, không viết chung chung, sơ sài.
  2. BẮT BUỘC có ví dụ thực tế / góc nhìn chuyên gia / trích dẫn mẹo thực chiến: "> 💡 **Lưu ý chuyên gia:** ...".
  3. Nếu có so sánh, phân loại hoặc thông số → BẮT BUỘC dùng Bảng biểu Markdown (| Cột 1 | Cột 2 | Cột 3 |).
  4. Sử dụng danh sách bullet points / đánh số để tăng trải nghiệm đọc.
- Bắt đầu bằng ## ${sec.text}. Format Markdown chuẩn.`;
            try {
              const secContent = await aiService.generate(secP, settings, { apiKeys });
              parts.push(secContent.trim());
            } catch {
              parts.push(`## ${sec.text}\n\nNội dung đang được cập nhật.`);
            }
          }

          if (outline.faq?.length > 0) {
            parts.push(`## Câu hỏi thường gặp về ${keyword}\n\n${outline.faq.map(f => `### ${f.question}\n${f.answer || ""}`).join("\n\n")}`);
          }

          const conclP = `Viết phần KẾT LUẬN & LỜI KHUYÊN HÀNH ĐỘNG (khoảng ${conclWords} từ, tiếng Việt) cho bài viết "${outline.title || keyword}". Tóm tắt điểm cốt lõi, đưa ra checklist hành động và lời kêu gọi hành động (CTA) tự nhiên. Format Markdown bắt đầu bằng ## Kết luận.`;
          try {
            const concl = await aiService.generate(conclP, settings, { apiKeys });
            parts.push(concl.trim());
          } catch {}

          rawContent = parts.join("\n\n");
        } else if (customContentPrompt) {
          let writePrompt = customContentPrompt
            .replace(/\{keyword\}/g, keyword)
            .replace(/\{outline\}/g, JSON.stringify(outline, null, 2))
            .replace(/\{date\}/g, `${new Date().getFullYear()}`);
          if (draft.customPrompt) writePrompt += `\n\n📝 HƯỚNG DẪN: ${draft.customPrompt}`;
          rawContent = await aiService.generate(writePrompt, settings, { apiKeys });
        } else {
          const prompts = await storage.getAllForUser("prompts", req.userId);
          const styleTemplate = prompts.find(p => p.type === "write-article" && p.isDefault);
          const minTotalWords = Math.round(contentWordCount * 0.9);
          const maxTotalWords = Math.round(contentWordCount * 1.15);
          const writePrompt = `Bạn là chuyên gia Content SEO #1 Việt Nam. Viết bài viết toàn diện, chuyên sâu chuẩn E-E-A-T.
[Ngữ cảnh: Thông tin cập nhật mới nhất năm ${new Date().getFullYear()}. Viết tự nhiên, chuyên nghiệp.]
📌 TỪ KHÓA CHÍNH: "${keyword}"
📏 ĐỘ DÀI MỤC TIÊU: Khoảng ${contentWordCount} từ (dao động từ ${minTotalWords} đến tối đa ${maxTotalWords} từ, không viết vượt quá ${Math.round(contentWordCount * 1.25)} từ).

📋 DÀN Ý CHI TIẾT (BẮT BUỘC VIẾT ĐẦY ĐỦ CÁC HEADING):
${JSON.stringify(outline, null, 2)}

${styleTemplate ? `🎭 PHONG CÁCH:\n${styleTemplate.content}` : "🎭 TONE & GIỌNG VĂN: Chuyên gia doanh nghiệp, thực chiến, đáng tin cậy, phân tích sâu sắc. Tuyệt đối không dùng tiếng lóng, khẩu ngữ suồng sã hay từ ngữ thiếu chuẩn mực."}
${draft.customPrompt ? `📝 HƯỚNG DẪN BỔ SUNG: ${draft.customPrompt}` : ""}

⭐ BẮT BUỘC TUÂN THỦ TIÊU CHUẨN E-E-A-T:
1. **Experience (Trải nghiệm thực tế):** Chia sẻ case study, bài học từ các dự án thực tế, các lỗi sai phổ biến và cách khắc phục.
2. **Expertise (Chuyên môn sâu):** Hướng dẫn từng bước (Step-by-step), giải thích tường tận nguyên lý, thuật ngữ chuyên ngành.
3. **Authoritativeness (Thẩm quyền & Trực quan):** BẮT BUỘC có ít nhất 1-2 Bảng so sánh dữ liệu (Markdown table), trích dẫn số liệu / tip chuyên gia (dùng > blockquote).
4. **Trustworthiness (Tin cậy & Cấu trúc):** Keyword chính trong 100 từ đầu tiên, viết sâu sắc đúng trọng tâm các heading, có phần FAQ chi tiết và Kết luận kèm CTA.
5. Định dạng: Markdown chuẩn (##, ###, **, *, >, | table |).`;
          rawContent = await aiService.generate(writePrompt, settings, { apiKeys });
        }

        const wordCount = rawContent.split(/\s+/).filter(Boolean).length;
        const html = "<p>" + rawContent
          .replace(/### (.*)/g, "</p><h3>$1</h3><p>")
          .replace(/## (.*)/g, "</p><h2>$1</h2><p>")
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\n\n/g, "</p><p>")
          .replace(/\n/g, "<br/>") + "</p>";
        const quality = validateArticle(html, outline.title || keyword, "guide", { keyword });
        const usedProvider = aiService.lastUsedProvider || "unknown";
        const usedModel = aiService.lastUsedModel || "unknown";
        await updateStatus("content", { content: { html, raw: rawContent, wordCount, mode: contentMode, targetWordCount: contentWordCount, usedProvider, usedModel }, quality });
        console.log(`[Auto-Pipeline] ${keyword}: Content done (${wordCount} words, ${contentMode} mode, QC: ${quality.score}/100, provider: ${usedProvider})`);

        // Track used image URLs so Thumbnail and Section images never pick duplicates
        const usedImageUrls = new Set();

        // STEP 4: Thumbnail (skip on error)
        try {
          await updateStatus("content", { autoStep: "thumbnail" });
          const articleTitle = outline.title || keyword;
          const sectionHeadings = (outline.outline || []).map(s => s.text).join(", ");
          let imgPrompt;
          try {
            const pr = await aiService.generate(`Create a SHORT image prompt (max 30 words, English) for blog thumbnail about "${articleTitle}". Sections: ${sectionHeadings}. Style: professional, NO text/watermarks/faces. Return ONLY prompt.`, settings, { apiKeys });
            imgPrompt = pr.trim().replace(/^["']|["']$/g, "").substring(0, 400);
          } catch { imgPrompt = `Professional photo representing "${articleTitle}", modern clean, bright lighting, no text`; }
          const imgUrl = await aiService.generateImage(imgPrompt, settings, {
            width: 1200,
            height: 630,
            apiKeys,
            imageType: "thumbnail",
            searchQuery: `${keyword} ${articleTitle}`,
            fallbackQuery: keyword,
            excludeUrls: usedImageUrls,
          });
          if (imgUrl) usedImageUrls.add(imgUrl);
          await updateStatus("content", { thumbnail: { status: "done", url: imgUrl, prompt: imgPrompt } });
          console.log(`[Auto-Pipeline] ${keyword}: Thumbnail done`);
        } catch (e) {
          console.log(`[Auto-Pipeline] ${keyword}: Thumbnail SKIPPED - ${e.message}`);
          await updateStatus("content", { thumbnail: { status: "skipped", error: e.message } });
        }

        // STEP 5: Section Images + Auto-insert into Article HTML (skip on error)
        try {
          await updateStatus("content", { autoStep: "sections" });
          const sections = (outline.outline || []).filter(s => s.tag === "h2");
          const selected = sections.length > 4 ? [sections[0], sections[Math.floor(sections.length/2)], sections[sections.length-1]] : sections.slice(0, 4);
          const imgs = [];
          for (const sec of selected) {
            try {
              let sp;
              try {
                const pr = await aiService.generate(`Create SHORT image prompt (max 25 words, English) for blog section: "${sec.text}". Professional photo, NO text/faces. Return ONLY prompt.`, settings, { apiKeys });
                sp = pr.trim().replace(/^["']|["']$/g, "").substring(0, 300);
              } catch { sp = `Professional illustration of ${sec.text}, modern style, bright lighting`; }
              const url = await aiService.generateImage(sp, settings, {
                width: 800,
                height: 500,
                apiKeys,
                imageType: "section",
                searchQuery: `${keyword} ${sec.text}`,
                fallbackQuery: keyword,
                excludeUrls: usedImageUrls,
              });
              if (url) usedImageUrls.add(url);
              imgs.push({ sectionHeading: sec.text, status: "done", url, prompt: sp });
            } catch (e) { imgs.push({ sectionHeading: sec.text, status: "failed", error: e.message }); }
          }

          // Auto-insert generated section images into article HTML and re-validate QC
          const { html: htmlWithImages, insertedCount } = insertSectionImagesIntoHtml(html, imgs, keyword);
          html = htmlWithImages;
          const updatedQuality = validateArticle(html, outline.title || keyword, "guide", { keyword });
          await updateStatus("content", {
            content: { html, raw: rawContent, wordCount, mode: contentMode, targetWordCount: contentWordCount, usedProvider, usedModel },
            quality: updatedQuality,
            sections: { status: "done", images: imgs, insertedIntoContent: insertedCount > 0 },
          });
          console.log(`[Auto-Pipeline] ${keyword}: Section images done (${imgs.filter(i=>i.status==="done").length}/${imgs.length}, inserted ${insertedCount} into HTML)`);
        } catch (e) {
          console.log(`[Auto-Pipeline] ${keyword}: Section images SKIPPED - ${e.message}`);
          await updateStatus("content", { sections: { status: "skipped", error: e.message } });
        }

        // STEP 6: Save as done
        await updateStatus("review", { autoStep: "done" });
        console.log(`[Auto-Pipeline] ${keyword}: ✅ COMPLETE`);

        // Track AI credits (pipeline = 10 credits)
        consumeCredits(req.userId, "pipeline").catch(() => {});


        // STEP 7 (optional): Auto-publish if toggle enabled
        const freshDraft = await storage.getByIdForUser("standalone-drafts", id, req.userId);
        const autoPublish = freshDraft?.autoPublish;
        if (autoPublish?.enabled && autoPublish?.siteId) {
          try {
            console.log(`[Auto-Pipeline] ${keyword}: Auto-publish → site ${autoPublish.siteId}`);
            const wpSites = await storage.getAllForUser("wp-sites", req.userId);
            const site = wpSites.find(s => s.id === autoPublish.siteId);
            if (!site) throw new Error("WP site not found: " + autoPublish.siteId);

            const fp = freshDraft.pipeline || {};
            const slug = (fp.outline?.title || keyword)
              .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
              .toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim()
              .replace(/\s+/g, "-").replace(/-+/g, "-").substring(0, 80);

            let featuredMediaId = null;
            if (fp.thumbnail?.url) {
              try {
                const uploaded = await wpService.uploadImage(site, fp.thumbnail.url, slug);
                featuredMediaId = uploaded?.id || null;
              } catch {}
            }

            const quality = validateArticle(
              fp.content?.html || "",
              fp.outline?.title || keyword,
              "guide",
              { keyword: fp.outline?.focusKeyword || keyword },
            );
            if (!quality.passed && autoPublish.forcePublish !== true) {
              console.warn(`[Auto-Pipeline] ${keyword}: Auto-publish skipped - QC ${quality.score}/100`);
              await storage.update("standalone-drafts", id, {
                pipeline: { ...fp, quality, autoStep: "review" },
                status: "review",
                updatedAt: new Date().toISOString(),
              });
              return;
            }

            const result = await wpService.publish(site, {
              title: fp.outline?.title || keyword,
              content: fp.content?.html || "",
              status: autoPublish.status || "draft",
              slug,
              featuredMediaId,
              metaTitle: fp.outline?.title || keyword,
              metaDescription: fp.outline?.metaDescription || "",
              focusKeyword: fp.outline?.focusKeyword || keyword,
            });

            const publishRecord = {
              wpPostId: result.id,
              wpLink: result.link,
              wpPreviewLink: result.previewLink,
              wpStatus: result.status,
              siteId: site.id,
              siteName: site.name,
              siteUrl: site.siteUrl,
              publishedAt: new Date().toISOString(),
              autoPublished: true,
            };
            await storage.update("standalone-drafts", id, {
              status: "published",
              pipeline: {
                ...fp,
                publishedTo: [...(fp.publishedTo || []), publishRecord],
                autoStep: "published",
              },
              updatedAt: new Date().toISOString(),
            });
            console.log(`[Auto-Pipeline] ${keyword}: 🌐 Auto-published to ${site.name} (ID: ${result.id})`);
          } catch (pubErr) {
            console.error(`[Auto-Pipeline] ${keyword}: Auto-publish FAILED - ${pubErr.message}`);
          }
        }

      } catch (e) {
        console.error(`[Auto-Pipeline] ${keyword}: FAILED at step - ${e.message}`);
        await storage.update("standalone-drafts", id, {
          pipeline: { ...pipeline, autoStep: "error", error: e.message },
          updatedAt: new Date().toISOString(),
        });
      } finally {
        // Always release pipeline queue slot
        pipelineQueue.complete(id);
      }
    })();

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== T1 — Auto-publish config toggle =====
router.put("/drafts/:id/auto-publish", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const { enabled, siteId, status = "draft" } = req.body;
    await storage.update("standalone-drafts", req.params.id, {
      autoPublish: { enabled: !!enabled, siteId: siteId || null, status },
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, autoPublish: { enabled: !!enabled, siteId, status } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== T2 — Bulk article creation =====
router.post("/drafts/bulk", async (req, res) => {
  try {
    const { keywords, siteId, autoPublish: autoPublishEnabled, publishStatus = "draft" } = req.body;
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: "keywords[] required" });
    }
    if (keywords.length > 20) {
      return res.status(400).json({ error: "Tối đa 20 keyword mỗi lần" });
    }

    // Check license limit
    const limit = req.license?.limits?.maxArticlesPerMonth || 0;
    const used = req.usage?.articlesCreated || 0;
    const remaining = limit - used;
    if (keywords.length > remaining) {
      return res.status(403).json({
        error: `Chỉ còn ${remaining} bài trong tháng. Giảm số keyword hoặc nâng cấp gói.`,
        code: "ARTICLE_LIMIT", limit, used, remaining,
      });
    }

    const created = [];
    for (const kw of keywords) {
      const keyword = kw.trim();
      if (!keyword) continue;
      const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const draft = {
        id, keyword,
        status: "pending",
        autoPublish: autoPublishEnabled ? { enabled: true, siteId: siteId || null, status: publishStatus } : null,
        pipeline: { autoStep: null },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.createForUser("standalone-drafts", draft, req.userId);
      created.push({ id, keyword });

      // Trigger auto-pipeline in background (staggered 500ms apart)
      const draftId = id;
      const delay = created.length * 500;
      setTimeout(async () => {
        try {
          // Simulate internal call to auto-pipeline logic
          const { default: fetch } = await import("node-fetch").catch(() => ({ default: null }));
          if (!fetch) return;
          await fetch(`http://127.0.0.1:${process.env.PORT || 3001}/api/content/drafts/${draftId}/auto-pipeline`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${req.authToken}`,
              "x-internal-bulk": "true",
            },
          });
        } catch (e) {
          console.error(`[Bulk] Failed to trigger pipeline for ${draftId}:`, e.message);
        }
      }, delay);
    }

    res.json({
      success: true,
      created: created.length,
      drafts: created,
      message: `Đã tạo ${created.length} bài, pipeline đang chạy tự động.`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content/research — Keyword research

router.post("/research", async (req, res) => {

  try {
    const { keyword, maxResults } = req.body;
    if (!keyword) return res.status(400).json({ error: "Keyword is required" });

    const results = await bulkCrawler.crawlByKeyword(keyword, maxResults || 5);

    if (!results || results.length === 0) {
      return res.json({ keyword, articles: [], analysis: null });
    }

    const analyses = results.map((r) => analyzer.analyze(r)).filter(Boolean);
    const bulkAnalysis = analyzer.analyzeBulk(results);

    res.json({
      keyword,
      articles: results.map((r, i) => ({
        title: r.title,
        url: r.url,
        wordCount: r.stats?.wordCount || 0,
        headings: r.headings?.length || 0,
        score: analyses[i]?.qualityScore || 0,
      })),
      analysis: bulkAnalysis,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/content/outline — Generate outline via AI
router.post("/outline", async (req, res) => {
  try {
    const { keyword, analysis, customInstructions } = req.body;
    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    // Build prompt from research data
    let prompt = `Bạn là chuyên gia SEO #1 Việt Nam. Tạo OUTLINE chi tiết cho bài viết về "${keyword}".
[Ngữ cảnh: Thông tin cập nhật đến tháng ${new Date().getMonth() + 1}/${new Date().getFullYear()}. KHÔNG cần nhắc năm trong tiêu đề hay nội dung trừ khi chủ đề yêu cầu.]

📋 YÊU CẦU:
1. Title Tag (tối đa 60 ký tự, chứa keyword chính, KHÔNG thêm năm trừ khi keyword có chứa năm)
2. Meta Description (tối đa 160 ký tự, hấp dẫn)
3. Cấu trúc H2 → H3 chi tiết (tối thiểu 8 H2)
4. Mỗi H2/H3 kèm gợi ý nội dung ngắn (1-2 dòng)
5. FAQ 5-7 câu
6. Schema markup gợi ý (Article/FAQ)

📊 FORMAT OUTPUT (JSON):
{
  "title": "...",
  "metaDescription": "...",
  "focusKeyword": "${keyword}",
  "outline": [
    { "tag": "h2", "text": "...", "hint": "..." },
    { "tag": "h3", "text": "...", "hint": "...", "parent": 0 }
  ],
  "faq": [
    { "question": "...", "answer": "..." }
  ],
  "schema": "Article"
}`;

    if (analysis) {
      prompt += `\n\n📊 DỮ LIỆU NGHIÊN CỨU:
- Đã phân tích ${analysis.totalArticles || 0} bài top Google
- Headings phổ biến: ${(analysis.commonHeadings || [])
        .slice(0, 5)
        .map((h) => h.heading)
        .join(", ")}
- Key points: ${(analysis.combinedKeyPoints || []).slice(0, 5).join("; ")}`;
    }

    if (customInstructions) {
      prompt += `\n\n📝 YÊU CẦU RIÊNG: ${customInstructions}`;
    }

    const result = await aiService.generate(prompt, settings, { apiKeys });

    // Try to parse JSON from response
    let outline;
    try {
      const jsonMatch =
        result.match(/```json\n?([\s\S]*?)\n?```/) ||
        result.match(/\{[\s\S]*\}/);
      outline = JSON.parse(jsonMatch ? jsonMatch[1] || jsonMatch[0] : result);
    } catch {
      outline = { raw: result };
    }

    res.json(outline);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/content/generate — Generate full article via AI (streaming)
router.post("/generate", async (req, res) => {
  try {
    const { keyword, outline, style } = req.body;
    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    // Get write prompt template
    const prompts = await storage.getAllForUser("prompts", req.userId);
    const styleTemplate = prompts.find(
      (p) => p.type === "write-article" && p.isDefault,
    );

    let prompt = `Bạn là chuyên gia viết blog SEO tiếng Việt với 10 năm kinh nghiệm.

📌 NHIỆM VỤ: Viết bài viết HOÀN CHỈNH dựa trên outline bên dưới.
🎯 KEYWORD: ${keyword}
📏 ĐỘ DÀI: 2000+ từ

📋 OUTLINE:
${JSON.stringify(outline, null, 2)}

${styleTemplate ? `🎭 PHONG CÁCH:\n${styleTemplate.content}` : "🎭 TONE: Chuyên nghiệp, chỉn chu, trang nhã chuẩn B2B. Tuyệt đối không dùng tiếng lóng, khẩu ngữ suồng sã hay từ ngữ đường phố."}

✅ YÊU CẦU:
1. Viết theo outline trên CHÍNH XÁC
2. Mỗi H2 ít nhất 200 từ
3. Keyword chính xuất hiện trong 100 từ đầu
4. Đặt [IMG: mô tả ảnh] nơi nên chèn ảnh
5. Cuối bài: Kết luận + CTA
6. Format: Markdown (## cho H2, ### cho H3)
7. Sử dụng bullet points, bảng khi phù hợp`;

    if (style) prompt += `\n\n📝 HƯỚNG DẪN THÊM: ${style}`;

    await aiService.generate(prompt, settings, { apiKeys, stream: true, res });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /api/content/publish — Publish to WordPress
router.post("/publish", async (req, res) => {
  try {
    const {
      wpSiteId,
      title,
      content,
      metaTitle,
      metaDescription,
      focusKeyword,
      categories,
      status,
    } = req.body;

    const site = await storage.getByIdForUser("wp-sites", wpSiteId, req.userId);
    if (!site)
      return res.status(404).json({ error: "WordPress site not found" });

    const result = await wpService.publish(site, {
      title,
      content,
      metaTitle,
      metaDescription,
      focusKeyword,
      categories,
      status: status || "draft",
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== STANDALONE DRAFTS =====
// Save standalone pipeline articles locally for review/edit before publishing

// GET active tasks — pipelines currently running (poll every 5s from frontend)
router.get("/active-tasks", async (req, res) => {
  try {
    const drafts = await storage.getAllForUser("standalone-drafts", req.userId);
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30-minute window

    const STEP_PCT = {
      research: 15, outline: 35, content: 65,
      thumbnail: 80, sections: 92, done: 100, error: 0,
    };

    const running = drafts
      .filter((d) => {
        if (!["research", "outline", "content"].includes(d.status)) return false;
        if (d.pipeline?.autoStep === "error") return false;
        // Only show tasks updated in the last 30 minutes
        return new Date(d.updatedAt || d.createdAt) > cutoff;
      })
      .map((d) => {
        const autoStep = d.pipeline?.autoStep;
        const pct = STEP_PCT[autoStep] ?? STEP_PCT[d.status] ?? 10;
        return {
          id: d.id,
          keyword: d.keyword,
          status: d.status,
          autoStep,
          pct,
          wordCount: d.pipeline?.content?.wordCount || 0,
          outlineTitle: d.pipeline?.outline?.title || null,
          updatedAt: d.updatedAt,
          error: d.pipeline?.error || null,
        };
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json(running);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET all drafts
router.get("/drafts", async (req, res) => {
  try {
    const drafts = await storage.getAllForUser("standalone-drafts", req.userId);
    // Sort newest first
    drafts.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    res.json(drafts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// GET single draft
router.get("/drafts/:id", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    res.json(draft);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST create draft
router.post("/drafts", async (req, res) => {
  try {
    // --- License: Article limit check ---
    const limit = req.license?.limits?.maxArticlesPerMonth || 0;
    const used = req.usage?.articlesCreated || 0;
    if (used >= limit) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${limit} bài/tháng. Nâng cấp gói để tạo thêm.`,
        code: "ARTICLE_LIMIT",
        limit, used,
        currentPlan: req.license?.plan,
      });
    }

    const draft = {
      keyword: req.body.keyword || "",
      customPrompt: req.body.customPrompt || "",
      status: req.body.status || "keyword", // keyword, research, outline, content, review, published
      pipeline: req.body.pipeline || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const created = await storage.createForUser("standalone-drafts", draft, req.userId);
    reportArticleCreated(req, res).catch(() => {});
    res.json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT update draft
router.put("/drafts/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Draft not found" });
    
    const { id: _id, userId: _userId, ...safeBody } = req.body || {};
    const updated = {
      ...existing,
      ...safeBody,
      updatedAt: new Date().toISOString(),
    };
    await storage.update("standalone-drafts", req.params.id, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE draft
router.delete("/drafts/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Draft not found" });
    await storage.delete("standalone-drafts", req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST convert draft → project article
router.post("/drafts/:id/to-project", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Bản nháp không tồn tại" });

    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: "Cần chọn dự án (projectId)" });

    // Check project exists
    const project = await storage.getByIdForUser("projects", projectId, req.userId);
    if (!project) return res.status(404).json({ error: "Dự án không tồn tại" });

    // Check duplicate by keyword/title
    const existingArticles = await storage.getAllForUser("articles", req.userId);
    const draftTitle = (draft.pipeline?.outline?.title || draft.keyword || "").toLowerCase().trim();
    const duplicate = existingArticles.find(
      (a) => a.projectId === projectId && (a.title || "").toLowerCase().trim() === draftTitle
    );
    if (duplicate) {
      return res.status(409).json({ error: `Bài "${draftTitle}" đã tồn tại trong dự án` });
    }

    // Build pipeline data from draft
    const contentData = draft.pipeline?.content || {};
    const outlineData = draft.pipeline?.outline || {};
    const researchData = draft.pipeline?.research || {};
    const thumbnailData = draft.pipeline?.thumbnail || {};
    const sectionsData = draft.pipeline?.sections || {};
    const wordCount = contentData.wordCount || 0;

    const article = await storage.createForUser("articles", {
      projectId,
      title: outlineData.title || draft.keyword || "Untitled",
      keyword: draft.keyword || "",
      source: "pipeline",
      originalContent: contentData.html || "",
      originalWordCount: wordCount,
      contentAngle: draft.contentAngle || "guide",
      estimatedWords: contentData.targetWordCount || wordCount || 2000,
      searchIntent: draft.searchIntent || "informational",
      contentType: draft.contentType || "blog",
      pipeline: {
        research: { status: researchData.keyword ? "done" : "pending", data: researchData },
        outline: { status: outlineData.title ? "done" : "pending", data: outlineData },
        content: {
          status: contentData.html ? "done" : "pending",
          data: contentData.html ? {
            html: contentData.html,
            wordCount,
            readingTime: Math.ceil(wordCount / 200),
            mode: contentData.mode || "basic",
          } : null,
        },
        thumbnail: thumbnailData.url
          ? { status: "done", url: thumbnailData.url, prompt: thumbnailData.prompt }
          : { status: "pending", url: null },
        sections: sectionsData.status === "done"
          ? sectionsData
          : { status: "pending", images: [] },
        publish: draft.pipeline?.publish?.wpPostId
          ? { status: "done", wpPostId: draft.pipeline.publish.wpPostId, wpUrl: draft.pipeline.publish.wpUrl }
          : { status: "pending" },
      },
      status: contentData.html ? "done" : "processing",
      wpPostId: draft.pipeline?.publish?.wpPostId || null,
      wpUrl: draft.pipeline?.publish?.wpUrl || null,
      tokenUsage: draft.tokenUsage || { research: 0, outline: 0, content: 0, total: 0 },
    }, req.userId);

    // Update project article count
    const allArticles = await storage.getAllForUser("articles", req.userId);
    const count = allArticles.filter((a) => a.projectId === projectId).length;
    await storage.update("projects", projectId, { articles: count });

    console.log(`[Draft→Project] Converted "${draft.keyword}" → project ${projectId}, article ${article.id}`);
    res.json({
      success: true,
      articleId: article.id,
      projectId,
      title: article.title,
    });
  } catch (e) {
    console.error("[Draft→Project] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST research for standalone draft
router.post("/drafts/:id/research", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const keyword = draft.keyword;
    if (!keyword) return res.status(400).json({ error: "Keyword is required" });

    // Update status
    await storage.update("standalone-drafts", req.params.id, {
      pipeline: { ...draft.pipeline, autoStep: "research" },
      status: "research",
      updatedAt: new Date().toISOString(),
    });

    const researchResult = await bulkCrawler.crawlByKeyword(keyword, 5);
    const analyses = (researchResult || []).map(r => analyzer.analyze(r)).filter(Boolean);
    const bulkAnalysis = researchResult?.length ? analyzer.analyzeBulk(researchResult) : null;
    const research = {
      keyword,
      articles: (researchResult || []).map((r, i) => ({
        title: r.title, url: r.url,
        wordCount: r.stats?.wordCount || 0, headings: r.headings?.length || 0,
        score: analyses[i]?.qualityScore || 0,
      })),
      analysis: bulkAnalysis,
    };

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: { ...draft.pipeline, research, autoStep: null },
      status: "research",
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Draft-Research] ${keyword}: Done (${(researchResult || []).length} articles)`);
    res.json({ success: true, data: research });
  } catch (error) {
    console.error("[Draft-Research] Error:", error.message);
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (draft) {
      await storage.update("standalone-drafts", req.params.id, {
        pipeline: { ...draft.pipeline, autoStep: "error", error: error.message },
        updatedAt: new Date().toISOString(),
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST outline for standalone draft
router.post("/drafts/:id/outline", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const keyword = draft.keyword;
    const research = draft.pipeline?.research || {};
    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: { ...draft.pipeline, autoStep: "outline" },
      status: "outline",
      updatedAt: new Date().toISOString(),
    });

    const outlinePrompt = `Bạn là chuyên gia SEO #1 Việt Nam. Tạo OUTLINE chi tiết cho bài viết về "${keyword}".
[Ngữ cảnh: Thông tin cập nhật đến tháng ${new Date().getMonth() + 1}/${new Date().getFullYear()}. KHÔNG cần nhắc năm trong tiêu đề hay nội dung trừ khi chủ đề yêu cầu.]
📋 YÊU CẦU:
1. Title Tag (tối đa 60 ký tự, chứa keyword chính, KHÔNG thêm năm trừ khi keyword có chứa năm)
2. Meta Description (tối đa 160 ký tự, hấp dẫn)
3. Cấu trúc H2 → H3 chi tiết (tối thiểu 8 H2)
4. FAQ 5-7 câu
${draft.customPrompt ? `\n📝 YÊU CẦU RIÊNG: ${draft.customPrompt}` : ""}
${research.analysis ? `\n📊 DỮ LIỆU: Đã phân tích ${research.analysis.totalArticles || 0} bài top Google` : ""}

📊 FORMAT OUTPUT (JSON):
{ "title": "...", "metaDescription": "...", "focusKeyword": "${keyword}",
  "outline": [ { "tag": "h2", "text": "...", "hint": "..." }, { "tag": "h3", "text": "...", "hint": "...", "parent": 0 } ],
  "faq": [ { "question": "...", "answer": "..." } ], "schema": "Article" }`;

    const outlineResult = await aiService.generate(outlinePrompt, settings, { apiKeys });
    let outline;
    try {
      const m = outlineResult.match(/```json\n?([\s\S]*?)\n?```/) || outlineResult.match(/\{[\s\S]*\}/);
      outline = JSON.parse(m ? (m[1] || m[0]) : outlineResult);
    } catch { outline = { raw: outlineResult }; }

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: { ...draft.pipeline, outline, autoStep: null },
      status: "outline",
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Draft-Outline] ${keyword}: Done`);
    res.json({ success: true, data: outline });
  } catch (error) {
    console.error("[Draft-Outline] Error:", error.message);
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (draft) {
      await storage.update("standalone-drafts", req.params.id, {
        pipeline: { ...draft.pipeline, autoStep: "error", error: error.message },
        updatedAt: new Date().toISOString(),
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST content for standalone draft
router.post("/drafts/:id/content", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const keyword = draft.keyword;
    const outline = draft.pipeline?.outline || {};
    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);
    const mode = req.body.mode || "basic"; // "basic" | "quality"
    const targetWordCount = parseInt(req.body.targetWordCount) || 2000;

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: { ...draft.pipeline, autoStep: "content" },
      status: "content",
      updatedAt: new Date().toISOString(),
    });

    const prompts = await storage.getAllForUser("prompts", req.userId);
    const styleTemplate = prompts.find(p => p.type === "write-article" && p.isDefault);
    let html, wordCount, raw;

    if (mode === "quality") {
      // Quality mode: viết từng section chuyên sâu chuẩn E-E-A-T
      const h2Sections = (outline.outline || []).filter(s => s.tag === "h2");
      const perSectionWords = Math.max(350, Math.ceil(targetWordCount / Math.max(h2Sections.length, 1)));
      const parts = [];

      // Intro
      const introPrompt = `Bạn là chuyên gia hàng đầu về "${keyword}". Viết phần MỞ ĐẦU chuyên nghiệp, hấp dẫn chuẩn E-E-A-T (khoảng 200-250 từ, tiếng Việt) cho bài viết "${outline.title || keyword}".
- Keyword chính "${keyword}" xuất hiện tự nhiên trong 50 từ đầu tiên.
- Mở đầu bằng hook lôi cuốn (thực trạng, số liệu hoặc insight đắt giá).
- Nêu rõ lợi ích và giá trị người đọc nhận được từ bài viết này.
- Format Markdown, không dùng thẻ <h1>.`;
      const intro = await aiService.generate(introPrompt, settings, { apiKeys });
      parts.push(intro.trim());

      // Mỗi H2 section
      for (const sec of h2Sections) {
        const hints = (outline.outline || []).filter(s => s.tag === "h3" && s.parent === h2Sections.indexOf(sec)).map(s => `- ${s.text}`).join("\n");
        const secPrompt = `Bạn là chuyên gia SEO & Content E-E-A-T. Viết section chi tiết "## ${sec.text}" cho bài "${outline.title || keyword}".
- Từ khóa chính: "${keyword}"
- Gợi ý chủ đề: ${sec.hint || ""}
- YÊU CẦU ĐỘ DÀI: Tối thiểu ${perSectionWords} từ cho section này.
- TIÊU CHUẨN E-E-A-T & ĐỘ SÂU:
  1. Phân tích chi tiết, giải thích rõ bản chất, không viết chung chung, sơ sài.
  2. BẮT BUỘC có ví dụ thực tế / góc nhìn chuyên gia / trích dẫn mẹo thực chiến: "> 💡 **Lưu ý chuyên gia:** ...".
  3. Nếu có so sánh, phân loại hoặc thông số → BẮT BUỘC dùng Bảng biểu Markdown (| Cột 1 | Cột 2 | Cột 3 |).
  4. Sử dụng danh sách bullet points / đánh số để tăng trải nghiệm đọc.
${hints ? `Sub-sections cần triển khai:\n${hints}` : ""}
${styleTemplate ? `Phong cách: ${styleTemplate.content.slice(0, 200)}` : ""}
- Bắt đầu bằng ## ${sec.text}. Format Markdown chuẩn.`;
        try {
          const secContent = await aiService.generate(secPrompt, settings, { apiKeys });
          parts.push(secContent.trim());
        } catch (e) {
          parts.push(`## ${sec.text}\n\nNội dung đang được cập nhật.`);
        }
      }

      // FAQ + Kết luận
      if (outline.faq?.length > 0) {
        const faqText = outline.faq.map(f => `### ${f.question}\n${f.answer || ""}`).join("\n\n");
        parts.push(`## Câu hỏi thường gặp về ${keyword}\n\n${faqText}`);
      }
      const conclPrompt = `Viết phần KẾT LUẬN & LỜI KHUYÊN HÀNH ĐỘNG (150-200 từ, tiếng Việt) cho bài viết "${outline.title || keyword}". Tóm tắt điểm cốt lõi, đưa ra checklist hành động và lời kêu gọi hành động (CTA) tự nhiên. Format Markdown bắt đầu bằng ## Kết luận.`;
      try {
        const concl = await aiService.generate(conclPrompt, settings, { apiKeys });
        parts.push(concl.trim());
      } catch {}

      raw = parts.join("\n\n");
    } else {
      // Basic mode: 1 prompt
      const writePrompt = `Bạn là chuyên gia Content SEO #1 Việt Nam. Viết bài viết toàn diện, chuyên sâu chuẩn E-E-A-T.
[Ngữ cảnh: Thông tin cập nhật mới nhất năm ${new Date().getFullYear()}. Viết tự nhiên, chuyên nghiệp.]
📌 TỪ KHÓA CHÍNH: "${keyword}"
📏 ĐỘ DÀI BẮT BUỘC: TỐI THIỂU ${targetWordCount} TỪ (Tuyệt đối không viết ngắn dưới ${Math.round(targetWordCount * 0.95)} từ).

📋 DÀN Ý CHI TIẾT (BẮT BUỘC VIẾT ĐẦY ĐỦ CÁC HEADING):
${JSON.stringify(outline, null, 2)}

${styleTemplate ? `🎭 PHONG CÁCH:\n${styleTemplate.content}` : "🎭 TONE & GIỌNG VĂN: Chuyên gia doanh nghiệp, thực chiến, đáng tin cậy, phân tích sâu sắc. Tuyệt đối không dùng tiếng lóng, khẩu ngữ suồng sã hay từ ngữ thiếu chuẩn mực."}
${draft.customPrompt ? `📝 HƯỚNG DẪN BỔ SUNG: ${draft.customPrompt}` : ""}

⭐ BẮT BUỘC TUÂN THỦ TIÊU CHUẨN E-E-A-T:
1. **Experience (Trải nghiệm thực tế):** Chia sẻ case study, bài học từ các dự án thực tế, các lỗi sai phổ biến và cách khắc phục.
2. **Expertise (Chuyên môn sâu):** Hướng dẫn từng bước (Step-by-step), giải thích tường tận nguyên lý, thuật ngữ chuyên ngành.
3. **Authoritativeness (Thẩm quyền & Trực quan):** BẮT BUỘC có ít nhất 1-2 Bảng so sánh dữ liệu (Markdown table), trích dẫn số liệu / tip chuyên gia (dùng > blockquote).
4. **Trustworthiness (Tin cậy & Cấu trúc):** Keyword chính trong 100 từ đầu tiên, mỗi H2 viết tối thiểu 300 từ, có phần FAQ chi tiết và Kết luận kèm CTA.
5. Định dạng: Markdown chuẩn (##, ###, **, *, >, | table |).`;
      raw = await aiService.generate(writePrompt, settings, { apiKeys });
    }

    wordCount = raw.split(/\s+/).filter(Boolean).length;
    html = "<p>" + raw
      .replace(/### (.*)/g, "</p><h3>$1</h3><p>")
      .replace(/## (.*)/g, "</p><h2>$1</h2><p>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br/>") + "</p>";

    let updatedThumbnail = draft.pipeline?.thumbnail;
    let updatedSections = draft.pipeline?.sections;
    const usedImageUrls = new Set();
    if (updatedThumbnail?.url) usedImageUrls.add(updatedThumbnail.url);

    // Auto-find & attach Copyright-Free Thumbnail + Section Images when writing content
    if (req.body.autoImages !== false) {
      const articleTitle = outline.title || keyword;

      // 1. Auto Thumbnail if missing
      if (!updatedThumbnail?.url) {
        try {
          const thumbPrompt = `Professional photo representing "${articleTitle}", modern clean style, bright lighting, no text`;
          const thumbUrl = await aiService.generateImage(thumbPrompt, settings, {
            width: 1200,
            height: 630,
            apiKeys,
            imageType: "thumbnail",
            searchQuery: `${keyword} ${articleTitle}`,
            fallbackQuery: keyword,
            excludeUrls: usedImageUrls,
          });
          if (thumbUrl) {
            usedImageUrls.add(thumbUrl);
            updatedThumbnail = { status: "done", url: thumbUrl, prompt: thumbPrompt };
          }
        } catch (e) {
          console.warn("[Draft-Content] Auto-thumbnail skipped:", e.message);
        }
      }

      // 2. Auto Section Images if missing
      if (!updatedSections?.images?.some(i => i.status === "done" && i.url)) {
        try {
          let h2List = (outline.outline || []).filter(s => s.tag === "h2").map(s => s.text);
          if (h2List.length === 0) {
            h2List = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [])
              .map(h => h.replace(/<[^>]*>/g, "").trim())
              .filter(Boolean);
          }
          const selectedH2s = h2List.length > 4
            ? [h2List[0], h2List[Math.floor(h2List.length / 2)], h2List[h2List.length - 1]]
            : h2List.slice(0, 3);

          const autoImgs = [];
          for (const h2Text of selectedH2s) {
            try {
              const sp = `Professional illustration of ${h2Text}, modern clean style, bright lighting, no text`;
              const url = await aiService.generateImage(sp, settings, {
                width: 800,
                height: 500,
                apiKeys,
                imageType: "section",
                searchQuery: `${keyword} ${h2Text}`,
                fallbackQuery: keyword,
                excludeUrls: usedImageUrls,
              });
              if (url) usedImageUrls.add(url);
              autoImgs.push({ sectionHeading: h2Text, status: "done", url, prompt: sp });
            } catch (e) {
              autoImgs.push({ sectionHeading: h2Text, status: "failed", error: e.message });
            }
          }
          if (autoImgs.length > 0) {
            updatedSections = { status: "done", images: autoImgs, insertedIntoContent: false };
          }
        } catch (e) {
          console.warn("[Draft-Content] Auto-section-images skipped:", e.message);
        }
      }
    }

    if (updatedSections?.images?.length > 0) {
      const { html: htmlWithImgs, insertedCount } = insertSectionImagesIntoHtml(html, updatedSections.images, keyword);
      if (insertedCount > 0) {
        html = htmlWithImgs;
        updatedSections = { ...updatedSections, insertedIntoContent: true };
      }
    }

    const quality = validateArticle(html, outline.title || keyword, "guide", {
      keyword: outline.focusKeyword || keyword,
    });

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: {
        ...draft.pipeline,
        content: { html, raw, wordCount, mode, targetWordCount },
        ...(updatedThumbnail ? { thumbnail: updatedThumbnail } : {}),
        ...(updatedSections ? { sections: updatedSections } : {}),
        quality,
        autoStep: null,
      },
      status: "content",
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Draft-Content] ${keyword}: Done (${wordCount} words, ${mode} mode, QC: ${quality.score}/100)`);
    res.json({ success: true, data: { html, wordCount, mode }, thumbnail: updatedThumbnail, sections: updatedSections, quality });
  } catch (error) {
    console.error("[Draft-Content] Error:", error.message);
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (draft) {
      await storage.update("standalone-drafts", req.params.id, {
        pipeline: { ...draft.pipeline, autoStep: "error", error: error.message },
        updatedAt: new Date().toISOString(),
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST generate thumbnail for standalone draft
router.post("/drafts/:id/thumbnail", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    const keyword = draft.keyword || "";
    const outline = draft.pipeline?.outline || {};
    const articleTitle = outline.title || keyword;
    const contentData = draft.pipeline?.content || {};
    const sectionHeadings = (outline.outline || []).map(s => s.text).join(", ");

    let contentPreview = "";
    if (contentData.html) {
      contentPreview = contentData.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 300);
    }

    // Generate AI prompt for thumbnail
    let imagePrompt;
    try {
      const promptResult = await aiService.generate(
        `You are a visual director for a blog. Create a SHORT but HIGHLY SPECIFIC image prompt (max 30 words, in English) for a blog thumbnail.

ARTICLE TITLE: "${articleTitle}"
KEYWORD: "${keyword}"
MAIN SECTIONS: ${sectionHeadings || "N/A"}
${contentPreview ? `CONTENT PREVIEW: ${contentPreview}` : ""}

Rules:
- Image MUST visually represent the SPECIFIC topic
- Be CONCRETE and SPECIFIC
- Style: professional photo or high-quality 3D render, bright clean lighting
- NO text, NO watermarks, NO human faces, NO logos
- Include lighting/mood descriptor
Return ONLY the prompt.`,
        settings,
        { apiKeys },
      );
      imagePrompt = promptResult.trim().replace(/^["']|["']$/g, "").replace(/\n/g, " ").substring(0, 400);
    } catch (e) {
      imagePrompt = `Professional high quality photo representing "${articleTitle}", modern clean design, bright studio lighting, detailed, no text, no watermark`;
    }

    const imageUrl = await aiService.generateImage(imagePrompt, settings, {
      width: 1200,
      height: 630,
      apiKeys,
      imageType: "thumbnail",
      searchQuery: `${keyword} ${articleTitle}`,
      fallbackQuery: keyword,
    });

    // Update draft
    await storage.update("standalone-drafts", req.params.id, {
      pipeline: {
        ...draft.pipeline,
        thumbnail: { status: "done", url: imageUrl, prompt: imagePrompt },
      },
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, url: imageUrl, prompt: imagePrompt });
  } catch (error) {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (draft) {
      await storage.update("standalone-drafts", req.params.id, {
        pipeline: { ...draft.pipeline, thumbnail: { status: "failed", error: error.message } },
        updatedAt: new Date().toISOString(),
      });
    }
    console.error("[Draft-Thumbnail] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST generate section images for standalone draft
router.post("/drafts/:id/section-images", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const outline = draft.pipeline?.outline || {};
    const sections = outline.outline || [];
    if (sections.length === 0) {
      return res.status(400).json({ error: "Cần tạo outline trước" });
    }

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    const keyword = draft.keyword || "";
    const articleTitle = outline.title || keyword;
    const usedImageUrls = new Set();
    if (draft.pipeline?.thumbnail?.url) usedImageUrls.add(draft.pipeline.thumbnail.url);

    // Smart selection: pick 3-4 visual sections
    let selectedSections = sections.filter(s => s.tag === "h2");
    if (selectedSections.length > 4) {
      const mid = Math.floor(selectedSections.length / 2);
      selectedSections = [selectedSections[0], selectedSections[mid], selectedSections[selectedSections.length - 1]];
    }
    if (selectedSections.length === 0) selectedSections = sections.slice(0, 3);

    const sectionImages = [];
    for (const section of selectedSections) {
      try {
        let sectionPrompt;
        try {
          const promptResult = await aiService.generate(
            `Create a SHORT image prompt (max 25 words, English) for a blog section illustration.
ARTICLE: "${articleTitle}"
SECTION: "${section.text}"
Rules: CONCRETE, SPECIFIC, professional photo, NO text/watermarks/faces/logos.
Return ONLY the prompt.`,
            settings,
            { apiKeys },
          );
          sectionPrompt = promptResult.trim().replace(/^["']|["']$/g, "").replace(/\n/g, " ").substring(0, 300);
        } catch {
          sectionPrompt = `Professional illustration of ${section.text}, modern clean style, bright lighting, no text`;
        }

        const imageUrl = await aiService.generateImage(sectionPrompt, settings, {
          width: 800,
          height: 500,
          apiKeys,
          imageType: "section",
          searchQuery: `${keyword} ${section.text}`,
          fallbackQuery: keyword,
          excludeUrls: usedImageUrls,
        });
        if (imageUrl) usedImageUrls.add(imageUrl);
        sectionImages.push({ sectionHeading: section.text, status: "done", url: imageUrl, prompt: sectionPrompt });
      } catch (e) {
        sectionImages.push({ sectionHeading: section.text, status: "failed", error: e.message });
      }
    }

    // Automatically insert section images into HTML if content already exists
    let updatedContent = draft.pipeline?.content;
    let updatedQuality = draft.pipeline?.quality;
    let insertedIntoContent = false;
    if (updatedContent?.html) {
      const { html: newHtml, insertedCount } = insertSectionImagesIntoHtml(updatedContent.html, sectionImages, keyword);
      if (insertedCount > 0) {
        const wordCount = newHtml.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
        updatedContent = { ...updatedContent, html: newHtml, wordCount };
        updatedQuality = validateArticle(newHtml, articleTitle, "guide", { keyword });
        insertedIntoContent = true;
      }
    }

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: {
        ...draft.pipeline,
        ...(updatedContent ? { content: updatedContent } : {}),
        ...(updatedQuality ? { quality: updatedQuality } : {}),
        sections: { status: "done", images: sectionImages, insertedIntoContent },
      },
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, images: sectionImages, insertedIntoContent });
  } catch (error) {
    console.error("[Draft-SectionImages] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST 1-click auto-find & attach Copyright-Free Thumbnail + Section Images into draft HTML
router.post("/drafts/:id/auto-attach-images", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);
    const keyword = draft.keyword || "";
    const outline = draft.pipeline?.outline || {};
    const articleTitle = outline.title || keyword;
    const usedImageUrls = new Set();

    // 1. Auto-find Copyright-Free Thumbnail
    let updatedThumbnail = draft.pipeline?.thumbnail || {};
    try {
      const thumbPrompt = `Professional photo representing "${articleTitle}", modern clean style, bright lighting, no text`;
      const thumbUrl = await aiService.generateImage(thumbPrompt, settings, {
        width: 1200,
        height: 630,
        apiKeys,
        imageType: "thumbnail",
        preferRealImages: true,
        searchQuery: `${keyword} ${articleTitle}`,
        fallbackQuery: keyword,
        excludeUrls: usedImageUrls,
      });
      if (thumbUrl) {
        usedImageUrls.add(thumbUrl);
        updatedThumbnail = { status: "done", url: thumbUrl, prompt: "Auto Copyright-Free Image" };
      }
    } catch (e) {
      console.warn("[Draft-AutoAttachImages] Thumbnail error:", e.message);
    }

    // 2. Auto-find Copyright-Free Section Images
    let h2List = (outline.outline || []).filter(s => s.tag === "h2").map(s => s.text);
    const currentHtml = draft.pipeline?.content?.html || "";
    if (h2List.length === 0 && currentHtml) {
      h2List = (currentHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [])
        .map(h => h.replace(/<[^>]*>/g, "").trim())
        .filter(Boolean);
    }
    const selectedH2s = h2List.length > 4
      ? [h2List[0], h2List[Math.floor(h2List.length / 2)], h2List[h2List.length - 1]]
      : h2List.slice(0, 3);

    const sectionImages = [];
    for (const h2Text of selectedH2s) {
      try {
        const sp = `Professional illustration of ${h2Text}, modern clean style, bright lighting, no text`;
        const url = await aiService.generateImage(sp, settings, {
          width: 800,
          height: 500,
          apiKeys,
          imageType: "section",
          preferRealImages: true,
          searchQuery: `${keyword} ${h2Text}`,
          fallbackQuery: keyword,
          excludeUrls: usedImageUrls,
        });
        if (url) usedImageUrls.add(url);
        sectionImages.push({ sectionHeading: h2Text, status: "done", url, prompt: "Auto Copyright-Free Image" });
      } catch (e) {
        sectionImages.push({ sectionHeading: h2Text, status: "failed", error: e.message });
      }
    }

    // 3. Auto-embed into article HTML
    let updatedContent = draft.pipeline?.content;
    let updatedQuality = draft.pipeline?.quality;
    let insertedIntoContent = false;
    let insertedCount = 0;
    if (updatedContent?.html && sectionImages.length > 0) {
      const resInsert = insertSectionImagesIntoHtml(updatedContent.html, sectionImages, keyword);
      insertedCount = resInsert.insertedCount;
      if (insertedCount > 0) {
        const wordCount = resInsert.html.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
        updatedContent = { ...updatedContent, html: resInsert.html, wordCount };
        updatedQuality = validateArticle(resInsert.html, articleTitle, "guide", { keyword });
        insertedIntoContent = true;
      }
    }

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: {
        ...draft.pipeline,
        thumbnail: updatedThumbnail,
        ...(updatedContent ? { content: updatedContent } : {}),
        ...(updatedQuality ? { quality: updatedQuality } : {}),
        sections: { status: "done", images: sectionImages, insertedIntoContent },
      },
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      thumbnail: updatedThumbnail,
      images: sectionImages,
      insertedIntoContent,
      insertedCount,
    });
  } catch (error) {
    console.error("[Draft-AutoAttachImages] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST search real images from Google/Bing for manual replacement
router.post("/search-images", async (req, res) => {
  try {
    const { query, limit = 16 } = req.body || {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: "Vui lòng nhập từ khóa tìm ảnh" });
    }
    const apiKeys = await resolveApiKeys(req.userId, req.license);
    const results = await aiService.searchRealImages(String(query).trim(), { apiKeys, limit });
    res.json({ success: true, results });
  } catch (error) {
    console.error("[Search-Images] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST insert section images into article HTML content
router.post("/drafts/:id/insert-images", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const pipeline = draft.pipeline || {};
    const content = pipeline.content || {};
    const sections = pipeline.sections || {};
    const sectionImages = sections.images || [];

    if (!content.html) {
      return res.status(400).json({ error: "Bài viết chưa có nội dung HTML" });
    }
    if (sectionImages.filter(i => i.status === "done" && i.url).length === 0) {
      return res.status(400).json({ error: "Chưa có ảnh section nào để chèn" });
    }

    const keyword = draft.keyword || "";
    const { html, insertedCount } = insertSectionImagesIntoHtml(content.html, sectionImages, keyword);

    // Update content HTML and re-validate QC
    const wordCount = html.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
    const quality = validateArticle(html, pipeline.outline?.title || keyword, "guide", { keyword });
    await storage.update("standalone-drafts", req.params.id, {
      pipeline: {
        ...pipeline,
        content: { ...content, html, wordCount },
        quality,
        sections: { ...sections, insertedIntoContent: true },
      },
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Draft-InsertImages] Inserted ${insertedCount}/${sectionImages.length} images into draft ${req.params.id}`);
    res.json({ success: true, insertedCount, totalImages: sectionImages.length });
  } catch (error) {
    console.error("[Draft-InsertImages] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT set/replace thumbnail URL or base64
router.put("/drafts/:id/thumbnail-url", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const { url, base64, thumbUrl } = req.body;
    let imageUrl = url || base64;
    if (!imageUrl) return res.status(400).json({ error: "URL hoặc base64 là bắt buộc" });

    if (base64 && String(base64).startsWith("data:image")) {
      imageUrl = imageStore.normalizeImageUrl(base64, "thumb");
    } else if (url && /^https?:\/\//i.test(url)) {
      try {
        imageUrl = await aiService.downloadAndStoreImage(url, "thumb", thumbUrl);
      } catch {
        imageUrl = url;
      }
    }

    const pipeline = draft.pipeline || {};
    await storage.update("standalone-drafts", req.params.id, {
      pipeline: {
        ...pipeline,
        thumbnail: { status: "done", url: imageUrl, prompt: "Manual / Google Image" },
      },
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Draft-Thumbnail] Manual set for draft ${req.params.id}`);
    res.json({ success: true, url: imageUrl });
  } catch (error) {
    console.error("[Draft-Thumbnail] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT replace a section image by index
router.put("/drafts/:id/section-image/:index", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const idx = parseInt(req.params.index, 10);
    const pipeline = draft.pipeline || {};
    const sections = pipeline.sections || {};
    const images = [...(sections.images || [])];

    if (idx < 0 || idx >= images.length) {
      return res.status(400).json({ error: "Index ảnh không hợp lệ" });
    }

    const { url, base64, thumbUrl } = req.body;
    let imageUrl = url || base64;
    if (!imageUrl) return res.status(400).json({ error: "URL hoặc base64 là bắt buộc" });

    if (base64 && String(base64).startsWith("data:image")) {
      imageUrl = imageStore.normalizeImageUrl(base64, "section");
    } else if (url && /^https?:\/\//i.test(url)) {
      try {
        imageUrl = await aiService.downloadAndStoreImage(url, "section", thumbUrl);
      } catch {
        imageUrl = url;
      }
    }

    // Update the specific image
    images[idx] = {
      ...images[idx],
      status: "done",
      url: imageUrl,
      prompt: images[idx].prompt ? `${images[idx].prompt} (replaced)` : "Manual / Google Image",
    };

    // Re-sync article HTML if content already exists
    let updatedContent = pipeline.content;
    let insertedIntoContent = sections.insertedIntoContent || false;
    if (updatedContent?.html) {
      const { html: newHtml, insertedCount } = insertSectionImagesIntoHtml(updatedContent.html, images, draft.keyword || "");
      if (insertedCount > 0) {
        const wordCount = newHtml.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
        updatedContent = { ...updatedContent, html: newHtml, wordCount };
        insertedIntoContent = true;
      }
    }

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: {
        ...pipeline,
        ...(updatedContent ? { content: updatedContent } : {}),
        sections: { ...sections, images, insertedIntoContent },
      },
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Draft-SectionImage] Replaced image ${idx} for draft ${req.params.id}`);
    res.json({ success: true, index: idx, url: imageUrl });
  } catch (error) {
    console.error("[Draft-SectionImage] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST publish standalone draft to WordPress
router.post("/drafts/:id/publish-wp", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const pipeline = draft.pipeline || {};
    const outline = pipeline.outline || {};
    const content = pipeline.content || {};

    if (!content.html) {
      return res.status(400).json({ error: "Cần hoàn thành bước Viết nội dung trước khi đăng." });
    }

    const forcePublish = req.body.forcePublish === true;
    const quality = validateArticle(
      content.html,
      outline.title || draft.keyword,
      "guide",
      { keyword: outline.focusKeyword || draft.keyword || "" },
    );
    if (!quality.passed && !forcePublish) {
      await storage.update("standalone-drafts", req.params.id, {
        pipeline: { ...pipeline, quality },
        updatedAt: new Date().toISOString(),
      });
      return res.status(422).json({
        error: "Bài chưa đạt chuẩn QC. Sửa lỗi rồi thử lại hoặc dùng forcePublish: true.",
        qc: quality,
        issues: quality.issues,
        warnings: quality.warnings,
      });
    }

    // Determine which WP site to publish to
    const siteId = req.body.siteId;
    let site;
    if (siteId) {
      site = await storage.getByIdForUser("wp-sites", siteId, req.userId);
    } else {
      // Fallback: first site with lastTestOk === true
      const sites = await storage.getAllForUser("wp-sites", req.userId);
      site = sites.find(s => s.lastTestOk === true) || sites[0];
    }
    if (!site) {
      return res.status(400).json({ error: "Chưa có kết nối WordPress nào. Thêm tại Cài đặt → Đăng bài." });
    }

    const publishStatus = req.body.status || "draft"; // draft | publish
    const categoryIds = req.body.categoryIds || [];

    // Build SEO-friendly slug from keyword
    const slug = draft.keyword
      ? draft.keyword.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .trim()
      : "";

    // Upload thumbnail to WP media library if available
    let featuredMediaId = null;
    const thumbnailUrl = pipeline.thumbnail?.url;
    if (thumbnailUrl && !thumbnailUrl.startsWith("data:")) {
      try {
        const media = await wpService.uploadImage(site, thumbnailUrl, outline.title || draft.keyword);
        featuredMediaId = media.id;
      } catch (e) {
        console.warn("[Draft-PublishWP] Thumbnail upload failed:", e.message);
      }
    }

    const result = await wpService.publish(site, {
      title: outline.title || draft.keyword,
      content: content.html,
      status: publishStatus,
      categories: categoryIds,
      slug,
      featuredMediaId,
      metaTitle: outline.title || draft.keyword,
      metaDescription: outline.metaDescription || "",
      focusKeyword: outline.focusKeyword || draft.keyword,
    });

    // Save publish record to draft
    const publishRecord = {
      wpPostId: result.id,
      wpLink: result.link,
      wpPreviewLink: result.previewLink,
      wpStatus: result.status,
      siteId: site.id,
      siteName: site.name,
      siteUrl: site.siteUrl,
      publishedAt: new Date().toISOString(),
    };

    await storage.update("standalone-drafts", req.params.id, {
      pipeline: {
        ...pipeline,
        publishedTo: [...(pipeline.publishedTo || []), publishRecord],
        autoStep: "done",
      },
      status: "published",
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Draft-PublishWP] "${draft.keyword}" → ${site.siteUrl} (ID: ${result.id}, status: ${result.status})`);
    res.json({ success: true, ...result, siteUrl: site.siteUrl, siteName: site.name });
  } catch (error) {
    console.error("[Draft-PublishWP] Error:", error.message);
    res.status(500).json({ error: error.response?.data?.message || error.message });
  }
});

// POST rewrite specific sections of a standalone draft
router.post("/drafts/:id/rewrite-sections", async (req, res) => {
  try {
    const draft = await storage.getByIdForUser("standalone-drafts", req.params.id, req.userId);
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const { sectionIndexes, targetWordCount, customInstructions } = req.body;
    if (!Array.isArray(sectionIndexes) || sectionIndexes.length === 0) {
      return res.status(400).json({ error: "sectionIndexes[] required" });
    }

    const html = draft.pipeline?.content?.html;
    if (!html) return res.status(400).json({ error: "Bài viết chưa có nội dung" });

    const keyword = draft.keyword;
    const outline = draft.pipeline?.outline || {};
    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    // Parse HTML thành sections bởi <h2>
    const parts = html.split(/(?=<h2[\s>])/i);
    const perSectionWords = Math.ceil((targetWordCount || 500) / Math.max(sectionIndexes.length, 1));

    // Viết lại từng section được chọn
    for (const idx of sectionIndexes) {
      if (idx < 0 || idx >= parts.length) continue;
      const part = parts[idx];
      const headingMatch = part.match(/<h2[^>]*>(.*?)<\/h2>/i);
      const isIntro = !headingMatch;
      const heading = headingMatch
        ? headingMatch[1].replace(/<[^>]*>/g, "").trim()
        : null;

      // Lấy text gốc để AI có ngữ cảnh viết lại
      const originalText = part.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);

      const prompt = isIntro
        ? `Bạn là copywriter SEO chuyên nghiệp. Hãy viết lại đoạn văn mở đầu dưới đây của bài "${outline.title || keyword}" sao cho HẤP DẪN, LÔI CUỐN và CHUYÊN SÂU hơn (khoảng ${perSectionWords} từ, tiếng Việt).
${customInstructions ? `Yêu cầu cụ thể: ${customInstructions}` : "Làm cho nó thu hút người đọc ngay từ câu đầu, tạo cảm giác tò mò, dẫn dắt tự nhiên vào bài."}
Keyword: "${keyword}"

Đoạn gốc (tham khảo để hiểu ngữ cảnh, KHÔNG copy lại):
"${originalText}"

⚠️ OUTPUT RULES:
- Chỉ viết nội dung HTML thuần: các thẻ <p>...</p>
- KHÔNG có <h2>, KHÔNG có tiêu đề, KHÔNG có label
- KHÔNG bắt đầu bằng "Tuyệt vời!", "Dưới đây là...", "Chắc chắn..." hay bất kỳ lời mào đầu nào
- Viết thẳng vào nội dung ngay câu đầu tiên`
        : `Bạn là copywriter SEO chuyên nghiệp. Hãy viết lại section "${heading}" dưới đây của bài "${outline.title || keyword}" sao cho CHẤT LƯỢNG HƠN (khoảng ${perSectionWords} từ, tiếng Việt).
${customInstructions ? `Yêu cầu cụ thể: ${customInstructions}` : "Viết sâu hơn, có dẫn chứng/số liệu cụ thể nếu phù hợp, ngôn ngữ tự nhiên hấp dẫn."}
Keyword: "${keyword}"

⚠️ OUTPUT RULES:
- Output HTML: bắt đầu bằng <h2>${heading}</h2> rồi các thẻ <p>...</p>
- KHÔNG có section khác, KHÔNG lặp lại heading
- KHÔNG bắt đầu bằng "Tuyệt vời!", "Dưới đây là...", "Chắc chắn..." hay bất kỳ lời mào đầu nào
- Viết thẳng vào nội dung ngay sau heading`;

      try {
        const rewritten = await aiService.generate(prompt, settings, { apiKeys });
        let newHtml = rewritten.trim();

        // Strip meta-commentary nếu AI vẫn sinh ra (phòng ngừa)
        newHtml = newHtml
          .replace(/^(tuyệt vời[!,.]?|chắc chắn[!,.]?|dưới đây là[^<\n]*[\n.!]?|được rồi[!,.]?|ok[!,.]?)/i, "")
          .trim();

        // Convert markdown → HTML nếu AI trả về markdown
        if (!newHtml.startsWith("<")) {
          // Xóa heading markdown nếu trùng
          newHtml = newHtml.replace(/^#{1,3} .+\n?/m, "").trim();
          if (isIntro) {
            newHtml = "<p>" + newHtml
              .replace(/### (.*)/g, "</p><h3>$1</h3><p>")
              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
              .replace(/\n\n/g, "</p><p>")
              .replace(/\n/g, "<br/>") + "</p>";
          } else {
            newHtml = `<h2>${heading}</h2><p>` + newHtml
              .replace(/### (.*)/g, "</p><h3>$1</h3><p>")
              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
              .replace(/\n\n/g, "</p><p>")
              .replace(/\n/g, "<br/>") + "</p>";
          }
        } else if (isIntro && newHtml.startsWith("<h2>")) {
          // Nếu intro lại có h2, bỏ h2 đầu đi
          newHtml = newHtml.replace(/^<h2[^>]*>.*?<\/h2>/i, "").trim();
        }

        parts[idx] = newHtml;
      } catch (e) {
        console.error(`[Rewrite-Section] idx=${idx} error:`, e.message);
      }
    }

    const newHtml = parts.join("");
    const wordCount = newHtml.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;

    const pipeline = draft.pipeline || {};
    await storage.update("standalone-drafts", req.params.id, {
      pipeline: { ...pipeline, content: { ...pipeline.content, html: newHtml, wordCount } },
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Rewrite-Section] Draft ${req.params.id}: rewrote sections [${sectionIndexes.join(",")}]`);
    res.json({ success: true, html: newHtml, wordCount, rewrittenSections: sectionIndexes.length });
  } catch (e) {
    console.error("[Rewrite-Section] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

