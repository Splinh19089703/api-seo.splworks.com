const axios = require("axios");

/**
 * SERP Service — Google search via Serper.dev API
 * Used for SERP-based keyword clustering verification
 */
class SerpService {
  constructor() {
    this.baseUrl = "https://google.serper.dev/search";
    this.rateLimitMs = 1000; // 1 request per second
    this.lastRequestTime = 0;
  }

  /**
   * Get all active Serper API keys from storage
   */
  _getSerperKeys(apiKeys) {
    return (apiKeys || []).filter(
      (k) => k.provider === "serper" && k.active && k.apiKey
    );
  }

  /**
   * Select API key (rotate through available keys)
   */
  _selectKey(keys, index = 0) {
    if (keys.length === 0) return null;
    return keys[index % keys.length];
  }

  /**
   * Rate limit: wait if needed before making a request
   */
  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitMs) {
      await new Promise((r) => setTimeout(r, this.rateLimitMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Search Google for a single keyword
   * @returns {Object} { keyword, urls: string[], titles: string[], snippets: string[], searchIntent: string }
   */
  async searchGoogle(keyword, apiKey, options = {}) {
    const { country = "vn", lang = "vi", num = 10 } = options;
    await this._rateLimit();

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          q: keyword,
          gl: country,
          hl: lang,
          num: num,
        },
        {
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const organic = response.data.organic || [];
      const urls = organic.map((r) => r.link).filter(Boolean);
      const titles = organic.map((r) => r.title || "").filter(Boolean);
      const snippets = organic.map((r) => r.snippet || "").filter(Boolean);

      // Detect search intent from SERP features
      let detectedIntent = "informational";
      const hasAds = response.data.ads && response.data.ads.length > 0;
      const hasShopping =
        response.data.shopping && response.data.shopping.length > 0;
      const hasLocalPack =
        response.data.places && response.data.places.length > 0;
      const hasKnowledgeGraph = !!response.data.knowledgeGraph;

      if (hasShopping || hasAds) detectedIntent = "commercial";
      if (hasLocalPack) detectedIntent = "local";
      if (hasKnowledgeGraph && !hasAds) detectedIntent = "informational";

      return {
        keyword,
        urls,
        titles,
        snippets,
        detectedIntent,
        features: {
          ads: hasAds,
          shopping: hasShopping,
          localPack: hasLocalPack,
          knowledgeGraph: hasKnowledgeGraph,
        },
      };
    } catch (error) {
      console.error(
        `[SERP] Error searching "${keyword}":`,
        error.response?.data?.message || error.message
      );
      return { keyword, urls: [], titles: [], snippets: [], detectedIntent: "unknown", features: {} };
    }
  }

  /**
   * Batch search multiple keywords with key rotation
   * @returns {Object[]} Array of search results
   */
  async batchSearch(keywords, apiKeys, options = {}) {
    const serperKeys = this._getSerperKeys(apiKeys);
    if (serperKeys.length === 0) {
      console.warn("[SERP] No Serper API keys configured, skipping SERP verification");
      return null;
    }

    const results = [];
    for (let i = 0; i < keywords.length; i++) {
      const key = this._selectKey(serperKeys, i);
      const kw = typeof keywords[i] === "string" ? keywords[i] : keywords[i].keyword;
      try {
        const result = await this.searchGoogle(kw, key.apiKey, options);
        results.push(result);
      } catch (e) {
        results.push({ keyword: kw, urls: [], titles: [], snippets: [], detectedIntent: "unknown", features: {} });
      }
    }
    return results;
  }

  /**
   * Calculate SERP overlap score between two keyword results
   * @returns {number} Number of shared URLs (0-10)
   */
  calculateOverlap(result1, result2) {
    if (!result1?.urls?.length || !result2?.urls?.length) return 0;

    // Normalize URLs: remove protocol, www, trailing slash, query params
    const normalize = (url) => {
      try {
        const u = new URL(url);
        return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "").toLowerCase();
      } catch {
        return url.toLowerCase();
      }
    };

    const urls1 = new Set(result1.urls.map(normalize));
    const urls2 = result2.urls.map(normalize);

    let overlap = 0;
    for (const url of urls2) {
      if (urls1.has(url)) overlap++;
    }
    return overlap;
  }

  /**
   * Build SERP-based clusters from search results
   * Keywords sharing ≥ threshold URLs in top 10 = same cluster
   * @param {Object[]} serpResults - Array of searchGoogle() results
   * @param {number} threshold - Min shared URLs to merge (default: 3)
   * @returns {Object[]} SERP-based clusters
   */
  clusterBySERP(serpResults, threshold = 3) {
    if (!serpResults || serpResults.length === 0) return [];

    // Build overlap matrix
    const n = serpResults.length;
    const overlapMatrix = [];
    for (let i = 0; i < n; i++) {
      overlapMatrix[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          overlapMatrix[i][j] = 10;
        } else if (j < i) {
          overlapMatrix[i][j] = overlapMatrix[j][i]; // symmetric
        } else {
          overlapMatrix[i][j] = this.calculateOverlap(serpResults[i], serpResults[j]);
        }
      }
    }

    // Union-Find clustering
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const union = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    // Merge keywords with overlap >= threshold
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (overlapMatrix[i][j] >= threshold) {
          union(i, j);
        }
      }
    }

    // Group by root
    const groups = {};
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!groups[root]) groups[root] = [];
      groups[root].push(serpResults[i]);
    }

    // Build cluster objects
    const clusters = Object.values(groups).map((members) => {
      // Use keyword with most SERP features or first one as pillar
      members.sort((a, b) => (b.urls?.length || 0) - (a.urls?.length || 0));
      return {
        pillarKeyword: members[0].keyword,
        detectedIntent: members[0].detectedIntent,
        keywords: members.map((m) => m.keyword),
        serpData: members.map((m) => ({
          keyword: m.keyword,
          detectedIntent: m.detectedIntent,
          topUrls: m.urls.slice(0, 5),
          features: m.features,
        })),
      };
    });

    return clusters;
  }

  /**
   * Select which keywords to verify via SERP
   * Strategy: All pillar keywords + top N by volume from uncategorized/large groups
   * @returns {string[]} Keywords to search
   */
  selectKeywordsForVerification(clusters, maxKeywords = 50) {
    const selected = new Set();

    // 1. All pillar keywords
    for (const c of clusters) {
      if (c.pillarKeyword) selected.add(c.pillarKeyword);
    }

    // 2. Top volume keywords from each cluster (max 2 per cluster)
    for (const c of clusters) {
      const sorted = [...(c.keywords || [])].sort(
        (a, b) => (b.volume || 0) - (a.volume || 0)
      );
      for (let i = 0; i < Math.min(2, sorted.length) && selected.size < maxKeywords; i++) {
        selected.add(sorted[i].keyword);
      }
    }

    return [...selected].slice(0, maxKeywords);
  }
}

module.exports = new SerpService();
