import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

// ===== Tab Definitions =====
const TABS = [
  { id: "connect", label: "Fanpage Liên Kết", icon: "🔗" },
  { id: "share", label: "Soạn & Đăng Bài", icon: "📤" },
  { id: "queue", label: "Hàng Đợi Đăng", icon: "📋" },
  { id: "history", label: "Nhật Ký & Thống Kê", icon: "📊" },
];

const PLATFORMS = {
  facebook: {
    name: "Facebook",
    icon: "📘",
    color: "#1877f2",
    gradient: "linear-gradient(135deg, #1877f2, #0d47a1)",
  },
};

export default function SocialHub() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "connect");
  const [accounts, setAccounts] = useState([]);
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Load accounts
  const loadAccounts = useCallback(async () => {
    try {
      const data = await api.getSocialAccounts();
      setAccounts(data || []);
    } catch {
      setAccounts([]);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const data = await api.getSocialQueue();
      setQueue(data || []);
    } catch {
      setQueue([]);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.getSocialHistory();
      setHistory(data || []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadAccounts(), loadQueue()]);
      setLoading(false);
    })();
  }, [loadAccounts, loadQueue]);

  useEffect(() => {
    if (tab === "queue") loadQueue();
    if (tab === "history") loadHistory();
  }, [tab, loadQueue, loadHistory]);

  function showToast(message, type = "info") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  }

  // Stats calculation
  const stats = useMemo(() => ({
    totalAccounts: accounts.length,
    activeAccounts: accounts.filter((a) => a.active).length,
    totalShared: accounts.reduce((sum, a) => sum + (a.stats?.totalShared || 0), 0),
    queuedCount: queue.filter((q) => q.status === "scheduled" || q.status === "pending").length,
  }), [accounts, queue]);

  return (
    <div style={{ padding: "0 0 40px", maxWidth: 1280, margin: "0 auto" }}>
      {/* ── Page Header Card ── */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
          padding: "20px 24px",
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          backdropFilter: "blur(12px)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "var(--radius)",
              background: "linear-gradient(135deg, #1877f2 0%, #0d47a1 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              color: "#fff",
              boxShadow: "0 4px 14px rgba(24, 119, 242, 0.35)",
              flexShrink: 0,
            }}
          >
            📱
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
                Social Hub
              </h1>
              <span
                style={{
                  background: "linear-gradient(135deg, #1877f2 0%, #42a5f5 100%)",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 12,
                  boxShadow: "0 2px 6px rgba(24, 119, 242, 0.25)",
                }}
              >
                Meta Graph API v21.0
              </span>
            </div>
            <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
              Tự động hóa đăng bài & phân phối nội dung đa kênh lên Facebook Fanpage
            </p>
          </div>
        </div>

        {/* Stat metrics */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              borderRadius: "var(--radius)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-light)",
            }}
          >
            <span style={{ fontSize: 18 }}>🔗</span>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                Fanpage
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                {stats.totalAccounts} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>trang</span>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              borderRadius: "var(--radius)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-light)",
            }}
          >
            <span style={{ fontSize: 18 }}>📤</span>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                Đã chia sẻ
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                {stats.totalShared} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>bài</span>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              borderRadius: "var(--radius)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-light)",
            }}
          >
            <span style={{ fontSize: 18 }}>📋</span>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                Hàng đợi
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                {stats.queuedCount} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>bài</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div
        style={{
          display: "inline-flex",
          background: "var(--bg-surface)",
          padding: 4,
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-light)",
          marginBottom: 20,
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 18px",
                borderRadius: "var(--radius)",
                border: isActive ? "1px solid var(--border-accent)" : "1px solid transparent",
                background: isActive ? "var(--bg-card)" : "transparent",
                color: isActive ? "var(--accent-blue)" : "var(--text-secondary)",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                transition: "all var(--transition)",
                boxShadow: isActive ? "var(--shadow-sm)" : "none",
              }}
            >
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === "connect" && accounts.length > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 10,
                    background: "rgba(24, 119, 242, 0.15)",
                    color: "#1877f2",
                  }}
                >
                  {accounts.length}
                </span>
              )}
              {t.id === "queue" && stats.queuedCount > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 10,
                    background: "rgba(245, 158, 11, 0.15)",
                    color: "#f59e0b",
                  }}
                >
                  {stats.queuedCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <p style={{ fontSize: 14 }}>Đang tải dữ liệu Social Hub...</p>
        </div>
      ) : (
        <>
          {tab === "connect" && (
            <ConnectTab accounts={accounts} onRefresh={loadAccounts} showToast={showToast} onSwitchToShare={() => setTab("share")} />
          )}
          {tab === "share" && (
            <ShareTab accounts={accounts} showToast={showToast} onRefreshQueue={loadQueue} />
          )}
          {tab === "queue" && (
            <QueueTab queue={queue} accounts={accounts} onRefresh={loadQueue} showToast={showToast} />
          )}
          {tab === "history" && <HistoryTab history={history} onRefresh={loadHistory} />}
        </>
      )}

      {/* ── Global Toast ── */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9999,
            padding: "12px 20px",
            borderRadius: "var(--radius)",
            background:
              toast.type === "success"
                ? "#10b981"
                : toast.type === "error"
                ? "#ef4444"
                : "var(--bg-card)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            animation: "slideInRight 0.3s ease",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>{toast.type === "success" ? "✅" : toast.type === "error" ? "⚠️" : "ℹ️"}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB 1: CONNECT — KẾT NỐI FANPAGE
// =====================================================================
function ConnectTab({ accounts, onRefresh, showToast, onSwitchToShare }) {
  const [showForm, setShowForm] = useState(false);
  const [pageId, setPageId] = useState("");
  const [pageToken, setPageToken] = useState("");
  const [autoShare, setAutoShare] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  const handleSave = async () => {
    if (!pageId.trim() || !pageToken.trim()) {
      showToast("Vui lòng điền đủ Page ID và Page Access Token", "error");
      return;
    }

    setSaving(true);
    try {
      await api.createSocialAccount({
        platform: "facebook",
        credentials: {
          pageId: pageId.trim(),
          pageToken: pageToken.trim(),
        },
        autoShare,
      });
      showToast("Kết nối Facebook Fanpage thành công!", "success");
      setPageId("");
      setPageToken("");
      setShowForm(false);
      onRefresh();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, "error");
    }
    setSaving(false);
  };

  const handleTest = async (account) => {
    setTestingId(account.id);
    try {
      const result = await api.testSocialAccount(account.id);
      showToast(
        result.message || (result.success ? "Kết nối Fanpage hoạt động tốt!" : "Lỗi kết nối"),
        result.success ? "success" : "error"
      );
      if (result.success) onRefresh();
    } catch (err) {
      showToast(`Lỗi kiểm tra: ${err.message}`, "error");
    }
    setTestingId(null);
  };

  const handleToggle = async (account, field) => {
    try {
      await api.updateSocialAccount(account.id, { [field]: !account[field] });
      onRefresh();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, "error");
    }
  };

  const handleDelete = async (account) => {
    if (!confirm(`Bạn có chắc muốn ngắt kết nối "${account.pageName || account.name || "Fanpage"}"?`)) return;
    try {
      await api.deleteSocialAccount(account.id);
      showToast(`Đã ngắt kết nối "${account.pageName || account.name}"`, "success");
      onRefresh();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, "error");
    }
  };

  return (
    <div>
      {/* ── Top Bar when accounts exist ── */}
      {accounts.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
              Fanpage Đã Kết Nối ({accounts.length})
            </h2>
            <p style={{ margin: "2px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Các trang Facebook sẵn sàng để đăng bài tự động hoặc lên lịch
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowGuide(!showGuide)}
              style={{ fontSize: 13 }}
            >
              📖 {showGuide ? "Ẩn hướng dẫn" : "Hướng dẫn Token"}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setShowForm(true)}
              style={{
                background: "linear-gradient(135deg, #1877f2 0%, #2563eb 100%)",
                fontSize: 13,
                boxShadow: "0 2px 8px rgba(24, 119, 242, 0.3)",
              }}
            >
              ➕ Thêm Fanpage Mới
            </button>
          </div>
        </div>
      )}

      {/* ── Add / Connect Form Card ── */}
      {showForm && (
        <div
          className="card"
          style={{
            padding: 24,
            marginBottom: 24,
            border: "1px solid var(--border-accent)",
            boxShadow: "var(--shadow-md)",
            background: "var(--bg-card)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
              borderBottom: "1px solid var(--border-color)",
              paddingBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>📘</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                Thêm Kết Nối Facebook Fanpage
              </h3>
            </div>
            <button
              onClick={() => setShowForm(false)}
              style={{
                background: "transparent",
                border: "none",
                fontSize: 18,
                cursor: "pointer",
                color: "var(--text-muted)",
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: "grid", gap: 16, maxWidth: 700 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                Page ID <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                placeholder="VD: 102938475610293"
                style={{ fontFamily: "monospace", fontSize: 13 }}
              />
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                Lấy Page ID tại:{" "}
                <a
                  href="https://www.facebook.com/settings/?tab=page_management"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent-blue)", textDecoration: "none" }}
                >
                  Facebook Page Settings ↗
                </a>{" "}
                (Mục Giới thiệu / About → ID Trang)
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                Page Access Token (Token trang) <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <textarea
                value={pageToken}
                onChange={(e) => setPageToken(e.target.value)}
                placeholder="EAABwz..."
                rows={3}
                style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
              />
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                Tạo tại:{" "}
                <a
                  href="https://developers.facebook.com/tools/explorer/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent-blue)", textDecoration: "none" }}
                >
                  Graph API Explorer ↗
                </a>{" "}
                (Yêu cầu quyền: <code>pages_manage_posts</code>, <code>pages_read_engagement</code>)
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, userSelect: "none" }}>
              <input
                type="checkbox"
                checked={autoShare}
                onChange={(e) => setAutoShare(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span>⚡ <strong>Tự động chia sẻ:</strong> Khi bài viết được xuất bản trên WordPress, tự động đăng link lên Fanpage này</span>
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowForm(false)}
                disabled={saving}
              >
                Hủy bỏ
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !pageId.trim() || !pageToken.trim()}
                style={{
                  background: "linear-gradient(135deg, #1877f2 0%, #2563eb 100%)",
                  boxShadow: "0 2px 8px rgba(24, 119, 242, 0.3)",
                }}
              >
                {saving ? "⏳ Đang kiểm tra & lưu..." : "💾 Lưu & Kết Nối Fanpage"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Guide Card (toggleable or shown on empty) ── */}
      {(showGuide || accounts.length === 0) && (
        <div
          className="card"
          style={{
            padding: 20,
            marginBottom: 24,
            background: "linear-gradient(135deg, rgba(24, 119, 242, 0.05) 0%, rgba(59, 130, 246, 0.02) 100%)",
            border: "1px solid rgba(24, 119, 242, 0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 18 }}>💡</span>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--accent-blue)" }}>
              Hướng dẫn lấy Page Access Token vĩnh viễn (Không bao giờ hết hạn)
            </h4>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ padding: 12, borderRadius: "var(--radius)", background: "var(--bg-surface)", border: "1px solid var(--border-light)" }}>
              <strong>1. Mở Graph API Explorer</strong>
              <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 12 }}>
                Truy cập <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-blue)" }}>Graph API Explorer</a>, chọn Meta App của bạn.
              </p>
            </div>
            <div style={{ padding: 12, borderRadius: "var(--radius)", background: "var(--bg-surface)", border: "1px solid var(--border-light)" }}>
              <strong>2. Cấp quyền & Chọn Page</strong>
              <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 12 }}>
                Thêm 2 quyền: <code>pages_manage_posts</code> và <code>pages_read_engagement</code>, rồi bấm <strong>Generate Access Token</strong>.
              </p>
            </div>
            <div style={{ padding: 12, borderRadius: "var(--radius)", background: "var(--bg-surface)", border: "1px solid var(--border-light)" }}>
              <strong>3. Gia hạn Token Vĩnh Viễn</strong>
              <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 12 }}>
                Copy Token vào <a href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-blue)" }}>Access Token Debugger</a> bấm <strong>Extend Token</strong> để sử dụng lâu dài.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty State Onboarding (If NO accounts connected yet) ── */}
      {accounts.length === 0 && !showForm && (
        <div
          className="card"
          style={{
            padding: "48px 32px",
            textAlign: "center",
            maxWidth: 640,
            margin: "20px auto",
            border: "1px dashed var(--border-accent)",
            background: "linear-gradient(180deg, var(--bg-card) 0%, var(--bg-surface) 100%)",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "linear-gradient(135deg, rgba(24, 119, 242, 0.2) 0%, rgba(59, 130, 246, 0.1) 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              margin: "0 auto 16px",
              border: "1px solid rgba(24, 119, 242, 0.3)",
            }}
          >
            📘
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
            Kết Nối Facebook Fanpage Đầu Tiên
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, margin: "0 auto 24px", maxWidth: 480, lineHeight: 1.6 }}>
            Liên kết Fanpage Facebook với SPLSEO để tự động chia sẻ bài viết, tạo caption bằng AI và tăng traffic tự nhiên từ mạng xã hội.
          </p>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => setShowForm(true)}
            style={{
              background: "linear-gradient(135deg, #1877f2 0%, #2563eb 100%)",
              boxShadow: "0 4px 16px rgba(24, 119, 242, 0.4)",
              fontWeight: 600,
            }}
          >
            ➕ Thêm Facebook Page Ngay
          </button>
        </div>
      )}

      {/* ── Connected Accounts Grid ── */}
      {accounts.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="card"
              style={{
                padding: 20,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                opacity: acc.active ? 1 : 0.6,
                border: acc.active ? "1px solid var(--border-color)" : "1px dashed var(--border-color)",
                transition: "all var(--transition)",
              }}
            >
              {/* Header: Avatar + Info */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: PLATFORMS[acc.platform]?.gradient || "#1877f2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    color: "#fff",
                    flexShrink: 0,
                    overflow: "hidden",
                    border: "2px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {acc.pageAvatar ? (
                    <img src={acc.pageAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "📘"
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {acc.pageName || acc.name || "Facebook Page"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                    <span>{acc.category || "Trang Doanh nghiệp"}</span>
                    {acc.fanCount > 0 && <span>• {formatNumber(acc.fanCount)} theo dõi</span>}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: 12,
                    background: acc.active ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    color: acc.active ? "#10b981" : "#ef4444",
                  }}
                >
                  {acc.active ? "Hoạt động" : "Tạm dừng"}
                </span>
              </div>

              {/* Stats & Settings */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: "var(--bg-surface)",
                  borderRadius: "var(--radius)",
                  fontSize: 12,
                }}
              >
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Đã chia sẻ: </span>
                  <strong style={{ color: "var(--text-primary)" }}>{acc.stats?.totalShared || 0} bài</strong>
                </div>
                <button
                  onClick={() => handleToggle(acc, "autoShare")}
                  style={{
                    border: "none",
                    background: acc.autoShare ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.05)",
                    color: acc.autoShare ? "var(--accent-blue)" : "var(--text-muted)",
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all var(--transition)",
                  }}
                  title="Tự động chia sẻ bài viết lên Fanpage này khi xuất bản trên WordPress"
                >
                  {acc.autoShare ? "⚡ Auto-share: BẬT" : "Auto-share: TẮT"}
                </button>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleTest(acc)}
                  disabled={testingId === acc.id}
                  style={{ flex: 1, fontSize: 12 }}
                >
                  {testingId === acc.id ? "⏳ Đang test..." : "🔌 Test Kết Nối"}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleToggle(acc, "active")}
                  style={{ fontSize: 12 }}
                >
                  {acc.active ? "Tắt" : "Bật"}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDelete(acc)}
                  style={{ fontSize: 12 }}
                  title="Ngắt kết nối trang này"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB 2: SHARE — SOẠN BÀI & LIVE FACEBOOK PREVIEW
