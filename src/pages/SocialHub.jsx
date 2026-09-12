import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

// ===== Tab Definitions =====
const TABS = [
  { id: "connect", label: "Kết nối", icon: "🔗" },
  { id: "share", label: "Chia sẻ", icon: "📤" },
  { id: "queue", label: "Hàng đợi", icon: "📋" },
  { id: "history", label: "Lịch sử", icon: "📊" },
];

// ===== Platform Visual Config =====
const PLATFORMS = {
  facebook: { name: "Facebook", icon: "📘", color: "#1877f2", gradient: "linear-gradient(135deg, #1877f2, #42a5f5)" },
};

export default function SocialHub() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "connect");
  const [accounts, setAccounts] = useState([]);
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // ===== Load accounts on mount =====
  const loadAccounts = useCallback(async () => {
    try {
      const data = await api.getSocialAccounts();
      setAccounts(data);
    } catch { setAccounts([]); }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadAccounts();
      setLoading(false);
    })();
  }, [loadAccounts]);

  // Tab-specific data loading
  useEffect(() => {
    if (tab === "queue") {
      api.getSocialQueue().then(setQueue).catch(() => setQueue([]));
    }
    if (tab === "history") {
      api.getSocialHistory().then(setHistory).catch(() => setHistory([]));
    }
  }, [tab]);

  function showToast(message, type = "info") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  // ===== Stats =====
  const stats = useMemo(() => ({
    totalAccounts: accounts.length,
    activeAccounts: accounts.filter(a => a.active).length,
    totalShared: accounts.reduce((sum, a) => sum + (a.stats?.totalShared || 0), 0),
  }), [accounts]);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 28 }}>📱</span> Social Hub
            <span className="nav-badge" style={{ background: "var(--accent-green, #10b981)", color: "#fff", fontSize: 10, padding: "2px 8px", borderRadius: 8, fontWeight: 700 }}>Mới</span>
          </h1>
          <p className="page-subtitle" style={{ marginTop: 4, opacity: 0.7 }}>
            Kết nối và chia sẻ nội dung lên mạng xã hội tự động
          </p>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div className="stat-chip">
            <span className="stat-chip-icon">🔗</span>
            <span>{stats.totalAccounts} tài khoản</span>
          </div>
          <div className="stat-chip">
            <span className="stat-chip-icon">📤</span>
            <span>{stats.totalShared} bài đã chia sẻ</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60, opacity: 0.5 }}>
          <span className="loader" />
        </div>
      ) : (
        <>
          {tab === "connect" && <ConnectTab accounts={accounts} onRefresh={loadAccounts} showToast={showToast} />}
          {tab === "share" && <ShareTab accounts={accounts} showToast={showToast} />}
          {tab === "queue" && <QueueTab queue={queue} accounts={accounts} onRefresh={() => api.getSocialQueue().then(setQueue)} showToast={showToast} />}
          {tab === "history" && <HistoryTab history={history} />}
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          padding: "12px 20px", borderRadius: 12,
          background: toast.type === "success" ? "var(--accent-green, #10b981)" : toast.type === "error" ? "#ef4444" : "var(--card-bg)",
          color: "#fff", fontSize: 14, fontWeight: 500,
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          animation: "slideInRight 0.3s ease",
        }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB: CONNECT — Nhập Token thủ công (Multi-tenant)
