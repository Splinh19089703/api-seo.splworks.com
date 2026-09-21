const axios = require("axios");

// ==================== Platform Strategies ====================

class WordPressStrategy {
  async publish(account, article, options = {}) {
    const creds = account.credentials;
    const postData = {
      title: article.title,
      content: article.content,
      status: options.status || account.defaults?.status || "draft",
      categories: options.categories || [],
      tags: options.tags || [],
      meta: {},
    };
    if (article.featuredMediaId) postData.featured_media = article.featuredMediaId;
    if (article.metaTitle) postData.meta.yoast_wpseo_title = article.metaTitle;
    if (article.metaDescription) postData.meta.yoast_wpseo_metadesc = article.metaDescription;
    if (article.focusKeyword) postData.meta.yoast_wpseo_focuskw = article.focusKeyword;

    const resp = await axios.post(`${creds.siteUrl}/wp-json/wp/v2/posts`, postData, {
      auth: { username: creds.username, password: creds.appPassword },
      timeout: 30000,
    });
    return { postId: resp.data.id, url: resp.data.link, status: resp.data.status, title: resp.data.title.rendered };
  }

  async testConnection(account) {
    const creds = account.credentials;
    const resp = await axios.get(`${creds.siteUrl}/wp-json/wp/v2/posts?per_page=1`, {
      auth: { username: creds.username, password: creds.appPassword },
      timeout: 10000,
    });
    return { success: true, message: `Kết nối WordPress thành công! (${resp.status})` };
  }

  async getCategories(account) {
    const creds = account.credentials;
    const resp = await axios.get(`${creds.siteUrl}/wp-json/wp/v2/categories?per_page=100`, {
      auth: { username: creds.username, password: creds.appPassword },
      timeout: 10000,
    });
    return resp.data.map(c => ({ id: c.id, name: c.name, slug: c.slug, count: c.count }));
  }

  async uploadImage(account, imageUrl, altText = "") {
    const creds = account.credentials;
    const imgResp = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(imgResp.data);
    const filename = `ai-image-${Date.now()}.png`;
    const resp = await axios.post(`${creds.siteUrl}/wp-json/wp/v2/media`, buffer, {
      auth: { username: creds.username, password: creds.appPassword },
      headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${filename}"` },
      timeout: 30000,
    });
    return { id: resp.data.id, url: resp.data.source_url, alt: altText };
  }
}

class BloggerStrategy {
  async publish(account, article, options = {}) {
    const creds = account.credentials;
    const postData = {
      kind: "blogger#post",
      title: article.title,
      content: article.content,
      labels: options.tags || [],
    };
    const isDraft = (options.status || account.defaults?.status || "draft") === "draft";
    const resp = await axios.post(
      `https://www.googleapis.com/blogger/v3/blogs/${creds.blogId}/posts?isDraft=${isDraft}`,
      postData,
      { headers: { Authorization: `Bearer ${creds.accessToken}` }, timeout: 30000 }
    );
    return { postId: resp.data.id, url: resp.data.url, status: isDraft ? "draft" : "publish", title: resp.data.title };
  }

