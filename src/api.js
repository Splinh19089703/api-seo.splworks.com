const API_BASE = import.meta.env.VITE_API_BASE || "/api";

/**
 * Get auth token from localStorage
 */
function getAuthToken() {
  return localStorage.getItem("splseo-token");
}

async function fetchApi(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const isPost = options.method === "POST" || options.method === "PUT";
  const timeoutMs = isPost ? 120000 : 30000; // 120s for POST (AI calls), 30s for GET
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const config = {
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    ...options,
  };

  // Add auth token to all requests
  const token = getAuthToken();
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }

  if (config.body && typeof config.body === "object") {
    config.body = JSON.stringify(config.body);
  }
  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    // Handle 401 — clear session và redirect về login (trừ khi đang ở trang login/register)
    if (response.status === 401) {
      const errorData = await response.json().catch(() => ({}));
      if (errorData.requireAuth) {
        const currentToken = getAuthToken();
        // Không để request cũ/chưa có token xóa token mới vừa login Google.
        const shouldClearSession = token && currentToken === token;
        if (shouldClearSession) {
          localStorage.removeItem("splseo-token");
          // Chỉ redirect khi token thực sự hết hạn giữa phiên — tránh loop khi trang login tự gọi API
          if (!["/login", "/register"].includes(window.location.pathname)) {
            window.location.assign("/login");
          }
        }
      }
      throw new Error(errorData.error || "Phiên đăng nhập hết hạn");
    }

    // Handle 403 — license limits / feature locks
    if (response.status === 403) {
      const errorData = await response.json().catch(() => ({}));
      const err = new Error(errorData.message || errorData.error || "Không có quyền truy cập");
      if (["NO_LICENSE", "LICENSE_EXPIRED", "INVALID_LICENSE"].includes(errorData.code)) {
        window.dispatchEvent(
          new CustomEvent("splseo:license-blocked", { detail: errorData }),
        );
      }
      err.code = errorData.code; // "FEATURE_LOCKED" | "ARTICLE_LIMIT" | "PROJECT_LIMIT"
      err.limit = errorData.limit;
      err.used = errorData.used;
      err.requested = errorData.requested;
      err.currentPlan = errorData.currentPlan;
      err.feature = errorData.feature;
      err.isLicenseError = true;
      throw err;
    }

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Server error" }));
      throw new Error(error.error || "Request failed");
    }
    return response.json();
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      throw new Error("Request timeout - AI đang xử lý quá lâu. Thử lại sau.");
    }
    throw e;
  }
}