// =====================================================================
function ConnectTab({ accounts, onRefresh, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [pageId, setPageId] = useState("");
  const [pageToken, setPageToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);

  const handleSave = async () => {
    if (!pageId.trim() || !pageToken.trim()) {
      showToast("Vui lòng nhập Page ID và Page Access Token", "error");
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
      });
      showToast("✅ Đã kết nối Facebook Page thành công!", "success");
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
    setTesting(account.id);
    try {
      const result = await api.testSocialAccount(account.id);
      showToast(result.message || (result.success ? "Kết nối OK" : "Lỗi kết nối"), result.success ? "success" : "error");
      if (result.success) onRefresh(); // Refresh to get updated page info
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, "error");
    }
    setTesting(null);
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
    if (!confirm(`Ngắt kết nối "${account.pageName || account.name}"? Hành động này không thể hoàn tác.`)) return;
    try {
      await api.deleteSocialAccount(account.id);
      showToast(`Đã ngắt kết nối ${account.pageName || account.name}`, "success");
      onRefresh();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, "error");
    }
  };

  return (
    <div>
      {/* Add New Form */}
      {!showForm ? (
        <div className="card" style={{
          background: "linear-gradient(135deg, rgba(24,119,242,0.1), rgba(66,165,245,0.05))",
          border: "1px dashed rgba(24,119,242,0.3)",
          padding: 24, textAlign: "center", marginBottom: 24,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📘</div>
          <h3 style={{ marginBottom: 8 }}>Kết nối Facebook Page</h3>
          <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 16, maxWidth: 500, margin: "0 auto 16px" }}>
            Nhập Page ID và Page Access Token để kết nối. Token lấy từ{" "}
            <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" style={{ color: "#1877f2" }}>
              Graph API Explorer
            </a>{" "}
            hoặc Facebook Business Suite.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(true)}
            style={{ background: "#1877f2", padding: "10px 24px", fontSize: 14, borderRadius: 10 }}
          >
            ➕ Thêm Facebook Page
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <h3 style={{ marginBottom: 16, fontSize: 15 }}>📘 Thêm Facebook Page</h3>

          {/* Page ID */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4, display: "block" }}>
              Page ID
            </label>
            <input
              type="text"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="VD: 123456789012345"
              className="input"
              style={{ fontFamily: "monospace" }}
            />
            <p style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
              Tìm Page ID tại:{" "}
              <a href="https://www.facebook.com/settings/?tab=page_management" target="_blank" rel="noopener noreferrer" style={{ color: "#1877f2" }}>
                Facebook Page Settings
              </a>
              {" → About → Page ID"}
            </p>
          </div>

          {/* Page Access Token */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4, display: "block" }}>
              Page Access Token
            </label>
            <textarea
              value={pageToken}
              onChange={(e) => setPageToken(e.target.value)}
              placeholder="EAAxxxxxx..."
              className="input"
              rows={3}
              style={{ fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            />
            <p style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
              Tạo token tại:{" "}
              <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" style={{ color: "#1877f2" }}>
                Graph API Explorer
              </a>
              {" → Chọn Page → permissions: pages_manage_posts, pages_read_engagement"}
            </p>
          </div>

          {/* How to guide */}
          <details style={{ marginBottom: 16, fontSize: 12, opacity: 0.7 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>📖 Hướng dẫn lấy Token (never-expiring)</summary>
            <ol style={{ paddingLeft: 20, marginTop: 8, lineHeight: 1.8 }}>
              <li>Vào <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" style={{ color: "#1877f2" }}>Graph API Explorer</a></li>
              <li>Chọn App của bạn (hoặc tạo mới tại developers.facebook.com)</li>
              <li>Nhấn <b>"Generate Access Token"</b></li>
              <li>Chọn permissions: <code>pages_manage_posts</code>, <code>pages_read_engagement</code></li>
              <li>Chọn Page bạn muốn kết nối</li>
              <li>Copy <b>Page Access Token</b> (không phải User Token)</li>
              <li>Để token không hết hạn: vào <a href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noopener noreferrer" style={{ color: "#1877f2" }}>Access Token Debugger</a> → "Extend Access Token"</li>
            </ol>
          </details>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={() => setShowForm(false)} style={{ borderRadius: 8 }}>Hủy</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !pageId.trim() || !pageToken.trim()}
              style={{ background: "#1877f2", borderRadius: 8, padding: "8px 20px" }}
            >
              {saving ? "Đang lưu..." : "💾 Lưu & Kết nối"}
            </button>
          </div>
        </div>
      )}

      {/* Connected Accounts */}
      {accounts.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Tài khoản đã kết nối ({accounts.length})</h3>
          <div style={{ display: "grid", gap: 12 }}>
            {accounts.map(account => (
              <div key={account.id} className="card" style={{
                display: "flex", alignItems: "center", gap: 16, padding: "16px 20px",
                opacity: account.active ? 1 : 0.5,
                transition: "all 0.2s ease",
              }}>
                {/* Avatar */}
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: PLATFORMS[account.platform]?.gradient || "#333",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 24, flexShrink: 0, overflow: "hidden",
                }}>
                  {account.pageAvatar ? (
                    <img src={account.pageAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    PLATFORMS[account.platform]?.icon || "📱"
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{account.pageName || account.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.6, display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                    <span>{PLATFORMS[account.platform]?.name || account.platform}</span>
                    {account.fanCount > 0 && <span>• {formatNumber(account.fanCount)} người theo dõi</span>}
                    {account.stats?.totalShared > 0 && <span>• {account.stats.totalShared} bài đã chia sẻ</span>}
                    {account.category && <span>• {account.category}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  {/* Auto-share toggle */}
                  <button
                    className="btn btn-sm"
                    onClick={() => handleToggle(account, "autoShare")}
                    title={account.autoShare ? "Tắt tự động chia sẻ" : "Bật tự động chia sẻ khi publish bài"}
                    style={{
                      background: account.autoShare ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.05)",
                      color: account.autoShare ? "#6366f1" : "inherit",
                      fontSize: 11, padding: "4px 8px", borderRadius: 6,
                    }}
                  >
                    {account.autoShare ? "🔄 Auto" : "Auto"}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleToggle(account, "active")}
                    style={{
                      background: account.active ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                      color: account.active ? "#10b981" : "#ef4444",
                      fontSize: 11, padding: "4px 8px", borderRadius: 6,
                    }}
                  >
                    {account.active ? "Bật" : "Tắt"}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleTest(account)}
                    disabled={testing === account.id}
                    style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}
                  >
                    {testing === account.id ? "..." : "🔌 Test"}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleDelete(account)}
                    style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6, color: "#ef4444" }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {accounts.length === 0 && !showForm && (
        <div style={{ textAlign: "center", padding: 40, opacity: 0.5 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔌</div>
          <p>Chưa có tài khoản nào được kết nối</p>
          <p style={{ fontSize: 13 }}>Nhấn "Thêm Facebook Page" để bắt đầu</p>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// TAB: SHARE
// =====================================================================
function ShareTab({ accounts, showToast }) {
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const activeAccounts = accounts.filter(a => a.active);

  const handlePreview = async () => {
    if (!link.trim()) return;
    setLoadingPreview(true);
    try {
      const data = await api.socialPreviewUrl(link.trim());
      setPreview(data);
    } catch (err) {
      showToast(`Không thể xem trước: ${err.message}`, "error");
    }
    setLoadingPreview(false);
  };

  const handleShare = async () => {
    if (!selectedAccounts.length) { showToast("Vui lòng chọn ít nhất 1 tài khoản", "error"); return; }
    if (!link.trim() && !message.trim()) { showToast("Vui lòng nhập link hoặc nội dung", "error"); return; }

    setPublishing(true);
    try {
      const result = await api.socialShare({
        accountIds: selectedAccounts,
        link: link.trim(),
        message: message.trim(),
        type: link.trim() ? "link" : "text",
      });
      showToast(result.message, result.success ? "success" : "error");
      if (result.success) {
        setLink(""); setMessage(""); setPreview(null); setSelectedAccounts([]);
      }
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, "error");
    }
    setPublishing(false);
  };

  const toggleAccount = (id) => {
    setSelectedAccounts(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1fr 1fr", maxWidth: 900 }}>
      {/* Left: Input */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 16, fontSize: 15 }}>📤 Chia sẻ lên Facebook</h3>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4, display: "block" }}>Link bài viết</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="url" value={link} onChange={(e) => setLink(e.target.value)}
              placeholder="https://example.com/bai-viet"
              className="input" style={{ flex: 1 }}
              onBlur={handlePreview}
            />
            <button className="btn btn-sm" onClick={handlePreview} disabled={loadingPreview}>
              {loadingPreview ? "..." : "👁️"}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4, display: "block" }}>Caption (tuỳ chọn)</label>
          <textarea
            value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Viết caption cho bài share..."
            className="input" rows={3} style={{ resize: "vertical" }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 8, display: "block" }}>Chọn tài khoản</label>
          {activeAccounts.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.5 }}>Chưa có tài khoản. Kết nối ở tab "Kết nối".</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {activeAccounts.map(acc => (
                <label key={acc.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                  borderRadius: 8, cursor: "pointer",
                  background: selectedAccounts.includes(acc.id) ? "rgba(24,119,242,0.1)" : "rgba(255,255,255,0.03)",
                  border: selectedAccounts.includes(acc.id) ? "1px solid rgba(24,119,242,0.3)" : "1px solid transparent",
                  transition: "all 0.15s ease",
                }}>
                  <input type="checkbox" checked={selectedAccounts.includes(acc.id)} onChange={() => toggleAccount(acc.id)} />
                  <span style={{ fontSize: 18 }}>{PLATFORMS[acc.platform]?.icon || "📱"}</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{acc.pageName || acc.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          className="btn btn-primary" onClick={handleShare}
          disabled={publishing || (!link.trim() && !message.trim()) || !selectedAccounts.length}
          style={{ width: "100%", padding: "10px 0", borderRadius: 10, fontSize: 14 }}
        >
          {publishing ? "Đang chia sẻ..." : `📤 Chia sẻ lên ${selectedAccounts.length} tài khoản`}
        </button>
      </div>

      {/* Right: Preview */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 16, fontSize: 15 }}>👁️ Xem trước</h3>
        {preview ? (
          <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden" }}>
            {preview.image && (
              <div style={{ height: 180, overflow: "hidden", background: "#1a1a2e" }}>
                <img src={preview.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )}
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 11, opacity: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                {preview.siteName || (() => { try { return new URL(preview.url || link).hostname; } catch { return ""; } })()}
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{preview.title || "Không có tiêu đề"}</div>
              <div style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.4 }}>
                {preview.description?.substring(0, 150) || ""}{(preview.description?.length || 0) > 150 && "..."}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: 40, opacity: 0.3 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🖼️</div>
            <p style={{ fontSize: 13 }}>Nhập URL rồi nhấn nút xem trước</p>
          </div>
        )}
        {message && (
          <div style={{ marginTop: 16, padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>Caption:</div>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{message}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// TAB: QUEUE
// =====================================================================
function QueueTab({ queue, accounts, onRefresh, showToast }) {
  const [importModal, setImportModal] = useState(false);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={() => setImportModal(true)} style={{ borderRadius: 10, fontSize: 13, padding: "8px 16px" }}>
          ➕ Import URLs
        </button>
        <button className="btn btn-sm" onClick={onRefresh} style={{ borderRadius: 8, fontSize: 12 }}>🔄 Làm mới</button>
        <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.5 }}>{queue.length} mục</div>
      </div>

      {queue.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, opacity: 0.5 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <p>Hàng đợi trống</p>
          <p style={{ fontSize: 13 }}>Nhấn "Import URLs" để thêm danh sách link cần chia sẻ</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {queue.map(item => {
            const account = accounts.find(a => a.id === item.accountId);
            return (
              <div key={item.id} className="card" style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                borderLeft: `3px solid ${getStatusColor(item.status)}`,
              }}>
                <div style={{ fontSize: 20 }}>{getStatusIcon(item.status)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.ogData?.title || item.url}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.5, display: "flex", gap: 8, marginTop: 2 }}>
                    <span>→ {account?.pageName || account?.name || "?"}</span>
                    <span>• {formatDate(item.scheduledAt)}</span>
                    {item.status === "failed" && <span style={{ color: "#ef4444" }}>• {item.error}</span>}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 6,
                  background: `${getStatusColor(item.status)}22`, color: getStatusColor(item.status),
                }}>
                  {getStatusLabel(item.status)}
                </span>
                {(item.status === "scheduled" || item.status === "pending") && (
                  <button className="btn btn-sm" onClick={async () => {
                    try { await api.publishSocialQueueItem(item.id); showToast("Đã đăng!", "success"); onRefresh(); }
                    catch (err) { showToast(`Lỗi: ${err.message}`, "error"); }
                  }} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6 }}>▶ Đăng</button>
                )}
                {item.status !== "published" && (
                  <button className="btn btn-sm" onClick={async () => {
                    try { await api.deleteSocialQueueItem(item.id); onRefresh(); } catch {}
                  }} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, color: "#ef4444" }}>✕</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {importModal && (
        <ImportUrlsModal
          accounts={accounts}
          onClose={() => setImportModal(false)}
          onSuccess={() => { setImportModal(false); onRefresh(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// =====================================================================
// IMPORT URLS MODAL
// =====================================================================
function ImportUrlsModal({ accounts, onClose, onSuccess, showToast }) {
  const [urls, setUrls] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [interval, setInterval_] = useState(30);
  const [useAI, setUseAI] = useState(false);
  const [scheduleType, setScheduleType] = useState("scheduled");
  const [importing, setImporting] = useState(false);

  const activeAccounts = accounts.filter(a => a.active);
  const urlList = urls.split("\n").map(u => u.trim()).filter(u => u.startsWith("http"));

  const handleImport = async () => {
    if (!urlList.length) { showToast("Vui lòng nhập URL hợp lệ", "error"); return; }
    if (!selectedAccounts.length) { showToast("Vui lòng chọn tài khoản", "error"); return; }

    setImporting(true);
    try {
      const result = await api.socialImportUrls({
        urls: urlList, accountIds: selectedAccounts,
        scheduleType, intervalMinutes: interval, useAI,
      });
      showToast(result.message, "success");
      onSuccess();
    } catch (err) { showToast(`Lỗi: ${err.message}`, "error"); }
    setImporting(false);
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" style={{ maxWidth: 560, padding: 24 }}>
        <h3 style={{ marginBottom: 16 }}>📥 Import danh sách URL</h3>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4, display: "block" }}>
            Danh sách URL (mỗi dòng 1 URL)
          </label>
          <textarea
            value={urls} onChange={(e) => setUrls(e.target.value)}
            placeholder={"https://example.com/bai-1\nhttps://example.com/bai-2\nhttps://example.com/bai-3"}
            className="input" rows={6}
            style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
          />
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>{urlList.length} URL hợp lệ</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 6, display: "block" }}>Chọn tài khoản</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {activeAccounts.map(acc => (
              <label key={acc.id} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
                borderRadius: 8, cursor: "pointer", fontSize: 12,
                background: selectedAccounts.includes(acc.id) ? "rgba(24,119,242,0.1)" : "rgba(255,255,255,0.03)",
                border: selectedAccounts.includes(acc.id) ? "1px solid rgba(24,119,242,0.3)" : "1px solid transparent",
              }}>
                <input type="checkbox" checked={selectedAccounts.includes(acc.id)}
                  onChange={() => setSelectedAccounts(prev => prev.includes(acc.id) ? prev.filter(x => x !== acc.id) : [...prev, acc.id])} />
                {PLATFORMS[acc.platform]?.icon} {acc.pageName || acc.name}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4, display: "block" }}>Kiểu lên lịch</label>
            <select className="input" value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
              <option value="scheduled">Theo lịch</option>
              <option value="immediate">Đăng ngay lần lượt</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 4, display: "block" }}>Khoảng cách (phút)</label>
            <input type="number" className="input" value={interval} onChange={(e) => setInterval_(Number(e.target.value) || 30)} min={5} max={1440} />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
          🤖 AI tự viết caption từ nội dung trang
        </label>

        {urlList.length > 0 && selectedAccounts.length > 0 && (
          <div style={{ padding: 12, borderRadius: 8, fontSize: 12, background: "rgba(24,119,242,0.08)", marginBottom: 16 }}>
            Sẽ tạo <strong>{urlList.length * selectedAccounts.length}</strong> bài share, mỗi bài cách <strong>{interval} phút</strong>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose} style={{ borderRadius: 8, fontSize: 13 }}>Hủy</button>
          <button className="btn btn-primary" onClick={handleImport}
            disabled={importing || !urlList.length || !selectedAccounts.length}
            style={{ borderRadius: 8, fontSize: 13, padding: "8px 20px" }}>
            {importing ? "Đang import..." : `📥 Import ${urlList.length} URL`}
          </button>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// TAB: HISTORY
// =====================================================================
function HistoryTab({ history }) {
  if (!history.length) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40, opacity: 0.5 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
        <p>Chưa có lịch sử chia sẻ nào</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {history.map(item => (
        <div key={item.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          <div style={{ fontSize: 20 }}>{item.status === "success" ? "✅" : "❌"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.link || item.message?.substring(0, 60) || "Bài viết"}
            </div>
            <div style={{ fontSize: 11, opacity: 0.5, display: "flex", gap: 8, marginTop: 2 }}>
              <span>→ {item.accountName}</span>
              <span>• {PLATFORMS[item.platform]?.name || item.platform}</span>
              <span>• {formatDate(item.sharedAt)}</span>
              {item.source === "queue" && <span>• từ hàng đợi</span>}
              {item.source === "auto-publish" && <span>• tự động</span>}
            </div>
          </div>
          {item.result?.url && (
            <a href={item.result.url} target="_blank" rel="noopener noreferrer"
              className="btn btn-sm" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, textDecoration: "none" }}>
              🔗 Xem
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// HELPERS
// =====================================================================
function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d;
  if (diff < 60000) return "Vừa xong";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} giờ trước`;
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getStatusColor(s) {
  const m = { published: "#10b981", processing: "#f59e0b", pending: "#6366f1", scheduled: "#6366f1", failed: "#ef4444" };
  return m[s] || "#666";
}

function getStatusIcon(s) {
  const m = { published: "✅", processing: "⏳", pending: "🕐", scheduled: "🕐", failed: "❌" };
  return m[s] || "📄";
}

function getStatusLabel(s) {
  const m = { published: "Đã đăng", processing: "Đang đăng", pending: "Chờ đăng", scheduled: "Đã lên lịch", failed: "Thất bại" };
  return m[s] || s;
}
