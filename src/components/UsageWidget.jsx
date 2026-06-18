import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import api from "../api";

const PLAN_LABELS = {
  trial: "Dùng thử",
  basic: "Basic",
  pro: "Pro",
  agency: "Agency",
  unlimited: "Unlimited",
};

const PLAN_COLORS = {
  trial: "#8899aa",
  basic: "#3b82f6",
  pro: "#8b5cf6",
  agency: "#f59e0b",
  unlimited: "#10b981",
};

export default function UsageWidget() {
  const { license, usage, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [aiCredits, setAiCredits] = useState(null);

  // Fetch AI credits
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    const fetchCredits = async () => {
      try {
        const res = await api.get("/ai-credits");
        if (!cancelled) setAiCredits(res.data);
      } catch {
        // silently fail
      }
    };

    fetchCredits();
    // Refresh every 2 minutes
    const interval = setInterval(fetchCredits, 2 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isAuthenticated]);

  if (!isAuthenticated || !license) return null;

  const plan = license.plan || "trial";
  const label = PLAN_LABELS[plan] || plan;
  const color = PLAN_COLORS[plan] || "#8899aa";
  const maxArticles = license.limits?.maxArticlesPerMonth || 10;
  const usedArticles = usage?.articlesCreated || 0;
  const percent = maxArticles >= 999999 ? 0 : Math.min(100, Math.round((usedArticles / maxArticles) * 100));

  // AI Credits
  const creditUsed = aiCredits?.used || 0;
  const creditLimit = aiCredits?.limit || license.limits?.aiCreditsPerMonth || 100;
  const creditPercent = creditLimit >= 50000 ? 0 : Math.min(100, Math.round((creditUsed / creditLimit) * 100));
  const showCredits = creditLimit < 50000; // Don't show for unlimited

  // Calculate remaining days
  let daysLeft = null;
  if (license.expiresAt) {
    const now = new Date();
    const exp = new Date(license.expiresAt);
    daysLeft = Math.max(0, Math.ceil((exp - now) / (1000 * 60 * 60 * 24)));
  }

  return (
    <div
      className="usage-widget"
      onClick={() => navigate("/account")}
      style={{ cursor: "pointer" }}
      title="Xem tài khoản"
    >
      <div className="usage-widget-header">
        <span className="plan-badge" style={{ background: color }}>
          {label}
        </span>
        {daysLeft !== null && (
          <span className="usage-days" style={{ color: daysLeft <= 3 ? "var(--accent-red)" : "var(--text-muted)" }}>
            {daysLeft <= 0 ? "Hết hạn" : `${daysLeft} ngày`}
          </span>
        )}
        {!license.expiresAt && plan !== "trial" && (
          <span className="usage-days" style={{ color: "var(--accent-green)" }}>Vĩnh viễn</span>
        )}
      </div>

      {/* Article usage */}
      {maxArticles < 999999 && (
        <>
          <div className="usage-stats">
            <span>{usedArticles} / {maxArticles} bài</span>
            <span style={{ color: percent >= 80 ? "var(--accent-red)" : "var(--text-muted)" }}>{percent}%</span>
          </div>
          <div className="usage-bar">
            <div
              className="usage-bar-fill"
              style={{
                width: `${percent}%`,
                background: percent >= 80 ? "var(--accent-red)" : color,
              }}
            />
          </div>
        </>
      )}
      {maxArticles >= 999999 && (
        <div className="usage-stats">
          <span>{usedArticles} bài đã tạo</span>
          <span style={{ color: "var(--accent-green)" }}>∞</span>
        </div>
      )}

      {/* AI Credits usage */}
      {showCredits && (
        <>
          <div className="usage-stats" style={{ marginTop: "6px" }}>
            <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>
              ⚡ {creditUsed} / {creditLimit} credits
            </span>
            <span style={{
              fontSize: "0.75rem",
              color: creditPercent >= 90 ? "var(--accent-red)" : creditPercent >= 70 ? "var(--accent-amber, #f59e0b)" : "var(--text-muted)"
            }}>
              {creditPercent}%
            </span>
          </div>
          <div className="usage-bar" style={{ height: "3px" }}>
            <div
              className="usage-bar-fill"
              style={{
                width: `${creditPercent}%`,
                background: creditPercent >= 90
                  ? "var(--accent-red)"
                  : creditPercent >= 70
                    ? "var(--accent-amber, #f59e0b)"
                    : "var(--accent-blue, #3b82f6)",
                transition: "width 0.5s ease",
              }}
            />
          </div>
          {creditPercent >= 90 && (
            <div style={{
              fontSize: "0.7rem",
              color: "var(--accent-red)",
              marginTop: "4px",
              textAlign: "center",
            }}>
              ⚠️ Sắp hết AI credits
            </div>
          )}
        </>
      )}
    </div>
  );
}
