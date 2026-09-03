import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";
import { Link, useNavigate } from "react-router-dom";
import { TaskQueueWidget } from "../context/TaskQueueContext";

const STATUS_MAP = {
  pending:   { label: "Chờ",         color: "#6b7280", bg: "rgba(107,114,128,0.12)", icon: "⏳" },
  research:  { label: "Nghiên cứu",  color: "#3b82f6", bg: "rgba(59,130,246,0.12)",  icon: "🔍" },
  outline:   { label: "Outline",     color: "#8b5cf6", bg: "rgba(139,92,246,0.12)",  icon: "📋" },
  content:   { label: "Viết bài",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  icon: "✍️" },
  thumbnail: { label: "Tạo ảnh",     color: "#06b6d4", bg: "rgba(6,182,212,0.12)",   icon: "🖼️" },
  sections:  { label: "Ảnh section", color: "#06b6d4", bg: "rgba(6,182,212,0.12)",   icon: "🎨" },
  review:    { label: "Hoàn thành",  color: "#10b981", bg: "rgba(16,185,129,0.12)",  icon: "✅" },
  published: { label: "Đã đăng",    color: "#10b981", bg: "rgba(16,185,129,0.12)",  icon: "🌐" },
  error:     { label: "Lỗi",         color: "#ef4444", bg: "rgba(239,68,68,0.12)",   icon: "❌" },
};

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

