const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const https = require("https");

// SSL bypass agent for sites with self-signed or expired certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Reuse existing scraper modules
const Crawler = require(
  path.join(__dirname, "..", "..", "..", "scraper", "src", "crawler"),
);
const Analyzer = require(
  path.join(__dirname, "..", "..", "..", "scraper", "src", "analyzer"),
);

const crawler = new Crawler();
const analyzer = new Analyzer();

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

class AuditService {
  /**
   * Crawl a full site and generate SEO audit
   */
  async auditSite(domain, options = {}) {
    const maxPages = options.maxPages || 200;
    const startTime = Date.now();
    const baseDomain = this._extractDomain(domain);

    // Step 1: Discover ALL URLs (sitemap + spider)
    console.log(`[Audit] Phase 1: Discovering URLs for ${domain}...`);
    const discoveredUrls = await this._discoverAllUrls(domain, maxPages);
    console.log(
      `[Audit] Found ${discoveredUrls.size} unique URLs from sitemaps`,
    );

    // Step 2: Crawl each page with raw HTML + response time + spider
    console.log(`[Audit] Phase 2: Crawling pages...`);
    const pages = [];
    let issues = [];
    const urlQueue = [...discoveredUrls];
    const queuedSet = new Set(discoveredUrls); // fast lookup for spider
    const crawledSet = new Set();
    const incomingLinks = {}; // url -> Set of pages linking to it

    // Crawl with spider: discover new URLs from internal links
    const BATCH_SIZE = Math.min(20, Math.max(5, Math.floor(maxPages / 10))); // 5-20 concurrent
    while (crawledSet.size < maxPages && urlQueue.length > 0) {
      // Crawl in batches for speed
      const batch = [];
      while (
        batch.length < BATCH_SIZE &&
        urlQueue.length > 0 &&
        crawledSet.size + batch.length < maxPages
      ) {
        const url = urlQueue.shift();
        if (crawledSet.has(url)) continue;
        if (!url.includes(baseDomain)) continue;
        crawledSet.add(url);
        batch.push(url);
      }

      if (batch.length === 0) break;

      console.log(
        `[Audit]   Crawling batch: ${crawledSet.size}/${maxPages} pages (${urlQueue.length} in queue)`,
      );

      const results = await Promise.allSettled(
        batch.map((url) => this._crawlPage(url)),
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const url = batch[i];

        if (result.status === "rejected" || !result.value) {
          pages.push({
            url,
            title: "Error",
            score: 0,
            httpStatus: 0,
            wordCount: 0,
            error: result.reason?.message || "Crawl failed",
          });
          continue;
        }

        const pageData = result.value;
        pages.push(pageData.pageResult);

        // Track incoming links (for orphan detection)
        for (const link of pageData.internalLinks) {
          if (!incomingLinks[link]) incomingLinks[link] = new Set();
          incomingLinks[link].add(url);
        }

        // Spider: add new internal links to queue
        for (const link of pageData.internalLinks) {
          if (
            !crawledSet.has(link) &&
            !queuedSet.has(link) &&
            link.includes(baseDomain)
          ) {
            urlQueue.push(link);
            queuedSet.add(link);
          }
        }

        // Collect per-page issues
        issues.push(...pageData.issues);
      }

      if (crawledSet.size % 20 === 0) {
        console.log(
          `[Audit] Crawled ${crawledSet.size}/${maxPages} pages (queue: ${urlQueue.length})...`,
        );
      }
    }

    // Step 3: Cross-page analysis
    console.log(
      `[Audit] Phase 3: Cross-page analysis on ${pages.length} pages...`,
    );
    try {
      const crossIssues = this._crossPageAnalysis(
        pages,
        incomingLinks,
        baseDomain,
      );
      issues = issues.concat(crossIssues);
    } catch (crossErr) {
      console.error(`[Audit] Cross-page analysis error: ${crossErr.message}`);
    }

    // Calculate results
    const duration = Math.round((Date.now() - startTime) / 1000);
    const validPages = pages.filter(
      (p) => typeof p.score === "number" && !isNaN(p.score) && p.score > 0,
    );
    const avgScore =
      validPages.length > 0
        ? Math.round(
            validPages.reduce((sum, p) => sum + p.score, 0) / validPages.length,
          )
        : 0;

    const categories = this._calculateCategories(issues);
    const issuesSummary = this._categorizeIssues(issues);

    // Calculate orphan count and schema count
    const orphanPages = pages.filter((p) => {
      const incoming = incomingLinks[p.url];
      return !incoming || incoming.size === 0;
    }).length;
    const schemaPages = pages.filter((p) => p.hasSchema).length;
    const avgResponseTime =
      pages.length > 0
        ? Math.round(
            pages.reduce((s, p) => s + (p.responseTime || 0), 0) / pages.length,
          )
        : 0;

    return {
      domain,
      score: avgScore,
      totalPages: pages.length,
      duration,
      pages,
      issues,
      issuesSummary,
      categories,
      stats: {
        totalCrawled: pages.length,
        critical: issues.filter((i) => i.severity === "critical").length,
        warning: issues.filter((i) => i.severity === "warning").length,
        info: issues.filter((i) => i.severity === "info").length,
        passed: 0,
        avgResponseTime,
        errors4xx: pages.filter(
          (p) => p.httpStatus >= 400 && p.httpStatus < 500,
        ).length,
        orphanPages,
        hasSchema: schemaPages,
      },
    };
  }

