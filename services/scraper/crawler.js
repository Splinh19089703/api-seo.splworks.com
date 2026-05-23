const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk");

/**
 * Crawler Module - Cào nội dung bài viết từ URL
 */
class Crawler {
  constructor() {
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    };
  }

  /**
   * Cào nội dung từ một URL
   * @param {string} url - URL bài viết
   * @returns {Object} Dữ liệu đã cào
   */
  async crawl(url) {
    console.log(chalk.blue(`\n🔍 Đang cào: ${url}\n`));

    try {
      const response = await axios.get(url, {
        headers: this.headers,
        timeout: 15000,
        maxRedirects: 5,
      });

      const $ = cheerio.load(response.data);

      // Loại bỏ script, style, nav, footer, sidebar, ads
      $(
        "script, style, nav, footer, aside, .sidebar, .ads, .advertisement, .comment, .comments, #comments, .social-share, .related-posts, .wp-block-latest-posts",
      ).remove();

      const data = {
        url,
        crawledAt: new Date().toISOString(),
        title: this._extractTitle($),
        metaDescription: this._extractMetaDescription($),
        headings: this._extractHeadings($),
        content: this._extractContent($),
        images: this._extractImages($, url),
        links: this._extractLinks($, url),
        stats: {},
      };

      // Tính stats
      data.stats = {
        wordCount: this._countWords(data.content),
        headingCount: data.headings.length,
        imageCount: data.images.length,
        linkCount: data.links.internal.length + data.links.external.length,
        readingTime: Math.ceil(this._countWords(data.content) / 200) + " phút",
      };

      console.log(chalk.green(`✅ Cào thành công!`));
      console.log(chalk.gray(`   📝 Tiêu đề: ${data.title}`));
      console.log(
        chalk.gray(
          `   📊 ${data.stats.wordCount} từ | ${data.stats.headingCount} headings | ${data.stats.imageCount} ảnh`,
        ),
      );
      console.log(
        chalk.gray(`   ⏱️  Thời gian đọc: ${data.stats.readingTime}`),
      );

      return data;
    } catch (error) {
      console.error(chalk.red(`❌ Lỗi khi cào ${url}: ${error.message}`));
      return null;
    }
  }

  /**
   * Trích xuất tiêu đề
   */
  _extractTitle($) {
    return (
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().trim() ||
      ""
    );
  }

  /**
   * Trích xuất meta description
   */
  _extractMetaDescription($) {
    return (
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      ""
    );
  }

  /**
   * Trích xuất tất cả headings (H1-H3)
   */
  _extractHeadings($) {
    const headings = [];
    $("h1, h2, h3").each((_, el) => {
      const tag = $(el).prop("tagName").toLowerCase();
      const text = $(el).text().trim();
      if (text && text.length > 2) {
        headings.push({ tag, text });
      }
    });
    return headings;
  }

  /**
   * Trích xuất nội dung chính (text only)
   */
  _extractContent($) {
    // Tìm vùng nội dung chính
    const selectors = [
      "article .entry-content",
      ".entry-content",
      ".post-content",
      ".article-content",
      "article .content",
      ".single-content",
      ".td-post-content",
      ".post-body",
      "article",
      ".content",
      "main",
    ];

    let contentEl = null;
    for (const selector of selectors) {
      const el = $(selector).first();
      if (el.length > 0 && el.text().trim().length > 200) {
        contentEl = el;
        break;
      }
    }

    if (!contentEl) {
      contentEl = $("body");
    }

    // Lấy text từ paragraphs và lists
    const paragraphs = [];
    contentEl.find("p, li, blockquote").each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 20) {
        paragraphs.push(text);
      }
    });

    return paragraphs.join("\n\n");
  }

  /**
   * Trích xuất ảnh (URL + alt text)
   */
  _extractImages($, baseUrl) {
    const images = [];
    const seen = new Set();

    $("article img, .entry-content img, .post-content img, main img").each(
      (_, el) => {
        const src = $(el).attr("src") || $(el).attr("data-src") || "";
        const alt = $(el).attr("alt") || "";

        if (
          src &&
          !seen.has(src) &&
          !src.includes("avatar") &&
          !src.includes("logo") &&
          !src.includes("icon")
        ) {
          seen.add(src);
          images.push({
            src: src.startsWith("http") ? src : new URL(src, baseUrl).href,
            alt: alt.trim(),
          });
        }
      },
    );

    return images;
  }

  /**
   * Trích xuất links (internal + external)
   */
  _extractLinks($, baseUrl) {
    const internal = [];
    const external = [];
    const seen = new Set();

    try {
      const domain = new URL(baseUrl).hostname;

      $("article a, .entry-content a, .post-content a, main a").each(
        (_, el) => {
          const href = $(el).attr("href") || "";
          const text = $(el).text().trim();

          if (href && text && !seen.has(href) && href.startsWith("http")) {
            seen.add(href);
            const linkData = { url: href, text: text.substring(0, 100) };

            if (href.includes(domain)) {
              internal.push(linkData);
            } else {
              external.push(linkData);
            }
          }
        },
      );
    } catch (e) {
      // ignore URL parse errors
    }

    return { internal, external };
  }

  /**
   * Đếm số từ
   */
  _countWords(text) {
    if (!text) return 0;
    return text.split(/\s+/).filter((w) => w.length > 0).length;
  }

  /**
   * Lưu kết quả cào vào file JSON
   */
  async save(data, outputDir = "./output") {
    await fs.ensureDir(outputDir);
    const slug = this._slugify(data.title);
    const filename = `${slug}-${Date.now()}.json`;
    const filepath = path.join(outputDir, filename);

    await fs.writeJson(filepath, data, { spaces: 2 });
    console.log(chalk.green(`\n💾 Đã lưu: ${filepath}`));

    return filepath;
  }

  _slugify(text) {
    return text
      .toLowerCase()
      .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a")
      .replace(/[èéẹẻẽêềếệểễ]/g, "e")
      .replace(/[ìíịỉĩ]/g, "i")
      .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, "o")
      .replace(/[ùúụủũưừứựửữ]/g, "u")
      .replace(/[ỳýỵỷỹ]/g, "y")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 60);
  }
}

module.exports = Crawler;
