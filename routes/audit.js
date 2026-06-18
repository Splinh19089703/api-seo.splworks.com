const express = require("express");
const router = express.Router();
const storage = require("../services/storage");
const auditService = require("../services/audit-service");
const { featureGate } = require("../middleware/license-guard");
const { resolveApiKeys } = require("../services/api-key-pool");

// --- License: Gate entire audit module behind seoAudit feature ---
router.use(featureGate("seoAudit"));

// Track running crawls so we can abort them
const runningCrawls = new Map(); // auditId -> { abortController, startTime }

// GET all audits
router.get("/", async (req, res) => {
  try {
    const audits = await storage.getAllForUser("audits", req.userId);
    // Auto-fix stale 'running' audits (older than 15 minutes)
    const now = Date.now();
    for (const a of audits) {
      if (a.status === "running") {
        const age = now - new Date(a.updatedAt || a.createdAt).getTime();
        if (age > 15 * 60 * 1000) {
          // 15 minutes
          await storage.update("audits", a.id, {
            status: "failed",
            error: "Crawl timed out (quá 15 phút)",
          });
          a.status = "failed";
          runningCrawls.delete(a.id);
          console.log(`[Audit] Auto-marked stale audit ${a.domain} as failed`);
        }
      }
    }
    // Return list without full pages/issues data
    const list = audits.map((a) => ({
      id: a.id,
      domain: a.domain,
      score: a.score,
      totalPages: a.totalPages,
      duration: a.duration,
      stats: a.stats,
      categories: a.categories,
      status: a.status,
      createdAt: a.createdAt,
    }));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single audit detail
router.get("/:id", async (req, res) => {
  try {
    const audit = await storage.getByIdForUser("audits", req.params.id, req.userId);
    if (!audit) return res.status(404).json({ error: "Audit not found" });
    res.json(audit);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST start new audit
router.post("/", async (req, res) => {
  try {
    const { domain, maxPages } = req.body;
    if (!domain) return res.status(400).json({ error: "Domain is required" });

    // Check audit limit
    const allAudits = await storage.getAllForUser("audits", req.userId);
    const maxAudits = req.license?.limits?.maxAudits || 3;
    if (maxAudits < 999999 && allAudits.length >= maxAudits) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${maxAudits} lần audit (gói ${req.license?.plan || "hiện tại"}). Nâng cấp để audit thêm.`,
        code: "AUDIT_LIMIT",
        limit: maxAudits,
        used: allAudits.length,
        currentPlan: req.license?.plan,
        upgradeRequired: true,
      });
    }

    const crawlPages = maxPages || 200;

    // Create audit record first
    const audit = await storage.createForUser("audits", {
      domain,
      maxPages: crawlPages,
      score: 0,
      totalPages: 0,
      duration: 0,
      status: "running",
      stats: {},
      categories: {},
      pages: [],
      issues: [],
      issuesSummary: [],
    }, req.userId);

    // Return immediately, run audit in background
    res.status(201).json(audit);

    // Run audit async with timeout
    const maxTimeMs = Math.max(10 * 60 * 1000, crawlPages * 3000); // min 10 min, 3s per page
    const crawlTimeout = setTimeout(async () => {
      runningCrawls.delete(audit.id);
      await storage.update("audits", audit.id, {
        status: "failed",
        error: `Crawl timed out after ${Math.round(maxTimeMs / 60000)} minutes`,
      });
      console.log(
        `[Audit] Timeout for ${domain} after ${Math.round(maxTimeMs / 60000)} min`,
      );
    }, maxTimeMs);
    runningCrawls.set(audit.id, { startTime: Date.now() });

    try {
      const result = await auditService.auditSite(domain, {
        maxPages: crawlPages,
      });
      clearTimeout(crawlTimeout);
      runningCrawls.delete(audit.id);
      await storage.update("audits", audit.id, {
        ...result,
        status: "completed",
      });
      console.log(`[Audit] Completed for ${domain}: score ${result.score}`);
    } catch (error) {
      clearTimeout(crawlTimeout);
      runningCrawls.delete(audit.id);
      await storage.update("audits", audit.id, {
        status: "failed",
        error: error.message,
      });
      console.error(`[Audit] Failed for ${domain}:`, error.message);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST re-crawl audit
router.post("/:id/recrawl", async (req, res) => {
  try {
    const audit = await storage.getByIdForUser("audits", req.params.id, req.userId);
    if (!audit) return res.status(404).json({ error: "Audit not found" });

    // Force-stop if already running
    if (runningCrawls.has(audit.id)) {
      runningCrawls.delete(audit.id);
    }

    // Reset audit
    await storage.update("audits", audit.id, {
      score: 0,
      totalPages: 0,
      duration: 0,
      status: "running",
      stats: {},
      categories: {},
      pages: [],
      issues: [],
      issuesSummary: [],
    });

    res.json({ success: true, message: "Re-crawl started" });

    // Run audit async with timeout
    const crawlPages = req.body.maxPages || audit.maxPages || 200;
    const maxTimeMs = Math.max(10 * 60 * 1000, crawlPages * 3000);
    const crawlTimeout = setTimeout(async () => {
      runningCrawls.delete(audit.id);
      await storage.update("audits", audit.id, {
        status: "failed",
        error: `Re-crawl timed out after ${Math.round(maxTimeMs / 60000)} minutes`,
      });
    }, maxTimeMs);
    runningCrawls.set(audit.id, { startTime: Date.now() });

    try {
      const result = await auditService.auditSite(audit.domain, {
        maxPages: crawlPages,
      });
      clearTimeout(crawlTimeout);
      runningCrawls.delete(audit.id);
      await storage.update("audits", audit.id, {
        ...result,
        status: "completed",
      });
      console.log(
        `[Audit] Re-crawl completed for ${audit.domain}: score ${result.score}`,
      );
    } catch (error) {
      clearTimeout(crawlTimeout);
      runningCrawls.delete(audit.id);
      await storage.update("audits", audit.id, {
        status: "failed",
        error: error.message,
      });
      console.error(
        `[Audit] Re-crawl failed for ${audit.domain}:`,
        error.message,
      );
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE audit (always works, even for running audits)
router.delete("/:id", async (req, res) => {
  try {
    const audit = await storage.getByIdForUser("audits", req.params.id, req.userId);
    if (!audit) return res.status(404).json({ error: "Audit not found" });
    // Stop any running crawl for this audit
    if (runningCrawls.has(req.params.id)) {
      runningCrawls.delete(req.params.id);
    }
    await storage.delete("audits", req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error(`[Audit] Delete error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});
// POST AI analyze page issues
router.post("/:id/ai-analyze", async (req, res) => {
  try {
    const audit = await storage.getByIdForUser("audits", req.params.id, req.userId);
    if (!audit) return res.status(404).json({ error: "Audit not found" });

    const { pageUrl } = req.body;
    if (!pageUrl) return res.status(400).json({ error: "pageUrl is required" });

    const page = (audit.pages || []).find((p) => p.url === pageUrl);
    if (!page)
      return res.status(404).json({ error: "Page not found in audit" });

    const pageIssues = (audit.issues || []).filter((i) => i.url === pageUrl);

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    const issuesList = pageIssues
      .map((i) => `- [${i.severity.toUpperCase()}] ${i.type}: ${i.message}`)
      .join("\n");

    const prompt = `Bạn là chuyên gia SEO. Phân tích các vấn đề SEO của trang web sau và đưa ra đề xuất sửa cụ thể.

URL: ${page.url}
Title: ${page.title || "Không có"}
Meta Description: ${page.metaDescription || "Không có"}
H1: ${page.h1 || "Không có"}
Score: ${page.score}/100
Word Count: ${page.wordCount}
Internal Links: ${page.internalLinks || 0}
External Links: ${page.externalLinks || 0}
Schema: ${page.hasSchema ? "Có" : "Không"}
Text/HTML Ratio: ${page.textHtmlRatio || "N/A"}%

Các vấn đề phát hiện:
${issuesList || "Không có vấn đề"}

Trả lời bằng JSON array với format:
[
  {
    "type": "issue_type",
    "priority": "high|medium|low",
    "title": "Tên vấn đề ngắn gọn",
    "description": "Mô tả chi tiết vấn đề",
    "fix": "Hướng dẫn sửa cụ thể, chi tiết",
    "example": "Ví dụ code hoặc nội dung đề xuất (nếu có)"
  }
]

Chỉ trả JSON array, không thêm text nào khác. Ưu tiên các vấn đề nghiêm trọng lên đầu.`;

    const aiService = require("../services/ai-service");
    const result = await aiService.generate(prompt, settings, { apiKeys });

    // Parse JSON from AI response
    let fixes = [];
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        fixes = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[Audit AI] Failed to parse AI response:", e.message);
      fixes = [
        {
          type: "AI_RESPONSE",
          priority: "medium",
          title: "AI Response",
          description: result,
          fix: result,
          example: "",
        },
      ];
    }

    res.json({ fixes, raw: result });
  } catch (error) {
    console.error("[Audit AI] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST AI generate optimized meta for a page
router.post("/:id/ai-meta", async (req, res) => {
  try {
    const audit = await storage.getByIdForUser("audits", req.params.id, req.userId);
    if (!audit) return res.status(404).json({ error: "Audit not found" });

    const { pageUrl } = req.body;
    const page = (audit.pages || []).find((p) => p.url === pageUrl);
    if (!page) return res.status(404).json({ error: "Page not found" });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);

    const prompt = `Bạn là chuyên gia SEO. Viết lại Title và Meta Description tối ưu SEO cho trang web sau:

URL: ${page.url}
Title hiện tại: ${page.title || "Không có"}
Meta Description hiện tại: ${page.metaDescription || "Không có"}
H1: ${page.h1 || "Không có"}
Nội dung: ${page.wordCount || 0} từ

Yêu cầu:
- Title: 30-60 ký tự, chứa từ khóa chính, hấp dẫn click
- Meta Description: 120-160 ký tự, tóm tắt nội dung, chứa từ khóa, kêu gọi hành động

Trả lời bằng JSON:
{
  "title": "Title mới tối ưu",
  "titleLength": 50,
  "metaDescription": "Meta description mới tối ưu",
  "metaLength": 150,
  "keywords": ["keyword1", "keyword2"],
  "reasoning": "Giải thích ngắn gọn lý do chọn"
}

Chỉ trả JSON, không text khác.`;

    const aiService = require("../services/ai-service");
    const result = await aiService.generate(prompt, settings, { apiKeys });

    let meta = {};
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) meta = JSON.parse(jsonMatch[0]);
    } catch (e) {
      meta = { title: "", metaDescription: "", reasoning: result };
    }

    res.json(meta);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Project-scoped audits ─────────────────────────────────────────────────
// GET audits filtered by project domain
router.get("/by-project/:projectId", async (req, res) => {
  try {
    const project = await storage.getByIdForUser("projects", req.params.projectId, req.userId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const audits = await storage.getAllForUser("audits", req.userId);
    const domain = (project.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    const filtered = audits
      .filter((a) => {
        const ad = (a.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
        return ad === domain || ad.endsWith("." + domain) || domain.endsWith("." + ad);
      })
      .map((a) => ({
        id: a.id,
        domain: a.domain,
        score: a.score,
        totalPages: a.totalPages,
        stats: a.stats,
        categories: a.categories,
        status: a.status,
        createdAt: a.createdAt,
      }));

    res.json({ project, audits: filtered, domain });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Article Rewriter — fetch article content ──────────────────────────────
// POST /api/audit/fetch-article  { url, siteId? }
router.post("/fetch-article", async (req, res) => {
  try {
    const { url, siteId } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });

    let articleData = null;

    // Try WP REST API first if siteId provided
    if (siteId) {
      try {
        const site = await storage.getByIdForUser("wp-sites", siteId, req.userId);
        if (site) {
          const siteBase = (site.url || site.siteUrl).replace(/\/$/, "");
          // Extract slug from URL
          const urlObj = new URL(url);
          const slug = urlObj.pathname.replace(/\/$/, "").split("/").filter(Boolean).pop();

          const wpRes = await fetch(`${siteBase}/wp-json/wp/v2/posts?slug=${slug}&_fields=id,title,content,excerpt,status,date,categories,tags,meta`, {
            headers: {
              "Authorization": "Basic " + Buffer.from(`${site.username}:${site.appPassword}`).toString("base64"),
            },
            signal: AbortSignal.timeout(10000),
          });
          if (wpRes.ok) {
            const posts = await wpRes.json();
            if (posts.length > 0) {
              const post = posts[0];
              const rawContent = post.content?.rendered || "";
              // Parse HTML sections using cheerio
              const cheerio = require("cheerio");
              const $ = cheerio.load(rawContent);
              // Build sections by H2
              const sections = [];
              let currentSection = null;
              $('h2, h3, p, ul, ol, blockquote').each((i, el) => {
                const tag = el.tagName.toLowerCase();
                const text = $(el).text().trim();
                if (tag === 'h2') {
                  if (currentSection) sections.push(currentSection);
                  currentSection = { heading: text, content: '', html: $.html(el) };
                } else if (tag === 'h3' && currentSection) {
                  currentSection.content += '\n### ' + text + '\n';
                  currentSection.html += $.html(el);
                } else if (currentSection && text) {
                  currentSection.content += text + '\n';
                  currentSection.html += $.html(el);
                }
              });
              if (currentSection) sections.push(currentSection);

              const wordCount = $('body').text().split(/\s+/).filter(Boolean).length;

              articleData = {
                source: "wp-api",
                wpPostId: post.id,
                siteId,
                url,
                title: post.title?.rendered || "",
                content: rawContent,
                sections,
                wordCount,
                status: post.status,
                date: post.date,
              };
            }
          }
        }
      } catch (wpErr) {
        console.warn("[fetch-article] WP REST API failed:", wpErr.message);
      }
    }

    // Fallback: HTTP scrape
    if (!articleData) {
      try {
        const fetchRes = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (SPLSEO Bot)" },
          signal: AbortSignal.timeout(10000),
        });
        const html = await fetchRes.text();
        const cheerio = require("cheerio");
        const $ = cheerio.load(html);

        const title = ($('h1').first().text() || $('title').text() || url).trim();

        // Find main content area
        const contentSel = $('article').length ? 'article'
          : $('.entry-content').length ? '.entry-content'
          : $('.post-content').length ? '.post-content'
          : $('main').length ? 'main' : 'body';
        const $content = $(contentSel);

        // Build sections by H2
        const sections = [];
        let currentSection = null;
        $content.find('h2, h3, p, ul, ol, blockquote').each((i, el) => {
          const tag = el.tagName.toLowerCase();
          const text = $(el).text().trim();
          if (tag === 'h2') {
            if (currentSection) sections.push(currentSection);
            currentSection = { heading: text, content: '', html: $.html(el) };
          } else if (tag === 'h3' && currentSection) {
            currentSection.content += '\n### ' + text + '\n';
          } else if (currentSection && text) {
            currentSection.content += text + '\n';
          }
        });
        if (currentSection) sections.push(currentSection);

        const metaDesc = $('meta[name="description"]').attr('content') || '';
        const metaTitle = $('meta[property="og:title"]').attr('content') || title;
        const wordCount = $content.text().split(/\s+/).filter(Boolean).length;

        articleData = {
          source: "scrape",
          url,
          title,
          metaTitle,
          metaDescription: metaDesc,
          sections,
          wordCount,
          content: $content.html() || '',
        };
      } catch (scrapeErr) {
        return res.status(500).json({ error: "Không thể fetch bài viết: " + scrapeErr.message });
      }
    }

    res.json(articleData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function cleanRewriteHtml(output, { mode, heading }) {
  let html = String(output || "").trim();
  html = html
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^(tuyệt vời[!,.]?|chắc chắn[!,.]?|dưới đây là[^<\n]*[\n.!]?|được rồi[!,.]?|ok[!,.]?)/i, "")
    .trim();

  if (mode === "section" && !html.startsWith("<")) {
    html = html
      .replace(/^#{1,3}\s+.+\n?/m, "")
      .replace(/###\s+(.+)/g, "</p><h3>$1</h3><p>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n\n+/g, "</p><p>")
      .replace(/\n/g, "<br/>");
    html = heading ? `<h2>${heading}</h2><p>${html}</p>` : `<p>${html}</p>`;
  }

  return html;
}

function limitRewriteText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength
    ? `${text.slice(0, maxLength)}\n...[đã rút gọn để tránh lỗi quá tải AI]...`
    : text;
}

// ─── Article Rewriter — AI rewrite ────────────────────────────────────────
// POST /api/audit/rewrite-article  { content, mode: 'full'|'section', keyword?, customInstructions?, heading?, originalHtml? }
router.post("/rewrite-article", async (req, res) => {
  try {
    const {
      content,
      mode = "full",
      keyword = "",
      tone = "professional",
      customInstructions = "",
      heading = "",
      originalHtml = "",
    } = req.body;
    if (!content) return res.status(400).json({ error: "content is required" });

    const settings = await storage.getSettings();
    const apiKeys = await resolveApiKeys(req.userId, req.license);
    const aiService = require("../services/ai-service");
    const safeContent = mode === "section" ? limitRewriteText(content, 4000) : content.substring(0, 4000);
    const safeOriginalHtml = mode === "section" ? limitRewriteText(originalHtml || content, 6000) : "";
    const safeInstructions = limitRewriteText(customInstructions, 1000);

    const prompt = mode === "section"
      ? `Bạn là chuyên gia SEO content. Viết lại section sau bằng tiếng Việt có dấu, tự nhiên hơn, đúng ý người dùng hơn, và giữ định dạng trình bày.
${keyword ? `Từ khóa mục tiêu: ${keyword}` : ""}
${heading ? `Heading section: ${heading}` : ""}
Giọng văn: ${tone}
${safeInstructions ? `Yêu cầu riêng cho section này: ${safeInstructions}` : ""}

HTML gốc của section:
${safeOriginalHtml}

Nội dung text tham khảo:
${safeContent}

Yêu cầu bắt buộc:
- Trả về HTML fragment sạch, không bọc trong markdown/code fence.
- Nếu section gốc có H2 thì output bắt đầu bằng đúng một thẻ <h2>${heading || "..."}</h2>.
- Giữ cấu trúc trình bày hợp lý bằng <p>, <h3>, <ul>, <ol>, <li>, <strong>, <blockquote>, <table> nếu nội dung gốc có hoặc yêu cầu riêng cần.
- Không trả plain text dài một đoạn.
- Không thêm emoji, không giải thích thêm, không mở đầu bằng lời dẫn như "Dưới đây là".
- Tối ưu từ khóa tự nhiên, không nhồi nhét.
- Có thể thêm placeholder internal link dạng [LINK:anchor text] nếu phù hợp.`
      : `Bạn là chuyên gia SEO content. Viết lại toàn bộ bài viết sau để tối ưu SEO, E-E-A-T, và trải nghiệm đọc.
${keyword ? `Từ khóa mục tiêu: ${keyword}` : ""}
Giọng văn: ${tone}
${safeInstructions ? `Yêu cầu riêng: ${safeInstructions}` : ""}

Nội dung gốc:
${safeContent}

Yêu cầu:
- Giữ nguyên cấu trúc H2/H3
- Thêm intro paragraph hấp dẫn
- Mỗi section có ít nhất 100 từ
- Kết bài với CTA rõ ràng
- Tối ưu từ khóa tự nhiên (không nhồi nhét)
- Không thêm emoji
-- Trả về nội dung HTML đã viết lại`;

    const aiOutput = await aiService.generate(prompt, settings, { apiKeys });
    const rewritten = cleanRewriteHtml(aiOutput, { mode, heading });

    res.json({
      original: content,
      rewritten,
      mode,
      keyword,
      customInstructions,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Article Rewriter — push update to WP ─────────────────────────────────
// POST /api/audit/update-article  { siteId, wpPostId, title?, content }
router.post("/update-article", async (req, res) => {
  try {
    const { siteId, wpPostId, title, content } = req.body;
    if (!siteId || !wpPostId || !content) {
      return res.status(400).json({ error: "siteId, wpPostId, and content are required" });
    }

    const site = await storage.getByIdForUser("wp-sites", siteId, req.userId);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const siteBase = (site.url || site.siteUrl).replace(/\/$/, "");
    const body = { content };
    if (title) body.title = title;

    const wpRes = await fetch(`${siteBase}/wp-json/wp/v2/posts/${wpPostId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(`${site.username}:${site.appPassword}`).toString("base64"),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!wpRes.ok) {
      const err = await wpRes.text();
      return res.status(wpRes.status).json({ error: `WP API error: ${err}` });
    }

    const updated = await wpRes.json();
    res.json({ success: true, postId: updated.id, link: updated.link });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── E2: WP Categories ─────────────────────────────────────────────────────
// GET /api/audit/wp-categories/:siteId — fetch categories for filter dropdown
router.get("/wp-categories/:siteId", async (req, res) => {
  try {
    const site = await storage.getByIdForUser("wp-sites", req.params.siteId, req.userId);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const siteBase = (site.url || site.siteUrl).replace(/\/$/, "");
    const wpRes = await fetch(`${siteBase}/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc`, {
      headers: {
        "Authorization": "Basic " + Buffer.from(`${site.username}:${site.appPassword}`).toString("base64"),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!wpRes.ok) {
      return res.status(wpRes.status).json({ error: "WP API error" });
    }

    const cats = await wpRes.json();
    const list = cats.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      count: c.count,
      parent: c.parent,
    })).filter(c => c.count > 0); // Chỉ trả categories có bài

    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Browse WP Posts — list posts from connected WP site ───────────────────
// GET /api/audit/wp-posts/:siteId?page=1&per_page=20&search=&status=publish&categories=5
router.get("/wp-posts/:siteId", async (req, res) => {
  try {
    const site = await storage.getByIdForUser("wp-sites", req.params.siteId, req.userId);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const siteBase = (site.url || site.siteUrl).replace(/\/$/, "");
    const page = parseInt(req.query.page) || 1;
    const perPage = Math.min(parseInt(req.query.per_page) || 20, 100);
    const search = req.query.search || "";
    const status = req.query.status || "publish";
    const categories = req.query.categories || ""; // E2: Category filter

    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      status,
      _fields: "id,title,slug,status,date,modified,link,excerpt,categories,tags",
      orderby: "modified",
      order: "desc",
    });
    if (search) params.set("search", search);
    if (categories) params.set("categories", categories); // E2

    const wpRes = await fetch(`${siteBase}/wp-json/wp/v2/posts?${params}`, {
      headers: {
        "Authorization": "Basic " + Buffer.from(`${site.username}:${site.appPassword}`).toString("base64"),
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!wpRes.ok) {
      const err = await wpRes.text();
      return res.status(wpRes.status).json({ error: `WP API error: ${err}` });
    }

    const posts = await wpRes.json();
    const total = parseInt(wpRes.headers.get("X-WP-Total")) || posts.length;
    const totalPages = parseInt(wpRes.headers.get("X-WP-TotalPages")) || 1;

    // Sanitize posts for frontend
    const list = posts.map((p) => ({
      id: p.id,
      title: p.title?.rendered || "",
      slug: p.slug,
      status: p.status,
      date: p.date,
      modified: p.modified,
      link: p.link,
      excerpt: (p.excerpt?.rendered || "").replace(/<[^>]+>/g, "").trim().substring(0, 200),
      categories: p.categories || [],
      tags: p.tags || [],
    }));

    res.json({ posts: list, total, totalPages, page, perPage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/audit/wp-posts/:siteId/:postId — fetch single post with parsed sections
router.get("/wp-posts/:siteId/:postId", async (req, res) => {
  try {
    const site = await storage.getByIdForUser("wp-sites", req.params.siteId, req.userId);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const siteBase = (site.url || site.siteUrl).replace(/\/$/, "");

    const wpRes = await fetch(
      `${siteBase}/wp-json/wp/v2/posts/${req.params.postId}?_fields=id,title,content,excerpt,status,date,modified,link,categories,tags,meta`,
      {
        headers: {
          "Authorization": "Basic " + Buffer.from(`${site.username}:${site.appPassword}`).toString("base64"),
        },
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!wpRes.ok) {
      const err = await wpRes.text();
      return res.status(wpRes.status).json({ error: `WP API error: ${err}` });
    }

    const post = await wpRes.json();
    const rawContent = post.content?.rendered || "";

    // Parse HTML sections using cheerio
    const cheerio = require("cheerio");
    const $ = cheerio.load(rawContent);

    // Build sections by H2
    const sections = [];
    let currentSection = null;
    $("h2, h3, p, ul, ol, blockquote, table, figure").each((i, el) => {
      const tag = el.tagName.toLowerCase();
      const text = $(el).text().trim();
      const html = $.html(el);
      if (tag === "h2") {
        if (currentSection) sections.push(currentSection);
        currentSection = { heading: text, content: "", html };
      } else if (tag === "h3" && currentSection) {
        currentSection.content += "\n### " + text + "\n";
        currentSection.html += html;
      } else if (currentSection && text) {
        currentSection.content += text + "\n";
        currentSection.html += html;
      }
    });
    if (currentSection) sections.push(currentSection);

    const wordCount = $("body").text().split(/\s+/).filter(Boolean).length;

    res.json({
      source: "wp-api",
      wpPostId: post.id,
      siteId: req.params.siteId,
      url: post.link,
      title: post.title?.rendered || "",
      content: rawContent,
      sections,
      wordCount,
      status: post.status,
      date: post.date,
      modified: post.modified,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REWRITE HISTORY (D1) ====================

/**
 * POST /api/audit/rewrite-history — Save a new rewrite record
 */
router.post("/rewrite-history", async (req, res) => {
  try {
    const {
      projectId, wpPostId, wpPostTitle, wpPostUrl,
      originalContent, rewrittenContent, rewriteMode,
      sectionsChanged, keyword, tone,
      wordCountBefore, wordCountAfter, changePercentage,
      usedProvider,
    } = req.body;

    if (!projectId || !wpPostId) {
      return res.status(400).json({ error: "projectId và wpPostId là bắt buộc" });
    }

    const project = await storage.getByIdForUser("projects", projectId, req.userId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const record = await storage.createForUser("rewrite-history", {
      projectId,
      wpPostId,
      wpPostTitle: wpPostTitle || "",
      wpPostUrl: wpPostUrl || "",
      originalContent: originalContent || "",
      rewrittenContent: rewrittenContent || "",
      rewriteMode: rewriteMode || "full",
      sectionsChanged: sectionsChanged || [],
      keyword: keyword || "",
      tone: tone || "professional",
      wordCountBefore: wordCountBefore || 0,
      wordCountAfter: wordCountAfter || 0,
      changePercentage: changePercentage || 0,
      usedProvider: usedProvider || "",
      status: "draft",
      pushedAt: null,
      scheduledAt: null,
    }, req.userId);

    res.json(record);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/audit/rewrite-history/:projectId — List rewrites for a project (paginated)
 * Query params: ?limit=20&offset=0&lightweight=true
 */
router.get("/rewrite-history/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const lightweight = req.query.lightweight === "true";

    const project = await storage.getByIdForUser("projects", projectId, req.userId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const items = await storage.getByFilter(
      "rewrite-history",
      { projectId },
      { limit, offset, lightweight }
    );
    const total = await storage.countByFilter("rewrite-history", { projectId });

    res.json({ items, total, limit, offset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/audit/rewrite-history/detail/:id — Get full detail of one rewrite
 */
router.get("/rewrite-history/detail/:id", async (req, res) => {
  try {
    const record = await storage.getByIdForUser("rewrite-history", req.params.id, req.userId);
    if (!record) return res.status(404).json({ error: "Không tìm thấy bản rewrite" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/audit/rewrite-history/:id/status — Update rewrite status
 * Body: { status: "draft" | "pushed" | "scheduled", pushedAt, scheduledAt }
 */
router.put("/rewrite-history/:id/status", async (req, res) => {
  try {
    const { status, pushedAt, scheduledAt } = req.body;
    if (!["draft", "pushed", "scheduled"].includes(status)) {
      return res.status(400).json({ error: "Status không hợp lệ" });
    }

    const updateData = { status };
    if (status === "pushed") updateData.pushedAt = pushedAt || new Date().toISOString();
    if (status === "scheduled") updateData.scheduledAt = scheduledAt || null;
    if (status === "draft") { updateData.pushedAt = null; updateData.scheduledAt = null; }

    const existing = await storage.getByIdForUser("rewrite-history", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "KhÃ´ng tÃ¬m tháº¥y báº£n rewrite" });
    const updated = await storage.update("rewrite-history", req.params.id, updateData);
    if (!updated) return res.status(404).json({ error: "Không tìm thấy bản rewrite" });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/audit/rewrite-history/:id — Delete a rewrite record
 */
router.delete("/rewrite-history/:id", async (req, res) => {
  try {
    const existing = await storage.getByIdForUser("rewrite-history", req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "KhÃ´ng tÃ¬m tháº¥y" });
    const deleted = await storage.delete("rewrite-history", req.params.id);
    if (!deleted) return res.status(404).json({ error: "Không tìm thấy" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/audit/rewrite-status-batch — Check rewrite status for multiple WP post IDs
 * Body: { projectId, wpPostIds: [123, 456, 789] }
 * Returns: { [wpPostId]: { status, rewriteCount, latestAt } }
 */
router.post("/rewrite-status-batch", async (req, res) => {
  try {
    const { projectId, wpPostIds } = req.body;
    if (!projectId || !Array.isArray(wpPostIds)) {
      return res.status(400).json({ error: "projectId và wpPostIds[] là bắt buộc" });
    }

    // Query all rewrites for this project (lightweight, no content)
    const allRewrites = await storage.getByFilter(
      "rewrite-history",
      { projectId },
      { limit: 9999, lightweight: true }
    );

    // Group by wpPostId
    const statusMap = {};
    for (const postId of wpPostIds) {
      const postRewrites = allRewrites.filter(r => r.wpPostId === postId);
      if (postRewrites.length === 0) {
        statusMap[postId] = { status: "none", rewriteCount: 0, latestAt: null };
      } else {
        // Latest rewrite determines status
        const latest = postRewrites[0]; // Already sorted DESC by createdAt
        statusMap[postId] = {
          status: latest.status || "draft",
          rewriteCount: postRewrites.length,
          latestAt: latest.createdAt,
          latestId: latest.id,
          rewriteMode: latest.rewriteMode,
        };
      }
    }

    res.json(statusMap);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
