/**
 * facebook-service.js — Facebook Graph API Service
 * Social SPLSEO — Phase 1: Facebook Integration
 *
 * ARCHITECTURE: Multi-tenant — mỗi user tự nhập Page Access Token của riêng họ.
 * Không dùng chung FB App từ .env. Giống pattern WordPress/Blogger/Telegram
 * trong publish-service.js.
 *
 * User flow:
 * 1. User vào Facebook Business Suite hoặc Graph API Explorer
 * 2. Tạo Page Access Token (never-expiring) cho Page của họ
 * 3. Nhập pageId + pageToken vào SPLSEO Social Hub
 * 4. SPLSEO dùng token đó để publish lên Page
 *
 * Handles:
 * - Publishing (link posts, photo posts, text posts)
 * - Page info / test connection
 * - URL scraping (force Facebook OG cache refresh)
 */

const axios = require("axios");

const GRAPH_API = "https://graph.facebook.com/v21.0";

class FacebookService {

  // ==================== Publishing ====================

  /**
   * Publish a link post to a Facebook Page
   * Facebook auto-scrapes the link for OG data (title, image, description)
   * @param {string} pageId - Facebook Page ID
   * @param {string} pageToken - Page Access Token (từ user settings)
   * @param {object} data - { link, message }
   */
  async publishLink(pageId, pageToken, { link, message = "" }) {
    const resp = await axios.post(
      `${GRAPH_API}/${pageId}/feed`,
      { link, message, access_token: pageToken },
      { timeout: 30000 }
    );
    return {
      postId: resp.data.id,
      url: `https://www.facebook.com/${resp.data.id}`,
      status: "published",
    };
  }

  /**
   * Publish a photo post to a Facebook Page
   * @param {string} pageId
   * @param {string} pageToken
   * @param {object} data - { url (image URL), caption }
   */
  async publishPhoto(pageId, pageToken, { url: imageUrl, caption = "" }) {
    const resp = await axios.post(
      `${GRAPH_API}/${pageId}/photos`,
      { url: imageUrl, caption, access_token: pageToken },
      { timeout: 30000 }
    );
    return {
      postId: resp.data.post_id || resp.data.id,
      url: `https://www.facebook.com/${resp.data.post_id || resp.data.id}`,
      status: "published",
    };
  }

  /**
   * Publish a text-only post to a Facebook Page
   */
  async publishTextPost(pageId, pageToken, { message }) {
    const resp = await axios.post(
      `${GRAPH_API}/${pageId}/feed`,
      { message, access_token: pageToken },
      { timeout: 30000 }
    );
    return {
      postId: resp.data.id,
      url: `https://www.facebook.com/${resp.data.id}`,
      status: "published",
    };
  }

  // ==================== Page Info ====================

  /**
   * Get page info — dùng để test connection + lấy tên/avatar Page
   */
  async getPageInfo(pageId, pageToken) {
    const resp = await axios.get(`${GRAPH_API}/${pageId}`, {
      params: {
        access_token: pageToken,
        fields: "id,name,picture,fan_count,category,link,verification_status",
      },
      timeout: 10000,
    });
    return resp.data;
  }

  /**
   * Test connection — verify page token is valid
   */
  async testConnection(pageId, pageToken) {
    try {
      const info = await this.getPageInfo(pageId, pageToken);
      return {
        success: true,
        message: `Kết nối thành công! Page: ${info.name} (${info.fan_count || 0} người theo dõi)`,
        pageInfo: {
          name: info.name,
          fanCount: info.fan_count,
          category: info.category,
          picture: info.picture?.data?.url || null,
          link: info.link,
        },
      };
    } catch (err) {
      const fbError = err.response?.data?.error;
      let msg = err.message;
      if (fbError) {
        if (fbError.code === 190) msg = "Token đã hết hạn hoặc không hợp lệ. Vui lòng tạo lại Page Access Token.";
        else if (fbError.code === 200) msg = "Không có quyền. Đảm bảo token có permission pages_manage_posts.";
        else msg = fbError.message || msg;
      }
      return { success: false, message: `Lỗi: ${msg}` };
    }
  }

  // ==================== Utilities ====================

  /**
   * Force Facebook to re-scrape a URL (refresh OG cache)
   */
  async scrapeUrl(pageToken, url) {
    try {
      const resp = await axios.post(
        `${GRAPH_API}/`,
        null,
        {
          params: { id: url, scrape: true, access_token: pageToken },
          timeout: 15000,
        }
      );
      return {
        success: true,
        title: resp.data.title,
        description: resp.data.description,
        image: resp.data.image?.[0]?.url || null,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new FacebookService();
