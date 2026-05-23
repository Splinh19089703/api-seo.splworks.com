import { useState, useEffect } from "react";
import { api } from "../api";

/**
 * WpSiteCard — Card hiển thị thông tin 1 WP site với:
 * - Badge status (xanh/đỏ/chưa test)
 * - Nút Test kết nối
 * - Inline edit form (không redirect)
 * - Nút Xóa
 */
export default function WpSiteCard({ site, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [testOk, setTestOk] = useState(null);
  const [form, setForm] = useState({
    name: site.name || "",
    siteUrl: site.siteUrl || "",
    username: site.username || "",
    appPassword: "",
    pluginApiKey: site.pluginApiKey || "",
    webhookSecret: site.webhookSecret || "",
  });
  const [saving, setSaving] = useState(false);
  const [pluginTesting, setPluginTesting] = useState(false);
  const [pluginStatus, setPluginStatus] = useState(site.pluginCapabilities || null);

  // Sync with prop updates (after test persists)
  useEffect(() => {
    setForm((f) => ({
      ...f,
      name: site.name || "",
      siteUrl: site.siteUrl || "",
      username: site.username || "",
    }));
  }, [site.name, site.siteUrl, site.username]);

  // How long ago was the last test?
  const testAgo = site.lastTestAt
    ? (() => {
        const mins = Math.round((Date.now() - new Date(site.lastTestAt)) / 60000);
        if (mins < 1) return "vừa xong";
        if (mins < 60) return `${mins} phút trước`;
        return `${Math.round(mins / 60)} giờ trước`;
      })()
    : null;

  const handleTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const result = await api.post(`/settings/wp-sites/${site.id}/test`);
      setTestOk(result.success);
      setTestMsg(result.message || (result.success ? "✅ Kết nối thành công!" : "❌ Kết nối thất bại"));
      onUpdate?.(); // re-fetch parent list
    } catch (e) {
      setTestOk(false);
      setTestMsg(`❌ ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAndTest = async () => {
    setSaving(true);
    setTestMsg(null);
    try {
      // 1. Save changes
      await api.put(`/settings/wp-sites/${site.id}`, form);
      // 2. Auto-test with new credentials
      const result = await api.post(`/settings/wp-sites/${site.id}/test`);
      setTestOk(result.success);
      setTestMsg(result.message || (result.success ? "✅ Kết nối thành công!" : "❌ Kết nối thất bại"));
      if (result.success) {
        setEditing(false); // collapse form on success
        setForm((f) => ({ ...f, appPassword: "" })); // clear password field
      }
      onUpdate?.();
    } catch (e) {
      setTestOk(false);
      setTestMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (window.confirm(`Xóa kết nối "${site.name}"?`)) {
      onDelete?.(site.id);
    }
  };

  // Status values: use live state if just tested, otherwise use persisted value
  const isOk = testOk !== null ? testOk : site.lastTestOk;
  const statusMsg =
    testMsg ||
    (site.lastTestOk === true
      ? `🟢 Kết nối OK${testAgo ? ` · ${testAgo}` : ""}`
      : site.lastTestOk === false
      ? `🔴 Lỗi kết nối${testAgo ? ` · ${testAgo}` : ""}`
      : "⚪ Chưa kiểm tra");

  const cardBorder = isOk === true
    ? "1px solid rgba(34,197,94,0.3)"
    : isOk === false
    ? "1px solid rgba(239,68,68,0.3)"
    : "1px solid var(--border-light, rgba(255,255,255,0.1))";

  return (
    <div
      style={{
        border: cardBorder,
        borderRadius: 12,
        padding: 16,
        background: "var(--card-bg, rgba(255,255,255,0.04))",
        transition: "border-color 0.3s",
      }}
    >
      {/* ── Card View ── */}
      {!editing ? (
        <>
          {/* Site info */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
            <div
              style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: "var(--accent-blue, #3b82f6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18,
              }}
            >
              🌐
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                {site.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted, #666)", wordBreak: "break-all" }}>
                {site.siteUrl}
              </div>
              {site.username && (
                <div style={{ fontSize: 11, color: "var(--text-muted, #555)", marginTop: 2 }}>
                  User: {site.username}
                </div>
              )}
            </div>
          </div>

          {/* Status badge */}
          <div
            style={{
              fontSize: 12,
              color: isOk === true
                ? "var(--accent-green, #22c55e)"
                : isOk === false
                ? "var(--accent-red, #ef4444)"
                : "var(--text-muted, #888)",
              marginBottom: 12,
              fontWeight: 500,
            }}
          >
            {statusMsg}
          </div>

          {/* Plugin capabilities badges */}
          {(site.pluginApiKey || pluginStatus) && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: "rgba(99,102,241,0.15)", color: "#818cf8", fontWeight: 600 }}>
                🔌 Plugin API
              </span>
              {(pluginStatus?.rankmath || site.pluginCapabilities?.rankmath) && (
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: 600 }}>
                  ✅ RankMath
                </span>
              )}
              {(pluginStatus?.yoast || site.pluginCapabilities?.yoast) && (
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: 600 }}>
                  ✅ Yoast
                </span>
              )}
              {(pluginStatus?.woocommerce || site.pluginCapabilities?.woocommerce) && (
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 600 }}>
                  🛒 WooCommerce
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={handleTest}
              disabled={testing}
              style={{ fontSize: 12 }}
            >
              {testing ? "⏳ Đang test..." : "🔍 Test kết nối"}
            </button>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => { setEditing(true); setTestMsg(null); setTestOk(null); }}
              style={{ fontSize: 12 }}
            >
              ✏️ Sửa
            </button>
            <button
              className="btn btn-sm"
              onClick={handleDelete}
              style={{
                fontSize: 12,
                background: "rgba(239,68,68,0.15)",
                color: "var(--accent-red, #ef4444)",
                border: "1px solid rgba(239,68,68,0.25)",
              }}
            >
              🗑️ Xóa
            </button>
          </div>
        </>
      ) : (
        /* ── Edit Form (inline) ── */
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "var(--accent-blue, #3b82f6)" }}>
            ✏️ Chỉnh sửa kết nối
          </div>
          {[
            { label: "Tên site", key: "name", placeholder: "VD: SPLWorks (Local)" },
            { label: "URL", key: "siteUrl", placeholder: "https://example.com" },
            { label: "Username", key: "username", placeholder: "admin" },
          ].map(({ label, key, placeholder }) => (
            <div key={key} style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                {label}
              </label>
              <input
                className="input"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                style={{ width: "100%", fontSize: 13 }}
              />
            </div>
          ))}
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
              App Password (để trống = giữ cũ)
            </label>
            <input
              className="input"
              type="password"
              value={form.appPassword}
              onChange={(e) => setForm({ ...form, appPassword: e.target.value })}
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              style={{ width: "100%", fontSize: 13 }}
            />
          </div>

          {/* Plugin API Section */}
          <div style={{ borderTop: "1px solid var(--border-light, rgba(255,255,255,0.08))", paddingTop: 12, marginTop: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-purple, #8b5cf6)", marginBottom: 10 }}>
              🔌 SPLSEO Connector Plugin (tùy chọn)
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
              Cài plugin <strong>SPLSEO Connector</strong> trên WordPress → vào <strong>Cài đặt → SPLSEO Connector</strong> → copy API Key dán vào đây.
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                Plugin API Key
              </label>
              <input
                className="input"
                value={form.pluginApiKey}
                onChange={(e) => setForm({ ...form, pluginApiKey: e.target.value })}
                placeholder="splseo_xxxxxxxxxxxxxxxxxxxx"
                style={{ width: "100%", fontSize: 13, fontFamily: "monospace" }}
              />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                Webhook Secret (tùy chọn)
              </label>
              <input
                className="input"
                value={form.webhookSecret}
                onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                placeholder="Để trống nếu chưa cài webhook"
                style={{ width: "100%", fontSize: 13, fontFamily: "monospace" }}
              />
            </div>
            {form.pluginApiKey && (
              <button
                className="btn btn-sm"
                style={{ fontSize: 11, background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}
                disabled={pluginTesting}
                onClick={async () => {
                  setPluginTesting(true);
                  try {
                    // Save first so the key is persisted
                    await api.put(`/settings/wp-sites/${site.id}`, form);
                    const result = await api.testPluginConnection(site.id);
                    setPluginStatus(result.capabilities || null);
                    setTestOk(result.connected);
                    setTestMsg(result.connected
                      ? `✅ Plugin kết nối thành công! WP ${result.wp_version} · ${result.capabilities?.seo_plugin || "No SEO"}`
                      : `❌ Plugin không phản hồi`
                    );
                    onUpdate?.();
                  } catch (e) {
                    setTestMsg(`❌ Plugin lỗi: ${e.message}`);
                    setTestOk(false);
                  }
                  setPluginTesting(false);
                }}
              >
                {pluginTesting ? "⏳ Đang test..." : "🔌 Test Plugin"}
              </button>
            )}
          </div>

          {/* Result message */}
          {testMsg && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                marginBottom: 10,
                fontSize: 12,
                background: testOk
                  ? "rgba(34,197,94,0.1)"
                  : "rgba(239,68,68,0.1)",
                color: testOk
                  ? "var(--accent-green, #22c55e)"
                  : "var(--accent-red, #ef4444)",
                border: `1px solid ${testOk ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
              }}
            >
              {testMsg}
            </div>
          )}

          {/* Form actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => { setEditing(false); setTestMsg(null); setTestOk(null); }}
              style={{ fontSize: 12 }}
            >
              Hủy
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleSaveAndTest}
              disabled={saving}
              style={{ fontSize: 12 }}
            >
              {saving ? "⏳ Đang lưu..." : "💾 Lưu & Test lại"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
