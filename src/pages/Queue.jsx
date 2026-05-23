import { useState, useEffect, useCallback } from "react";
import { api } from "../api";

const STATUS_CONFIG = {
  scheduled: { label: "Đã lên lịch", color: "var(--accent-blue)", bg: "rgba(59,130,246,0.12)", icon: "🕐" },
  publishing: { label: "Đang đăng...", color: "var(--accent-orange)", bg: "rgba(251,146,60,0.12)", icon: "⏳" },
  published: { label: "Đã đăng", color: "var(--accent-green)", bg: "rgba(52,211,153,0.12)", icon: "✅" },
  failed: { label: "Thất bại", color: "var(--accent-red)", bg: "rgba(239,68,68,0.12)", icon: "❌" },
};

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function timeUntil(iso) {
  if (!iso) return "";
  const diff = new Date(iso) - new Date();
  if (diff < 0) return "Quá hạn";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)} ngày nữa`;
  if (h > 0) return `${h}h ${m}m nữa`;
  return `${m} phút nữa`;
}

// ============================================================
// AddToQueueModal
// ============================================================
function AddToQueueModal({ onClose, onAdd, wpSites }) {
  const [drafts, setDrafts] = useState([]);
  const [selectedSourceType, setSelectedSourceType] = useState("draft");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState(wpSites[0]?.id || "");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("08:00");
  const [wpStatus, setWpStatus] = useState("publish");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Lấy danh sách drafts chưa publish
  useEffect(() => {
    api.getDrafts?.().then(data => {
      const ready = (data || []).filter(d =>
        d.pipeline?.content?.html && d.pipeline?.outline
      );
      setDrafts(ready);
      if (ready.length > 0) setSelectedSourceId(ready[0].id);
    }).catch(() => {});
  }, []);

  // Set ngày mặc định là ngày mai
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduledDate(tomorrow.toISOString().split("T")[0]);
  }, []);

  const handleAdd = async () => {
    if (!selectedSourceId || !selectedSiteId || !scheduledDate) {
      setError("Vui lòng điền đầy đủ thông tin");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();
      const draft = drafts.find(d => d.id === selectedSourceId);
      await onAdd({
        sourceType: selectedSourceType,
        sourceId: selectedSourceId,
        siteId: selectedSiteId,
        scheduledAt,
        wpStatus,
        title: draft?.pipeline?.outline?.title || draft?.keyword || selectedSourceId,
        keyword: draft?.keyword || "",
      });
      onClose();
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "var(--bg-card)", borderRadius: 16, padding: 28, width: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", border: "1px solid var(--border-color)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📅 Thêm vào Publish Queue</h3>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid var(--accent-red)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "var(--accent-red)" }}>
            ❌ {error}
          </div>
        )}

        {/* Chọn bài viết */}
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13 }}>Bài viết (Standalone Draft)</label>
          {drafts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "10px 0" }}>
              Chưa có draft nào sẵn sàng (cần hoàn thành Outline + Content).
            </div>
          ) : (
            <select value={selectedSourceId} onChange={e => setSelectedSourceId(e.target.value)}
              style={{ fontSize: 13 }}>
              {drafts.map(d => (
                <option key={d.id} value={d.id}>
                  {d.pipeline?.outline?.title || d.keyword} ({d.pipeline?.content?.wordCount?.toLocaleString() || 0} từ)
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Chọn site */}
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13 }}>WordPress Site</label>
          {wpSites.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Chưa có WP site nào. Thêm tại Cài đặt → Đăng bài.</div>
          ) : (
            <select value={selectedSiteId} onChange={e => setSelectedSiteId(e.target.value)}
              style={{ fontSize: 13 }}>
              {wpSites.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.siteUrl})</option>
              ))}
            </select>
          )}
        </div>

        {/* Ngày giờ đăng */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: 13 }}>Ngày đăng</label>
            <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]} style={{ fontSize: 13 }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: 13 }}>Giờ đăng</label>
            <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)}
              style={{ fontSize: 13 }} />
          </div>
        </div>

        {/* Trạng thái bài WP */}
        <div className="form-group" style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13 }}>Trạng thái WP</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[{ v: "publish", l: "🌐 Công khai" }, { v: "draft", l: "📋 Nháp" }].map(o => (
              <button key={o.v} className={`btn btn-sm ${wpStatus === o.v ? "btn-primary" : "btn-secondary"}`}
                style={{ flex: 1 }} onClick={() => setWpStatus(o.v)}>{o.l}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={handleAdd} disabled={loading || !selectedSourceId || !selectedSiteId}>
            {loading ? "Đang lưu..." : "📅 Thêm vào Queue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// RescheduleModal
// ============================================================
function RescheduleModal({ item, onClose, onSave }) {
  const [date, setDate] = useState(item.scheduledAt ? item.scheduledAt.split("T")[0] : "");
  const [time, setTime] = useState(item.scheduledAt ? item.scheduledAt.split("T")[1]?.slice(0, 5) : "08:00");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
      await onSave(item.id, { scheduledAt });
      onClose();
    } catch (e) { alert("Lỗi: " + e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "var(--bg-card)", borderRadius: 14, padding: 24, width: 340, border: "1px solid var(--border-color)" }}
        onClick={e => e.stopPropagation()}>
        <h4 style={{ margin: "0 0 16px" }}>🔄 Đổi lịch đăng</h4>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>{item.title}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: 12 }}>Ngày</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ fontSize: 13 }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: 12 }}>Giờ</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ fontSize: 13 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "💾 Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN Queue Page
// ============================================================
export default function Queue() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [wpSites, setWpSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [rescheduleItem, setRescheduleItem] = useState(null);
  const [filter, setFilter] = useState("all"); // all | scheduled | published | failed
  const [actionLoading, setActionLoading] = useState(null);

  const load = useCallback(async () => {
    try {
      const [q, s, sites] = await Promise.all([
        api.getQueue(),
        api.getQueueStats(),
        api.getWpSites?.() || Promise.resolve([]),
      ]);
      setItems(q || []);
      setStats(s || {});
      setWpSites(sites || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh mỗi 30s để cập nhật status publishing
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const handleAdd = async (data) => {
    await api.addToQueue(data);
    await load();
  };

  const handleDelete = async (id) => {
    if (!confirm("Xóa item này khỏi queue?")) return;
    setActionLoading(id + "-delete");
    try { await api.deleteQueueItem(id); await load(); }
    catch (e) { alert("Lỗi: " + e.message); }
    setActionLoading(null);
  };

  const handlePublishNow = async (id) => {
    if (!confirm("Publish bài này ngay bây giờ?")) return;
    setActionLoading(id + "-publish");
    try { await api.publishQueueNow(id); await load(); }
    catch (e) { alert("Lỗi: " + e.message); }
    setActionLoading(null);
  };

  const handleReschedule = async (id, data) => {
    await api.updateQueueItem(id, data);
    await load();
  };

  const filtered = filter === "all" ? items : items.filter(i => i.status === filter);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
      <span className="loader" />
    </div>
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800 }}>📅 Publish Queue</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Lên lịch đăng bài tự động lên WordPress</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          + Thêm lịch đăng
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { key: "scheduled", label: "Đã lên lịch", icon: "🕐", color: "var(--accent-blue)" },
          { key: "publishing", label: "Đang đăng", icon: "⏳", color: "var(--accent-orange)" },
          { key: "published", label: "Đã đăng", icon: "✅", color: "var(--accent-green)" },
          { key: "failed", label: "Thất bại", icon: "❌", color: "var(--accent-red)" },
        ].map(s => (
          <div key={s.key} className="card" style={{ padding: "14px 16px", cursor: "pointer", border: filter === s.key ? `1px solid ${s.color}` : undefined }}
            onClick={() => setFilter(filter === s.key ? "all" : s.key)}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{stats[s.key] || 0}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[["all", "Tất cả"], ["scheduled", "Đã lên lịch"], ["published", "Đã đăng"], ["failed", "Thất bại"]].map(([v, l]) => (
          <button key={v} className={`btn btn-sm ${filter === v ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>

      {/* Queue list */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📅</div>
          <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>
            {filter === "all" ? "Queue đang trống" : `Không có bài ${STATUS_CONFIG[filter]?.label || ""}`}
          </h3>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
            {filter === "all" ? "Thêm bài viết vào queue để lên lịch đăng tự động." : ""}
          </p>
          {filter === "all" && (
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Thêm lịch đăng</button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(item => {
            const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.scheduled;
            const isPast = item.scheduledAt && new Date(item.scheduledAt) < new Date();
            return (
              <div key={item.id} className="card" style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  {/* Status badge */}
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                    {cfg.icon}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title}
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
                      <span>🌐 {item.siteName}</span>
                      <span>📅 {formatDateTime(item.scheduledAt)}</span>
                      {item.status === "scheduled" && (
                        <span style={{ color: isPast ? "var(--accent-red)" : "var(--accent-blue)" }}>
                          ⏰ {timeUntil(item.scheduledAt)}
                        </span>
                      )}
                      {item.status === "published" && item.publishResult?.wpLink && (
                        <a href={item.publishResult.wpLink} target="_blank" rel="noopener noreferrer"
                          style={{ color: "var(--accent-green)", textDecoration: "none" }}>
                          🔗 Xem bài
                        </a>
                      )}
                      <span style={{ padding: "1px 8px", borderRadius: 10, background: cfg.bg, color: cfg.color, fontWeight: 600 }}>
                        {cfg.label}
                      </span>
                      <span style={{ background: "var(--bg-tertiary)", padding: "1px 8px", borderRadius: 10 }}>
                        {item.wpStatus === "draft" ? "📋 Nháp WP" : "🌐 Công khai"}
                      </span>
                    </div>
                    {item.status === "failed" && item.errorMessage && (
                      <div style={{ fontSize: 12, color: "var(--accent-red)", marginTop: 4 }}>
                        ⚠️ {item.errorMessage}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {item.status !== "published" && (
                      <button className="btn btn-secondary btn-sm"
                        disabled={actionLoading === item.id + "-publish"}
                        title="Publish ngay"
                        onClick={() => handlePublishNow(item.id)}
                        style={{ color: "var(--accent-green)" }}>
                        {actionLoading === item.id + "-publish" ? "⏳" : "🚀"}
                      </button>
                    )}
                    {(item.status === "scheduled" || item.status === "failed") && (
                      <button className="btn btn-secondary btn-sm" title="Đổi lịch"
                        onClick={() => setRescheduleItem(item)}>🔄</button>
                    )}
                    <button className="btn btn-secondary btn-sm"
                      disabled={actionLoading === item.id + "-delete"}
                      title="Xóa"
                      onClick={() => handleDelete(item.id)}
                      style={{ color: "var(--accent-red)" }}>
                      {actionLoading === item.id + "-delete" ? "⏳" : "🗑️"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cron info */}
      <div style={{ marginTop: 24, padding: "12px 16px", background: "var(--bg-tertiary)", borderRadius: 10, fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
        <span>⚙️</span>
        <span>Hệ thống tự động kiểm tra queue mỗi <strong>60 giây</strong> và publish bài đến hạn. Trang này tự refresh mỗi 30 giây.</span>
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddToQueueModal
          wpSites={wpSites}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAdd}
        />
      )}
      {rescheduleItem && (
        <RescheduleModal
          item={rescheduleItem}
          onClose={() => setRescheduleItem(null)}
          onSave={handleReschedule}
        />
      )}
    </div>
  );
}
