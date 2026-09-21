import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

// ===== Platform Definitions =====
const PLATFORMS = [
  { id: "wordpress", name: "WordPress", icon: "🔵", auth: "REST API", color: "#0073aa", phase: 1,
    fields: [
      { key: "siteUrl", label: "URL Website", placeholder: "https://example.com", type: "text" },
      { key: "username", label: "Username", placeholder: "admin", type: "text" },
      { key: "appPassword", label: "Application Password", placeholder: "xxxx xxxx xxxx xxxx", type: "password" },
    ]},
  { id: "blogger", name: "Blogger", icon: "📙", auth: "Google OAuth", color: "#ff6f00", phase: 1,
    fields: [
      { key: "blogId", label: "Blog ID", placeholder: "1234567890", type: "text" },
      { key: "accessToken", label: "Access Token", placeholder: "ya29...", type: "password" },
    ]},
  { id: "medium", name: "Medium", icon: "✍️", auth: "Token", color: "#000000", phase: 1,
    fields: [
      { key: "integrationToken", label: "Integration Token", placeholder: "Token từ Settings > Integration tokens", type: "password" },
      { key: "authorId", label: "Author ID", placeholder: "Lấy từ /v1/me", type: "text" },
    ]},
  { id: "facebook", name: "Facebook", icon: "📘", auth: "Meta Graph API", color: "#1877f2", phase: 1,
    fields: [
      { key: "pageId", label: "Facebook Page ID", placeholder: "VD: 102938475610293", type: "text" },
      { key: "pageToken", label: "Page Access Token", placeholder: "EAABwz...", type: "password" },
    ]},
  { id: "zalo", name: "Zalo OA", icon: "💬", auth: "REST API", color: "#0068ff", phase: 2 },
  { id: "instagram", name: "Instagram", icon: "📷", auth: "OAuth", color: "#e4405f", phase: 2 },
  { id: "threads", name: "Threads", icon: "🧵", auth: "OAuth", color: "#000000", phase: 2 },
  { id: "twitter", name: "X (Twitter)", icon: "🐦", auth: "OAuth", color: "#1da1f2", phase: 2 },
  { id: "youtube", name: "YouTube", icon: "▶️", auth: "OAuth", color: "#ff0000", phase: 2 },
  { id: "tiktok", name: "TikTok", icon: "🎵", auth: "OAuth", color: "#010101", phase: 2 },
  { id: "tiktokshop", name: "TikTok Shop", icon: "🛒", auth: "OAuth", color: "#ee1d52", phase: 2 },
  { id: "linkedin", name: "LinkedIn", icon: "💼", auth: "OAuth", color: "#0077b5", phase: 2 },
  { id: "pinterest", name: "Pinterest", icon: "📌", auth: "OAuth", color: "#e60023", phase: 2 },
  { id: "reddit", name: "Reddit", icon: "🤖", auth: "OAuth", color: "#ff4500", phase: 2 },
  { id: "tumblr", name: "Tumblr", icon: "📝", auth: "OAuth", color: "#35465c", phase: 2 },
  { id: "telegram", name: "Telegram", icon: "✈️", auth: "Token", color: "#0088cc", phase: 1,
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF...", type: "password" },
      { key: "channelId", label: "Channel ID", placeholder: "@channelname hoặc -100123456", type: "text" },
    ]},
  { id: "discord", name: "Discord", icon: "🎮", auth: "Webhook", color: "#5865f2", phase: 2 },
  { id: "mastodon", name: "Mastodon", icon: "🐘", auth: "OAuth", color: "#6364ff", phase: 2 },
  { id: "lineoa", name: "LINE OA", icon: "💚", auth: "OAuth", color: "#00c300", phase: 2 },
  { id: "vkontakte", name: "VKontakte", icon: "🔷", auth: "OAuth", color: "#4c75a3", phase: 2 },
];

const TABS = [
  { id: "accounts", label: "Tài khoản", icon: "🔗" },
  { id: "publish", label: "Đăng bài", icon: "📤" },
  { id: "history", label: "Lịch sử", icon: "📊" },
];