export default function Dashboard() {
  const [drafts, setDrafts]       = useState([]);
  const [activeTasks, setActive]  = useState([]);
  const [wpSites, setWpSites]     = useState([]);
  const [dashData, setDashData]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const navigate = useNavigate();
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [draftsRes, activeRes, sitesRes, dashRes] = await Promise.allSettled([
        api.getDrafts(),
        api.getActiveTasks(),
        api.getWpSites(),
        api.getDashboard(),
      ]);
      if (draftsRes.status === "fulfilled") setDrafts(draftsRes.value || []);
      if (activeRes.status === "fulfilled") setActive(activeRes.value || []);
      if (sitesRes.status === "fulfilled") setWpSites(sitesRes.value || []);
      if (dashRes.status === "fulfilled") setDashData(dashRes.value);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll active tasks mỗi 5s khi có task đang chạy — chỉ khi tab visible (tránh request trùng lãng phí)
  useEffect(() => {
    if (activeTasks.length > 0) {
      pollRef.current = setInterval(() => {
        if (document.hidden) return; // skip poll khi tab ẩn
        api.getActiveTasks().then(t => setActive(t || [])).catch(() => {});
        api.getDrafts().then(d => setDrafts(d || [])).catch(() => {});
      }, 5000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [activeTasks.length]);

  // Derived stats
  const today = new Date().toDateString();
  const todayDrafts   = drafts.filter(d => new Date(d.createdAt).toDateString() === today);
  const doneDrafts    = drafts.filter(d => d.pipeline?.autoStep === "done" || d.status === "review");
  const publishedDrafts = drafts.filter(d => d.status === "published" || (d.pipeline?.publishedTo?.length > 0));
  const errorDrafts   = drafts.filter(d => d.pipeline?.autoStep === "error");
  const recentDrafts  = [...drafts].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)).slice(0, 8);
  const connectedSites = wpSites.filter(s => s.lastTestOk === true);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Chào buổi sáng! ☀️";
    if (h < 18) return "Chào buổi chiều! 🌤️";
    return "Chào buổi tối! 🌙";
  };

  if (loading) return (
    <div className="loading-overlay"><span className="loader" /> Đang tải...</div>
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>{greeting()}</h1>
          <p className="subtitle" style={{ margin: "4px 0 0" }}>
            {new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/pipeline" className="btn btn-primary btn-lg">✍️ Tạo bài mới</Link>
        </div>
      </div>

      {/* Active Tasks Banner */}
      {activeTasks.length > 0 && (
        <div className="active-banner">
          <span className="banner-dot" />
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, color: "var(--accent-primary)" }}>
              Đang xử lý {activeTasks.length} bài viết
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>
              {activeTasks.map(t => t.keyword).join(" · ")}
            </span>
          </div>
          <Link to="/pipeline" className="btn btn-secondary btn-sm">Xem chi tiết →</Link>
        </div>
      )}

      {/* F4: Global Task Queue Widget */}
      <TaskQueueWidget />

      {/* Stat Cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-icon purple">📄</div>
          <div className="stat-label">Tổng bài viết</div>
          <div className="stat-value">{drafts.length}</div>
          <div className="stat-sub">+{todayDrafts.length} hôm nay</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">⚡</div>
          <div className="stat-label">Đang chạy</div>
          <div className="stat-value blue">{activeTasks.length}</div>
          <div className="stat-sub">pipeline tự động</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">✅</div>
          <div className="stat-label">Hoàn thành</div>
          <div className="stat-value green">{doneDrafts.length}</div>
          <div className="stat-sub">sẵn sàng đăng</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">🌐</div>
          <div className="stat-label">Đã đăng</div>
          <div className="stat-value green">{publishedDrafts.length}</div>
          <div className="stat-sub">lên WordPress</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon cyan">🔗</div>
          <div className="stat-label">Kết nối WP</div>
          <div className={`stat-value ${connectedSites.length > 0 ? "green" : ""}`}>
            {connectedSites.length}/{wpSites.length}
          </div>
          <div className="stat-sub">site hoạt động</div>
        </div>
      </div>

      {/* Main grid */}
      <div className="dashboard-grid">

        {/* Left: Recent Articles */}
        <div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>📄 Bài viết gần đây</h3>
              <Link to="/pipeline" className="btn btn-secondary btn-sm">Xem tất cả →</Link>
            </div>

            {recentDrafts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>✍️</div>
                <p style={{ margin: "0 0 12px", fontSize: 14 }}>Chưa có bài viết nào</p>
                <Link to="/pipeline" className="btn btn-primary btn-sm">Tạo bài đầu tiên →</Link>
              </div>
            ) : (
              <div>
                {recentDrafts.map((d) => {
                  const autoStep = d.pipeline?.autoStep;
                  const st = autoStep
                    ? (STATUS_MAP[autoStep] || STATUS_MAP.pending)
                    : (d.status === "published" ? STATUS_MAP.published : STATUS_MAP.pending);
                  const title = d.pipeline?.outline?.title || d.keyword;
                  const wordCount = d.pipeline?.content?.wordCount;
                  const thumb = d.pipeline?.thumbnail?.url;
                  const isRunning = autoStep && !["done", "error", null].includes(autoStep);
                  const publishedSite = d.pipeline?.publishedTo?.[d.pipeline.publishedTo.length - 1];

                  return (
                    <div key={d.id} className="article-row" onClick={() => navigate("/pipeline")}>
                      {/* Thumbnail */}
                      <div className="article-thumb">
                        {thumb
                          ? <img src={thumb} alt="" />
                          : <span style={{ fontSize: 18 }}>{st.icon}</span>
                        }
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {title}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 8, marginTop: 2 }}>
                          <span>🔑 {d.keyword}</span>
                          {wordCount > 0 && <span>~{wordCount.toLocaleString()} từ</span>}
                          {publishedSite && <span style={{ color: "#10b981" }}>🌐 {publishedSite.siteName}</span>}
                        </div>
                      </div>

                      {/* Status */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span className="status-pill" style={{ background: st.bg, color: st.color }}>
                          {isRunning && <span className="loader" style={{ width: 8, height: 8 }} />}
                          {st.icon} {st.label}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 60, textAlign: "right" }}>
                          {timeAgo(d.updatedAt || d.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Quick Actions */}
          <div className="card">
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>⚡ Thao tác nhanh</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { to: "/pipeline", icon: "✍️", label: "Tạo bài viết mới" },
                { to: "/projects", icon: "📁", label: "Quản lý dự án" },
                { to: "/audit",    icon: "🔍", label: "SEO Audit" },
                { to: "/settings", icon: "🔗", label: "Kết nối WordPress" },
                { to: "/settings/ai-provider", icon: "🤖", label: "Cấu hình AI" },
              ].map(a => (
                <Link key={a.to} to={a.to} className="quick-action">
                  <span className="qa-icon">{a.icon}</span>
                  {a.label}
                </Link>
              ))}
            </div>
          </div>

          {/* WordPress Sites */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🌐 WordPress Sites</h3>
              <Link to="/settings" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}>Quản lý</Link>
            </div>
            {wpSites.length === 0 ? (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-muted)", fontSize: 12 }}>
                Chưa có site nào.
                <br />
                <Link to="/settings" style={{ color: "var(--accent-primary)", fontSize: 12 }}>+ Thêm ngay →</Link>
              </div>
            ) : (
              wpSites.map(site => {
                const ok = site.lastTestOk === true;
                const err = site.lastTestOk === false;
                return (
                  <div key={site.id} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
                    borderBottom: "1px solid var(--border-light)",
                  }}>
                    <span style={{ fontSize: 14 }}>{ok ? "🟢" : err ? "🔴" : "⚪"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {site.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{site.siteUrl}</div>
                    </div>
                    {err && (
                      <Link to="/settings" style={{ fontSize: 11, color: "#ef4444" }}>Sửa →</Link>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Stats tổng */}
          <div className="card">
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>📊 Thống kê</h3>
            {[
              ["Bài viết", drafts.length],
              ["Dự án", dashData?.projects || 0],
              ["SEO Audits", dashData?.audits || 0],
              ["API Keys", dashData?.apiKeys || 0],
              ["Lỗi pipeline", errorDrafts.length],
            ].map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: "1px solid var(--border-light)" }}>
                <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                <span style={{ fontWeight: 700, color: label === "Lỗi pipeline" && val > 0 ? "#ef4444" : "inherit" }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Error alert nếu có lỗi */}
          {errorDrafts.length > 0 && (
            <div style={{
              padding: "10px 14px", borderRadius: 10,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            }}>
              <div style={{ fontWeight: 600, color: "#ef4444", fontSize: 13, marginBottom: 6 }}>
                ❌ {errorDrafts.length} bài gặp lỗi
              </div>
              {errorDrafts.slice(0, 3).map(d => (
                <div key={d.id} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "2px 0" }}>
                  · {d.keyword}
                </div>
              ))}
              <Link to="/pipeline" style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>
                Xem & chạy lại →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
