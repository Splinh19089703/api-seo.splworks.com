const axios = require("axios");
const cheerio = require("cheerio");
const chalk = require("chalk");
const Crawler = require("./crawler");

/**
 * Bulk Crawler Module - Cào hàng loạt bài viết theo keyword
 * Tìm bài viết liên quan trên Google và cào tất cả
 */
class BulkCrawler {
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
   * Tìm URLs từ Google Search (DuckDuckGo HTML version as fallback)
   * @param {string} keyword - Từ khóa tìm kiếm
   * @param {number} maxResults - Số kết quả tối đa
   * @returns {Array} Danh sách URLs
   */
  async searchUrls(keyword, maxResults = 10) {
    console.log(chalk.blue(`\n🔎 Đang tìm kiếm: "${keyword}"\n`));

    let urls = [];

    // Thử nhiều search engine, dừng khi có kết quả
    const engines = [
      { name: "Bing", fn: () => this._searchBing(keyword, maxResults) },
      {
        name: "DuckDuckGo",
        fn: () => this._searchDuckDuckGo(keyword, maxResults),
      },
      { name: "Google", fn: () => this._searchGoogle(keyword, maxResults) },
    ];

    for (const engine of engines) {
      try {
        console.log(chalk.gray(`   📍 Thử ${engine.name}...`));
        urls = await engine.fn();
        if (urls.length > 0) {
          console.log(
            chalk.green(`✅ Tìm thấy ${urls.length} kết quả từ ${engine.name}`),
          );
          urls.forEach((u, i) =>
            console.log(chalk.gray(`   ${i + 1}. ${u.title}`)),
          );
          break;
        }
      } catch (error) {
        console.log(
          chalk.gray(`   ⚠️ ${engine.name} thất bại: ${error.message}`),
        );
      }
    }

    if (urls.length === 0) {
      console.log(chalk.yellow("⚠️ Không tìm thấy kết quả từ search engine."));
      console.log(
        chalk.cyan("💡 Thử dùng lệnh 'site' để cào trực tiếp từ domain:"),
      );
      console.log(chalk.white(`   node src/index.js site "ten-domain.com"`));
    }

    return urls;
  }

  async _searchBing(keyword, maxResults) {
    const urls = [];
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(keyword)}&count=${maxResults}`;

    const response = await axios.get(searchUrl, {
      headers: this.headers,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    $("li.b_algo h2 a, .b_algo h2 a").each((i, el) => {
      if (urls.length >= maxResults) return false;
      const href = $(el).attr("href") || "";
      const title = $(el).text().trim();

      if (href.startsWith("http") && !this._isExcluded(href)) {
        urls.push({ url: href, title });
      }
    });

    return urls;
  }

  async _searchDuckDuckGo(keyword, maxResults) {
    const urls = [];
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`;

    const response = await axios.get(searchUrl, {
      headers: this.headers,
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    $(".result__a").each((i, el) => {
      if (urls.length >= maxResults) return false;
      let href = $(el).attr("href") || "";

      if (href.includes("uddg=")) {
        const match = href.match(/uddg=([^&]+)/);
        if (match) href = decodeURIComponent(match[1]);
      }

      if (href.startsWith("http") && !this._isExcluded(href)) {
        urls.push({ url: href, title: $(el).text().trim() });
      }
    });

    return urls;
  }

  async _searchGoogle(keyword, maxResults) {
    const urls = [];
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&num=${maxResults}&hl=vi`;

    const response = await axios.get(searchUrl, {
      headers: {
        ...this.headers,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    $("a[href]").each((i, el) => {
      if (urls.length >= maxResults) return false;
      const href = $(el).attr("href") || "";

      // Google search result URLs
      const match = href.match(/\/url\?q=([^&]+)/);
      if (match) {
        const url = decodeURIComponent(match[1]);
        if (url.startsWith("http") && !this._isExcluded(url)) {
          const title = $(el).text().trim() || url;
          urls.push({ url, title: title.substring(0, 150) });
        }
      }
    });

    return urls;
  }

  /**
   * Cào hàng loạt từ keyword
   * @param {string} keyword - Từ khóa
   * @param {number} maxResults - Số bài tối đa
   * @returns {Array} Danh sách dữ liệu đã cào
   */
  async crawlByKeyword(keyword, maxResults = 5) {
    const searchResults = await this.searchUrls(keyword, maxResults);

    if (searchResults.length === 0) {
      console.log(
        chalk.yellow("\n⚠️ Không tìm thấy kết quả. Thử keyword khác."),
      );
      return [];
    }

    return await this.crawlUrls(searchResults.map((r) => r.url));
  }

  /**
   * Cào hàng loạt từ danh sách URLs
   * @param {Array<string>} urls - Danh sách URLs
   * @returns {Array} Danh sách dữ liệu đã cào
   */
  async crawlUrls(urls) {
    console.log(chalk.blue(`\n🚀 Bắt đầu cào ${urls.length} bài...\n`));

    const results = [];
    let success = 0;
    let failed = 0;

    for (let i = 0; i < urls.length; i++) {
      console.log(chalk.gray(`\n[${i + 1}/${urls.length}]`));

      const data = await this.crawler.crawl(urls[i]);
      if (data && data.content && data.stats.wordCount > 200) {
        results.push(data);
        success++;
      } else {
        failed++;
      }

      // Delay giữa các request (tránh bị block)
      if (i < urls.length - 1) {
        const delay = 1000 + Math.random() * 2000;
        console.log(chalk.gray(`   ⏳ Đợi ${Math.round(delay / 1000)}s...`));
        await this._sleep(delay);
      }
    }

    console.log(
      chalk.green(`\n✅ Hoàn tất: ${success} thành công, ${failed} thất bại`),
    );
    return results;
  }

  /**
   * Cào từ file danh sách URLs
   * @param {string} filePath - Đường dẫn file (mỗi URL 1 dòng)
   * @returns {Array}
   */
  async crawlFromFile(filePath) {
    const fs = require("fs-extra");
    const content = await fs.readFile(filePath, "utf-8");
    const urls = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("http"));

    console.log(chalk.blue(`📄 Đọc ${urls.length} URLs từ file: ${filePath}`));
    return await this.crawlUrls(urls);
  }

  /**
   * Kiểm tra URL nên bỏ qua
   */
  _isExcluded(url) {
    const excluded = [
      "youtube.com",
      "facebook.com",
      "twitter.com",
      "instagram.com",
      "tiktok.com",
      "pinterest.com",
      "reddit.com",
      "google.com",
      "bing.com",
      "duckduckgo.com",
      "wikipedia.org",
    ];
    return excluded.some((domain) => url.includes(domain));
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = BulkCrawler;
