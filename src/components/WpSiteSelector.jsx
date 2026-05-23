import { useState, useEffect } from "react";
import { api } from "../api";

/**
 * WpSiteSelector — Chọn WP site trước khi đăng bài.
 * - 1 site → auto-select ngay
 * - Nhiều site → hiển thị danh sách radio với badge status
 * - Disabled "Đăng" nếu site chưa test hoặc test fail
 */
export default function WpSiteSelector({ selectedId, onSelect }) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/settings/wp-sites")
      .then((data) => {
        setSites(Array.isArray(data) ? data : []);
      })
      .catch(() => setSites([]))
      .finally(() => setLoading(false));
  }, []);

  // Auto-select if only one site
  useEffect(() => {
    if (sites.length === 1 && !selectedId) {
      onSelect?.(sites[0].id, sites[0]);
    }
  }, [sites, selectedId, onSelect]);

  if (loading) {
    return (
      <div style={{ padding: "12px 0", color: "var(--text-muted)", fontSize: 13 }}>
        Đang tải danh sách site...
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.2)",
          fontSize: 13,
          color: "var(--accent-red, #ef4444)",
        }}
      >
        ⚠️ Chưa có WP site nào.{" "}
        <a href="/settings" style={{ color: "var(--accent-blue, #3b82f6)" }}>
          Thêm trong Cài đặt →
        </a>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        🌐 Chọn website để đăng bài
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sites.map((site) => {
          const isSelected = selectedId === site.id;
          const statusOk = site.lastTestOk === true;
          const statusFail = site.lastTestOk === false;

          return (
            <label
              key={site.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 10,
                border: isSelected
                  ? "2px solid var(--accent-blue, #3b82f6)"
                  : "1px solid var(--border-light, rgba(255,255,255,0.1))",
                background: isSelected
                  ? "rgba(59,130,246,0.08)"
                  : "rgba(255,255,255,0.03)",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <input
                type="radio"
                name="wp-site-select"
                value={site.id}
                checked={isSelected}
                onChange={() => onSelect?.(site.id, site)}
                style={{ accentColor: "var(--accent-blue, #3b82f6)" }}
              />
              {/* Site info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{site.name}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted, #666)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {site.siteUrl}
                </div>
              </div>
              {/* Status badge */}
              <span
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 10,
                  fontWeight: 500,
                  flexShrink: 0,
                  background: statusOk
                    ? "rgba(34,197,94,0.15)"
                    : statusFail
                    ? "rgba(239,68,68,0.15)"
                    : "rgba(255,255,255,0.08)",
                  color: statusOk
                    ? "var(--accent-green, #22c55e)"
                    : statusFail
                    ? "var(--accent-red, #ef4444)"
                    : "var(--text-muted, #888)",
                  border: statusOk
                    ? "1px solid rgba(34,197,94,0.25)"
                    : statusFail
                    ? "1px solid rgba(239,68,68,0.25)"
                    : "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {statusOk ? "🟢 Sẵn sàng" : statusFail ? "🔴 Lỗi" : "⚪ Chưa test"}
              </span>
            </label>
          );
        })}
      </div>

      {/* Warning if selected site has not been tested or failed */}
      {selectedId && (() => {
        const sel = sites.find((s) => s.id === selectedId);
        if (!sel) return null;
        if (sel.lastTestOk === null || sel.lastTestOk === undefined) {
          return (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(251,191,36,0.1)",
                border: "1px solid rgba(251,191,36,0.25)",
                fontSize: 12,
                color: "#fbbf24",
              }}
            >
              ⚠️ Site này chưa được kiểm tra. Nên test trước khi đăng để đảm bảo kết nối.
            </div>
          );
        }
        if (sel.lastTestOk === false) {
          return (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.25)",
                fontSize: 12,
                color: "var(--accent-red, #ef4444)",
              }}
            >
              ❌ Kết nối site này đang lỗi. Vào{" "}
              <a href="/settings" style={{ color: "var(--accent-blue, #3b82f6)" }}>
                Cài đặt → Đăng bài
              </a>{" "}
              để sửa thông tin.
            </div>
          );
        }
        return null;
      })()}
    </div>
  );
}
