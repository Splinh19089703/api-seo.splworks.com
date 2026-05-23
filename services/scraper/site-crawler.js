const axios = require("axios");
const cheerio = require("cheerio");
const chalk = require("chalk");
const Crawler = require("./crawler");

/**
 * Site Crawler Module - Cào bài viết từ domain hoặc category URL
 * Hỗ trợ: WordPress sitemap, category pages, RSS feeds
 */
class SiteCrawler {
  constructor() {
    this.crawler = new Crawler();
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    };
  }

  /**
   * Lấy danh sách bài viết từ domain (tự detect sitemap/category/page)
   * @param {string} input - Domain hoặc URL (e.g. "wpbeginner.com" hoặc "https://wpbeginner.com/category/wp-tutorials/")
   * @param {Object} options
   * @returns {Array<{url, title}>}
   */
  async discoverUrls(input, options = {}) {
    const { maxUrls = 20 } = options;

    // Normalize input
    let url = input;
    if (!url.startsWith("http")) {
      url = `https://${url}`;
    }

    console.log(chalk.blue(`\n🌐 Đang quét: ${url}\n`));

    let urls = [];

    // 1. Thử sitemap trước (nếu là domain root)
    if (this._isDomainRoot(url)) {
      console.log(chalk.gray("   📍 Đang tìm sitemap..."));
      urls = await this._fromSitemap(url, maxUrls);
    }

    // 2. Nếu không có sitemap hoặc là category URL → cào từ HTML page
    if (urls.length === 0) {
      console.log(chalk.gray("   📍 Đang quét trang HTML..."));
      urls = await this._fromHtmlPage(url, maxUrls);
    }

    // 3. Thử RSS feed
    if (urls.length === 0) {
      console.log(chalk.gray("   📍 Đang tìm RSS feed..."));
      urls = await this._fromRssFeed(url, maxUrls);
    }

    if (urls.length === 0) {
      console.log(
        chalk.yellow(
          "⚠️ Không tìm thấy bài viết nào. Thử nhập URL danh mục cụ thể hơn.",
        ),
      );
    } else {
      console.log(chalk.green(`✅ Tìm thấy ${urls.length} bài viết`));
      urls.forEach((u, i) =>
        console.log(chalk.gray(`   ${i + 1}. ${u.title || u.url}`)),
      );
    }

    return urls;
  }

  /**
   * Cào bài viết từ domain/category
   * @param {string} input - Domain hoặc URL
   * @param {Object} options
   * @returns {Array} Dữ liệu đã cào
   */
  async crawlSite(input, options = {}) {
    const { maxUrls = 10, maxCrawl = 5 } = options;

    const urls = await this.discoverUrls(input, { maxUrls });

    if (urls.length === 0) return [];

    // Chỉ cào tối đa maxCrawl bài
    const toCrawl = urls.slice(0, maxCrawl);
    console.log(
      chalk.blue(`\n🚀 Bắt đầu cào ${toCrawl.length}/${urls.length} bài...\n`),
    );

    const results = [];
    for (let i = 0; i < toCrawl.length; i++) {
      console.log(chalk.gray(`\n[${i + 1}/${toCrawl.length}]`));
      const data = await this.crawler.crawl(toCrawl[i].url);

      if (data && data.content && data.stats.wordCount > 200) {
        results.push(data);
      }

      // Delay giữa requests
      if (i < toCrawl.length - 1) {
        const delay = 1500 + Math.random() * 2000;
        console.log(chalk.gray(`   ⏳ Đợi ${Math.round(delay / 1000)}s...`));
        await this._sleep(delay);
      }
    }

    console.log(
      chalk.green(
        `\n✅ Cào xong: ${results.length}/${toCrawl.length} thành công`,
      ),
    );
    return results;
  }

  // ===== PRIVATE METHODS =====

  /**
   * Lấy URLs từ WordPress sitemap
   */
  async _fromSitemap(baseUrl, maxUrls) {
    const urls = [];
    const sitemapPaths = [
      "/wp-sitemap-posts-post-1.xml",
      "/post-sitemap.xml",
      "/sitemap_index.xml",
      "/sitemap.xml",
    ];

    for (const sitemapPath of sitemapPaths) {
      try {
        const sitemapUrl = new URL(sitemapPath, baseUrl).href;
        console.log(chalk.gray(`   → Thử: ${sitemapUrl}`));

        const response = await axios.get(sitemapUrl, {
          headers: this.headers,
          timeout: 10000,
        });

        const $ = cheerio.load(response.data, { xmlMode: true });

        // Sitemap index → lấy sitemap con
        const sitemapUrls = [];
        $("sitemap > loc, sitemapindex > sitemap > loc").each((_, el) => {
          const loc = $(el).text().trim();
          if (loc && loc.includes("post")) {
            sitemapUrls.push(loc);
          }
        });

        // Nếu là sitemap index, cào sitemap con đầu tiên
        if (sitemapUrls.length > 0) {
          console.log(
            chalk.gray(`   → Tìm thấy sitemap index, lấy: ${sitemapUrls[0]}`),
          );
          try {
            const subResponse = await axios.get(sitemapUrls[0], {
              headers: this.headers,
              timeout: 10000,
            });
            const $sub = cheerio.load(subResponse.data, { xmlMode: true });
            $sub("url > loc").each((_, el) => {
              if (urls.length >= maxUrls) return false;
              urls.push({ url: $sub(el).text().trim(), title: "" });
            });
          } catch (e) {
            /* skip */
          }
        }

        // Post URLs trực tiếp
        $("url > loc").each((_, el) => {
          if (urls.length >= maxUrls) return false;
          const loc = $(el).text().trim();
          if (loc && !loc.endsWith(".xml") && !this._isExcludedUrl(loc)) {
            urls.push({ url: loc, title: "" });
          }
        });

        if (urls.length > 0) {
          console.log(
            chalk.green(`   ✅ Tìm thấy ${urls.length} URLs từ sitemap`),
          );
          break;
        }
      } catch (e) {
        // Thử sitemap path tiếp theo
      }
    }

    return urls;
  }

  /**
   * Lấy URLs từ trang HTML (category, archive, blog page)
   */
  async _fromHtmlPage(url, maxUrls) {
    const allUrls = [];
    let currentUrl = url;
    let page = 1;
    const maxPages = 5; // Tối đa 5 trang pagination

    while (allUrls.length < maxUrls && page <= maxPages) {
      try {
        console.log(chalk.gray(`   → Quét trang ${page}: ${currentUrl}`));

        const response = await axios.get(currentUrl, {
          headers: this.headers,
          timeout: 10000,
        });
        const $ = cheerio.load(response.data);

        // Loại bỏ nav, footer, sidebar
        $("nav, footer, aside, .sidebar, .widget").remove();

        const pageUrls = [];
        const domain = new URL(url).hostname;

        // Tìm article links — nhiều selector phổ biến
        const articleSelectors = [
          "article a[href]",
          ".post a[href]",
          ".entry-title a[href]",
          ".post-title a[href]",
          "h2 a[href]",
          "h3 a[href]",
          ".blog-post a[href]",
          ".archive-post a[href]",
          ".hentry a[href]",
          ".wp-block-post-title a[href]",
          // Blocksy theme selectors
          ".entries > article a[href]",
          ".ct-posts-container article a[href]",
        ];

        const seen = new Set(allUrls.map((u) => u.url));

        for (const selector of articleSelectors) {
          $(selector).each((_, el) => {
            const href = $(el).attr("href") || "";
            const text = $(el).text().trim();

            if (
              href.startsWith("http") &&
              href.includes(domain) &&
              text.length > 10 &&
              !seen.has(href) &&
              !this._isExcludedUrl(href) &&
              allUrls.length + pageUrls.length < maxUrls
            ) {
              seen.add(href);
              pageUrls.push({ url: href, title: text.substring(0, 150) });
            }
          });

          if (pageUrls.length >= 5) break; // Đủ selector tốt rồi
        }

        if (pageUrls.length === 0) break; // Không còn bài

        allUrls.push(...pageUrls);

        // Tìm link trang tiếp theo
        const nextPage = this._findNextPage($, currentUrl, page);
        if (!nextPage) break;

        currentUrl = nextPage;
        page++;

        await this._sleep(1000);
      } catch (e) {
        break;
      }
    }

    return allUrls.slice(0, maxUrls);
  }

  /**
   * Lấy URLs từ RSS feed
   */
  async _fromRssFeed(baseUrl, maxUrls) {
    const urls = [];
    const feedPaths = ["/feed/", "/rss/", "/feed/rss2/", "/atom.xml"];

    for (const feedPath of feedPaths) {
      try {
        const feedUrl = new URL(feedPath, baseUrl).href;
        console.log(chalk.gray(`   → Thử RSS: ${feedUrl}`));

        const response = await axios.get(feedUrl, {
          headers: {
            ...this.headers,
            Accept: "application/rss+xml, application/xml, text/xml",
          },
          timeout: 10000,
        });

        const $ = cheerio.load(response.data, { xmlMode: true });

        $("item").each((_, el) => {
          if (urls.length >= maxUrls) return false;
          const link =
            $(el).find("link").text().trim() ||
            $(el).find("link").attr("href") ||
            "";
          const title = $(el).find("title").text().trim();

          if (link) {
            urls.push({ url: link, title });
          }
        });

        // Atom feed
        if (urls.length === 0) {
          $("entry").each((_, el) => {
            if (urls.length >= maxUrls) return false;
            const link =
              $(el).find('link[rel="alternate"]').attr("href") ||
              $(el).find("link").attr("href") ||
              "";
            const title = $(el).find("title").text().trim();

            if (link) {
              urls.push({ url: link, title });
            }
          });
        }

        if (urls.length > 0) {
          console.log(chalk.green(`   ✅ Tìm thấy ${urls.length} bài từ RSS`));
          break;
        }
      } catch (e) {
        // Thử path tiếp theo
      }
    }

    return urls;
  }

  /**
   * Tìm link trang tiếp theo (pagination)
   */
  _findNextPage($, currentUrl, currentPage) {
    // WordPress pagination patterns
    const nextSelectors = [
      "a.next",
      ".nav-next a",
      ".pagination .next a",
      'a[rel="next"]',
      ".next-posts-link a",
      "a.page-numbers.next",
      // Blocksy pagination
      ".ct-pagination a.next",
    ];

    for (const selector of nextSelectors) {
      const href = $(selector).first().attr("href");
      if (href) return href;
    }

    // Thử /page/N/
    try {
      const nextUrl = new URL(currentUrl);
      const pathParts = nextUrl.pathname.replace(/\/$/, "").split("/");

      if (pathParts[pathParts.length - 2] === "page") {
        pathParts[pathParts.length - 1] = String(currentPage + 1);
      } else {
        pathParts.push("page", String(currentPage + 1));
      }

      nextUrl.pathname = pathParts.join("/") + "/";
      return nextUrl.href;
    } catch (e) {
      return null;
    }
  }

  _isDomainRoot(url) {
    try {
      const u = new URL(url);
      return u.pathname === "/" || u.pathname === "";
    } catch (e) {
      return false;
    }
  }

  _isExcludedUrl(url) {
    const excluded = [
      "/tag/",
      "/author/",
      "/page/",
      "#",
      "/wp-admin",
      "/wp-login",
      "/feed/",
      "/wp-json/",
      "/xmlrpc",
      ".xml",
      ".jpg",
      ".png",
      ".pdf",
      "/cart/",
      "/checkout/",
      "/my-account/",
      "/privacy-policy/",
      "/lien-he/",
      "/gioi-thieu/",
      "/contact/",
      "/about/",
    ];
    return excluded.some((pattern) => url.toLowerCase().includes(pattern));
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = SiteCrawler;