  async testConnection(account) {
    const creds = account.credentials;
    const resp = await axios.get(
      `https://www.googleapis.com/blogger/v3/blogs/${creds.blogId}`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` }, timeout: 10000 }
    );
    return { success: true, message: `Kết nối Blogger thành công! Blog: ${resp.data.name}` };
  }

  async getCategories() { return []; }
  async uploadImage() { return null; }
}

class MediumStrategy {
  async publish(account, article, options = {}) {
    const creds = account.credentials;
    const postData = {
      title: article.title,
      contentFormat: "html",
      content: article.content,
      tags: (options.tags || []).slice(0, 5),
      publishStatus: (options.status === "publish") ? "public" : "draft",
    };
    const resp = await axios.post(
      `https://api.medium.com/v1/users/${creds.authorId}/posts`,
      postData,
      { headers: { Authorization: `Bearer ${creds.integrationToken}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    return { postId: resp.data.data.id, url: resp.data.data.url, status: resp.data.data.publishStatus, title: resp.data.data.title };
  }

  async testConnection(account) {
    const creds = account.credentials;
    const resp = await axios.get("https://api.medium.com/v1/me", {
      headers: { Authorization: `Bearer ${creds.integrationToken}` }, timeout: 10000,
    });
    return { success: true, message: `Kết nối Medium thành công! User: ${resp.data.data.name}` };
  }

  async getCategories() { return []; }
  async uploadImage() { return null; }
}

class TelegramStrategy {
  async publish(account, article, options = {}) {
    const creds = account.credentials;
    // Create a condensed message for Telegram
    const excerpt = (article.content || "").replace(/<[^>]*>/g, "").substring(0, 500);
    const message = `<b>${article.title}</b>\n\n${excerpt}...`;
    const resp = await axios.post(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      chat_id: creds.channelId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }, { timeout: 15000 });
    return { postId: String(resp.data.result.message_id), url: null, status: "publish", title: article.title };
  }

  async testConnection(account) {
    const creds = account.credentials;
    const resp = await axios.get(`https://api.telegram.org/bot${creds.botToken}/getMe`, { timeout: 10000 });
    return { success: true, message: `Kết nối Telegram thành công! Bot: @${resp.data.result.username}` };
  }

  async getCategories() { return []; }
  async uploadImage() { return null; }
}

class FacebookStrategy {
  async publish(account, article, options = {}) {
    const creds = account.credentials || {};
    const pageId = creds.pageId || account.pageId;
    const pageToken = creds.pageToken;
    if (!pageId || !pageToken) throw new Error("Thiếu Page ID hoặc Page Access Token.");

    const facebookService = require("./facebook-service");

    const excerpt = (article.content || "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 300);

    const message = options.message || `${article.title}\n\n${excerpt}...`;
    const link = options.link || article.url || article.permalink;

    if (link) {
      const res = await facebookService.publishLink(pageId, pageToken, { link, message });
      return { postId: res.postId, url: res.url, status: "published", title: article.title };
    } else if (article.thumbnailUrl || article.featuredImage) {
      const res = await facebookService.publishPhoto(pageId, pageToken, {
        url: article.thumbnailUrl || article.featuredImage,
        caption: message,
      });
      return { postId: res.postId, url: res.url, status: "published", title: article.title };
    } else {
      const res = await facebookService.publishTextPost(pageId, pageToken, { message });
      return { postId: res.postId, url: res.url, status: "published", title: article.title };
    }
  }

  async testConnection(account) {
    const creds = account.credentials || {};
    const pageId = creds.pageId || account.pageId;
    const pageToken = creds.pageToken;
    if (!pageId || !pageToken) throw new Error("Thiếu Page ID hoặc Page Access Token.");
    const facebookService = require("./facebook-service");
    return facebookService.testConnection(pageId, pageToken);
  }

  async getCategories() { return []; }
  async uploadImage() { return null; }
}

// Stub strategies for platforms not yet implemented
class StubStrategy {
  constructor(name) { this.name = name; }
  async publish() { throw new Error(`${this.name} chưa được hỗ trợ. Vui lòng cập nhật phiên bản mới.`); }
  async testConnection() { throw new Error(`${this.name} chưa được hỗ trợ.`); }
  async getCategories() { return []; }
  async uploadImage() { return null; }
}

// ==================== Main Service ====================

class PublishService {
  constructor() {
    this.strategies = {
      wordpress: new WordPressStrategy(),
      blogger: new BloggerStrategy(),
      medium: new MediumStrategy(),
      telegram: new TelegramStrategy(),
      facebook: new FacebookStrategy(),
      // Stubs — will be implemented in future phases
      zalo: new StubStrategy("Zalo OA"),
      instagram: new StubStrategy("Instagram"),
      threads: new StubStrategy("Threads"),
      twitter: new StubStrategy("X (Twitter)"),
      youtube: new StubStrategy("YouTube"),
      tiktok: new StubStrategy("TikTok"),
      tiktokshop: new StubStrategy("TikTok Shop"),
      linkedin: new StubStrategy("LinkedIn"),
      pinterest: new StubStrategy("Pinterest"),
      reddit: new StubStrategy("Reddit"),
      tumblr: new StubStrategy("Tumblr"),
      vkontakte: new StubStrategy("VKontakte"),
      mastodon: new StubStrategy("Mastodon"),
      lineoa: new StubStrategy("LINE OA"),
      discord: new StubStrategy("Discord"),
    };
  }

  getStrategy(platform) {
    const strategy = this.strategies[platform];
    if (!strategy) throw new Error(`Nền tảng "${platform}" không được hỗ trợ.`);
    return strategy;
  }

  async publish(account, article, options = {}) {
    return this.getStrategy(account.platform).publish(account, article, options);
  }

  async testConnection(account) {
    return this.getStrategy(account.platform).testConnection(account);
  }

  async getCategories(account) {
    return this.getStrategy(account.platform).getCategories(account);
  }

  async uploadImage(account, imageUrl, altText) {
    return this.getStrategy(account.platform).uploadImage(account, imageUrl, altText);
  }
}

module.exports = new PublishService();
