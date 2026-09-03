import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";
import SafeHtml from "../components/SafeHtml";

export default function AdminUsers() {
  const { user, loading: authLoading } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Inspection Drawer/Modal state
  const [selectedUser, setSelectedUser] = useState(null);

  // Load users list
  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getAdminUsers();
      if (res && res.users) {
        setUsers(res.users);
      }
    } catch (err) {
      console.error("Lỗi khi tải danh sách users:", err);
      setError(err.message || "Không thể tải danh sách user từ server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Check admin authorization — giữ flag, render-guard đặt sau tất cả hooks (rules of hooks)
  const isAdmin = Boolean(user?.role === "admin" || user?.isAdmin);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalArticles = 0;
    let totalErrors = 0;
    let activeLicenses = 0;

    for (const u of users) {
      totalArticles += u.stats?.articlesCount || 0;
      totalErrors += u.stats?.errorArticlesCount || 0;
      if (u.license?.status === "active") activeLicenses++;
    }

    return {
      totalUsers: users.length,
      activeLicenses,
      totalArticles,
      totalErrors,
    };
  }, [users]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchEmail = (u.email || "").toLowerCase().includes(q);
        const matchName = (u.name || "").toLowerCase().includes(q);
        const matchId = (u.id || "").toLowerCase().includes(q);
        if (!matchEmail && !matchName && !matchId) return false;
      }

      // Plan filter
      if (planFilter !== "all") {
        const userPlan = (u.license?.plan || "none").toLowerCase();
        if (userPlan !== planFilter) return false;
      }

      // Status filter
      if (statusFilter === "errors") {
        if ((u.stats?.errorArticlesCount || 0) === 0) return false;
      } else if (statusFilter === "active") {
        if (u.license?.status !== "active") return false;
      } else if (statusFilter === "expired") {
        if (u.license?.status !== "expired") return false;
      }

      return true;
    });
  }, [users, searchTerm, planFilter, statusFilter]);

  // Render-guard sau tất cả hooks — tránh lỗi rules-of-hooks khi redirect
  if (!authLoading && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="admin-users-page" style={{ paddingBottom: 60 }}>
      {/* Header */}
      <div
        className="page-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>🛡️ Quản lý & Giám sát Users</h1>
            <span
              className="badge badge-danger"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 12,
              }}
            >
              🔒 Admin Only • Read-Only
            </span>
          </div>
          <p className="subtitle" style={{ margin: 0, color: "var(--text-secondary, #94a3b8)", fontSize: 13 }}>
            Xem dữ liệu bài viết, dự án, audits và nhật ký lỗi của từng khách hàng để hỗ trợ và cải tiến sản phẩm.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={loadUsers}
          disabled={loading}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
        >
          <span>🔄</span> {loading ? "Đang tải..." : "Làm mới dữ liệu"}
        </button>
      </div>

      {/* Top Metric Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ padding: 16, borderLeft: "4px solid #3b82f6" }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary, #94a3b8)", marginBottom: 4 }}>
            👥 Tổng số Khách hàng
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary, #fff)" }}>
            {metrics.totalUsers}
          </div>
        </div>

        <div className="card" style={{ padding: 16, borderLeft: "4px solid #10b981" }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary, #94a3b8)", marginBottom: 4 }}>
            ✅ License Hoạt động
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#10b981" }}>
            {metrics.activeLicenses}
          </div>
        </div>

        <div className="card" style={{ padding: 16, borderLeft: "4px solid #8b5cf6" }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary, #94a3b8)", marginBottom: 4 }}>
            📝 Tổng bài viết đã tạo
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#a78bfa" }}>
            {metrics.totalArticles}
          </div>
        </div>

        <div className="card" style={{ padding: 16, borderLeft: "4px solid #ef4444" }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary, #94a3b8)", marginBottom: 4 }}>
            ⚠️ Bài viết phát sinh lỗi
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: metrics.totalErrors > 0 ? "#ef4444" : "#10b981" }}>
            {metrics.totalErrors}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div
        className="card"
        style={{
          padding: 16,
          marginBottom: 20,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          background: "var(--card-bg, rgba(255,255,255,0.03))",
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <input
            type="text"
            placeholder="🔍 Tìm theo email, tên khách hàng hoặc User ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: "100%", fontSize: 13 }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            style={{ fontSize: 13, padding: "8px 12px", borderRadius: 8 }}
          >
            <option value="all">Tất cả gói bản quyền</option>
            <option value="trial">Gói Trial (Dùng thử)</option>
            <option value="basic">Gói Basic</option>
            <option value="pro">Gói Pro</option>
            <option value="agency">Gói Agency</option>
            <option value="unlimited">Gói Unlimited</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ fontSize: 13, padding: "8px 12px", borderRadius: 8 }}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="errors">⚠️ Có bài viết bị lỗi</option>
            <option value="active">🟢 Đang hoạt động</option>
            <option value="expired">🔴 Hết hạn bản quyền</option>
          </select>
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 20,
            background: "rgba(239, 68, 68, 0.12)",
            color: "#ef4444",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            fontSize: 13,
          }}
        >
          ❌ {error}
        </div>
      )}

      {/* Users List Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <span className="loader" />
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary, #94a3b8)" }}>
            Đang tải dữ liệu khách hàng & nhật ký...
          </div>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👥</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>
            Không tìm thấy người dùng phù hợp
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary, #94a3b8)", margin: 0 }}>
            Thử thay đổi từ khóa tìm kiếm hoặc bỏ bớt các bộ lọc bên trên.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredUsers.map((u) => {
            const hasErrors = (u.stats?.errorArticlesCount || 0) > 0;
            const planName = u.license?.plan ? u.license.plan.toUpperCase() : "CHƯA KÍCH HOẠT";
            const isPlanActive = u.license?.status === "active";

            return (
              <div
                key={u.id}
                className="card"
                style={{
                  padding: "16px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                  borderLeft: hasErrors ? "4px solid #ef4444" : "4px solid rgba(255,255,255,0.1)",
                  background: hasErrors ? "rgba(239, 68, 68, 0.03)" : "var(--card-bg, rgba(255,255,255,0.03))",
                  transition: "all 0.2s ease",
                }}
              >
                {/* Left: User Identity */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 260, flex: 1 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: hasErrors
                        ? "rgba(239, 68, 68, 0.2)"
                        : "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#fff",
                      flexShrink: 0,
                      overflow: "hidden",
                    }}
                  >
                    {u.avatarUrl ? (
                      <img src={u.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      (u.name || u.email || "U")[0].toUpperCase()
                    )}
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary, #fff)" }}>
                        {u.name || "Khách hàng"}
                      </span>
                      {u.role === "admin" && (
                        <span
                          className="badge badge-warning"
                          style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6 }}
                        >
                          👑 Admin
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary, #94a3b8)", marginBottom: 4 }}>
                      {u.email}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted, #64748b)", fontFamily: "monospace" }}>
                      ID: {u.id}
                    </div>
                  </div>
                </div>

                {/* Center: License & Plan Info */}
                {/* Center: License & Credit Usage */}
                <div style={{ minWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      className={`badge ${
                        u.license?.plan === "unlimited"
                          ? "badge-critical"
                          : u.license?.plan === "agency"
                          ? "badge-warning"
                          : isPlanActive
                          ? "badge-success"
                          : "badge-secondary"
                      }`}
                      style={{ fontSize: 11, fontWeight: 600 }}
                    >
                      {planName}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: isPlanActive ? "var(--accent-green, #10b981)" : "#ef4444",
                        fontWeight: 500,
                      }}
                    >
                      {isPlanActive ? "🟢 Active" : "🔴 Expired"}
                    </span>
                  </div>

                  {/* Monthly Credit / AI Calls Meter */}
                  <div
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      padding: "6px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ color: "var(--text-muted, #94a3b8)" }}>⚡ AI Calls (Tháng):</span>
                      <span style={{ fontWeight: 700, color: "#38bdf8" }}>
                        {u.usage?.aiCalls || 0} /{" "}
                        {u.license?.limits?.aiCreditsPerMonth >= 999999
                          ? "∞"
                          : (u.license?.limits?.aiCreditsPerMonth || 100).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-muted, #94a3b8)" }}>📝 Bài viết:</span>
                      <span style={{ fontWeight: 700, color: "#a78bfa" }}>
                        {u.usage?.articlesCreated || 0} /{" "}
                        {u.license?.limits?.maxArticlesPerMonth >= 999999
                          ? "∞"
                          : (u.license?.limits?.maxArticlesPerMonth || 10).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Data Statistics & Status */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", gap: 12, textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary, #fff)" }}>
                        {u.stats?.projectsCount || 0}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted, #64748b)" }}>Dự án</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa" }}>
                        {u.stats?.articlesCount || 0}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted, #64748b)" }}>Bài viết</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#38bdf8" }}>
                        {u.stats?.draftsCount || 0}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted, #64748b)" }}>Drafts</div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: hasErrors ? "#ef4444" : "var(--text-secondary, #94a3b8)",
                        }}
                      >
                        {u.stats?.errorArticlesCount || 0}
                      </div>
                      <div style={{ fontSize: 10, color: hasErrors ? "#ef4444" : "var(--text-muted, #64748b)" }}>
                        Lỗi
                      </div>
                    </div>
                  </div>

                  {/* Inspect Button */}
                  <button
                    className={`btn ${hasErrors ? "btn-danger" : "btn-primary"}`}
                    onClick={() => setSelectedUser(u)}
                    style={{
                      fontSize: 12,
                      padding: "8px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontWeight: 600,
                    }}
                  >
                    <span>👁️</span> Soi Dữ liệu & Lỗi
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* User Inspection Modal / Drawer */}
      {selectedUser && (
        <UserInspectionModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}

/**
 * Inspection Modal for deep-diving into a customer's data
 */
function UserInspectionModal({ user, onClose }) {
  const [activeTab, setActiveTab] = useState("credits");
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Data states for tabs
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);

  const [articles, setArticles] = useState([]);
  const [loadingArticles, setLoadingArticles] = useState(false);

  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  const [audits, setAudits] = useState([]);
  const [loadingAudits, setLoadingAudits] = useState(false);

  const [wpSites, setWpSites] = useState([]);
  const [loadingWpSites, setLoadingWpSites] = useState(false);

  // Article Reader Modal state
  const [viewingArticle, setViewingArticle] = useState(null);
  const [viewingDraft, setViewingDraft] = useState(null);

  // Load summary
  useEffect(() => {
    async function fetchSummary() {
      try {
        setLoadingSummary(true);
        const res = await api.getAdminUserSummary(user.id);
        if (res) setSummary(res);
      } catch (err) {
        console.error("Lỗi tải tóm tắt user:", err);
      } finally {
        setLoadingSummary(false);
      }
    }
    fetchSummary();
  }, [user.id]);

  // Load projects tab
  const loadProjects = useCallback(async () => {
    try {
      setLoadingProjects(true);
      const res = await api.getAdminUserProjects(user.id);
      if (res && res.projects) {
        setProjects(res.projects);
        if (res.projects.length > 0 && !selectedProject) {
          setSelectedProject(res.projects[0]);
        }
      }
    } catch (err) {
      console.error("Lỗi tải dự án:", err);
    } finally {
      setLoadingProjects(false);
    }
  }, [user.id, selectedProject]);

  // Load articles when project changes
  useEffect(() => {
    if (activeTab === "projects") {
      loadProjects();
    }
  }, [activeTab, loadProjects]);

  useEffect(() => {
    async function loadProjectArticles() {
      if (!selectedProject) {
        setArticles([]);
        return;
      }
      try {
        setLoadingArticles(true);
        const res = await api.getAdminProjectArticles(user.id, selectedProject.id);
        if (res && res.articles) {
          setArticles(res.articles);
        }
      } catch (err) {
        console.error("Lỗi tải bài viết dự án:", err);
      } finally {
        setLoadingArticles(false);
      }
    }
    if (selectedProject) {
      loadProjectArticles();
    }
  }, [user.id, selectedProject]);

  // Load Drafts tab
  useEffect(() => {
    async function loadDrafts() {
      if (activeTab !== "drafts") return;
      try {
        setLoadingDrafts(true);
        const res = await api.getAdminUserDrafts(user.id);
        if (res && res.drafts) setDrafts(res.drafts);
      } catch (err) {
        console.error("Lỗi tải drafts:", err);
      } finally {
        setLoadingDrafts(false);
      }
    }
    loadDrafts();
  }, [user.id, activeTab]);

  // Load Audits tab
  useEffect(() => {
    async function loadAudits() {
      if (activeTab !== "audits") return;
      try {
        setLoadingAudits(true);
        const res = await api.getAdminUserAudits(user.id);
        if (res && res.audits) setAudits(res.audits);
      } catch (err) {
        console.error("Lỗi tải audits:", err);
      } finally {
        setLoadingAudits(false);
      }
    }
    loadAudits();
  }, [user.id, activeTab]);

  // Load WP Sites tab
  useEffect(() => {
    async function loadWpSites() {
      if (activeTab !== "wpsites") return;
      try {
        setLoadingWpSites(true);
        const res = await api.getAdminUserWpSites(user.id);
        if (res && res.sites) setWpSites(res.sites);
      } catch (err) {
        console.error("Lỗi tải wp-sites:", err);
      } finally {
        setLoadingWpSites(false);
      }
    }
    loadWpSites();
  }, [user.id, activeTab]);

  // Open full article view
  const handleOpenArticle = async (articleId) => {
    try {
      const res = await api.getAdminArticleDetail(user.id, articleId);
      if (res && res.article) setViewingArticle(res.article);
    } catch (err) {
      alert("Lỗi tải chi tiết bài viết: " + err.message);
    }
  };

  // Open full draft view
  const handleOpenDraft = async (draftId) => {
    try {
      const res = await api.getAdminDraftDetail(user.id, draftId);
      if (res && res.draft) setViewingDraft(res.draft);
    } catch (err) {
      alert("Lỗi tải chi tiết draft: " + err.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 1080,
          width: "95vw",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid var(--border-color, rgba(255,255,255,0.08))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(0,0,0,0.2)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                🛡️ Soi dữ liệu: {user.name || user.email}
              </h2>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  fontWeight: 600,
                }}
              >
                Chế độ Read-Only An Toàn
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary, #94a3b8)", marginTop: 2 }}>
              Email: <strong>{user.email}</strong> • ID: <code>{user.id}</code> • Gói:{" "}
              <strong>{user.license?.plan || "Trial"}</strong>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              color: "var(--text-muted, #64748b)",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Read-Only Safety Banner */}
        <div
          style={{
            padding: "8px 24px",
            background: "rgba(59, 130, 246, 0.08)",
            borderBottom: "1px solid rgba(59, 130, 246, 0.2)",
            fontSize: 12,
            color: "#93c5fd",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>👁️</span>
          <span>
            <strong>Lưu ý:</strong> Mọi thao tác trong màn hình này là <em>chỉ đọc</em>. Bạn có thể xem toàn bộ dàn
            ý, nội dung và nguyên nhân lỗi để hướng dẫn khách hàng mà không làm ảnh hưởng đến dữ liệu gốc.
          </span>
        </div>

        {/* Modal Tabs Bar */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "12px 24px",
            borderBottom: "1px solid var(--border-color, rgba(255,255,255,0.08))",
            background: "rgba(0,0,0,0.1)",
            overflowX: "auto",
          }}
        >
          {[
            { id: "credits", label: "💳 Hạn mức & Credit", icon: "💳" },
            { id: "projects", label: "📁 Dự án & Bài viết", icon: "📁", count: user.stats?.projectsCount || 0 },
            { id: "drafts", label: "✍️ Bài viết Pipeline (Drafts)", icon: "✍️", count: user.stats?.draftsCount || 0 },
            { id: "audits", label: "🔍 SEO Audits", icon: "🔍", count: user.stats?.auditsCount || 0 },
            { id: "wpsites", label: "🌐 Kết nối WordPress", icon: "🌐", count: user.stats?.wpSitesCount || 0 },
          ].map((t) => (
            <button
              key={t.id}
              className={`filter-btn ${activeTab === t.id ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
              style={{
                fontSize: 13,
                padding: "6px 14px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 8,
              }}
            >
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 10,
                    background: activeTab === t.id ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)",
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Modal Body Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {/* TAB 0: CREDITS & USAGE */}
          {activeTab === "credits" && <UserCreditsTab user={user} />}

          {/* TAB 1: PROJECTS & ARTICLES */}
          {activeTab === "projects" && (
            <div>
              {loadingProjects ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <span className="loader" />
                </div>
              ) : projects.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary, #94a3b8)" }}>
                  Khách hàng chưa tạo dự án nào.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16 }}>
                  {/* Left: Project Selector */}
                  <div style={{ borderRight: "1px solid rgba(255,255,255,0.08)", paddingRight: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
                      CHỌN DỰ ÁN ({projects.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {projects.map((p) => {
                        const isSelected = selectedProject?.id === p.id;
                        const hasErrors = (p.stats?.errors || 0) > 0;
                        return (
                          <button
                            key={p.id}
                            onClick={() => setSelectedProject(p)}
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderRadius: 8,
                              border: isSelected
                                ? "1px solid var(--accent-blue, #3b82f6)"
                                : "1px solid rgba(255,255,255,0.06)",
                              background: isSelected
                                ? "rgba(59, 130, 246, 0.15)"
                                : "rgba(255,255,255,0.02)",
                              color: isSelected ? "#fff" : "var(--text-primary, #e2e8f0)",
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{p.name}</div>
                            <div
                              style={{
                                fontSize: 11,
                                color: hasErrors ? "#ef4444" : "var(--text-muted, #94a3b8)",
                                display: "flex",
                                justifyContent: "space-between",
                              }}
                            >
                              <span>{p.stats?.total || 0} bài viết</span>
                              {hasErrors && <span>⚠️ {p.stats.errors} lỗi</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: Articles inside selected project */}
                  <div>
                    {selectedProject && (
                      <div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 12,
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 15 }}>
                              Bài viết trong: {selectedProject.name}
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>
                              ({articles.length} bài)
                            </span>
                          </div>
                        </div>

                        {loadingArticles ? (
                          <div style={{ textAlign: "center", padding: 40 }}>
                            <span className="loader" />
                          </div>
                        ) : articles.length === 0 ? (
                          <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
                            Dự án này chưa có bài viết nào.
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {articles.map((art) => {
                              const isError = art.status === "error" || Boolean(art.error);
                              return (
                                <div
                                  key={art.id}
                                  className="card"
                                  style={{
                                    padding: "12px 14px",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: 12,
                                    border: isError
                                      ? "1px solid rgba(239, 68, 68, 0.4)"
                                      : "1px solid rgba(255,255,255,0.06)",
                                    background: isError
                                      ? "rgba(239, 68, 68, 0.04)"
                                      : "rgba(255,255,255,0.02)",
                                  }}
                                >
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
                                      {art.title || art.keyword || "Bài viết chưa có tiêu đề"}
                                    </div>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 12 }}>
                                      <span>Từ khóa: <strong>{art.keyword || "(Trống)"}</strong></span>
                                      <span>Số từ: {art.wordCount || 0}</span>
                                      {art.seoScore && <span>Điểm SEO: {art.seoScore}/100</span>}
                                    </div>

                                    {/* Error explanation box */}
                                    {isError && (
                                      <div
                                        style={{
                                          marginTop: 6,
                                          padding: "4px 8px",
                                          borderRadius: 4,
                                          background: "rgba(239, 68, 68, 0.15)",
                                          color: "#f87171",
                                          fontSize: 11,
                                          fontWeight: 500,
                                        }}
                                      >
                                        ⚠️ Lỗi: {art.error || "Quá trình tạo bài bị gián đoạn"}
                                      </div>
                                    )}
                                  </div>

                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span
                                      className={`badge ${
                                        isError
                                          ? "badge-critical"
                                          : art.status === "published"
                                          ? "badge-success"
                                          : "badge-info"
                                      }`}
                                      style={{ fontSize: 11 }}
                                    >
                                      {art.status}
                                    </span>
                                    <button
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => handleOpenArticle(art.id)}
                                      style={{ fontSize: 11, padding: "4px 10px" }}
                                    >
                                      👁️ Xem bài
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

                    {/* TAB 2: STANDALONE DRAFTS */}
          {activeTab === "drafts" && (
            <div>
              {/* Informative Header Banner */}
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: "rgba(59, 130, 246, 0.08)",
                  border: "1px solid rgba(59, 130, 246, 0.2)",
                  marginBottom: 16,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "#93c5fd",
                }}
              >
                📍 <strong>Vị trí dữ liệu:</strong> Đây là các bài viết nằm trong mục <strong>Tạo bài viết (Pipeline)</strong> của khách hàng.
                <br />
                Khách hàng import danh sách từ khóa vào đây để AI tự động thực hiện quy trình 6 bước (Nghiên cứu → Dàn ý → Viết bài → Thumbnail → Ảnh minh họa → Đăng bài).
              </div>

              {loadingDrafts ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <span className="loader" />
                </div>
              ) : drafts.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
                  Khách hàng chưa có bài viết tự do (pipeline draft) nào.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {drafts.map((d) => {
                    const currentStep = d.currentStep || (d.pipeline?.stepNumber || 1);
                    const statusInfo = getDraftStatusBadge(d.status, currentStep, d.error);
                    const isError = d.status === "error" || Boolean(d.error);

                    return (
                      <div
                        key={d.id}
                        className="card"
                        style={{
                          padding: "12px 16px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          border: isError
                            ? "1px solid rgba(239, 68, 68, 0.4)"
                            : "1px solid rgba(255,255,255,0.06)",
                          background: isError
                            ? "rgba(239, 68, 68, 0.04)"
                            : "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{d.title || d.keyword}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 14, flexWrap: "wrap" }}>
                            <span>Từ khóa: <strong style={{ color: "#fff" }}>{d.keyword}</strong></span>
                            <span>Tiến độ: <strong>Bước {currentStep}/6</strong></span>
                            <span>Số từ: {d.wordCount || 0}</span>
                            <span>Tạo ngày: {new Date(d.createdAt).toLocaleDateString("vi-VN")}</span>
                          </div>
                          {isError && (
                            <div
                              style={{
                                marginTop: 6,
                                padding: "4px 8px",
                                borderRadius: 4,
                                background: "rgba(239, 68, 68, 0.15)",
                                color: "#f87171",
                                fontSize: 11,
                              }}
                            >
                              ⚠️ Lỗi: {d.error || "Gặp lỗi trong pipeline"}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            className={`badge ${statusInfo.badgeClass}`}
                            style={{ fontSize: 11 }}
                          >
                            {statusInfo.label}
                          </span>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenDraft(d.id)}
                            style={{ fontSize: 11, padding: "4px 10px" }}
                          >
                            👁️ Xem chi tiết
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SEO AUDITS */}
          {activeTab === "audits" && (
            <div>
              {loadingAudits ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <span className="loader" />
                </div>
              ) : audits.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
                  Khách hàng chưa chạy báo cáo SEO Audit nào.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {audits.map((a) => (
                    <div
                      key={a.id}
                      className="card"
                      style={{
                        padding: "12px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{a.url}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          Thời gian: {new Date(a.createdAt).toLocaleString("vi-VN")} • Số lỗi:{" "}
                          <strong>{a.totalIssues}</strong>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            fontSize: 16,
                            fontWeight: 700,
                            color: a.score >= 80 ? "#10b981" : a.score >= 50 ? "#f59e0b" : "#ef4444",
                          }}
                        >
                          {a.score}/100
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: WP SITES */}
          {activeTab === "wpsites" && (
            <div>
              {loadingWpSites ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <span className="loader" />
                </div>
              ) : wpSites.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
                  Khách hàng chưa kết nối website WordPress nào.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {wpSites.map((s) => (
                    <div
                      key={s.id}
                      className="card"
                      style={{
                        padding: "12px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: "var(--accent-blue, #60a5fa)", marginBottom: 2 }}>
                          {s.siteUrl}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          User: <code>{s.username}</code> • App Password:{" "}
                          <code title="Đã ẩn vì bảo mật">
                            {s.appPassword ? `${String(s.appPassword).slice(0, 4)}••••••••` : "—"}
                          </code>{" "}
                          • Chuyên mục: {s.categoriesCount}
                        </div>
                      </div>
                      <span className="badge badge-success" style={{ fontSize: 11 }}>
                        {s.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full Article Reader Modal */}
      {viewingArticle && (
        <ArticleReaderModal article={viewingArticle} onClose={() => setViewingArticle(null)} />
      )}

      {/* Full Draft Reader Modal */}
      {viewingDraft && (
        <DraftReaderModal draft={viewingDraft} onClose={() => setViewingDraft(null)} />
      )}
    </div>
  );
}

/**
 * Tab: Thống kê Credit, Hạn mức & Bản quyền người dùng
 */
function UserCreditsTab({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadCredits() {
      try {
        setLoading(true);
        setError(null);
        const res = await api.getAdminUserCredits(user.id);
        if (res) setData(res);
      } catch (err) {
        console.error("Lỗi lấy thông tin credits:", err);
        setError(err.message || "Không thể tải thông tin credit");
      } finally {
        setLoading(false);
      }
    }
    loadCredits();
  }, [user.id]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <span className="loader" />
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary, #94a3b8)" }}>
          Đang tính toán thống kê Credit & Hạn mức...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, background: "rgba(239,68,68,0.1)", color: "#ef4444", borderRadius: 8 }}>
        ❌ {error}
      </div>
    );
  }

  const lic = data?.license || user.license || {};
  const limits = lic.limits || {};
  const currentUsage = data?.currentUsage || { articlesCreated: 0, articlesPublished: 0, aiCalls: 0 };
  const sqliteMetrics = data?.sqliteMetrics || {
    totalWords: 0,
    totalImages: 0,
    totalArticles: 0,
    totalDrafts: 0,
    totalProjects: 0,
    totalAudits: 0,
    publishedArticles: 0,
    failedArticles: 0,
  };
  const usageHistory = data?.usageHistory || [];
  const features = lic.features || {};

  const isUnlimitedAi = (limits.aiCreditsPerMonth || 0) >= 999999;
  const isUnlimitedArticles = (limits.maxArticlesPerMonth || 0) >= 999999;
  const isUnlimitedProjects = (limits.maxProjects || 0) >= 999999;

  const aiPercent = isUnlimitedAi ? 0 : Math.min(100, Math.round((currentUsage.aiCalls / (limits.aiCreditsPerMonth || 1)) * 100));
  const artPercent = isUnlimitedArticles ? 0 : Math.min(100, Math.round((currentUsage.articlesCreated / (limits.maxArticlesPerMonth || 1)) * 100));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* SECTION 1: MONTHLY LIMITS & LIVE GAUGES */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚡</span> Hạn Mức & Credit Tháng Này ({new Date().toISOString().slice(0, 7)})
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {/* Card 1: AI Calls / Credits */}
          <div
            className="card"
            style={{
              padding: 16,
              background: "linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(59, 130, 246, 0.04))",
              border: "1px solid rgba(56, 189, 248, 0.2)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span>⚡ Lượt gọi AI (AI Calls)</span>
              <span style={{ fontWeight: 600, color: "#38bdf8" }}>{isUnlimitedAi ? "Không giới hạn" : `${aiPercent}%`}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#38bdf8", marginBottom: 8 }}>
              {currentUsage.aiCalls.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>/ {isUnlimitedAi ? "∞" : (limits.aiCreditsPerMonth || 100).toLocaleString()}</span>
            </div>
            {!isUnlimitedAi && (
              <div style={{ width: "100%", height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${aiPercent}%`, height: "100%", background: aiPercent > 90 ? "#ef4444" : aiPercent > 70 ? "#f59e0b" : "#38bdf8", transition: "width 0.3s" }} />
              </div>
            )}
          </div>

          {/* Card 2: Articles Limit */}
          <div
            className="card"
            style={{
              padding: 16,
              background: "linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(139, 92, 246, 0.04))",
              border: "1px solid rgba(168, 85, 247, 0.2)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span>📝 Bài viết trong tháng</span>
              <span style={{ fontWeight: 600, color: "#a855f7" }}>{isUnlimitedArticles ? "Không giới hạn" : `${artPercent}%`}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#a855f7", marginBottom: 8 }}>
              {currentUsage.articlesCreated.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>/ {isUnlimitedArticles ? "∞" : (limits.maxArticlesPerMonth || 10).toLocaleString()}</span>
            </div>
            {!isUnlimitedArticles && (
              <div style={{ width: "100%", height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${artPercent}%`, height: "100%", background: artPercent > 90 ? "#ef4444" : artPercent > 70 ? "#f59e0b" : "#a855f7", transition: "width 0.3s" }} />
              </div>
            )}
          </div>

          {/* Card 3: Published Articles */}
          <div
            className="card"
            style={{
              padding: 16,
              background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(5, 150, 105, 0.04))",
              border: "1px solid rgba(16, 185, 129, 0.2)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
              <span>📤 Đã xuất bản lên WordPress</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#10b981", marginBottom: 8 }}>
              {currentUsage.articlesPublished.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)" }}>bài viết</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tự động đăng qua REST API</div>
          </div>

          {/* Card 4: Projects & Audits Quota */}
          <div
            className="card"
            style={{
              padding: 16,
              background: "linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(217, 119, 6, 0.04))",
              border: "1px solid rgba(245, 158, 11, 0.2)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
              <span>📁 Dự án & Thiết bị</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b", marginBottom: 4 }}>
              Dự án: {sqliteMetrics.totalProjects} / {isUnlimitedProjects ? "∞" : (limits.maxProjects || 2)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Thiết bị tối đa: <strong>{limits.maxDevices || 1}</strong> • Audit: <strong>{(limits.maxAudits || 3) >= 999999 ? "∞" : (limits.maxAudits || 3)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: REAL PRODUCTION ACTIVITY METRICS (SQLite) */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span>📊</span> Sản Lượng Dữ Liệu Thực Tế (Toàn Thời Gian)
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <div className="card" style={{ padding: 14, textAlign: "center", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#38bdf8" }}>
              {sqliteMetrics.totalWords.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>✍️ Tổng số từ AI đã viết</div>
          </div>

          <div className="card" style={{ padding: 14, textAlign: "center", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#ec4899" }}>
              {sqliteMetrics.totalImages.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>🎨 Tổng số hình ảnh AI đã tạo</div>
          </div>

          <div className="card" style={{ padding: 14, textAlign: "center", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#a855f7" }}>
              {sqliteMetrics.totalArticles + sqliteMetrics.totalDrafts}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>📚 Tổng bài viết đang lưu</div>
          </div>

          <div className="card" style={{ padding: 14, textAlign: "center", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>
              {sqliteMetrics.publishedArticles}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>✅ Đã xuất bản lên WP</div>
          </div>

          <div className="card" style={{ padding: 14, textAlign: "center", background: sqliteMetrics.failedArticles > 0 ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.02)", border: sqliteMetrics.failedArticles > 0 ? "1px solid rgba(239,68,68,0.3)" : undefined }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: sqliteMetrics.failedArticles > 0 ? "#ef4444" : "var(--text-muted)" }}>
              {sqliteMetrics.failedArticles}
            </div>
            <div style={{ fontSize: 12, color: sqliteMetrics.failedArticles > 0 ? "#ef4444" : "var(--text-muted)", marginTop: 4 }}>⚠️ Bài viết phát sinh lỗi</div>
          </div>
        </div>
      </div>

      {/* SECTION 3: MONTHLY USAGE HISTORY TABLE */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span>📅</span> Lịch Sử Sử Dụng Theo Tháng (MongoDB Usage Log)
        </h3>

        {usageHistory.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>
            Chưa có lịch sử sử dụng các tháng trước.
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(0,0,0,0.2)", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <th style={{ padding: "10px 16px" }}>Tháng</th>
                  <th style={{ padding: "10px 16px" }}>Lượt gọi AI (Calls)</th>
                  <th style={{ padding: "10px 16px" }}>Bài viết đã tạo</th>
                  <th style={{ padding: "10px 16px" }}>Bài viết đã đăng WP</th>
                  <th style={{ padding: "10px 16px" }}>Tình trạng</th>
                </tr>
              </thead>
              <tbody>
                {usageHistory.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "10px 16px", fontWeight: 600, color: "var(--text-primary)" }}>
                      {row.month}
                    </td>
                    <td style={{ padding: "10px 16px", color: "#38bdf8", fontWeight: 600 }}>
                      {(row.aiCalls || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: "10px 16px", color: "#a855f7", fontWeight: 600 }}>
                      {(row.articlesCreated || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: "10px 16px", color: "#10b981", fontWeight: 600 }}>
                      {(row.articlesPublished || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span className="badge badge-success" style={{ fontSize: 10, padding: "2px 6px" }}>
                        Hợp lệ
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 4: LICENSE DETAILS & FEATURE GATES */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span>🛡️</span> Thông Tin Bản Quyền & Tính Năng Được Mở
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* License meta */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#fff" }}>Thông tin License Key</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Gói cước:</span>
                <span style={{ fontWeight: 700, color: "#38bdf8" }}>{(lic.plan || "trial").toUpperCase()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Kỳ hạn:</span>
                <span>{lic.period === "lifetime" ? "Vĩnh viễn (Lifetime)" : lic.period}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Mã License:</span>
                <code style={{ fontSize: 11, background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: 4 }}>
                  {lic.licenseKey || "—"}
                </code>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Trạng thái:</span>
                <span style={{ color: lic.status === "active" ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                  {lic.status === "active" ? "🟢 Đang hoạt động" : "🔴 " + lic.status}
                </span>
              </div>
              {lic.expiresAt && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)" }}>Ngày hết hạn:</span>
                  <span>{new Date(lic.expiresAt).toLocaleDateString("vi-VN")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Features grid */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#fff" }}>Quyền hạn tính năng (Feature Gates)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
              {[
                { key: "aiWriting", label: "Viết bài AI" },
                { key: "aiImage", label: "Tạo ảnh AI" },
                { key: "wpPublish", label: "Đăng bài WordPress" },
                { key: "multiPlatform", label: "Đa nền tảng" },
                { key: "internalLinks", label: "Liên kết nội bộ" },
                { key: "seoAudit", label: "SEO Audit" },
                { key: "googleSearchConsole", label: "Google Search Console" },
                { key: "sharedAiPool", label: "Dùng chung AI Pool" },
                { key: "bringYourOwnKey", label: "Tự cấu hình API Key" },
                { key: "priorityAiPool", label: "AI Pool Ưu Tiên" },
              ].map((f) => {
                const enabled = Boolean(features[f.key]);
                return (
                  <div
                    key={f.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 6px",
                      borderRadius: 4,
                      background: enabled ? "rgba(16, 185, 129, 0.08)" : "rgba(255,255,255,0.02)",
                      color: enabled ? "#10b981" : "var(--text-muted)",
                    }}
                  >
                    <span>{enabled ? "✅" : "⚪"}</span>
                    <span>{f.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Full Article Reader Modal for Admin diagnostics
 */
function ArticleReaderModal({ article, onClose }) {
  const [viewTab, setViewTab] = useState("content");

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 900,
          width: "90vw",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(0,0,0,0.2)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              📖 Soát nội dung bài: {article.title || article.keyword}
            </h3>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              Từ khóa chính: <strong>{article.keyword}</strong> • Trạng thái: <code>{article.status}</code>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, color: "var(--text-muted)", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {/* View Tabs */}
        <div style={{ display: "flex", gap: 8, padding: "8px 20px", background: "rgba(0,0,0,0.1)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button className={`filter-btn ${viewTab === "content" ? "active" : ""}`} onClick={() => setViewTab("content")} style={{ fontSize: 12 }}>
            📄 Nội dung bài viết
          </button>
          <button className={`filter-btn ${viewTab === "outline" ? "active" : ""}`} onClick={() => setViewTab("outline")} style={{ fontSize: 12 }}>
            📑 Dàn ý (Outline)
          </button>
          <button className={`filter-btn ${viewTab === "research" ? "active" : ""}`} onClick={() => setViewTab("research")} style={{ fontSize: 12 }}>
            🔍 Nghiên cứu & Search Intent
          </button>
          <button className={`filter-btn ${viewTab === "debug" ? "active" : ""}`} onClick={() => setViewTab("debug")} style={{ fontSize: 12 }}>
            ⚠️ Nhật ký Lỗi / Debug
          </button>
        </div>

        {/* Content Viewer */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {viewTab === "content" && (
            <div>
              {article.html ? (
                <SafeHtml
                  className="article-content-preview"
                  style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" }}
                  html={article.html}
                />
              ) : article.content ? (
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6 }}>{article.content}</div>
              ) : (
                <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>
                  Chưa có nội dung bài viết được sinh ra.
                </div>
              )}
            </div>
          )}

          {viewTab === "outline" && (
            <div>
              {article.outline ? (
                <pre style={{ background: "rgba(0,0,0,0.3)", padding: 14, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
                  {JSON.stringify(article.outline, null, 2)}
                </pre>
              ) : (
                <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>
                  Chưa có dữ liệu dàn ý.
                </div>
              )}
            </div>
          )}

          {viewTab === "research" && (
            <div>
              {article.researchSummary || article.research ? (
                <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {article.researchSummary || JSON.stringify(article.research, null, 2)}
                </div>
              ) : (
                <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 30 }}>
                  Chưa có dữ liệu nghiên cứu từ khóa.
                </div>
              )}
            </div>
          )}

          {viewTab === "debug" && (
            <div>
              {article.error ? (
                <div style={{ padding: 12, borderRadius: 8, background: "rgba(239,68,68,0.15)", color: "#f87171", marginBottom: 12 }}>
                  <strong>Lỗi phát sinh:</strong> {article.error}
                </div>
              ) : (
                <div style={{ padding: 12, borderRadius: 8, background: "rgba(16,185,129,0.1)", color: "#10b981", marginBottom: 12 }}>
                  ✅ Không có lỗi ghi nhận trên bài viết này.
                </div>
              )}

              {article.generationLogs && article.generationLogs.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Nhật ký tiến trình (Logs):</div>
                  <pre style={{ background: "rgba(0,0,0,0.3)", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto" }}>
                    {JSON.stringify(article.generationLogs, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Draft Reader Modal for standalone drafts
 */
/**
 * Pipeline 6-Step Configuration
 */
const PIPELINE_STEPS = [
  { step: 1, id: "research", label: "1. Nghiên cứu", icon: "🔍", desc: "Crawl đối thủ & phân tích intent" },
  { step: 2, id: "outline", label: "2. Lập dàn ý", icon: "📑", desc: "Cấu trúc H2, H3 chuẩn SEO" },
  { step: 3, id: "content", label: "3. Viết nội dung", icon: "✍️", desc: "Sinh bài viết chuyên sâu" },
  { step: 4, id: "thumbnail", label: "4. Thumbnail", icon: "🖼️", desc: "Tạo ảnh đại diện AI" },
  { step: 5, id: "section_image", label: "5. Ảnh Sections", icon: "🎨", desc: "Ảnh minh họa từng phần" },
  { step: 6, id: "publish", label: "6. Hoàn tất", icon: "📤", desc: "Đăng lên WordPress / Export" },
];

function getDraftStatusBadge(status, currentStep = 1, error = null) {
  if (error || status === "error") {
    return {
      label: "⚠️ Bị lỗi ở Bước " + currentStep,
      badgeClass: "badge-critical",
      color: "#ef4444",
      bg: "rgba(239, 68, 68, 0.15)",
      desc: "Quá trình chạy AI bị lỗi.",
    };
  }
  if (status === "pending") {
    return {
      label: "⏳ Hàng chờ (Chưa chạy)",
      badgeClass: "badge-secondary",
      color: "#94a3b8",
      bg: "rgba(148, 163, 184, 0.15)",
      desc: "Đang chờ kích hoạt chạy AI qua 6 bước.",
    };
  }
  if (status === "review") {
    return {
      label: "👀 Chờ duyệt Bước " + currentStep,
      badgeClass: "badge-warning",
      color: "#f59e0b",
      bg: "rgba(245, 158, 11, 0.15)",
      desc: "Đã sinh xong bản nháp, đang chờ khách hàng duyệt để sang bước tiếp.",
    };
  }
  if (status === "generating" || status === "research" || status === "outline" || status === "writing") {
    return {
      label: "⚡ Đang xử lý Bước " + currentStep,
      badgeClass: "badge-info",
      color: "#3b82f6",
      bg: "rgba(59, 130, 246, 0.15)",
      desc: "AI đang tự động sinh nội dung.",
    };
  }
  if (status === "completed" || status === "published") {
    return {
      label: "✅ Hoàn tất 6/6 bước",
      badgeClass: "badge-success",
      color: "#10b981",
      bg: "rgba(16, 185, 129, 0.15)",
      desc: "Bài viết đã hoàn thành.",
    };
  }
  return {
    label: status,
    badgeClass: "badge-info",
    color: "#94a3b8",
    bg: "rgba(255,255,255,0.1)",
    desc: "Trạng thái khác",
  };
}

/**
 * Draft Reader Modal for standalone pipeline drafts
 */
function DraftReaderModal({ draft, onClose }) {
  const [activeTab, setActiveTab] = useState("progress");
  const currentStep = draft.currentStep || (draft.pipeline?.stepNumber || 1);
  const statusInfo = getDraftStatusBadge(draft.status, currentStep, draft.error);
  const pipeline = draft.pipeline || {};

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 960,
          width: "92vw",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(0,0,0,0.25)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                ✍️ {draft.title || draft.keyword || "Bài viết Pipeline"}
              </h3>
              <span
                className={`badge ${statusInfo.badgeClass}`}
                style={{ fontSize: 11, padding: "2px 8px" }}
              >
                {statusInfo.label}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary, #94a3b8)", marginTop: 3 }}>
              📍 <strong>Vị trí:</strong> Mục <em>Tạo bài viết (Pipeline)</em> • Từ khóa chính:{" "}
              <strong style={{ color: "#fff" }}>{draft.keyword}</strong> • Tạo lúc:{" "}
              {new Date(draft.createdAt).toLocaleString("vi-VN")}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 22, color: "var(--text-muted)", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {/* 6-Step Visual Timeline Banner */}
        <div
          style={{
            padding: "14px 24px",
            background: "rgba(0,0,0,0.15)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase" }}>
            Tiến trình Quy trình 6 Bước Pipeline:
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 8,
            }}
          >
            {PIPELINE_STEPS.map((s) => {
              const isPassed = draft.status === "completed" || draft.status === "published" || currentStep > s.step;
              const isCurrent = currentStep === s.step;
              const isError = isCurrent && (draft.status === "error" || Boolean(draft.error));

              return (
                <div
                  key={s.step}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: isError
                      ? "1px solid #ef4444"
                      : isCurrent
                      ? "1px solid #3b82f6"
                      : isPassed
                      ? "1px solid rgba(16, 185, 129, 0.4)"
                      : "1px solid rgba(255,255,255,0.06)",
                    background: isError
                      ? "rgba(239, 68, 68, 0.15)"
                      : isCurrent
                      ? "rgba(59, 130, 246, 0.15)"
                      : isPassed
                      ? "rgba(16, 185, 129, 0.1)"
                      : "rgba(255,255,255,0.02)",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 14, marginBottom: 2 }}>{s.icon}</div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isError ? "#ef4444" : isCurrent ? "#60a5fa" : isPassed ? "#10b981" : "var(--text-muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.label}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>
                    {isPassed ? "✅ Đã xong" : isCurrent ? (draft.status === "pending" ? "⏳ Đang đợi" : "⚡ Đang xử lý") : "Chưa chạy"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tab Selection */}
        <div style={{ display: "flex", gap: 8, padding: "8px 24px", background: "rgba(0,0,0,0.08)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button className={`filter-btn ${activeTab === "progress" ? "active" : ""}`} onClick={() => setActiveTab("progress")} style={{ fontSize: 12 }}>
            📊 Trạng thái & Vị trí
          </button>
          <button className={`filter-btn ${activeTab === "content" ? "active" : ""}`} onClick={() => setActiveTab("content")} style={{ fontSize: 12 }}>
            📄 Bài viết & Dàn ý ({draft.wordCount || 0} từ)
          </button>
          <button className={`filter-btn ${activeTab === "images" ? "active" : ""}`} onClick={() => setActiveTab("images")} style={{ fontSize: 12 }}>
            🖼️ Hình ảnh
          </button>
          <button className={`filter-btn ${activeTab === "debug" ? "active" : ""}`} onClick={() => setActiveTab("debug")} style={{ fontSize: 12 }}>
            🛠️ Dữ liệu JSON & Lỗi
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {/* TAB 1: PROGRESS & CONTEXT EXPLANATION */}
          {activeTab === "progress" && (
            <div>
              {/* Location & Status explanation card */}
              <div
                className="card"
                style={{
                  padding: 18,
                  marginBottom: 16,
                  borderLeft: `4px solid ${statusInfo.color}`,
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <h4 style={{ margin: "0 0 8px", fontSize: 15, color: "var(--text-primary)" }}>
                  📌 Giải thích trạng thái của bài viết:
                </h4>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  {statusInfo.desc}
                </p>

                {draft.status === "pending" && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: "rgba(59, 130, 246, 0.08)",
                      border: "1px solid rgba(59, 130, 246, 0.2)",
                      fontSize: 12,
                      color: "#93c5fd",
                      lineHeight: 1.6,
                    }}
                  >
                    💡 <strong>Vì sao có trạng thái này?</strong>
                    <br />
                    Khách hàng đã import từ khóa <strong>"{draft.keyword}"</strong> vào danh sách hàng đợi của mục <strong>Tạo bài viết (Pipeline)</strong>.
                    <br />
                    Khi khách hàng bấm <strong>"Bắt đầu"</strong> hoặc <strong>"Chạy tự động (Auto-Pipeline)"</strong>, hệ thống AI sẽ kích hoạt và lần lượt chạy qua 6 bước để tạo thành bài viết hoàn chỉnh.
                  </div>
                )}

                {draft.error && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      fontSize: 12,
                      color: "#f87171",
                      marginTop: 10,
                      lineHeight: 1.6,
                    }}
                  >
                    <strong>⚠️ Chi tiết lỗi:</strong> {draft.error}
                    <br />
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      Gợi ý: Kiểm tra lại số dư quota API Key AI hoặc kết nối mạng trên server.
                    </span>
                  </div>
                )}
              </div>

              {/* Information Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>TỪ KHÓA MỤC TIÊU</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{draft.keyword}</div>
                </div>

                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>BƯỚC HIỆN TẠI</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    Bước {currentStep}/6: {PIPELINE_STEPS[currentStep - 1]?.label || "Chưa xác định"}
                  </div>
                </div>

                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>SỐ TỪ ĐÃ VIẾT</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{draft.wordCount || 0} từ</div>
                </div>

                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>MÃ BÀI VIẾT (DRAFT ID)</div>
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)" }}>
                    {draft.id}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OUTLINE & CONTENT */}
          {activeTab === "content" && (
            <div>
              {draft.article || draft.content || draft.html ? (
                <SafeHtml
                  className="article-content-preview"
                  style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" }}
                  html={draft.article || draft.content || draft.html}
                />
              ) : pipeline.outline ? (
                <div>
                  <h4 style={{ margin: "0 0 12px", fontSize: 15 }}>📑 Dàn ý bài viết đã tạo:</h4>
                  <pre style={{ background: "rgba(0,0,0,0.3)", padding: 14, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
                    {JSON.stringify(pipeline.outline, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Chưa có nội dung bài viết</div>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                    Bài viết đang ở trạng thái <strong>{statusInfo.label}</strong> (Bước {currentStep}/6). Nội dung sẽ xuất hiện khi AI hoàn tất bước 3.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: IMAGES */}
          {activeTab === "images" && (
            <div>
              {draft.thumbnail || (draft.images && draft.images.length > 0) ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
                  {draft.thumbnail && (
                    <div className="card" style={{ padding: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>🖼️ Ảnh Thumbnail:</div>
                      <img src={draft.thumbnail} alt="Thumbnail" style={{ width: "100%", borderRadius: 8, objectFit: "cover" }} />
                    </div>
                  )}
                  {(draft.images || []).map((img, idx) => (
                    <div key={idx} className="card" style={{ padding: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>🎨 Ảnh Section #{idx + 1}:</div>
                      <img src={img.url || img} alt="" style={{ width: "100%", borderRadius: 8, objectFit: "cover" }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Chưa tạo hình ảnh</div>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                    Hình ảnh Thumbnail và Section sẽ được tạo ở bước 4 và bước 5.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: RAW JSON & DEBUG */}
          {activeTab === "debug" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
                DỮ LIỆU GỐC TRONG SQLITE (READ-ONLY JSON):
              </div>
              <pre
                style={{
                  background: "rgba(0,0,0,0.35)",
                  padding: 16,
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.5,
                  overflowX: "auto",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {JSON.stringify(draft, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
