import { useState, useEffect } from "react";
import { api } from "../api";

// ==========================================
// Status badge
// ==========================================
const STATUS_MAP = {
  pending:  { label: "Chờ duyệt",     color: "#f59e0b" },
  approved: { label: "Đã duyệt",      color: "#6366f1" },
  paid:     { label: "Đã thanh toán", color: "#10b981" },
  rejected: { label: "Từ chối",       color: "#ef4444" },
};

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status, color: "#6b7280" };
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: s.color + "22", color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// ==========================================
// Stat card
// ==========================================
function StatCard({ icon, label, value, color = "#6366f1", sub }) {
  return (
    <div className="aff-stat-card" style={{ "--aff-color": color }}>
      <div className="aff-stat-icon">{icon}</div>
      <div className="aff-stat-value" style={{ color }}>{value}</div>
      <div className="aff-stat-label">{label}</div>
      {sub && <div className="aff-stat-sub">{sub}</div>}
    </div>
  );
}

// ==========================================
// Main component
// ==========================================
export default function Affiliate() {
  const [stats, setStats] = useState(null);
  const [link, setLink] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Payout modal
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutForm, setPayoutForm] = useState({ bankName: "", accountNumber: "", accountName: "" });
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [statsRes, linkRes] = await Promise.allSettled([
        api.affiliateStats(),
        api.affiliateLink(),
      ]);
      if (statsRes.status === "fulfilled") setStats(statsRes.value);
      if (linkRes.status === "fulfilled") setLink(linkRes.value);

      // Load history
      await loadHistory();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (page = 1) => {
    setHistoryLoading(true);
    try {
      const res = await api.affiliateHistory({ page, limit: 20 });
      setHistory(res.commissions || []);
    } catch {} finally {
      setHistoryLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!link?.shareLink) return;
    await navigator.clipboard.writeText(link.shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePayout = async () => {
    if (!payoutForm.bankName || !payoutForm.accountNumber || !payoutForm.accountName) {
      setPayoutMsg("Vui lòng điền đầy đủ thông tin ngân hàng.");
      return;
    }
    setPayoutLoading(true);
    setPayoutMsg("");
    try {
      const res = await api.affiliatePayout(payoutForm);
      setPayoutMsg("✅ " + res.message);
      setTimeout(() => {
        setShowPayoutModal(false);
        setPayoutMsg("");
        loadData();
      }, 2500);
    } catch (e) {
      setPayoutMsg("❌ " + (e.message || "Lỗi gửi yêu cầu"));
    } finally {
      setPayoutLoading(false);
    }
  };

  // Format VND
  const vnd = (n) => (n || 0).toLocaleString("vi-VN") + "đ";
  const pct = (n) => (((n || 0) * 100).toFixed(0)) + "%";

  if (loading) {
    return (
      <div className="page-container" style={{ textAlign: "center", paddingTop: 80 }}>
        <span className="loader" />
        <p style={{ marginTop: 16, color: "var(--text-muted)" }}>Đang tải thông tin CTV...</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px" }}>🤝 Chương Trình CTV / Affiliate</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
          Giới thiệu bạn bè đăng ký SPLSEO và nhận <strong style={{ color: "#10b981" }}>20% hoa hồng</strong> cho mỗi đơn thành công.
        </p>
      </div>

      {error && (
        <div className="card" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: 14, marginBottom: 16 }}>
          <p style={{ color: "#ef4444", margin: 0 }}>❌ {error}</p>
        </div>
      )}

      {/* Referral Link Card */}
      <div className="card aff-link-card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 22 }}>🔗</span>
          <div>
            <strong style={{ fontSize: 15 }}>Link giới thiệu của bạn</strong>
            <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "2px 0 0" }}>
              Code: <code style={{ background: "var(--bg-surface)", padding: "1px 8px", borderRadius: 6, fontWeight: 700, color: "#6366f1" }}>
                {link?.referralCode || "—"}
              </code>
            </p>
          </div>
        </div>

        <div className="aff-link-row">
          <div className="aff-link-box">
            {link?.shareLink || "Chưa có link"}
          </div>
          <button
            className={`btn ${copied ? "btn-secondary" : "btn-primary"}`}
            onClick={handleCopyLink}
            style={{ whiteSpace: "nowrap" }}
          >
            {copied ? "✅ Đã sao chép!" : "📋 Sao chép"}
          </button>
        </div>

        <div className="aff-share-btns">
          {link?.shareLink && (
            <>
              <a
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link.shareLink)}`}
                target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
              >
                📘 Facebook
              </a>
              <a
                href={`https://t.me/share/url?url=${encodeURIComponent(link.shareLink)}&text=${encodeURIComponent("Dùng thử SPLSEO - Hệ thống AI Content SEO tự động!")}`}
                target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
              >
                ✈️ Telegram
              </a>
              <a
                href={`https://zalo.me/share?url=${encodeURIComponent(link.shareLink)}`}
                target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
              >
                💬 Zalo
              </a>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="aff-stats-row">
        <StatCard icon="👥" label="Người đã đăng ký" value={stats?.totalReferrals ?? 0} color="#6366f1" sub="Qua link của bạn" />
        <StatCard icon="🛒" label="Đơn thành công" value={stats?.totalOrders ?? 0} color="#3b82f6" sub="Phát sinh hoa hồng" />
        <StatCard icon="💰" label="Tổng hoa hồng" value={vnd(stats?.totalCommission)} color="#10b981" sub={`Tỷ lệ: ${pct(stats?.commissionRate)}`} />
        <StatCard icon="⏳" label="Chờ thanh toán" value={vnd(stats?.pendingCommission)} color="#f59e0b" sub={stats?.canRequestPayout ? "✅ Đủ điều kiện rút" : `Cần tối thiểu ${vnd(stats?.minPayout)}`} />
        <StatCard icon="✅" label="Đã thanh toán" value={vnd(stats?.paidCommission)} color="#64748b" />
      </div>

      {/* Payout button */}
      {stats?.canRequestPayout && (
        <div style={{ textAlign: "center", margin: "0 0 24px" }}>
          <button className="btn btn-primary" style={{ padding: "12px 32px", fontSize: 15 }} onClick={() => setShowPayoutModal(true)}>
            💸 Yêu cầu thanh toán {vnd(stats.pendingCommission)}
          </button>
        </div>
      )}

      {/* Commission History Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <div style={{ padding: "14px 20px 12px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <strong>📋 Lịch sử hoa hồng</strong>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{history.length} bản ghi</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Người được refer</th>
              <th>Gói</th>
              <th style={{ textAlign: "right" }}>Giá trị đơn</th>
              <th style={{ textAlign: "right" }}>Hoa hồng (20%)</th>
              <th>Trạng thái</th>
              <th>Ngày</th>
            </tr>
          </thead>
          <tbody>
            {historyLoading ? (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Đang tải...</td></tr>
            ) : history.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                  Chưa có hoa hồng nào. Chia sẻ link để bắt đầu kiếm tiền! 🚀
                </td>
              </tr>
            ) : (
              history.map((h, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{h.referredUser?.email || "—"}</div>
                    {h.referredUser?.name && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{h.referredUser.name}</div>}
                  </td>
                  <td>
                    <span style={{ fontSize: 12 }}>
                      <span style={{ fontWeight: 600 }}>{h.plan}</span>
                      {h.period && <span style={{ color: "var(--text-muted)" }}> / {h.period}</span>}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontSize: 13, fontWeight: 500 }}>{vnd(h.orderAmount)}</td>
                  <td style={{ textAlign: "right", fontSize: 14, fontWeight: 700, color: "#10b981" }}>{vnd(h.commissionAmount)}</td>
                  <td><StatusBadge status={h.status} /></td>
                  <td style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {new Date(h.createdAt).toLocaleDateString("vi-VN")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* How it works */}
      <div className="card" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(16,185,129,0.04) 100%)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>🎯 Cách thức hoạt động</h3>
        <div className="aff-steps">
          {[
            ["1", "Chia sẻ link", "Copy link của bạn và chia sẻ lên Facebook, Zalo, Telegram, blog..."],
            ["2", "Bạn bè đăng ký", "Họ truy cập link của bạn và tạo tài khoản SPLSEO miễn phí."],
            ["3", "Họ mua gói", "Khi họ nâng cấp lên gói trả phí, hệ thống tự động ghi nhận."],
            ["4", "Bạn nhận 20%", "20% giá trị đơn hàng được tích lũy vào tài khoản của bạn."],
            ["5", "Rút tiền", "Khi đạt 500,000đ, bạn có thể yêu cầu thanh toán qua ngân hàng."],
          ].map(([num, title, desc]) => (
            <div key={num} className="aff-step">
              <div className="aff-step-num">{num}</div>
              <div>
                <strong style={{ fontSize: 13 }}>{title}</strong>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Payout Modal */}
      {showPayoutModal && (
        <div className="modal-overlay" onClick={() => setShowPayoutModal(false)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px" }}>💸 Yêu cầu thanh toán hoa hồng</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
              Số tiền: <strong style={{ color: "#10b981" }}>{vnd(stats?.pendingCommission)}</strong>. Admin sẽ xử lý trong 1–3 ngày làm việc.
            </p>

            <div className="form-group">
              <label>Ngân hàng</label>
              <input
                type="text"
                placeholder="VD: MB Bank, Vietcombank..."
                value={payoutForm.bankName}
                onChange={e => setPayoutForm(f => ({ ...f, bankName: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Số tài khoản</label>
              <input
                type="text"
                placeholder="VD: 0123456789"
                value={payoutForm.accountNumber}
                onChange={e => setPayoutForm(f => ({ ...f, accountNumber: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Tên chủ tài khoản</label>
              <input
                type="text"
                placeholder="VD: NGUYEN VAN A"
                value={payoutForm.accountName}
                onChange={e => setPayoutForm(f => ({ ...f, accountName: e.target.value }))}
              />
            </div>

            {payoutMsg && (
              <p style={{ fontSize: 13, color: payoutMsg.startsWith("✅") ? "#10b981" : "#ef4444", margin: "0 0 12px" }}>
                {payoutMsg}
              </p>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setShowPayoutModal(false)}>Huỷ</button>
              <button className="btn btn-primary" onClick={handlePayout} disabled={payoutLoading}>
                {payoutLoading ? "⏳ Đang gửi..." : "Gửi yêu cầu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
