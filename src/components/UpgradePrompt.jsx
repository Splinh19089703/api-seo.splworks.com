import { useState } from "react";
import PricingModal from "./PricingModal";
import { useAuth } from "../context/AuthContext";

const PLAN_NAMES = {
  trial: "Dùng thử",
  basic: "Basic",
  pro: "Pro",
  agency: "Agency",
  unlimited: "Unlimited",
};

const FEATURE_LABELS = {
  seoAudit: "SEO Audit",
  multiPlatform: "Đăng đa nền tảng",
  googleSearchConsole: "Google Search Console",
  knowledgeBase: "Knowledge Base",
  internalLinks: "Internal Links",
  prioritySupport: "Hỗ trợ ưu tiên",
  affiliate: "CTV / Affiliate",
};

const MIN_PLAN_FOR_FEATURE = {
  seoAudit: "Pro",
  multiPlatform: "Pro",
  googleSearchConsole: "Agency",
  prioritySupport: "Agency",
  affiliate: "Unlimited",
};

/**
 * UpgradePrompt — Shown when user hits a limit or feature is locked
 * 
 * @param {"feature_locked"|"article_limit"|"project_limit"} type
 * @param {string} feature - Feature name (for feature_locked)
 * @param {number} limit - Max allowed
 * @param {number} used - Currently used
 * @param {string} variant - "inline" (default) | "card" | "fullpage"
 */
export default function UpgradePrompt({ type, feature, limit, used, variant = "inline" }) {
  const [showPricing, setShowPricing] = useState(false);
  const { license } = useAuth();
  const currentPlan = PLAN_NAMES[license?.plan] || license?.plan || "Hiện tại";

  let icon, title, description;

  switch (type) {
    case "feature_locked":
      icon = "🔒";
      title = `${FEATURE_LABELS[feature] || feature} — Cần nâng cấp`;
      description = `Tính năng ${FEATURE_LABELS[feature] || feature} chỉ có từ gói ${MIN_PLAN_FOR_FEATURE[feature] || "Pro"} trở lên. Bạn đang dùng gói ${currentPlan}.`;
      break;
    case "article_limit":
      icon = "📝";
      title = "Đã đạt giới hạn bài viết";
      description = `Bạn đã sử dụng ${used || 0}/${limit || 0} bài viết tháng này (gói ${currentPlan}). Nâng cấp để tạo thêm bài viết.`;
      break;
    case "project_limit":
      icon = "📁";
      title = "Đã đạt giới hạn dự án";
      description = `Bạn đã tạo ${used || 0}/${limit || 0} dự án (gói ${currentPlan}). Nâng cấp để tạo thêm dự án.`;
      break;
    default:
      icon = "⬆️";
      title = "Nâng cấp gói";
      description = "Nâng cấp để mở khoá tính năng này.";
  }

  if (variant === "fullpage") {
    return (
      <>
        <div className="upgrade-prompt-fullpage">
          <div className="upgrade-prompt-icon-large">{icon}</div>
          <h2>{title}</h2>
          <p>{description}</p>
          <button className="btn-primary" onClick={() => setShowPricing(true)}>
            Xem bảng giá & Nâng cấp
          </button>
        </div>
        {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
      </>
    );
  }

  if (variant === "card") {
    return (
      <>
        <div className="upgrade-prompt-card">
          <div className="upgrade-prompt-card-header">
            <span className="upgrade-prompt-icon">{icon}</span>
            <strong>{title}</strong>
          </div>
          <p>{description}</p>
          <button className="btn-outline-primary btn-sm" onClick={() => setShowPricing(true)}>
            Xem bảng giá
          </button>
        </div>
        {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
      </>
    );
  }

  // variant === "inline" (default)
  return (
    <>
      <div className="upgrade-prompt-inline">
        <span className="upgrade-prompt-icon">{icon}</span>
        <div className="upgrade-prompt-text">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <button className="btn-outline-primary btn-sm" onClick={() => setShowPricing(true)}>
          Nâng cấp
        </button>
      </div>
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </>
  );
}