export default function Publishing() {
  const [tab, setTab] = useState("accounts");
  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { mode: "add"|"edit", platform, account }
  const [drafts, setDrafts] = useState([]);

  const loadAccounts = useCallback(async () => {
    try {
      const [pubData, socData] = await Promise.all([
        api.getPublishAccounts().catch(() => []),
        api.getSocialAccounts().catch(() => []),
      ]);

      const formattedSoc = (socData || []).map((sa) => ({
        id: sa.id,
        platform: "facebook",
        name: sa.pageName || sa.name || `Facebook Page (${sa.pageId || ""})`,
        active: sa.active !== false,
        credentials: sa.credentials || {},
        defaults: { status: "publish" },
        stats: {
          totalPublished: sa.stats?.totalShared || 0,
          lastPublished: sa.stats?.lastShared || null,
        },
        pageAvatar: sa.pageAvatar,
        fanCount: sa.fanCount,
        autoShare: sa.autoShare,
        isSocialAccount: true,
      }));

      const combined = [
        ...(pubData || []),
        ...formattedSoc.filter((s) => !(pubData || []).some((p) => p.id === s.id)),
      ];
      setAccounts(combined);
    } catch {
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadAccounts();
      setLoading(false);
    })();
  }, [loadAccounts]);

  useEffect(() => {
    if (tab === "history") {
      api.getPublishHistory().then(setHistory).catch(() => setHistory([]));
    }
    if (tab === "publish") {
      api.getDrafts().then(setDrafts).catch(() => setDrafts([]));
    }
  }, [tab]);

  return (
    <div style={{ padding: "0 0 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>📤 Đăng bài đa nền tảng</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
            Quản lý tài khoản & đăng bài viết lên nhiều nền tảng cùng lúc
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.id} className={`btn ${tab === t.id ? "btn-primary" : "btn-secondary"}`}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 16px" }}
            onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>⏳ Đang tải...</div>
      ) : (
        <>
          {tab === "accounts" && <AccountsTab accounts={accounts} onRefresh={loadAccounts} modal={modal} setModal={setModal} />}
          {tab === "publish" && <PublishTab accounts={accounts} drafts={drafts} />}
          {tab === "history" && <HistoryTab history={history} />}
        </>
      )}
    </div>
  );
}