// =====================================================================
function ShareTab({ accounts, showToast, onRefreshQueue }) {
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState(() => accounts.filter((a) => a.active).map((a) => a.id));
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [mode, setMode] = useState("now"); // "now" | "queue"

  const activeAccounts = accounts.filter((a) => a.active);

  // Fetch OG preview
  const handlePreview = async () => {
    if (!link.trim()) return;
    setLoadingPreview(true);
    try {
      const data = await api.socialPreviewUrl(link.trim());
      setPreview(data);
    } catch (err) {
      showToast(`Không thể quét link: ${err.message}`, "error");
    }
    setLoadingPreview(false);
  };

  // Generate AI Caption
  const handleGenerateCaption = async () => {
    if (!link.trim() && !preview?.title) {
      showToast("Vui lòng nhập Link bài viết trước để AI phân tích nội dung", "error");
      return;
    }

    setGeneratingCaption(true);
    try {
      const res = await api.generateSocialCaption({
        url: link.trim(),
        title: preview?.title || "",
        description: preview?.description || "",
      });
      if (res.caption) {
        setMessage(res.caption);
        showToast("Đã tạo caption bằng AI thành công!", "success");
      }
    } catch (err) {
      showToast(`Lỗi tạo caption: ${err.message}`, "error");
    }
    setGeneratingCaption(false);
  };

  // Share post
  const handleShare = async () => {
    if (!selectedAccounts.length) {
      showToast("Vui lòng chọn ít nhất 1 Fanpage để đăng", "error");
      return;
    }
    if (!link.trim() && !message.trim()) {
      showToast("Vui lòng nhập link bài viết hoặc nội dung caption", "error");
      return;
    }

    setPublishing(true);
    try {
      if (mode === "now") {
        const result = await api.socialShare({
          accountIds: selectedAccounts,
          link: link.trim(),
          message: message.trim(),
          type: link.trim() ? "link" : "text",
        });
        showToast(result.message, result.success ? "success" : "error");
        if (result.success) {
          setLink("");
          setMessage("");
          setPreview(null);
        }
      } else {
        // Add to queue
        await api.socialImportUrls({
          urls: [link.trim()],
          accountIds: selectedAccounts,
          scheduleType: "scheduled",
          intervalMinutes: 30,
          useAI: false,
        });
        showToast("Đã thêm bài viết vào hàng đợi đăng!", "success");
        if (onRefreshQueue) onRefreshQueue();
        setLink("");
        setMessage("");
        setPreview(null);
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, "error");
    }
    setPublishing(false);
  };

  const toggleAccount = (id) => {
    setSelectedAccounts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const selectAllAccounts = () => {
    if (selectedAccounts.length === activeAccounts.length) {
      setSelectedAccounts([]);
    } else {
      setSelectedAccounts(activeAccounts.map((a) => a.id));
    }
  };

  const insertEmoji = (emoji) => {
    setMessage((prev) => prev + " " + emoji);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 24, alignItems: "start" }}>
      {/* ── LEFT: COMPOSER ── */}
      <div className="card" style={{ padding: 24, background: "var(--bg-card)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <span>✏️</span> Soạn Bài Đăng Facebook
        </h3>

        {/* 1. Chọn Fanpage */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              1. Chọn Fanpage Đăng ({selectedAccounts.length}/{activeAccounts.length})
            </label>
            {activeAccounts.length > 0 && (
              <button
                type="button"
                onClick={selectAllAccounts}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--accent-blue)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {selectedAccounts.length === activeAccounts.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </button>
            )}
          </div>

          {activeAccounts.length === 0 ? (
            <div style={{ padding: 12, borderRadius: "var(--radius)", background: "var(--bg-surface)", fontSize: 13, color: "var(--text-muted)" }}>
              ⚠️ Chưa có Fanpage nào đang hoạt động. Vui lòng kết nối tại tab <strong>"Fanpage Liên Kết"</strong>.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {activeAccounts.map((acc) => {
                const isSelected = selectedAccounts.includes(acc.id);
                return (
                  <label
                    key={acc.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      background: isSelected ? "rgba(24, 119, 242, 0.12)" : "var(--bg-surface)",
                      border: isSelected ? "1.5px solid #1877f2" : "1px solid var(--border-color)",
                      transition: "all var(--transition)",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAccount(acc.id)}
                      style={{ width: 16, height: 16 }}
                    />
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: "#1877f2",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        color: "#fff",
                        flexShrink: 0,
                      }}
                    >
                      {acc.pageAvatar ? <img src={acc.pageAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "📘"}
                    </div>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: isSelected ? 600 : 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {acc.pageName || acc.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. Link bài viết */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
            2. Đường Dẫn Bài Viết (URL)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://splworks.com/bai-viet-seo-mau"
              style={{ flex: 1, fontSize: 13 }}
              onBlur={handlePreview}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePreview}
              disabled={loadingPreview || !link.trim()}
              style={{ whiteSpace: "nowrap", fontSize: 13 }}
            >
              {loadingPreview ? "⏳ Quét..." : "🔍 Quét Link"}
            </button>
          </div>
        </div>

        {/* 3. Caption + AI Generator Button */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              3. Caption Bài Viết
            </label>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleGenerateCaption}
              disabled={generatingCaption || (!link.trim() && !preview?.title)}
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%)",
                border: "1px solid rgba(139, 92, 246, 0.4)",
                color: "var(--text-primary)",
                fontWeight: 600,
                fontSize: 12,
                borderRadius: 8,
              }}
            >
              {generatingCaption ? "⏳ AI đang viết..." : "✨ AI Tạo Caption Viral"}
            </button>
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Viết caption cho bài đăng Facebook (hoặc bấm nút 'AI Tạo Caption' ở trên)..."
            rows={5}
            style={{ fontSize: 13, lineHeight: 1.5, resize: "vertical" }}
          />

          {/* Quick Emoji Bar */}
          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Emoji nhanh:</span>
            {["🔥", "🚀", "💡", "📌", "👉", "⚡", "⭐", "👇"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertEmoji(emoji)}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-light)",
                  borderRadius: 6,
                  padding: "2px 6px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {emoji}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
              {message.length} ký tự
            </span>
          </div>
        </div>

        {/* 4. Tùy chọn đăng */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input
              type="radio"
              name="postMode"
              checked={mode === "now"}
              onChange={() => setMode("now")}
            />
            <span>🚀 Đăng ngay bây giờ</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input
              type="radio"
              name="postMode"
              checked={mode === "queue"}
              onChange={() => setMode("queue")}
            />
            <span>⏰ Thêm vào hàng đợi đăng</span>
          </label>
        </div>

        {/* Submit Button */}
        <button
          className="btn btn-primary btn-lg"
          onClick={handleShare}
          disabled={publishing || (!link.trim() && !message.trim()) || !selectedAccounts.length}
          style={{
            width: "100%",
            background: "linear-gradient(135deg, #1877f2 0%, #0d47a1 100%)",
            boxShadow: "0 4px 16px rgba(24, 119, 242, 0.4)",
            fontWeight: 700,
            fontSize: 15,
            justifyContent: "center",
          }}
        >
          {publishing
            ? "⏳ Đang thực hiện đăng bài..."
            : mode === "now"
            ? `🚀 Đăng Lên ${selectedAccounts.length} Fanpage Đã Chọn`
            : `⏰ Thêm Vào Hàng Đợi (${selectedAccounts.length} Trang)`}
        </button>
      </div>

      {/* ── RIGHT: LIVE FACEBOOK FEED MOCKUP ── */}
      <div>
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
            👁️ Xem Trước Trên Newsfeed Facebook
          </h3>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Mô phỏng thời gian thực</span>
        </div>

        {/* Mockup Card */}
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {/* Post Header */}
          <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#1877f2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                color: "#fff",
                overflow: "hidden",
              }}
            >
              {selectedAccounts.length > 0 && accounts.find((a) => a.id === selectedAccounts[0])?.pageAvatar ? (
                <img
                  src={accounts.find((a) => a.id === selectedAccounts[0]).pageAvatar}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                "📘"
              )}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                {selectedAccounts.length > 0
                  ? accounts.find((a) => a.id === selectedAccounts[0])?.pageName || "Tên Fanpage"
                  : "Tên Fanpage"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
                <span>Vừa xong</span>
                <span>•</span>
                <span>🌐</span>
              </div>
            </div>
          </div>

          {/* Caption Text */}
          <div style={{ padding: "0 16px 12px", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>
            {message || (
              <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                Nội dung caption sẽ hiển thị tại đây khi bạn nhập văn bản...
              </span>
            )}
          </div>

          {/* Link OG Card */}
          {preview ? (
            <div style={{ borderTop: "1px solid var(--border-color)", borderBottom: "1px solid var(--border-color)", background: "var(--bg-surface)" }}>
              {preview.image && (
                <div style={{ height: 200, width: "100%", overflow: "hidden", background: "#0c1424" }}>
                  <img src={preview.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              )}
              <div style={{ padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                  {preview.siteName || (() => { try { return new URL(preview.url || link).hostname; } catch { return "WEBSITE"; } })()}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4, lineHeight: 1.3 }}>
                  {preview.title || "Tiêu đề bài viết"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {preview.description || "Mô tả ngắn của bài viết sẽ hiển thị ở đây..."}
                </div>
              </div>
            </div>
          ) : (
            link && (
              <div style={{ padding: 16, textAlign: "center", borderTop: "1px solid var(--border-color)", borderBottom: "1px solid var(--border-color)", color: "var(--text-muted)", fontSize: 12 }}>
                🔗 Nhấn <strong>"Quét Link"</strong> để hiển thị ảnh bìa và tiêu đề đầy đủ
              </div>
            )
          )}

          {/* Facebook Interaction Bar */}
          <div
            style={{
              padding: "8px 16px",
              display: "flex",
              justifyContent: "space-around",
              borderTop: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "default" }}>
              <span>👍</span> Thích
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "default" }}>
              <span>💬</span> Bình luận
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "default" }}>
              <span>↗️</span> Chia sẻ
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 3: QUEUE — HÀNG ĐỢI ĐĂNG BÀI
// =====================================================================
function QueueTab({ queue, accounts, onRefresh, showToast }) {
  const [filter, setFilter] = useState("all");
  const [importModal, setImportModal] = useState(false);

  const filteredQueue = useMemo(() => {
    if (filter === "all") return queue;
    return queue.filter((q) => q.status === filter);
  }, [queue, filter]);

  return (
    <div>
      {/* Action & Filter Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* Filters */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { id: "all", label: `Tất cả (${queue.length})` },
            { id: "pending", label: "Chờ đăng" },
            { id: "scheduled", label: "Đã lên lịch" },
            { id: "published", label: "Đã đăng" },
            { id: "failed", label: "Thất bại" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                border: filter === f.id ? "1px solid var(--border-accent)" : "1px solid var(--border-color)",
                background: filter === f.id ? "var(--bg-secondary)" : "transparent",
                color: filter === f.id ? "var(--accent-blue)" : "var(--text-secondary)",
                padding: "6px 12px",
                borderRadius: "var(--radius)",
                fontSize: 12,
                fontWeight: filter === f.id ? 600 : 400,
                cursor: "pointer",
                transition: "all var(--transition)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
            🔄 Làm Mới
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setImportModal(true)}
            style={{ background: "linear-gradient(135deg, #1877f2 0%, #2563eb 100%)" }}
          >
            ➕ Import URLs Hàng Loạt
          </button>
        </div>
      </div>

      {/* Queue Items */}
      {filteredQueue.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ margin: 0, fontSize: 14 }}>Không có bài viết nào trong danh mục này</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filteredQueue.map((item) => {
            const acc = accounts.find((a) => a.id === item.accountId);
            return (
              <div
                key={item.id}
                className="card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 18px",
                  borderLeft: `4px solid ${getStatusColor(item.status)}`,
                }}
              >
                <div style={{ fontSize: 22 }}>{getStatusIcon(item.status)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.ogData?.title || item.url}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                    <span>👉 Đăng tới: <strong>{acc?.pageName || acc?.name || "Fanpage"}</strong></span>
                    <span>• Hẹn lúc: {formatDate(item.scheduledAt)}</span>
                    {item.status === "failed" && <span style={{ color: "#ef4444" }}>• Lỗi: {item.error}</span>}
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 12,
                    background: `${getStatusColor(item.status)}22`,
                    color: getStatusColor(item.status),
                  }}
                >
                  {getStatusLabel(item.status)}
                </span>

                {(item.status === "scheduled" || item.status === "pending") && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      try {
                        await api.publishSocialQueueItem(item.id);
                        showToast("Đã kích hoạt đăng bài!", "success");
                        onRefresh();
                      } catch (err) {
                        showToast(`Lỗi: ${err.message}`, "error");
                      }
                    }}
                    style={{ fontSize: 12 }}
                  >
                    ▶ Đăng Ngay
                  </button>
                )}

                {item.status !== "published" && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      try {
                        await api.deleteSocialQueueItem(item.id);
                        onRefresh();
                      } catch {}
                    }}
                    style={{ fontSize: 12 }}
                    title="Xóa khỏi hàng đợi"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Import URLs Modal */}
      {importModal && (
        <ImportUrlsModal
          accounts={accounts}
          onClose={() => setImportModal(false)}
          onSuccess={() => {
            setImportModal(false);
            onRefresh();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// =====================================================================
// MODAL: IMPORT URLS HÀNG LOẠT
// =====================================================================
function ImportUrlsModal({ accounts, onClose, onSuccess, showToast }) {
  const [urls, setUrls] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState(() => accounts.filter((a) => a.active).map((a) => a.id));
  const [interval, setInterval_] = useState(30);
  const [useAI, setUseAI] = useState(true);
  const [scheduleType, setScheduleType] = useState("scheduled");
  const [importing, setImporting] = useState(false);

  const activeAccounts = accounts.filter((a) => a.active);
  const urlList = urls
    .split("\n")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("http"));

  const handleImport = async () => {
    if (!urlList.length) {
      showToast("Vui lòng nhập ít nhất 1 đường dẫn URL hợp lệ", "error");
      return;
    }
    if (!selectedAccounts.length) {
      showToast("Vui lòng chọn ít nhất 1 Fanpage đích", "error");
      return;
    }

    setImporting(true);
    try {
      const result = await api.socialImportUrls({
        urls: urlList,
        accountIds: selectedAccounts,
        scheduleType,
        intervalMinutes: interval,
        useAI,
      });
      showToast(result.message || "Import hàng loạt thành công!", "success");
      onSuccess();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, "error");
    }
    setImporting(false);
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" style={{ maxWidth: 580, padding: 24 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>
          📥 Import Danh Sách URL Vào Hàng Đợi
        </h3>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
            Danh sách link bài viết (mỗi dòng 1 URL)
          </label>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={"https://splworks.com/bai-viet-1\nhttps://splworks.com/bai-viet-2\nhttps://splworks.com/bai-viet-3"}
            rows={5}
            style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Đã nhận diện: <strong>{urlList.length}</strong> URL hợp lệ
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
            Chọn Fanpage đăng
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {activeAccounts.map((acc) => (
              <label
                key={acc.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                  cursor: "pointer",
                  background: selectedAccounts.includes(acc.id) ? "rgba(24,119,242,0.15)" : "var(--bg-surface)",
                  border: selectedAccounts.includes(acc.id) ? "1px solid #1877f2" : "1px solid var(--border-color)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedAccounts.includes(acc.id)}
                  onChange={() =>
                    setSelectedAccounts((prev) =>
                      prev.includes(acc.id) ? prev.filter((x) => x !== acc.id) : [...prev, acc.id]
                    )
                  }
                />
                <span>📘 {acc.pageName || acc.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Chế độ đăng
            </label>
            <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
              <option value="scheduled">Giãn cách theo lịch</option>
              <option value="immediate">Đăng lần lượt ngay</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              Khoảng cách giãn (phút)
            </label>
            <input
              type="number"
              value={interval}
              onChange={(e) => setInterval_(Number(e.target.value) || 30)}
              min={5}
              max={1440}
            />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
          <span>🤖 <strong>AI tự viết caption:</strong> Quét nội dung từng bài viết để tạo caption thu hút riêng biệt</span>
        </label>

        {urlList.length > 0 && selectedAccounts.length > 0 && (
          <div style={{ padding: 12, borderRadius: 8, fontSize: 12, background: "rgba(24, 119, 242, 0.08)", marginBottom: 16 }}>
            Sẽ tạo <strong>{urlList.length * selectedAccounts.length}</strong> bài đăng, mỗi bài cách nhau <strong>{interval} phút</strong>.
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={importing || !urlList.length || !selectedAccounts.length}
            style={{ background: "linear-gradient(135deg, #1877f2 0%, #2563eb 100%)" }}
          >
            {importing ? "⏳ Đang import..." : `📥 Import ${urlList.length} Bài Viết`}
          </button>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// TAB 4: HISTORY — NHẬT KÝ & THỐNG KÊ
// =====================================================================
function HistoryTab({ history, onRefresh }) {
  if (!history.length) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
        <p style={{ margin: 0, fontSize: 14 }}>Chưa có lịch sử chia sẻ nào</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {history.map((item) => (
        <div
          key={item.id}
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 18px",
          }}
        >
          <div style={{ fontSize: 20 }}>{item.status === "success" ? "✅" : "❌"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.link || item.message?.substring(0, 70) || "Bài đăng Facebook"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 8, marginTop: 3 }}>
              <span>→ {item.accountName || "Fanpage"}</span>
              <span>• {formatDate(item.sharedAt)}</span>
              {item.source === "queue" && <span>• từ hàng đợi</span>}
              {item.source === "auto-publish" && <span>• tự động khi publish</span>}
            </div>
          </div>

          {item.result?.url && (
            <a
              href={item.result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ textDecoration: "none", fontSize: 12, whiteSpace: "nowrap" }}
            >
              Mở trên FB ↗
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================
function formatNumber(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "Vừa xong";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} giờ trước`;
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusColor(s) {
  const m = {
    published: "#10b981",
    processing: "#f59e0b",
    pending: "#6366f1",
    scheduled: "#6366f1",
    failed: "#ef4444",
  };
  return m[s] || "#64748b";
}

function getStatusIcon(s) {
  const m = {
    published: "✅",
    processing: "⏳",
    pending: "🕐",
    scheduled: "⏰",
    failed: "❌",
  };
  return m[s] || "📄";
}

function getStatusLabel(s) {
  const m = {
    published: "Đã đăng",
    processing: "Đang xử lý",
    pending: "Chờ đăng",
    scheduled: "Đã lên lịch",
    failed: "Thất bại",
  };
  return m[s] || s;
}
