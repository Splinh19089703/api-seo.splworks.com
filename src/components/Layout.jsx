import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import UsageWidget from "./UsageWidget";
import ActiveTasksWidget, { useActiveTasks } from "./ActiveTasksWidget";
import { useAuth } from "../context/AuthContext";
import PricingModal from "./PricingModal";

export default function Layout() {
  const { user, license, refreshLicense } = useAuth();
  const [showPricing, setShowPricing] = useState(false);
  const [licenseBlocked, setLicenseBlocked] = useState(false);
  const features = license?.features || {};
  const activeTasks = useActiveTasks(); // Poll running pipelines every 5s
  const licenseExpired = useMemo(() => {
    if (!license?.expiresAt) return false;
    return new Date(license.expiresAt).getTime() <= Date.now();
  }, [license?.expiresAt]);
  const needsPayment = !!user && (!license || licenseExpired || licenseBlocked);

  useEffect(() => {
    const onLicenseBlocked = () => {
      setLicenseBlocked(true);
      setShowPricing(true);
      refreshLicense();
    };
    window.addEventListener("splseo:license-blocked", onLicenseBlocked);
    return () =>
      window.removeEventListener("splseo:license-blocked", onLicenseBlocked);
  }, [refreshLicense]);

  useEffect(() => {
    if (needsPayment) setShowPricing(true);
    if (license && !licenseExpired) setLicenseBlocked(false);
  }, [needsPayment, license, licenseExpired]);

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">S</div>
          <div>
            <div className="logo-text">SPLSEO</div>
            <div className="logo-version">v2.0.0</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">📊</span> Tổng quan
          </NavLink>
          <NavLink
            to="/projects"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">📁</span> Dự án
          </NavLink>
          <NavLink
            to="/audit"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">🔍</span> SEO Audit
            {!features.seoAudit ? (
              <span className="nav-badge nav-badge-lock">🔒</span>
            ) : (
              <span className="nav-badge">Beta</span>
            )}
          </NavLink>
          <NavLink
            to="/pipeline"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">✍️</span> Tạo bài viết
            {activeTasks.length > 0 && (
              <span
                className="nav-badge"
                style={{
                  background: "var(--accent-orange, #f97316)",
                  color: "#fff",
                  marginLeft: "auto",
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 10,
                  fontWeight: 700,
                }}
              >
                {activeTasks.length}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/topical-map"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">🗺️</span> Topical Map
          </NavLink>
          <NavLink
            to="/indexer"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">🚀</span> URL Indexer
          </NavLink>
          <NavLink
            to="/queue"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">📅</span> Publish Queue
          </NavLink>
          <NavLink
            to="/woo"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">🛒</span> WooCommerce AI
            <span className="nav-badge" style={{ background: "var(--accent-green, #10b981)", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 8, fontWeight: 700, marginLeft: "auto" }}>Mới</span>
          </NavLink>
          <NavLink
            to="/keyword-planner"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">📊</span> Keyword Planner
          </NavLink>
          <NavLink
            to="/gsc"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">📈</span> Search Console
            <span className="nav-badge" style={{ background: "var(--accent-green, #10b981)", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 8, fontWeight: 700, marginLeft: "auto" }}>Mới</span>
          </NavLink>
          <NavLink
            to="/affiliate"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">🤝</span> Kiếm tiền CTV
            <span className="nav-badge" style={{ background: "#10b981", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 8, fontWeight: 700, marginLeft: "auto" }}>Mới</span>
          </NavLink>
          <NavLink
            to="/publish"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span className="nav-icon">📤</span> Đăng bài
            {!features.multiPlatform && (
              <span className="nav-badge nav-badge-lock" title="Đa nền tảng cần gói Pro+">🔒</span>
            )}
          </NavLink>
        </nav>

        <div className="sidebar-bottom">
          {/* Active pipeline tasks widget */}
          <ActiveTasksWidget />

          {/* Usage Widget */}
          <UsageWidget />

          {/* Account & Settings Links */}
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
            <NavLink
              to="/account"
              className={({ isActive }) => (isActive ? "active" : "")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              <span>👤</span> {user?.name || "Tài khoản"}
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => (isActive ? "active" : "")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              <span>⚙️</span> Cài đặt
            </NavLink>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {needsPayment ? (
          <div
            style={{
              minHeight: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <div
              style={{
                maxWidth: 560,
                width: "100%",
                background: "var(--surface)",
                border: "1px solid var(--border-color)",
                borderRadius: 12,
                padding: 28,
                textAlign: "center",
                boxShadow: "var(--shadow-lg)",
              }}
            >
              <div style={{ fontSize: 34, marginBottom: 12 }}>🔒</div>
              <h2 style={{ margin: "0 0 10px", fontSize: 22 }}>
                Gói dùng thử đã hết hạn
              </h2>
              <p
                style={{
                  margin: "0 0 20px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                Chọn gói phù hợp để tiếp tục sử dụng SPLSEO. Hệ thống sẽ
                tạo mã QR chuyển khoản theo tài khoản ACB đã cấu hình và
                gửi thông báo đơn mới qua Zalo bot để admin xác nhận.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => setShowPricing(true)}
              >
                Xem bảng giá và thanh toán
              </button>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
        {showPricing && (
          <PricingModal
            isOpen={showPricing}
            onClose={() => setShowPricing(false)}
          />
        )}
      </main>
    </div>
  );
}
