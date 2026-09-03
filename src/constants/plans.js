/**
 * Constants dùng chung — Single source of truth cho plans/status trên client.
 * Trước đây lặp ở UpgradePrompt, UsageWidget, Account, PricingModal, Dashboard, Pipeline, WooProducts.
 */

export const PLAN_NAMES = {
  trial: "Dùng thử",
  basic: "Basic",
  pro: "Pro",
  agency: "Agency",
  unlimited: "Unlimited",
};

export const PLAN_COLORS = {
  trial: "#94a3b8",
  basic: "#3b82f6",
  pro: "#8b5cf6",
  agency: "#f59e0b",
  unlimited: "#10b981",
};

export const ARTICLE_STATUS = {
  draft: { label: "Nháp", color: "#6366f1", icon: "📝" },
  writing: { label: "Đang viết", color: "#f59e0b", icon: "✍️" },
  done: { label: "Hoàn thành", color: "#10b981", icon: "✅" },
  published: { label: "Đã đăng", color: "#10b981", icon: "🚀" },
  error: { label: "Lỗi", color: "#ef4444", icon: "⚠️" },
  pending: { label: "Chờ xử lý", color: "#f59e0b", icon: "⏳" },
  processing: { label: "Đang xử lý", color: "#f59e0b", icon: "🔄" },
};

export const FEATURE_LABELS = {
  seoAudit: "SEO Audit",
  multiPlatform: "Đăng đa nền tảng",
  googleSearchConsole: "Google Search Console",
  knowledgeBase: "Knowledge Base",
  internalLinks: "Internal Links",
  prioritySupport: "Hỗ trợ ưu tiên",
  affiliate: "CTV / Affiliate",
  aiWriting: "AI Writing",
  aiImage: "Tạo ảnh AI",
  wpPublish: "Đăng WordPress",
};

export const MIN_PLAN_FOR_FEATURE = {
  seoAudit: "Pro",
  multiPlatform: "Pro",
  googleSearchConsole: "Agency",
  prioritySupport: "Agency",
  affiliate: "Unlimited",
};

export function statusInfo(status) {
  return ARTICLE_STATUS[status] || { label: status || "Không rõ", color: "#94a3b8", icon: "❔" };
}

export function planName(plan) {
  return PLAN_NAMES[plan] || plan || "Hiện tại";
}
