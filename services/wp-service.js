const axios = require("axios");
const fs = require('fs');
const path = require('path');
const imageStore = require('./image-store');

class WpService {
  /**
   * Test WordPress connection
   */
  async testConnection(config) {
    try {
      const url = await this._resolveWpUrl(config.siteUrl, "/wp/v2/posts?per_page=1");
      const response = await axios.get(url, {
        auth: { username: config.username, password: config.appPassword },
        timeout: 10000,
      });
      return { success: true, message: "Kết nối thành công!" };
    } catch (error) {
      return { success: false, message: `Lỗi kết nối: ${error.message}` };
    }
  }

  /**
   * Sync categories from WordPress
   */
  async syncCategories(config) {
    const url = await this._resolveWpUrl(config.siteUrl, "/wp/v2/categories?per_page=100");
    const response = await axios.get(url, {
      auth: { username: config.username, password: config.appPassword },
      timeout: 10000,
    },
    );
    return response.data.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      count: cat.count,
    }));
  }

  /**
   * Publish article to WordPress
   */
  async publish(config, article) {
    const postData = {
      title: article.title,
      content: article.content,
      status: article.status || "draft",
      categories: article.categories || [],
      tags: article.tags || [],
      meta: {},
    };

    // Featured image (thumbnail)
    if (article.featuredMediaId) {
      postData.featured_media = article.featuredMediaId;
    }

    // Yoast SEO meta
    if (article.metaTitle) postData.meta.yoast_wpseo_title = article.metaTitle;
    if (article.metaDescription)
      postData.meta.yoast_wpseo_metadesc = article.metaDescription;
    if (article.focusKeyword)
      postData.meta.yoast_wpseo_focuskw = article.focusKeyword;

    // RankMath SEO meta (auto-fill if RankMath is active)
    if (article.metaTitle) {
      postData.meta.rank_math_title = article.metaTitle;
      postData.meta.rank_math_og_title = article.metaTitle;
    }
    if (article.metaDescription) {
      postData.meta.rank_math_description = article.metaDescription;
      postData.meta.rank_math_og_description = article.metaDescription;
    }
    if (article.focusKeyword) {
      postData.meta.rank_math_focus_keyword = article.focusKeyword;
    }

    // Slug from focus keyword (SEO-friendly URL)
    if (article.slug) {
      postData.slug = article.slug;
    }

    const url = await this._resolveWpUrl(config.siteUrl, "/wp/v2/posts");
    const response = await axios.post(url, postData, {
      auth: { username: config.username, password: config.appPassword },
      timeout: 30000,
    },
    );

    return {
      id: response.data.id,
      link: response.data.link,
      // Draft posts cần login admin mới xem được — dùng preview link
      previewLink: response.data.status === "draft"
        ? `${config.siteUrl}/wp-admin/post.php?post=${response.data.id}&action=preview`
        : response.data.link,
      status: response.data.status,
      title: response.data.title.rendered,
    };
  }

  /**
   * Upload image to WordPress
   */
  async uploadImage(config, imageUrl, altText = "") {
    let buffer;
    let mimeType = 'image/jpeg';
    let filename;

    // Ưu tiên đọc file local nếu URL là /api/uploads/images/
    const localPath = imageStore.getFilePath(imageUrl);
    if (localPath) {
      buffer = fs.readFileSync(localPath);
      const ext = path.extname(localPath).toLowerCase().replace('.', '');
      mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      filename = `ai-image-${Date.now()}.${ext}`;
    } else {
      // Fallback: download từ URL (URL ngoài, Unsplash, Pexels...)
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      buffer = Buffer.from(imageResponse.data);
      const ctHeader = imageResponse.headers['content-type'] || 'image/jpeg';
      mimeType = ctHeader.split(';')[0].trim();
      const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      filename = `ai-image-${Date.now()}.${ext}`;
    }

    const url = await this._resolveWpUrl(config.siteUrl, "/wp/v2/media");
    const response = await axios.post(url, buffer, {
      auth: { username: config.username, password: config.appPassword },
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      timeout: 60000,
    });

    return {
      id: response.data.id,
      url: response.data.source_url,
      alt: altText,
    };
  }

  // ===========================
  // URL Resolution Helpers
  // ===========================

  /**
   * Auto-discover correct WP REST API URL
   * Tries: /wp-json/ → /wp/wp-json/ → ?rest_route= (query fallback)
   */
  async _resolveWpUrl(siteUrl, path) {
    const base = siteUrl.replace(/\/$/, "");
    // If path has query params, handle differently
    const [pathPart, queryPart] = path.split("?");
    const qs = queryPart ? `&${queryPart}` : "";
    
    const candidates = [
      `${base}/wp-json${pathPart}${queryPart ? '?' + queryPart : ''}`,
      `${base}/wp/wp-json${pathPart}${queryPart ? '?' + queryPart : ''}`,
    ];
    for (const url of candidates) {
      try {
        const probe = await axios.get(url, {
          timeout: 5000,
          validateStatus: () => true, // don't throw on any status
          maxRedirects: 2,
        });
        // Accept: 200, 201, 401, 403 (auth required but route exists)
        // Reject: 404 (route not found)
        if (probe.status < 400 || probe.status === 401 || probe.status === 403) return url;
      } catch {}
    }
    // Fallback: query param mode (always works)
    return `${base}/?rest_route=${pathPart}${qs}`;
  }

  /**
   * Auto-discover correct SPLSEO plugin REST URL
   */
  async _pluginUrl(config, path) {
    return this._resolveWpUrl(config.siteUrl, `/splseo/v1${path}`);
  }

  // ===========================
  // SPLSEO Plugin Endpoints
  // ===========================

  /**
   * Build headers for plugin API requests
   */
  _pluginHeaders(config) {
    return {
      "X-SPLSEO-Key": config.pluginApiKey,
      "Content-Type": "application/json",
    };
  }

  /**
   * Test connection via SPLSEO Plugin
   */
  async connectViaPlugin(config) {
    try {
      const url = await this._pluginUrl(config, "/connect");
      const resp = await axios.get(url, {
        headers: this._pluginHeaders(config),
        timeout: 10000,
      });
      return { success: true, ...resp.data };
    } catch (error) {
      const msg = error.response?.data?.message || error.message;
      return { success: false, message: `Lỗi: ${msg}` };
    }
  }

  /**
   * Get posts via plugin API (includes SEO meta)
   */
  async getPluginPosts(config, params = {}) {
    const url = await this._pluginUrl(config, "/posts");
    const resp = await axios.get(url, {
      headers: this._pluginHeaders(config),
      params: {
        page: params.page || 1,
        per_page: params.perPage || 20,
        search: params.search || "",
        status: params.status || "any",
        splseo_status: params.splseoStatus || "",
      },
      timeout: 15000,
    });
    return resp.data;
  }

  /**
   * Get single post via plugin API
   */
  async getPluginPost(config, postId) {
    const url = await this._pluginUrl(config, `/post/${postId}`);
    const resp = await axios.get(url, {
      headers: this._pluginHeaders(config),
      timeout: 15000,
    });
    return resp.data;
  }

  /**
   * Update post content + SEO meta via plugin
   */
  async updatePluginPost(config, postId, data) {
    const url = await this._pluginUrl(config, `/post/${postId}/update`);
    const resp = await axios.post(url, data, {
      headers: this._pluginHeaders(config),
      timeout: 30000,
    });
    return resp.data;
  }

  /**
   * Update SPLSEO status via plugin
   */
  async updatePluginStatus(config, postId, status) {
    const url = await this._pluginUrl(config, `/post/${postId}/status`);
    const resp = await axios.post(url, { status }, {
      headers: this._pluginHeaders(config),
      timeout: 10000,
    });
    return resp.data;
  }

  /**
   * Get site stats via plugin
   */
  async getPluginStats(config) {
    const url = await this._pluginUrl(config, "/stats");
    const resp = await axios.get(url, {
      headers: this._pluginHeaders(config),
      timeout: 10000,
    });
    return resp.data;
  }

  // ===========================
  // WooCommerce via Plugin
  // ===========================

  /**
   * Get WooCommerce products
   */
  async getProducts(config, params = {}) {
    const url = await this._pluginUrl(config, "/products");
    const resp = await axios.get(url, {
      headers: this._pluginHeaders(config),
      params: {
        page: params.page || 1,
        per_page: params.perPage || 20,
        search: params.search || "",
        category: params.category || "",
      },
      timeout: 15000,
    });
    return resp.data;
  }

  /**
   * Get single product detail
   */
  async getProduct(config, productId) {
    const url = await this._pluginUrl(config, `/product/${productId}`);
    const resp = await axios.get(url, {
      headers: this._pluginHeaders(config),
      timeout: 15000,
    });
    return resp.data;
  }

  /**
   * Update product description + SEO
   */
  async updateProduct(config, productId, data) {
    const url = await this._pluginUrl(config, `/product/${productId}/update`);
    const resp = await axios.post(url, data, {
      headers: this._pluginHeaders(config),
      timeout: 30000,
    });
    return resp.data;
  }

  /**
   * Get product stats
   */
  async getProductStats(config) {
    const url = await this._pluginUrl(config, "/product-stats");
    const resp = await axios.get(url, {
      headers: this._pluginHeaders(config),
      timeout: 10000,
    });
    return resp.data;
  }
}

module.exports = new WpService();
