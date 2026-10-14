/**
 * url-scraper.js — URL Open Graph Metadata Scraper
 * Social SPLSEO — Phase 1
 *
 * Scrapes a URL to extract Open Graph metadata (title, description, image, url).
 * Falls back to standard HTML tags if OG tags are missing.
 */

const axios = require("axios");
const cheerio = require("cheerio");
const net = require("net");

/**
 * Validate that a URL is a safe public HTTP/HTTPS URL (anti-SSRF)
 * Blocks localhost, loopback, link-local (169.254.x.x), and private RFC1918 ranges.
 */
function isSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  let parsed;
  try {
    const normalized = /^https?:\/\//i.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    parsed = new URL(normalized);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return false;

  const hostname = (parsed.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) return false;

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    return false;
  }

  const ipType = net.isIP(hostname);
  if (ipType === 4) {
    const parts = hostname.split(".").map(Number);
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return false;
    }
  } else if (ipType === 6) {
    if (
      hostname === "::1" ||
      hostname === "::" ||
      hostname.startsWith("fe80:") ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("::ffff:127.") ||
      hostname.startsWith("::ffff:10.") ||
      hostname.startsWith("::ffff:192.168.") ||
      hostname.startsWith("::ffff:169.254.")
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Scrape Open Graph metadata from a URL
 * @param {string} url - The URL to scrape
 * @returns {Promise<{title, description, image, url, siteName}>}
 */
async function scrapeUrl(url) {
  try {
    if (!isSafeExternalUrl(url)) {
      throw new Error("URL không hợp lệ hoặc bị chặn vì lý do bảo mật (SSRF protection)");
    }
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

module.exports = { scrapeUrl, batchScrapeUrls, isSafeExternalUrl };