  /**
   * Discover ALL URLs from sitemaps (all sub-sitemaps, not just first)
   */
  async _discoverAllUrls(domain, maxUrls) {
    const urls = new Set();
    let baseUrl = domain;
    if (!baseUrl.startsWith("http")) baseUrl = `https://${baseUrl}`;

    const sitemapPaths = [
      "/sitemap_index.xml",
      "/sitemap.xml",
      "/wp-sitemap.xml",
      "/wp-sitemap-posts-post-1.xml",
      "/wp-sitemap-posts-page-1.xml",
      "/wp-sitemap-posts-product-1.xml",
      "/post-sitemap.xml",
      "/page-sitemap.xml",
      "/product-sitemap.xml",
    ];

    // Try each sitemap path
    for (const sitemapPath of sitemapPaths) {
      if (urls.size >= maxUrls) break;
      try {
        const sitemapUrl = new URL(sitemapPath, baseUrl).href;
        console.log(`[Audit]   Trying sitemap: ${sitemapUrl}`);
        const resp = await axios.get(sitemapUrl, {
          headers: HEADERS,
          timeout: 30000,
          httpsAgent,
          maxContentLength: 10 * 1024 * 1024, // 10MB max sitemap
        });
        const $ = cheerio.load(resp.data, { xmlMode: true });

        // If sitemap index → fetch ALL sub-sitemaps
        const subSitemaps = [];
        $("sitemap > loc, sitemapindex > sitemap > loc").each((_, el) => {
          subSitemaps.push($(el).text().trim());
        });

        if (subSitemaps.length > 0) {
          console.log(
            `[Audit] Found sitemap index with ${subSitemaps.length} sub-sitemaps`,
          );
          for (const subUrl of subSitemaps) {
            if (urls.size >= maxUrls) break;
            try {
              const subResp = await axios.get(subUrl, {
                headers: HEADERS,
                timeout: 30000,
                httpsAgent,
                maxContentLength: 10 * 1024 * 1024,
              });
              const $sub = cheerio.load(subResp.data, { xmlMode: true });
              $sub("url > loc").each((_, el) => {
                if (urls.size >= maxUrls) return false;
                const loc = $sub(el).text().trim();
                if (loc && !loc.endsWith(".xml")) urls.add(loc);
              });
              console.log(
                `[Audit]   Sub-sitemap ${subUrl.split("/").pop()}: ${urls.size} total URLs`,
              );
            } catch (e) {
              /* skip sub-sitemap */
            }
          }
        }

        // Direct URLs in this sitemap
        $("url > loc").each((_, el) => {
          if (urls.size >= maxUrls) return false;
          const loc = $(el).text().trim();
          if (loc && !loc.endsWith(".xml")) urls.add(loc);
        });
      } catch (e) {
        console.log(`[Audit]   Sitemap ${sitemapPath} failed: ${e.message}`);
        /* try next sitemap path */
      }
    }

    // Always include the homepage
    urls.add(baseUrl.replace(/\/$/, "") + "/");

    return urls;
  }