export const api = {
  // ===== Auth =====
  login: (email, password) =>
    fetchApi("/auth/login", { method: "POST", body: { email, password } }),
  register: (email, password, name, referredBy) =>
    fetchApi("/auth/register", {
      method: "POST",
      body: referredBy ? { email, password, name, referredBy } : { email, password, name },
    }),
  googleLogin: (idToken, referralCode) =>
    fetchApi("/auth/google", {
      method: "POST",
      body: referralCode ? { idToken, referralCode } : { idToken },
    }),
  getMe: () => fetchApi("/auth/me"),
  getMeFresh: () => fetchApi("/auth/me?refresh=true"),
  logout: () => fetchApi("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword, newPassword) =>
    fetchApi("/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    }),
  getLicenseInfo: () => fetchApi("/auth/license-info"),
  deactivateDevice: (deviceId) =>
    fetchApi("/auth/deactivate-device", { method: "POST", body: { deviceId } }),
  getPlans: () => fetchApi("/auth/plans"),

  // ===== Orders & Coupons =====
  createOrder: (data) =>
    fetchApi("/auth/create-order", { method: "POST", body: data }),
  applyCoupon: (data) =>
    fetchApi("/auth/apply-coupon", { method: "POST", body: data }),
  getMyOrders: () => fetchApi("/auth/my-orders"),

  // ===== Dashboard =====
  getDashboard: () => fetchApi("/dashboard"),

  // ===== Projects =====
  getProjects: () => fetchApi("/projects"),
  getProject: (id) => fetchApi(`/projects/${id}`),
  createProject: (data) =>
    fetchApi("/projects", { method: "POST", body: data }),
  updateProject: (id, data) =>
    fetchApi(`/projects/${id}`, { method: "PUT", body: data }),
  cloneProject: (id) => fetchApi(`/projects/${id}/clone`, { method: "POST" }),
  deleteProject: (id) => fetchApi(`/projects/${id}`, { method: "DELETE" }),
  getProjectStats: (id) => fetchApi(`/projects/${id}/stats`),
  testWordpress: (id) =>
    fetchApi(`/projects/${id}/test-wordpress`, { method: "POST" }),
  getChecklist: (id) => fetchApi(`/projects/${id}/checklist`),
  importProjectKeywords: (pid, data) =>
    fetchApi(`/projects/${pid}/keywords/import`, { method: "POST", body: data }),

  // KW Plans
  getKwPlans: (pid) => fetchApi(`/projects/${pid}/kwplans`),
  getKwPlan: (pid, planId) => fetchApi(`/projects/${pid}/kwplans/${planId}`),
  createKwPlan: (pid, data) =>
    fetchApi(`/projects/${pid}/kwplans`, { method: "POST", body: data }),
  updateKwPlan: (pid, planId, data) =>
    fetchApi(`/projects/${pid}/kwplans/${planId}`, {
      method: "PUT",
      body: data,
    }),
  deleteKwPlan: (pid, planId) =>
    fetchApi(`/projects/${pid}/kwplans/${planId}`, { method: "DELETE" }),
  generatePlanTitles: (pid, planId) =>
    fetchApi(`/projects/${pid}/kwplans/${planId}/generate-titles`, {
      method: "POST",
    }),

  // AI Keyword Clustering
  getClusterings: (pid) => fetchApi(`/projects/${pid}/clustering`),
  getClustering: (pid, cid) => fetchApi(`/projects/${pid}/clustering/${cid}`),
  startClustering: (pid, data) =>
    fetchApi(`/projects/${pid}/clustering`, { method: "POST", body: data }),
  saveClusteringAsPlan: (pid, cid, data) =>
    fetchApi(`/projects/${pid}/clustering/${cid}/save-plan`, {
      method: "POST",
      body: data,
    }),
  deleteClustering: (pid, cid) =>
    fetchApi(`/projects/${pid}/clustering/${cid}`, { method: "DELETE" }),
  cancelClustering: (pid, cid) =>
    fetchApi(`/projects/${pid}/clustering/${cid}/cancel`, { method: "POST" }),

  // Articles
  getArticles: (pid) => fetchApi(`/projects/${pid}/articles`),
  getArticle: (pid, aid) => fetchApi(`/projects/${pid}/articles/${aid}`),
  createArticles: (pid, data) =>
    fetchApi(`/projects/${pid}/articles`, { method: "POST", body: data }),
  updateArticle: (pid, aid, data) =>
    fetchApi(`/projects/${pid}/articles/${aid}`, { method: "PUT", body: data }),
  deleteArticle: (pid, aid) =>
    fetchApi(`/projects/${pid}/articles/${aid}`, { method: "DELETE" }),
  generateThumbnail: (pid, aid) =>
    fetchApi(`/projects/${pid}/articles/${aid}/thumbnail`, { method: "POST" }),
  generateSectionImages: (pid, aid) =>
    fetchApi(`/projects/${pid}/articles/${aid}/section-images`, {
      method: "POST",
    }),
  generateResearch: (pid, aid) =>
    fetchApi(`/projects/${pid}/articles/${aid}/research`, { method: "POST" }),
  generateOutline: (pid, aid) =>
    fetchApi(`/projects/${pid}/articles/${aid}/outline`, { method: "POST" }),
  generateContent: (pid, aid, mode = "basic") =>
    fetchApi(`/projects/${pid}/articles/${aid}/content`, {
      method: "POST",
      body: { mode },
    }),
  validateArticle: (pid, aid) =>
    fetchApi(`/projects/${pid}/articles/${aid}/validate`, { method: "POST" }),
  approveArticle: (pid, aid, data) =>
    fetchApi(`/projects/${pid}/articles/${aid}/approve`, {
      method: "POST",
      body: data,
    }),
  publishArticleWP: (pid, aid, data) =>
    fetchApi(`/projects/${pid}/articles/${aid}/publish-wp`, {
      method: "POST",
      body: data,
    }),

  // YouTube Videos
  getVideos: (pid) => fetchApi(`/projects/${pid}/videos`),
  addVideos: (pid, data) =>
    fetchApi(`/projects/${pid}/videos`, { method: "POST", body: data }),
  deleteVideo: (pid, vid) =>
    fetchApi(`/projects/${pid}/videos/${vid}`, { method: "DELETE" }),

  // Knowledge Base
  getKnowledgeBases: (pid) => fetchApi(`/projects/${pid}/knowledgebases`),
  createKnowledgeBase: (pid, data) =>
    fetchApi(`/projects/${pid}/knowledgebases`, { method: "POST", body: data }),
  deleteKnowledgeBase: (pid, kbId) =>
    fetchApi(`/projects/${pid}/knowledgebases/${kbId}`, { method: "DELETE" }),

  // Internal Links
  scanInternalLinks: (pid) =>
    fetchApi(`/projects/${pid}/internal-links/scan`, { method: "POST" }),
  applyInternalLinks: (pid, data) =>
    fetchApi(`/projects/${pid}/internal-links/apply`, {
      method: "POST",
      body: data,
    }),
  pushInternalLinksToWp: (pid, data) =>
    fetchApi(`/projects/${pid}/internal-links/push-wp`, {
      method: "POST",
      body: data,
    }),
  pushArticleToWp: (pid, articleId, data) =>
    fetchApi(`/projects/${pid}/articles/${articleId}/push-wp`, {
      method: "POST",
      body: data,
    }),

  // Settings
  getSettings: () => fetchApi("/settings"),
  updateSettings: (data) =>
    fetchApi("/settings", { method: "PUT", body: data }),
  clearCache: () => fetchApi("/settings/clear-cache", { method: "POST" }),

  // API Keys
  getApiKeys: () => fetchApi("/settings/api-keys"),
  createApiKey: (data) =>
    fetchApi("/settings/api-keys", { method: "POST", body: data }),
  testApiKey: (data) =>
    fetchApi("/settings/api-keys/test", { method: "POST", body: data }),
  deleteApiKey: (id) =>
    fetchApi(`/settings/api-keys/${id}`, { method: "DELETE" }),
  updateApiKey: (id, data) =>
    fetchApi(`/settings/api-keys/${id}`, { method: "PUT", body: data }),

  // WP Sites
  getWpSites: () => fetchApi("/settings/wp-sites"),
  createWpSite: (data) =>
    fetchApi("/settings/wp-sites", { method: "POST", body: data }),
  updateWpSite: (id, data) =>
    fetchApi(`/settings/wp-sites/${id}`, { method: "PUT", body: data }),
  testWpSite: (id) =>
    fetchApi(`/settings/wp-sites/${id}/test`, { method: "POST" }),
  syncWpCategories: (id) =>
    fetchApi(`/settings/wp-sites/${id}/sync-categories`, { method: "POST" }),
  deleteWpSite: (id) =>
    fetchApi(`/settings/wp-sites/${id}`, { method: "DELETE" }),

  // Generic REST helpers (used by components that build their own URLs)
  get: (path) => fetchApi(path),
  post: (path, data) => fetchApi(path, { method: "POST", body: data }),
  put: (path, data) => fetchApi(path, { method: "PUT", body: data }),
  del: (path) => fetchApi(path, { method: "DELETE" }),

  // Active tasks (pipeline monitor)
  getActiveTasks: () => fetchApi("/content/active-tasks"),

  // Prompts
  getPrompts: () => fetchApi("/settings/prompts"),
  createPrompt: (data) =>
    fetchApi("/settings/prompts", { method: "POST", body: data }),
  updatePrompt: (id, data) =>
    fetchApi(`/settings/prompts/${id}`, { method: "PUT", body: data }),
  deletePrompt: (id) =>
    fetchApi(`/settings/prompts/${id}`, { method: "DELETE" }),

  // SEO Audit
  getAudits: () => fetchApi("/audit"),
  getAudit: (id) => fetchApi(`/audit/${id}`),
  startAudit: (data) => fetchApi("/audit", { method: "POST", body: data }),
  recrawlAudit: (id, body = {}) =>
    fetchApi(`/audit/${id}/recrawl`, { method: "POST", body }),
  deleteAudit: (id) => fetchApi(`/audit/${id}`, { method: "DELETE" }),
  aiAnalyzePage: (id, pageUrl) =>
    fetchApi(`/audit/${id}/ai-analyze`, { method: "POST", body: { pageUrl } }),
  aiMetaRewrite: (id, pageUrl) =>
    fetchApi(`/audit/${id}/ai-meta`, { method: "POST", body: { pageUrl } }),

  // Content Pipeline
  research: (data) =>
    fetchApi("/content/research", { method: "POST", body: data }),
  publishToWp: (data) =>
    fetchApi("/content/publish", { method: "POST", body: data }),

  // Standalone Drafts
  getDrafts: () => fetchApi("/content/drafts"),
  getDraft: (id) => fetchApi(`/content/drafts/${id}`),
  createDraft: (data) =>
    fetchApi("/content/drafts", { method: "POST", body: data }),
  updateDraft: (id, data) =>
    fetchApi(`/content/drafts/${id}`, { method: "PUT", body: data }),
  deleteDraft: (id) => fetchApi(`/content/drafts/${id}`, { method: "DELETE" }),
  generateDraftThumbnail: (id) =>
    fetchApi(`/content/drafts/${id}/thumbnail`, { method: "POST" }),
  generateDraftSectionImages: (id) =>
    fetchApi(`/content/drafts/${id}/section-images`, { method: "POST" }),
  generateDraftResearch: (id) =>
    fetchApi(`/content/drafts/${id}/research`, { method: "POST" }),
  generateDraftOutline: (id) =>
    fetchApi(`/content/drafts/${id}/outline`, { method: "POST" }),
  generateDraftContent: (id, mode = "basic", targetWordCount = 2000) =>
    fetchApi(`/content/drafts/${id}/content`, { method: "POST", body: { mode, targetWordCount } }),
  analyzeKeywords: (keywords) =>
    fetchApi("/content/analyze-keywords", {
      method: "POST",
      body: { keywords },
    }),
  runAutoPipeline: (id, opts = {}) =>
    fetchApi(`/content/drafts/${id}/auto-pipeline`, { method: "POST", body: opts }),
  rewriteDraftSections: (id, data) =>
    fetchApi(`/content/drafts/${id}/rewrite-sections`, { method: "POST", body: data }),
  publishDraftToWp: (id, data) =>
    fetchApi(`/content/drafts/${id}/publish-wp`, { method: "POST", body: data }),
  setAutoPublish: (id, data) =>
    fetchApi(`/content/drafts/${id}/auto-publish`, { method: "PUT", body: data }),
  bulkCreateDrafts: (data) =>
    fetchApi("/content/drafts/bulk", { method: "POST", body: data }),
  insertImagesIntoContent: (id) =>
    fetchApi(`/content/drafts/${id}/insert-images`, { method: "POST" }),
  setDraftThumbnailUrl: (id, data) =>
    fetchApi(`/content/drafts/${id}/thumbnail-url`, { method: "PUT", body: data }),
  setDraftSectionImage: (id, index, data) =>
    fetchApi(`/content/drafts/${id}/section-image/${index}`, { method: "PUT", body: data }),
  convertDraftToProject: (id, projectId) =>
    fetchApi(`/content/drafts/${id}/to-project`, { method: "POST", body: { projectId } }),

  // ===== Multi-Platform Publishing =====
  getPublishAccounts: () => fetchApi("/publish/accounts"),
  getPublishAccount: (id) => fetchApi(`/publish/accounts/${id}`),
  createPublishAccount: (data) =>
    fetchApi("/publish/accounts", { method: "POST", body: data }),
  updatePublishAccount: (id, data) =>
    fetchApi(`/publish/accounts/${id}`, { method: "PUT", body: data }),
  deletePublishAccount: (id) =>
    fetchApi(`/publish/accounts/${id}`, { method: "DELETE" }),
  testPublishAccount: (id) =>
    fetchApi(`/publish/accounts/${id}/test`, { method: "POST" }),
  syncAccountCategories: (id) =>
    fetchApi(`/publish/accounts/${id}/categories`, { method: "POST" }),
  publishNow: (data) =>
    fetchApi("/publish/now", { method: "POST", body: data }),
  getPublishHistory: (params) =>
    fetchApi(
      `/publish/history${params ? "?" + new URLSearchParams(params) : ""}`,
    ),
  getArticlePublishHistory: (articleId) =>
    fetchApi(`/publish/history/${articleId}`),

  // ===== Topical Map =====
  getTopicalMaps: () =>
    fetchApi("/topical-map"),
  getTopicalMap: (id) =>
    fetchApi(`/topical-map/${id}`),
  generateTopicalMap: (data) =>
    fetchApi("/topical-map", { method: "POST", body: data }),
  deleteTopicalMap: (id) =>
    fetchApi(`/topical-map/${id}`, { method: "DELETE" }),
  importTopicalMapToPipeline: (id, articleIds) =>
    fetchApi(`/topical-map/${id}/import-to-pipeline`, {
      method: "POST",
      body: { articleIds },
    }),

  // ===== Indexer =====
  submitToBing: (data) =>
    fetchApi("/indexer/bing", { method: "POST", body: data }),
  submitToGoogle: (data) =>
    fetchApi("/indexer/google", { method: "POST", body: data }),
  getIndexerConfig: () =>
    fetchApi("/indexer/config"),
  getIndexHistory: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return fetchApi(`/indexer/history${q ? "?" + q : ""}`);
  },
  clearIndexHistory: () =>
    fetchApi("/indexer/history", { method: "DELETE" }),
  verifyBingKey: (data) =>
    fetchApi("/indexer/verify-bing", { method: "POST", body: data }),

  // ===== Publish Queue (T3) =====
  getQueue: () => fetchApi("/queue"),
  getQueueStats: () => fetchApi("/queue/stats"),
  addToQueue: (data) => fetchApi("/queue", { method: "POST", body: data }),
  updateQueueItem: (id, data) => fetchApi(`/queue/${id}`, { method: "PUT", body: data }),
  deleteQueueItem: (id) => fetchApi(`/queue/${id}`, { method: "DELETE" }),
  publishQueueNow: (id) => fetchApi(`/queue/${id}/publish`, { method: "POST" }),

  // ===== WooCommerce (Sprint 14) =====
  wooConnect: (siteId) =>
    fetchApi("/woo/connect", { method: "POST", body: { siteId } }),
  wooGetProducts: (siteId, params = {}) => {
    const q = new URLSearchParams({ siteId, ...params }).toString();
    return fetchApi(`/woo/products?${q}`);
  },
  wooGetProduct: (siteId, productId) =>
    fetchApi(`/woo/product/${productId}?siteId=${siteId}`),
  wooGetProductStats: (siteId) =>
    fetchApi(`/woo/product-stats?siteId=${siteId}`),
  wooGenerateDescription: (data) =>
    fetchApi("/woo/generate-description", { method: "POST", body: data }),
  wooBulkGenerate: (data) =>
    fetchApi("/woo/bulk-generate", { method: "POST", body: data }),
  wooPush: (data) =>
    fetchApi("/woo/push", { method: "POST", body: data }),

  // Plugin connection test
  testPluginConnection: (siteId) =>
    fetchApi(`/settings/wp-sites/${siteId}/test-plugin`, { method: "POST" }),

  // ===== Keyword Planner (Sprint 14) =====
  kwResearch: (data) =>
    fetchApi("/keywords/research", { method: "POST", body: data }),
  kwSuggest: (data) =>
    fetchApi("/keywords/suggest", { method: "POST", body: data }),
  kwRelated: (data) =>
    fetchApi("/keywords/related", { method: "POST", body: data }),
  kwExport: async (keywords, filename) => {
    const headers = { "Content-Type": "application/json" };
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`; // không gửi "Bearer null" khi chưa login
    const resp = await fetch(`${API_BASE}/keywords/export`, {
      method: "POST",
      headers,
      body: JSON.stringify({ keywords, filename }),
    });
    if (!resp.ok) throw new Error("Export thất bại");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename || "keyword-research"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // ===== Google Search Console (Sprint 15) =====
  gscStatus: () => fetchApi("/gsc/status"),
  gscAuthUrl: () => fetchApi("/gsc/auth-url"),
  gscDisconnect: () => fetchApi("/gsc/disconnect", { method: "POST" }),
  gscSites: () => fetchApi("/gsc/sites"),
  gscData: (data) => fetchApi("/gsc/data", { method: "POST", body: data }),
  gscTopQueries: ({ siteUrl, days = 28, limit = 50 }) => {
    const q = new URLSearchParams({ siteUrl, days, limit }).toString();
    return fetchApi(`/gsc/top-queries?${q}`);
  },
  gscTopPages: ({ siteUrl, days = 28, limit = 50 }) => {
    const q = new URLSearchParams({ siteUrl, days, limit }).toString();
    return fetchApi(`/gsc/top-pages?${q}`);
  },
  gscTrend: ({ siteUrl, days = 28 }) => {
    const q = new URLSearchParams({ siteUrl, days }).toString();
    return fetchApi(`/gsc/trend?${q}`);
  },
  gscClearCache: () => fetchApi("/gsc/clear-cache", { method: "POST" }),

  // ===== Affiliate / CTV (Sprint 15) =====
  affiliateLink: () => fetchApi("/affiliate/link"),
  affiliateStats: () => fetchApi("/affiliate/stats"),
  affiliateHistory: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return fetchApi(`/affiliate/history${q ? "?" + q : ""}`);
  },
  affiliatePayout: (data) => fetchApi("/affiliate/payout", { method: "POST", body: data }),

  // ===== Admin User Inspection (Read-Only) =====
  getAdminUsers: () => fetchApi("/admin/users"),
  getAdminUserSummary: (userId) => fetchApi(`/admin/users/${userId}/summary`),
  getAdminUserCredits: (userId) => fetchApi(`/admin/users/${userId}/credits`),
  getAdminUserProjects: (userId) => fetchApi(`/admin/users/${userId}/projects`),
  getAdminProjectArticles: (userId, projectId) => fetchApi(`/admin/users/${userId}/projects/${projectId}/articles`),
  getAdminArticleDetail: (userId, articleId) => fetchApi(`/admin/users/${userId}/articles/${articleId}`),
  getAdminUserDrafts: (userId) => fetchApi(`/admin/users/${userId}/drafts`),
  getAdminDraftDetail: (userId, draftId) => fetchApi(`/admin/users/${userId}/drafts/${draftId}`),
  getAdminUserAudits: (userId) => fetchApi(`/admin/users/${userId}/audits`),
  getAdminAuditDetail: (userId, auditId) => fetchApi(`/admin/users/${userId}/audits/${auditId}`),
  getAdminUserKwPlans: (userId) => fetchApi(`/admin/users/${userId}/kwplans`),
  getAdminUserWpSites: (userId) => fetchApi(`/admin/users/${userId}/wp-sites`),

  // ===== Social Hub =====
  createSocialAccount: (data) => fetchApi("/social/accounts", { method: "POST", body: data }),
  getSocialAccounts: () => fetchApi("/social/accounts"),
  getSocialAccount: (id) => fetchApi(`/social/accounts/${id}`),
  testSocialAccount: (id) => fetchApi(`/social/accounts/${id}/test`, { method: "POST" }),
  updateSocialAccount: (id, data) => fetchApi(`/social/accounts/${id}`, { method: "PUT", body: data }),
  deleteSocialAccount: (id) => fetchApi(`/social/accounts/${id}`, { method: "DELETE" }),
  socialShare: (data) => fetchApi("/social/share", { method: "POST", body: data }),
  socialPreviewUrl: (url) => fetchApi("/social/preview-url", { method: "POST", body: { url } }),
  socialImportUrls: (data) => fetchApi("/social/import-urls", { method: "POST", body: data }),
  getSocialQueue: () => fetchApi("/social/queue"),
  updateSocialQueueItem: (id, data) => fetchApi(`/social/queue/${id}`, { method: "PUT", body: data }),
  deleteSocialQueueItem: (id) => fetchApi(`/social/queue/${id}`, { method: "DELETE" }),
  publishSocialQueueItem: (id) => fetchApi(`/social/queue/${id}/publish`, { method: "POST" }),
  getSocialHistory: () => fetchApi("/social/history"),
};
