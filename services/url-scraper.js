/**
 * url-scraper.js — URL Open Graph Metadata Scraper
 * Social SPLSEO — Phase 1
 *
 * Scrapes a URL to extract Open Graph metadata (title, description, image, url).
 * Falls back to standard HTML tags if OG tags are missing.
 */

const axios = require("axios");
const cheerio = require("cheerio");

/**
 * Scrape Open Graph metadata from a URL
 * @param {string} url - The URL to scrape
 * @returns {Promise<{title, description, image, url, siteName}>}
 */
async function scrapeUrl(url) {
  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SPLSEO-Bot/1.0; +https://seo.splworks.com)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      },
      maxRedirects: 5,
      responseType: "text",
      // Only fetch HTML, abort if not
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const html = resp.data;
    if (typeof html !== "string") {
      return { title: url, description: "", image: null, url, siteName: "" };
    }

    const $ = cheerio.load(html);

    // Extract OG tags first, then fall back
    const ogTitle =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="title"]').attr("content") ||
      $("title").text() ||
      "";

    const ogDescription =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      "";

    const ogImage =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[property="og:image:url"]').attr("content") ||
      $('link[rel="image_src"]').attr("href") ||
      null;

    const ogUrl =
      $('meta[property="og:url"]').attr("content") ||
      $('link[rel="canonical"]').attr("href") ||
      url;

    const ogSiteName =
      $('meta[property="og:site_name"]').attr("content") || "";

    // Resolve relative image URLs
    let resolvedImage = ogImage;
    if (ogImage && !ogImage.startsWith("http")) {
      try {
        resolvedImage = new URL(ogImage, url).href;
      } catch {
        resolvedImage = null;
      }
    }

    return {
      title: ogTitle.trim().substring(0, 300),
      description: ogDescription.trim().substring(0, 500),
      image: resolvedImage,
      url: ogUrl,
      siteName: ogSiteName.trim(),
    };
  } catch (err) {
    console.warn(`[URL Scraper] Failed to scrape ${url}: ${err.message}`);
    return {
      title: url,
      description: "",
      image: null,
      url,
      siteName: "",
      error: err.message,
    };
  }
}

/**
 * Batch scrape multiple URLs
 * @param {string[]} urls - Array of URLs to scrape
 * @param {number} concurrency - Max concurrent requests
 * @returns {Promise<Array<{title, description, image, url, siteName}>>}
 */
async function batchScrapeUrls(urls, concurrency = 3) {
  const results = [];
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) continue;
      const result = await scrapeUrl(url.trim());
      results.push(result);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, urls.length) },
    () => worker()
  );
  await Promise.all(workers);

  // Return in original order
  const urlMap = new Map(results.map((r) => [r.url, r]));
  return urls.map(
    (u) =>
      urlMap.get(u.trim()) ||
      results.find((r) => r.url === u.trim()) || {
        title: u,
        description: "",
        image: null,
        url: u,
        siteName: "",
      }
  );
}

module.exports = { scrapeUrl, batchScrapeUrls };