  /**
   * Crawl a single page with raw HTML, response time, and issue detection
   */
  async _crawlPage(url) {
    const startTime = Date.now();
    let httpStatus = 0;
    let rawHtml = "";
    let responseTime = 0;

    try {
      const response = await axios.get(url, {
        headers: HEADERS,
        timeout: 30000,
        maxRedirects: 5,
        httpsAgent,
        maxContentLength: 5 * 1024 * 1024, // 5MB max page
        validateStatus: () => true, // Accept all HTTP statuses
      });

      httpStatus = response.status;
      responseTime = Date.now() - startTime;
      rawHtml = response.data || "";

      if (httpStatus >= 400) {
        return {
          pageResult: {
            url,
            title: "",
            score: 0,
            httpStatus,
            wordCount: 0,
            responseTime,
          },
          internalLinks: [],
          issues: [
            {
              type: "HTTP_4XX_ERROR",
              severity: "critical",
              category: "technical",
              url,
              message: `Trang trả về lỗi ${httpStatus}`,
            },
          ],
        };
      }
    } catch (error) {
      return null;
    }

    const $raw = cheerio.load(rawHtml);
    const $ = cheerio.load(rawHtml);

    // Extract technical data BEFORE removing elements
    const canonical = $raw('link[rel="canonical"]').attr("href") || "";
    const ogTitle = $raw('meta[property="og:title"]').attr("content") || "";
    const ogDesc =
      $raw('meta[property="og:description"]').attr("content") || "";
    const ogImage = $raw('meta[property="og:image"]').attr("content") || "";
    const twitterCard = $raw('meta[name="twitter:card"]').attr("content") || "";
    const htmlLength = rawHtml.length;
    const robots = $raw('meta[name="robots"]').attr("content") || "";

    // Check for schema/structured data
    const schemaScripts = [];
    $raw('script[type="application/ld+json"]').each((_, el) => {
      try {
        schemaScripts.push(JSON.parse($raw(el).html()));
      } catch (e) {
        /* invalid JSON */
      }
    });
    const hasSchema = schemaScripts.length > 0;

    // Check for mixed content (HTTP resources on HTTPS page)
    const mixedContentResources = [];
    if (url.startsWith("https")) {
      $raw(
        "img[src^='http:'], script[src^='http:'], link[href^='http:'], iframe[src^='http:']",
      ).each((_, el) => {
        mixedContentResources.push(
          $raw(el).attr("src") || $raw(el).attr("href"),
        );
      });
    }

    // Extract ALL internal links from the entire page (for spider + orphan detection)
    const baseDomain = this._extractDomain(url);
    const allInternalLinks = new Set();
    $raw("a[href]").each((_, el) => {
      const href = $raw(el).attr("href") || "";
      try {
        const resolved = new URL(href, url).href;
        if (
          resolved.includes(baseDomain) &&
          !resolved.includes("#") &&
          !resolved.match(/\.(jpg|jpeg|png|gif|pdf|zip|css|js)$/i)
        ) {
          allInternalLinks.add(resolved.split("?")[0].split("#")[0]);
        }
      } catch (e) {
        /* invalid URL */
      }
    });

    // Now use Crawler's analysis (removes nav/footer/etc internally)
    $(
      "script, style, nav, footer, aside, .sidebar, .ads, .advertisement, .comment, .comments, #comments, .social-share, .related-posts",
    ).remove();

    const title = $raw("title").text().trim();
    const h1Text = $("h1").first().text().trim();
    const metaDescription =
      $raw('meta[name="description"]').attr("content") ||
      $raw('meta[property="og:description"]').attr("content") ||
      "";

    // Extract headings
    const headings = [];
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const tag = $(el).prop("tagName")?.toLowerCase();
      const text = $(el).text().trim();
      if (text && text.length > 2) headings.push({ tag, text });
    });

    // Extract content
    const contentText = $("body").text().replace(/\s+/g, " ").trim();
    const wordCount = contentText
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    const textLength = contentText.length;
    const textHtmlRatio =
      htmlLength > 0 ? Math.round((textLength / htmlLength) * 100) : 0;

    // Extract images
    const images = [];
    $("img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      const alt = $(el).attr("alt") || "";
      if (src && !src.includes("data:image/svg")) images.push({ src, alt });
    });

    // Content links (inside article/main)
    const articleLinks = { internal: [], external: [] };
    $("article a, .entry-content a, .post-content a, main a, .content a").each(
      (_, el) => {
        const href = $(el).attr("href") || "";
        if (href && href.startsWith("http")) {
          if (href.includes(baseDomain)) articleLinks.internal.push(href);
          else articleLinks.external.push(href);
        }
      },
    );

    // Content hash for duplicate detection
    const contentForHash = contentText
      .substring(0, 3000)
      .toLowerCase()
      .replace(/\s+/g, " ");
    const contentHash = crypto
      .createHash("md5")
      .update(contentForHash)
      .digest("hex");

    // Simple content fingerprint (top 50 words) for near-duplicate
    const words = contentForHash.split(" ").filter((w) => w.length > 3);
    const wordFreq = {};
    words.forEach((w) => {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    });
    const topWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([w]) => w);
    const fingerprint = topWords.join(",");

    // Check for product page indicators
    const isProductPage =
      rawHtml.includes("woocommerce") ||
      rawHtml.includes("product_meta") ||
      rawHtml.includes("add-to-cart") ||
      rawHtml.includes("product-price") ||
      url.includes("/product/") ||
      url.includes("/san-pham/");
    const hasProductSchema = schemaScripts.some(
      (s) =>
        s["@type"] === "Product" ||
        (Array.isArray(s["@graph"]) &&
          s["@graph"].some((g) => g["@type"] === "Product")),
    );

    // Calculate page score (simplified)
    let pageScore = 0;
    if (title) pageScore += 10;
    if (metaDescription && metaDescription.length >= 50) pageScore += 10;
    if (headings.filter((h) => h.tag === "h1").length === 1) pageScore += 10;
    if (wordCount >= 300) pageScore += 15;
    if (wordCount >= 1000) pageScore += 10;
    if (images.length >= 1) pageScore += 5;
    if (images.every((img) => img.alt && img.alt.trim())) pageScore += 10;
    if (articleLinks.internal.length >= 3) pageScore += 10;
    if (articleLinks.external.length >= 1) pageScore += 5;
    if (hasSchema) pageScore += 10;
    if (responseTime < 2000) pageScore += 5;

    const pageResult = {
      url,
      title,
      h1: h1Text,
      score: pageScore,
      httpStatus,
      wordCount,
      responseTime,
      textHtmlRatio,
      internalLinks: articleLinks.internal.length,
      externalLinks: articleLinks.external.length,
      headings,
      metaDescription,
      images,
      depth: 1,
      hasSchema,
      canonical,
      contentHash,
      fingerprint,
      isProductPage,
      hasProductSchema,
      // Extra data for URL detail popup
      ogTitle,
      ogDesc,
      ogImage,
      robots,
      schemaTypes: schemaScripts.map(
        (s) =>
          s["@type"] ||
          (Array.isArray(s["@graph"])
            ? s["@graph"].map((g) => g["@type"]).join(", ")
            : "Unknown"),
      ),
      htmlSize: htmlLength,
      totalImages: images.length,
      imagesWithoutAlt: images.filter((img) => !img.alt || !img.alt.trim())
        .length,
    };

    // Per-page issue detection
    const issues = this._detectPageIssues(pageResult, url, {
      ogTitle,
      ogDesc,
      ogImage,
      twitterCard,
      schemaScripts,
      mixedContentResources,
      allLinks: [...allInternalLinks],
      headingsList: headings,
      textHtmlRatio,
      contentText,
      rawHtml,
    });

    return {
      pageResult,
      internalLinks: [...allInternalLinks],
      issues,
    };
  }

  /**
   * Detect per-page SEO issues (25+ types)
   */
  _detectPageIssues(page, url, extra) {
    const issues = [];

    // === ON-PAGE SEO ===
    if (!page.title) {
      issues.push({
        type: "MISSING_TITLE",
        severity: "critical",
        category: "on-page",
        url,
        message: "Trang thiếu thẻ <title>",
      });
    } else if (page.title.length > 60) {
      issues.push({
        type: "TITLE_TOO_LONG",
        severity: "warning",
        category: "on-page",
        url,
        message: `Title quá dài (${page.title.length} ký tự, nên ≤60)`,
      });
    } else if (page.title.length < 30) {
      issues.push({
        type: "TITLE_TOO_SHORT",
        severity: "warning",
        category: "on-page",
        url,
        message: `Title quá ngắn (${page.title.length} ký tự, nên ≥30)`,
      });
    }

    if (!page.metaDescription) {
      issues.push({
        type: "MISSING_META_DESC",
        severity: "critical",
        category: "on-page",
        url,
        message: "Trang thiếu meta description",
      });
    } else if (page.metaDescription.length > 160) {
      issues.push({
        type: "META_DESC_TOO_LONG",
        severity: "warning",
        category: "on-page",
        url,
        message: `Meta description quá dài (${page.metaDescription.length} ký tự, nên ≤160)`,
      });
    } else if (page.metaDescription.length < 70) {
      issues.push({
        type: "META_DESC_TOO_SHORT",
        severity: "warning",
        category: "on-page",
        url,
        message: `Meta description quá ngắn (${page.metaDescription.length} ký tự, nên ≥70)`,
      });
    }

    const h1s = (page.headings || []).filter((h) => h.tag === "h1");
    if (h1s.length === 0) {
      issues.push({
        type: "MISSING_H1",
        severity: "critical",
        category: "on-page",
        url,
        message: "Trang thiếu thẻ H1",
      });
    }
    if (h1s.length > 1) {
      issues.push({
        type: "MULTIPLE_H1",
        severity: "warning",
        category: "on-page",
        url,
        message: `Trang có ${h1s.length} thẻ H1 (nên chỉ có 1)`,
      });
    }

    // Heading hierarchy check
    const headingLevels = (page.headings || [])
      .map((h) => parseInt(h.tag?.replace("h", "") || "0"))
      .filter((n) => n > 0);
    for (let i = 1; i < headingLevels.length; i++) {
      if (headingLevels[i] - headingLevels[i - 1] > 1) {
        issues.push({
          type: "HEADING_SKIP_LEVEL",
          severity: "warning",
          category: "on-page",
          url,
          message: `Heading nhảy cấp: H${headingLevels[i - 1]} → H${headingLevels[i]}`,
        });
        break;
      }
    }

    // === TECHNICAL SEO ===
    if (page.httpStatus >= 400) {
      issues.push({
        type: "HTTP_4XX_ERROR",
        severity: "critical",
        category: "technical",
        url,
        message: `Trang trả về lỗi HTTP ${page.httpStatus}`,
      });
    }

    if (
      page.canonical &&
      page.canonical !== url &&
      page.canonical !== url.replace(/\/$/, "") &&
      url !== page.canonical.replace(/\/$/, "")
    ) {
      issues.push({
        type: "CANONICAL_MISMATCH",
        severity: "critical",
        category: "technical",
        url,
        message: `Canonical URL khác URL thực tế: ${page.canonical}`,
      });
    }

    if (extra.mixedContentResources && extra.mixedContentResources.length > 0) {
      issues.push({
        type: "MIXED_CONTENT_RESOURCES",
        severity: "critical",
        category: "technical",
        url,
        message: `Trang HTTPS tải ${extra.mixedContentResources.length} resource qua HTTP`,
      });
    }

    // === CONTENT QUALITY ===
    if (page.wordCount < 300) {
      issues.push({
        type: "THIN_CONTENT",
        severity: "critical",
        category: "content",
        url,
        message: `Nội dung quá mỏng (${page.wordCount} từ, dưới 300 từ)`,
      });
    }

    if (extra.textHtmlRatio < 10) {
      issues.push({
        type: "LOW_TEXT_HTML_RATIO",
        severity: "warning",
        category: "content",
        url,
        message: `Tỷ lệ text/HTML quá thấp (${extra.textHtmlRatio}%, nên ≥10%)`,
      });
    }

    // Image alt text
    if (page.images && page.images.length > 0) {
      const noAlt = page.images.filter(
        (img) => !img.alt || img.alt.trim() === "",
      );
      if (noAlt.length > 0) {
        issues.push({
          type: "MISSING_IMG_ALT",
          severity: "warning",
          category: "content",
          url,
          message: `${noAlt.length}/${page.images.length} ảnh thiếu alt text`,
        });
      }
    }

    // === LINKS ===
    if (page.internalLinks === 0) {
      issues.push({
        type: "NO_INTERNAL_LINKS",
        severity: "warning",
        category: "links",
        url,
        message: "Trang không có internal links",
      });
    }

    if (page.externalLinks === 0 && page.wordCount > 300) {
      issues.push({
        type: "NO_EXTERNAL_LINKS",
        severity: "info",
        category: "links",
        url,
        message: "Trang không có external links",
      });
    }

    const totalLinks = page.internalLinks + page.externalLinks;
    if (totalLinks > 100) {
      issues.push({
        type: "TOO_MANY_LINKS",
        severity: "warning",
        category: "links",
        url,
        message: `Trang có quá nhiều links (${totalLinks}, nên ≤100)`,
      });
    }

    // === SPEED ===
    if (page.responseTime > 3000) {
      issues.push({
        type: "SLOW_RESPONSE",
        severity: "warning",
        category: "speed",
        url,
        message: `Thời gian phản hồi chậm (${Math.round(page.responseTime / 1000)}s, nên <3s)`,
      });
    }

    // === SCHEMA ===
    if (!page.hasSchema) {
      issues.push({
        type: "NO_SCHEMA",
        severity: "info",
        category: "schema",
        url,
        message: "Trang không có Structured Data (JSON-LD)",
      });
    }

    if (page.isProductPage && !page.hasProductSchema) {
      issues.push({
        type: "PRODUCT_NO_SCHEMA",
        severity: "critical",
        category: "schema",
        url,
        message: "Trang sản phẩm thiếu Product Schema",
      });
    }

    // === SOCIAL / SEO META ===
    if (!extra.ogTitle && !extra.ogDesc) {
      issues.push({
        type: "NO_OPEN_GRAPH",
        severity: "info",
        category: "on-page",
        url,
        message: "Thiếu Open Graph tags (og:title, og:description)",
      });
    }

    if (!extra.twitterCard) {
      issues.push({
        type: "NO_TWITTER_CARD",
        severity: "info",
        category: "on-page",
        url,
        message: "Thiếu Twitter Card meta tags",
      });
    }
    // === CONTENT QUALITY (from travel-blogging-skill) ===

    // Banned/filler words check
    const bannedWords = [
      "tuyệt vời", "tuyệt đẹp", "không thể bỏ qua", "đáng để trải nghiệm",
      "hấp dẫn du khách", "thiên đường", "bỏ túi ngay", "hot nhất",
      "cực kỳ", "vô cùng", "siêu đẹp", "đỉnh cao",
    ];
    if (extra.contentText && page.wordCount > 300) {
      const textLower = extra.contentText.toLowerCase();
      const foundBanned = bannedWords.filter((w) => textLower.includes(w));
      if (foundBanned.length >= 3) {
        issues.push({
          type: "FILLER_WORDS",
          severity: "warning",
          category: "content",
          url,
          message: `Nội dung chứa ${foundBanned.length} từ sáo rỗng/filler (${foundBanned.slice(0, 3).join(", ")}...)`,
        });
      }
    }

    // Long paragraphs check (via raw HTML)
    if (extra.rawHtml && page.wordCount > 300) {
      const $content = cheerio.load(extra.rawHtml);
      const longParas = [];
      $content("p").each((_, el) => {
        const text = $content(el).text().trim();
        const words = text.split(/\s+/).filter(Boolean).length;
        if (words > 150) longParas.push(words);
      });
      if (longParas.length > 0) {
        issues.push({
          type: "LONG_PARAGRAPHS",
          severity: "warning",
          category: "content",
          url,
          message: `${longParas.length} đoạn văn quá dài (>${150} từ), nên ≤80 từ/đoạn`,
        });
      }

      // Missing lists check
      const hasList = $content("ul, ol").length > 0;
      if (!hasList && page.wordCount > 500) {
        issues.push({
          type: "NO_LISTS",
          severity: "info",
          category: "content",
          url,
          message: "Nội dung không có danh sách (ul/ol), nên dùng bullet points để dễ đọc",
        });
      }

      // Missing emphasis/bold
      const hasEmphasis = $content("strong, b, em").length > 0;
      if (!hasEmphasis && page.wordCount > 500) {
        issues.push({
          type: "NO_EMPHASIS",
          severity: "info",
          category: "content",
          url,
          message: "Nội dung không có text in đậm (strong/b), nên highlight từ khóa quan trọng",
        });
      }

      // No images in content area
      if (page.images.length === 0 && page.wordCount > 500) {
        issues.push({
          type: "NO_CONTENT_IMAGES",
          severity: "warning",
          category: "content",
          url,
          message: "Bài viết dài nhưng không có hình ảnh minh họa",
        });
      }
    }

    return issues;
  }

  /**
   * Cross-page analysis: duplicates, orphan pages, duplicate titles/meta
   */
  _crossPageAnalysis(pages, incomingLinks, baseDomain) {
    const issues = [];

    // 1. Duplicate content (same contentHash)
    const hashMap = {};
    pages.forEach((p) => {
      if (!p.contentHash) return;
      if (!hashMap[p.contentHash]) hashMap[p.contentHash] = [];
      hashMap[p.contentHash].push(p.url);
    });
    Object.values(hashMap).forEach((urls) => {
      if (urls.length > 1) {
        urls.forEach((url) => {
          issues.push({
            type: "DUPLICATE_CONTENT",
            severity: "critical",
            category: "content",
            url,
            message: `Nội dung trùng lặp 100% với ${urls.length - 1} trang khác`,
          });
        });
      }
    });

    // 2. Near-duplicate content (fingerprint similarity) — cap at 500 pages to avoid O(n²)
    const fingerprints = pages
      .filter((p) => p.fingerprint && p.wordCount > 100)
      .slice(0, 500)
      .map((p) => ({ url: p.url, fp: new Set(p.fingerprint.split(",")) }));
    const nearDupFound = new Set();
    for (let i = 0; i < fingerprints.length; i++) {
      if (nearDupFound.has(i)) continue;
      for (let j = i + 1; j < fingerprints.length; j++) {
        const a = fingerprints[i],
          b = fingerprints[j];
        if (a.fp.size === 0 || b.fp.size === 0) continue;
        let intersection = 0;
        for (const w of a.fp) {
          if (b.fp.has(w)) intersection++;
        }
        const similarity = Math.round(
          (intersection / Math.max(a.fp.size, b.fp.size)) * 100,
        );
        if (similarity >= 70 && similarity < 100) {
          issues.push({
            type: "NEAR_DUPLICATE",
            severity: "warning",
            category: "content",
            url: a.url,
            message: `Nội dung tương tự ${similarity}% với trang khác`,
          });
          nearDupFound.add(i);
          break; // only flag once per page
        }
      }
    }

    // 3. Orphan pages (no incoming internal links)
    pages.forEach((p) => {
      const incoming =
        incomingLinks[p.url] ||
        incomingLinks[p.url.replace(/\/$/, "")] ||
        incomingLinks[p.url + "/"];
      if (!incoming || incoming.size === 0) {
        // Skip homepage
        const urlPath = new URL(p.url).pathname;
        if (urlPath !== "/" && urlPath !== "") {
          issues.push({
            type: "ORPHAN_PAGE",
            severity: "critical",
            category: "links",
            url: p.url,
            message: "Trang mồ côi (0 internal links trỏ đến)",
          });
        }
      }
    });

    // 4. Duplicate titles
    const titleMap = {};
    pages.forEach((p) => {
      if (!p.title) return;
      const key = p.title.toLowerCase().trim();
      if (!titleMap[key]) titleMap[key] = [];
      titleMap[key].push(p.url);
    });
    Object.entries(titleMap).forEach(([title, urls]) => {
      if (urls.length > 1) {
        urls.forEach((url) => {
          issues.push({
            type: "DUPLICATE_TITLE",
            severity: "warning",
            category: "on-page",
            url,
            message: `Title trùng lặp với ${urls.length - 1} trang khác: "${title.substring(0, 50)}..."`,
          });
        });
      }
    });

    // 5. Duplicate meta descriptions
    const metaMap = {};
    pages.forEach((p) => {
      if (!p.metaDescription) return;
      const key = p.metaDescription.toLowerCase().trim();
      if (!metaMap[key]) metaMap[key] = [];
      metaMap[key].push(p.url);
    });
    Object.entries(metaMap).forEach(([meta, urls]) => {
      if (urls.length > 1) {
        urls.forEach((url) => {
          issues.push({
            type: "DUPLICATE_META_DESC",
            severity: "warning",
            category: "on-page",
            url,
            message: `Meta description trùng lặp với ${urls.length - 1} trang khác`,
          });
        });
      }
    });

    return issues;
  }

  _extractDomain(url) {
    try {
      if (!url.startsWith("http")) url = "https://" + url;
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  _categorizeIssues(issues) {
    const categories = {};
    issues.forEach((issue) => {
      if (!categories[issue.type]) {
        categories[issue.type] = {
          type: issue.type,
          severity: issue.severity,
          category: issue.category,
          message: issue.message,
          fix: issue.fix || "",
          count: 0,
          urls: [],
        };
      }
      categories[issue.type].count++;
      if (issue.url) categories[issue.type].urls.push(issue.url);
    });
    return Object.values(categories).sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] || 3) - (order[b.severity] || 3);
    });
  }

  _calculateCategories(issues) {
    return {
      "on-page": issues.filter((i) => i.category === "on-page").length,
      technical: issues.filter((i) => i.category === "technical").length,
      links: issues.filter((i) => i.category === "links").length,
      content: issues.filter((i) => i.category === "content").length,
      speed: issues.filter((i) => i.category === "speed").length,
      schema: issues.filter((i) => i.category === "schema").length,
      keyword: issues.filter((i) => i.category === "keyword").length,
    };
  }
}

module.exports = new AuditService();