// ===== Accounts Tab =====
function AccountsTab({ accounts, onRefresh, modal, setModal }) {
  const navigate = useNavigate();
  const [expandedPlatform, setExpandedPlatform] = useState(null);
  const [wpSites, setWpSites] = useState([]);
  const [wpSitesLoaded, setWpSitesLoaded] = useState(false);

  const accountsByPlatform = {};
  accounts.forEach(a => {
    if (!accountsByPlatform[a.platform]) accountsByPlatform[a.platform] = [];
    accountsByPlatform[a.platform].push(a);
  });

  // E4: Load WP sites from Settings when WordPress is expanded
  useEffect(() => {
    if (expandedPlatform === "wordpress" && !wpSitesLoaded) {
      api.getWpSites().then(sites => {
        setWpSites(sites || []);
        setWpSitesLoaded(true);
      }).catch(() => setWpSitesLoaded(true));
    }
  }, [expandedPlatform, wpSitesLoaded]);

  const toggleExpand = (platformId) => {
    setExpandedPlatform(prev => prev === platformId ? null : platformId);
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
        {PLATFORMS.map(p => {
          const accts = accountsByPlatform[p.id] || [];
          const isReady = p.phase === 1;
          const isExpanded = expandedPlatform === p.id;
          const hasMultiAccount = p.id === "wordpress" || p.id === "facebook";

          return (
            <div key={p.id} className="card" style={{
              padding: 0, position: "relative", opacity: isReady ? 1 : 0.6,
              border: accts.length > 0 ? `2px solid ${p.color}40` : undefined,
              transition: "all 0.3s",
              gridColumn: isExpanded && hasMultiAccount ? "1 / -1" : undefined,
            }}>
              {/* Phase badge */}
              {!isReady && (
                <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, padding: "2px 6px",
                  borderRadius: 8, background: "var(--bg-tertiary)", color: "var(--text-muted)", fontWeight: 600 }}>
                  SẮP RA MẮT
                </span>
              )}

              {/* Card header — clickable for expand */}
              <div
                style={{
                  padding: 16, cursor: hasMultiAccount && isReady && accts.length > 0 ? "pointer" : "default",
                  transition: "background 0.2s",
                }}
                onClick={() => hasMultiAccount && isReady && accts.length > 0 && toggleExpand(p.id)}
                onMouseEnter={(e) => { if (hasMultiAccount && isReady && accts.length > 0) e.currentTarget.style.background = `${p.color}08`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, background: `${p.color}18`,
                  }}>
                    {p.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.auth}</div>
                  </div>
                  {isReady && (
                    <label className="toggle-switch" style={{ transform: "scale(0.85)" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={accts.some(a => a.active)} readOnly />
                      <span className="toggle-slider" />
                    </label>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {accts.length > 0 ? (
                      <span style={{ color: p.color, fontWeight: 600 }}>● {accts.length} tài khoản</span>
                    ) : (
                      "0 tài khoản"
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {isReady && (!hasMultiAccount || accts.length === 0) && (
                      <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: "4px 10px" }}
                        onClick={(e) => { e.stopPropagation(); setModal({ mode: "add", platform: p }); }}>
                        🔗 Kết nối
                      </button>
                    )}
                    {hasMultiAccount && isReady && accts.length > 0 && (
                      <button
                        className={`btn btn-sm ${isExpanded ? "btn-primary" : "btn-secondary"}`}
                        style={{ fontSize: 11, padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}
                        onClick={(e) => { e.stopPropagation(); toggleExpand(p.id); }}
                      >
                        {isExpanded ? "✕ Thu gọn" : "⚙️ Quản lý"}
                      </button>
                    )}
                  </div>
                </div>

                {/* List connected accounts (compact — non-WP) */}
                {!hasMultiAccount && accts.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--border-light)", paddingTop: 8 }}>
                    {accts.map(a => (
                      <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 12 }}>
                        <span style={{ fontWeight: 500 }}>{a.name}</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" style={{ padding: "2px 6px", fontSize: 10 }}
                            onClick={(e) => { e.stopPropagation(); setModal({ mode: "edit", platform: p, account: a }); }}>✏️</button>
                          <button className="btn btn-secondary btn-sm" style={{ padding: "2px 6px", fontSize: 10, color: "var(--accent-red)" }}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm("Xoá tài khoản này?")) return;
                              try { await api.deletePublishAccount(a.id); onRefresh(); }
                              catch (err) { alert("Lỗi xóa tài khoản: " + err.message); }
                            }}>🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* E4: Expanded WordPress panel */}
              {isExpanded && p.id === "wordpress" && (
                <div style={{
                  borderTop: "1px solid var(--border-light)",
                  padding: 16, background: `${p.color}04`,
                  animation: "fadeIn 0.2s ease-out",
                }}>
                  <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>

                  {/* WP Publishing accounts */}
                  {accts.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.5px" }}>
                        📤 Tài khoản đã kết nối
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                        {accts.map(a => (
                          <div key={a.id} style={{
                            padding: "12px 14px", borderRadius: 10,
                            border: "1px solid var(--border-light)", background: "var(--bg-secondary)",
                            display: "flex", alignItems: "center", gap: 10,
                          }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: 8, background: `${p.color}18`,
                              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
                            }}>🌐</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {a.name}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {a.credentials?.siteUrl ? a.credentials.siteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "") : "—"}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                              <button className="btn btn-secondary btn-sm" style={{ padding: "4px 8px", fontSize: 10 }}
                                onClick={() => setModal({ mode: "edit", platform: p, account: a })}>✏️</button>
                              <button className="btn btn-secondary btn-sm" style={{ padding: "4px 8px", fontSize: 10, color: "var(--accent-red)" }}
                                onClick={async () => {
                                  if (!confirm("Xoá tài khoản WordPress này?")) return;
                                  try { await api.deletePublishAccount(a.id); onRefresh(); }
                                  catch (err) { alert("Lỗi xóa tài khoản: " + err.message); }
                                }}>🗑</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* WP Sites from Settings — sync info */}
                  {wpSites.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.5px" }}>
                        ⚙️ WP Sites từ Cài đặt
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                        {wpSites.map(site => {
                          const siteUrl = (site.siteUrl || site.url || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
                          const alreadyLinked = accts.some(a =>
                            (a.credentials?.siteUrl || "").replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase() === siteUrl.toLowerCase()
                          );
                          return (
                            <div key={site.id} style={{
                              padding: "10px 14px", borderRadius: 10,
                              border: `1px solid ${alreadyLinked ? "rgba(16,185,129,0.3)" : "var(--border-light)"}`,
                              background: alreadyLinked ? "rgba(16,185,129,0.04)" : "var(--bg-secondary)",
                              display: "flex", alignItems: "center", gap: 10,
                              opacity: alreadyLinked ? 0.7 : 1,
                            }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: 6, background: alreadyLinked ? "rgba(16,185,129,0.15)" : "rgba(0,115,170,0.1)",
                                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
                              }}>
                                {alreadyLinked ? "✅" : "🌐"}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 500, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {site.name || siteUrl}
                                </div>
                                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{siteUrl}</div>
                              </div>
                              {alreadyLinked ? (
                                <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600, flexShrink: 0 }}>Đã liên kết</span>
                              ) : (
                                <button className="btn btn-sm btn-secondary" style={{ fontSize: 10, padding: "3px 8px", flexShrink: 0 }}
                                  onClick={() => setModal({
                                    mode: "add", platform: p,
                                    prefill: {
                                      name: site.name || `WordPress - ${siteUrl}`,
                                      credentials: { siteUrl: site.siteUrl || site.url, username: site.username || "", appPassword: site.appPassword || "" },
                                    },
                                  })}>
                                  ➕ Thêm vào
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Add new WP account */}
                  <button className="btn btn-primary btn-sm" style={{ fontSize: 12, padding: "8px 16px", width: "100%" }}
                    onClick={() => setModal({ mode: "add", platform: p })}>
                    ➕ Thêm tài khoản WordPress mới
                  </button>
                </div>
              )}

              {/* Expanded Facebook panel */}
              {isExpanded && p.id === "facebook" && (
                <div style={{
                  borderTop: "1px solid var(--border-light)",
                  padding: 16, background: `${p.color}04`,
                  animation: "fadeIn 0.2s ease-out",
                }}>
                  <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                  {accts.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.5px" }}>
                        📘 Fanpage Facebook đã kết nối ({accts.length})
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                        {accts.map(a => (
                          <div key={a.id} style={{
                            padding: "12px 14px", borderRadius: 10,
                            border: "1px solid var(--border-light)", background: "var(--bg-secondary)",
                            display: "flex", alignItems: "center", gap: 10,
                          }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: "50%", background: "#1877f2",
                              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
                              overflow: "hidden", color: "#fff",
                            }}>
                              {a.pageAvatar ? (
                                <img src={a.pageAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                "📘"
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {a.name}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {a.fanCount > 0 ? `${a.fanCount.toLocaleString("vi-VN")} người theo dõi` : a.credentials?.pageId ? `ID: ${a.credentials.pageId}` : "Facebook Fanpage"}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                              <button className="btn btn-secondary btn-sm" style={{ padding: "4px 8px", fontSize: 10 }}
                                title="Kiểm tra kết nối"
                                onClick={async () => {
                                  try {
                                    const res = await api.testPublishAccount(a.id);
                                    alert(res.message || (res.success ? "Kết nối tốt!" : "Lỗi"));
                                  } catch (err) { alert("Lỗi: " + err.message); }
                                }}>🔌</button>
                              <button className="btn btn-secondary btn-sm" style={{ padding: "4px 8px", fontSize: 10 }}
                                title="Chỉnh sửa"
                                onClick={() => setModal({ mode: "edit", platform: p, account: a })}>✏️</button>
                              <button className="btn btn-secondary btn-sm" style={{ padding: "4px 8px", fontSize: 10, color: "var(--accent-red)" }}
                                title="Xóa"
                                onClick={async () => {
                                  if (!confirm("Xoá kết nối Fanpage này?")) return;
                                  try { await api.deletePublishAccount(a.id); onRefresh(); }
                                  catch (err) { alert("Lỗi xóa: " + err.message); }
                                }}>🗑</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="btn btn-primary btn-sm" style={{ fontSize: 12, padding: "8px 16px", flex: 1 }}
                      onClick={() => setModal({ mode: "add", platform: p })}>
                      ➕ Thêm Fanpage Facebook mới
                    </button>
                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 12, padding: "8px 16px" }}
                      onClick={() => navigate("/social")}>
                      📱 Mở Social Hub (Đặt lịch & AI Caption) ↗
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add/Edit Modal */}
      {modal && <AccountModal modal={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); onRefresh(); }} />}
    </div>
  );
}

// ===== Account Modal =====
function AccountModal({ modal, onClose, onSaved }) {
  const { mode, platform, account, prefill } = modal;
  const [form, setForm] = useState({
    name: prefill?.name || account?.name || `${platform.name} - ${new Date().toLocaleDateString("vi-VN")}`,
    credentials: prefill?.credentials || {},
    defaults: { status: "draft" },
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);

  // For edit mode, load full credentials
  useEffect(() => {
    if (mode === "edit" && account?.id) {
      api.getPublishAccount(account.id).then(full => {
        setForm({ name: full.name || full.pageName || "", credentials: full.credentials || {}, defaults: full.defaults || { status: "draft" } });
      }).catch(() => {});
    }
  }, [mode, account]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === "add") {
        await api.createPublishAccount({ platform: platform.id, name: form.name, credentials: form.credentials, defaults: form.defaults });
      } else {
        await api.updatePublishAccount(account.id, { name: form.name, credentials: form.credentials, defaults: form.defaults });
      }
      onSaved();
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (mode === "add") {
      // Save first, then test
      setSaving(true);
      try {
        const created = await api.createPublishAccount({ platform: platform.id, name: form.name, credentials: form.credentials, defaults: form.defaults });
        setTesting({ loading: true });
        const result = await api.testPublishAccount(created.id);
        setTesting(result);
        // If user closes modal, the account still exists
        onSaved();
      } catch (e) {
        setTesting({ success: false, message: e.message });
      } finally {
        setSaving(false);
      }
      return;
    }
    // For edit mode
    setSaving(true);
    try {
      await api.updatePublishAccount(account.id, { name: form.name, credentials: form.credentials, defaults: form.defaults });
      setTesting({ loading: true });
      const result = await api.testPublishAccount(account.id);
      setTesting(result);
    } catch (e) {
      setTesting({ success: false, message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const fields = platform.fields || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: "90vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            {platform.icon} {mode === "add" ? "Kết nối" : "Sửa"} {platform.name}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-muted)" }}>✕</button>
        </div>

        {platform.id === "facebook" && (
          <div style={{
            background: "rgba(24, 119, 242, 0.08)", border: "1px solid rgba(24, 119, 242, 0.2)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 600, color: "#1877f2", marginBottom: 4 }}>
              💡 Hướng dẫn kết nối Fanpage Facebook:
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
              • Nhập <b>Facebook Page ID</b> và <b>Page Access Token</b> (có quyền <code>pages_manage_posts, pages_read_engagement</code>).<br />
              • Hệ thống sẽ tự động đồng bộ sang <b>Social Hub</b> để bạn đặt lịch & tạo AI Caption.
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Tên hiển thị</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="VD: Blog chính" />
        </div>

        {fields.map(f => (
          <div className="form-group" key={f.key}>
            <label>{f.label}</label>
            <input type={f.type} placeholder={f.placeholder}
              value={form.credentials[f.key] || ""}
              onChange={e => setForm({ ...form, credentials: { ...form.credentials, [f.key]: e.target.value } })} />
          </div>
        ))}

        <div className="form-group">
          <label>Trạng thái mặc định</label>
          <select value={form.defaults.status} onChange={e => setForm({ ...form, defaults: { ...form.defaults, status: e.target.value } })}>
            <option value="draft">Bản nháp (Draft)</option>
            <option value="publish">Xuất bản (Publish)</option>
          </select>
        </div>

        {testing && (
          <div className={`alert ${testing.success ? "alert-success" : "alert-error"}`} style={{ marginTop: 12 }}>
            {testing.loading ? "⏳ Đang kiểm tra..." : testing.success ? `✅ ${testing.message}` : `❌ ${testing.message}`}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleTest} disabled={saving}>
            🔗 Test kết nối
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : mode === "add" ? "✓ Thêm tài khoản" : "✓ Lưu thay đổi"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Publish Tab =====
function PublishTab({ accounts, drafts }) {
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [pubStatus, setPubStatus] = useState("draft");
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState(null);

  const activeAccounts = accounts.filter(a => a.active !== false);
  const readyDrafts = drafts.filter(d => d.pipeline?.content?.html || d.pipeline?.content?.status === "done");

  const toggleAccount = (id) => {
    setSelectedAccounts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handlePublish = async () => {
    if (!selectedDraft || selectedAccounts.length === 0) return;
    setPublishing(true);
    setResults(null);
    try {
      const res = await api.publishNow({
        articleId: selectedDraft.id,
        articleType: "standalone",
        accounts: selectedAccounts,
        options: { status: pubStatus },
      });
      setResults(res);
    } catch (e) {
      setResults({ success: false, message: e.message, results: [] });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      {/* Left: Select draft */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>📝 Chọn bài viết</h3>
        {readyDrafts.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div>Chưa có bài viết nào sẵn sàng.</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Tạo bài viết trong Pipeline trước.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
            {readyDrafts.map(d => {
              const title = d.pipeline?.outline?.title || d.keyword;
              const isSelected = selectedDraft?.id === d.id;
              return (
                <div key={d.id} onClick={() => setSelectedDraft(d)}
                  style={{
                    padding: 12, borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
                    border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-light)",
                    background: isSelected ? "var(--accent-primary-muted)" : "var(--bg-secondary)",
                  }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    🔑 {d.keyword} · ~{d.pipeline?.content?.wordCount || "?"} từ
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Select platforms & publish */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>🎯 Chọn nền tảng đích</h3>
        {activeAccounts.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
            <div>Chưa kết nối nền tảng nào.</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Vào tab "Tài khoản" để kết nối.</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {activeAccounts.map(a => {
                const p = PLATFORMS.find(pl => pl.id === a.platform);
                const checked = selectedAccounts.includes(a.id);
                return (
                  <label key={a.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                    border: checked ? `2px solid ${p?.color || "var(--accent-primary)"}` : "1px solid var(--border-light)",
                    background: checked ? `${(p?.color || "#4f8df9")}10` : "var(--bg-secondary)",
                  }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleAccount(a.id)} style={{ width: 18, height: 18 }} />
                    <span style={{ fontSize: 20 }}>{p?.icon || "🌐"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p?.name || a.platform}</div>
                    </div>
                    {a.stats?.totalPublished > 0 && (
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{a.stats.totalPublished} bài</span>
                    )}
                  </label>
                );
              })}
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label>Trạng thái</label>
              <select value={pubStatus} onChange={e => setPubStatus(e.target.value)}>
                <option value="draft">Bản nháp (Draft)</option>
                <option value="publish">Xuất bản ngay (Publish)</option>
              </select>
            </div>

            <button className="btn btn-primary" style={{ width: "100%", padding: "12px 20px", fontSize: 15, fontWeight: 600 }}
              disabled={!selectedDraft || selectedAccounts.length === 0 || publishing}
              onClick={handlePublish}>
              {publishing ? "⏳ Đang đăng bài..." : `📤 Đăng lên ${selectedAccounts.length} nền tảng`}
            </button>
          </>
        )}

        {/* Results */}
        {results && (
          <div style={{ marginTop: 16 }}>
            <div className={`alert ${results.success ? "alert-success" : "alert-error"}`} style={{ marginBottom: 12 }}>
              {results.message}
            </div>
            {results.results?.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13,
                borderBottom: "1px solid var(--border-light)" }}>
                {r.success ? "✅" : "❌"}
                <span style={{ fontWeight: 500 }}>{r.accountName || r.platform}</span>
                {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, marginLeft: "auto" }}>🔗 Xem</a>}
                {r.error && <span style={{ fontSize: 11, color: "var(--accent-red)", marginLeft: "auto" }}>{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== History Tab =====
function HistoryTab({ history }) {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all" ? history :
    filter === "success" ? history.filter(h => h.status === "success") :
    history.filter(h => h.status === "failed");

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "all", label: `Tất cả (${history.length})` },
          { id: "success", label: `✅ Thành công (${history.filter(h => h.status === "success").length})` },
          { id: "failed", label: `❌ Lỗi (${history.filter(h => h.status === "failed").length})` },
        ].map(f => (
          <button key={f.id} className={`btn btn-sm ${filter === f.id ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>Chưa có lịch sử đăng bài</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-light)" }}>
                <th style={thStyle}>Nền tảng</th>
                <th style={thStyle}>Tài khoản</th>
                <th style={thStyle}>Trạng thái</th>
                <th style={thStyle}>Link</th>
                <th style={thStyle}>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(h => {
                const p = PLATFORMS.find(pl => pl.id === h.platform);
                return (
                  <tr key={h.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td style={tdStyle}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 18 }}>{p?.icon || "🌐"}</span>
                        {p?.name || h.platform}
                      </span>
                    </td>
                    <td style={tdStyle}>{h.accountName || "—"}</td>
                    <td style={tdStyle}>
                      {h.status === "success" ? (
                        <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>✅ Thành công</span>
                      ) : (
                        <span style={{ color: "var(--accent-red)", fontWeight: 600 }} title={h.error}>❌ Lỗi</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {h.result?.url ? (
                        <a href={h.result.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>🔗 Xem bài</a>
                      ) : "—"}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "var(--text-muted)" }}>
                      {h.publishedAt ? new Date(h.publishedAt).toLocaleString("vi-VN") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" };
const tdStyle = { padding: "10px 14px", fontSize: 13 };
