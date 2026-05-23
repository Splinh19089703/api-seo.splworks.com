import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import PricingModal from "../components/PricingModal";

const PLAN_LABELS = {
  trial: "Dùng thử",
  basic: "Basic",
  pro: "Pro",
  agency: "Agency",
  unlimited: "Unlimited",
};
const PLAN_COLORS = {
  trial: "#8899aa",
  basic: "#3b82f6",
  pro: "#8b5cf6",
  agency: "#f59e0b",
  unlimited: "#10b981",
};
const PERIOD_LABELS = {
  trial: "7 ngày",
  "6months": "6 tháng",
  "1year": "1 năm",
  "2years": "2 năm",
  lifetime: "Vĩnh viễn",
};
const STATUS_LABELS = {
  pending: {
    text: "Chờ thanh toán",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.1)",
  },
  completed: {
    text: "Hoàn thành",
    color: "#10b981",
    bg: "rgba(16,185,129,0.1)",
  },
  failed: { text: "Thất bại", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
  refunded: { text: "Hoàn tiền", color: "#06b6d4", bg: "rgba(6,182,212,0.1)" },
  cancelled: { text: "Đã huỷ", color: "#64748b", bg: "rgba(100,116,139,0.1)" },
};

function formatPrice(amount) {
  return new Intl.NumberFormat("vi-VN").format(amount || 0) + "đ";
}

export default function Account() {
  const { user, license, usage, logout, refreshLicense } = useAuth();
  const navigate = useNavigate();
  const [licenseInfo, setLicenseInfo] = useState(null);
  const [orders, setOrders] = useState([]);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pwForm, setPwForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pwError, setPwError] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  useEffect(() => {
    api.getLicenseInfo().then(setLicenseInfo).catch(console.error);
    api
      .getMyOrders()
      .then((data) => setOrders(data.orders || []))
      .catch(console.error);
  }, []);

  const handleValidate = async () => {
    setValidating(true);
    setValidateResult(null);
    try {
      await refreshLicense();
      setValidateResult({ success: true, message: "License hợp lệ ✅" });
    } catch (e) {
      setValidateResult({
        success: false,
        message: e.message || "Lỗi kiểm tra",
      });
    }
    setValidating(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError("");
    if (pwForm.newPassword.length < 6) {
      setPwError("Mật khẩu mới phải ít nhất 6 ký tự");
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError("Mật khẩu xác nhận không khớp");
      return;
    }
    setPwLoading(true);
    try {
      await api.changePassword(pwForm.currentPassword, pwForm.newPassword);
      setShowChangePassword(false);
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      alert("✅ Đổi mật khẩu thành công!");
    } catch (e) {
      setPwError(e.message || "Lỗi đổi mật khẩu");
    }
    setPwLoading(false);
  };

  const handleDeactivateDevice = async (deviceId) => {
    if (!confirm("Gỡ thiết bị này?")) return;
    try {
      await api.deactivateDevice(deviceId);
      const info = await api.getLicenseInfo();
      setLicenseInfo(info);
    } catch (e) {
      alert("Lỗi: " + e.message);
    }
  };

  if (!user) return null;

  const plan = license?.plan || "trial";
  const planLabel = PLAN_LABELS[plan];
  const planColor = PLAN_COLORS[plan];
  const maxArticles = license?.limits?.maxArticlesPerMonth || 10;
  const usedArticles = usage?.articlesCreated || 0;
  const percent =
    maxArticles >= 999999
      ? 0
      : Math.min(100, Math.round((usedArticles / maxArticles) * 100));

  let daysLeft = null;
  if (license?.expiresAt) {
    const exp = new Date(license.expiresAt);
    daysLeft = Math.max(
      0,
      Math.ceil((exp - new Date()) / (1000 * 60 * 60 * 24)),
    );
  }

  const maskedKey = license?.licenseKey
    ? license.licenseKey.slice(0, 10) + "••••"
    : "—";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tài khoản</h1>
          <p className="subtitle">Thông tin tài khoản và gói dịch vụ</p>
        </div>
      </div>

      {/* User Info Card */}
      <div className="card account-card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div className="account-avatar">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" />
              ) : (
                <span>{(user.name || user.email)[0].toUpperCase()}</span>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>
                {user.name || "User"}
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                {user.email}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowChangePassword(!showChangePassword)}
            >
              🔒 Đổi mật khẩu
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleLogout}>
              Đăng xuất
            </button>
          </div>
        </div>
      </div>

      {/* Change Password Form */}
      {showChangePassword && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>🔒 Đổi mật khẩu</h3>
          {pwError && (
            <div className="auth-error" style={{ marginBottom: 12 }}>
              <span>⚠️</span> {pwError}
            </div>
          )}
          <form onSubmit={handleChangePassword}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <div className="form-group">
                <label>Mật khẩu hiện tại</label>
                <input
                  type="password"
                  value={pwForm.currentPassword}
                  onChange={(e) =>
                    setPwForm({ ...pwForm, currentPassword: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Mật khẩu mới</label>
                <input
                  type="password"
                  value={pwForm.newPassword}
                  onChange={(e) =>
                    setPwForm({ ...pwForm, newPassword: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Xác nhận</label>
                <input
                  type="password"
                  value={pwForm.confirmPassword}
                  onChange={(e) =>
                    setPwForm({ ...pwForm, confirmPassword: e.target.value })
                  }
                />
              </div>
            </div>
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowChangePassword(false)}
              >
                Huỷ
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={pwLoading}
              >
                {pwLoading ? "Đang lưu..." : "Lưu mật khẩu"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* License Card */}
      <div className="card account-card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>Gói dịch vụ</h3>
          <span
            className="plan-badge"
            style={{ background: planColor, fontSize: 13, padding: "4px 12px" }}
          >
            {planLabel}
          </span>
        </div>

        {/* Expiry */}
        {daysLeft !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            <span>⏰</span>
            <span
              style={{
                color:
                  daysLeft <= 3 ? "var(--accent-red)" : "var(--text-secondary)",
              }}
            >
              Hết hạn: {new Date(license.expiresAt).toLocaleDateString("vi-VN")}{" "}
              ({daysLeft} ngày còn lại)
            </span>
          </div>
        )}
        {!license?.expiresAt && plan !== "trial" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            <span>♾️</span>
            <span style={{ color: "var(--accent-green)" }}>
              License vĩnh viễn
            </span>
          </div>
        )}

        {/* Usage Bar */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              marginBottom: 6,
            }}
          >
            Sử dụng tháng này:
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              marginBottom: 4,
            }}
          >
            <span>
              {usedArticles} / {maxArticles >= 999999 ? "∞" : maxArticles} bài
            </span>
            {maxArticles < 999999 && (
              <span
                style={{
                  color:
                    percent >= 80 ? "var(--accent-red)" : "var(--text-muted)",
                }}
              >
                {percent}%
              </span>
            )}
          </div>
          {maxArticles < 999999 && (
            <div className="usage-bar" style={{ height: 8 }}>
              <div
                className="usage-bar-fill"
                style={{
                  width: `${percent}%`,
                  background: percent >= 80 ? "var(--accent-red)" : planColor,
                }}
              />
            </div>
          )}
        </div>

        {/* License Key */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <span style={{ color: "var(--text-muted)" }}>License:</span>
          <code
            style={{
              background: "var(--bg-tertiary)",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {maskedKey}
          </code>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleValidate}
            disabled={validating}
          >
            {validating ? (
              <>
                <span className="loader" style={{ width: 12, height: 12 }} />{" "}
                Kiểm tra...
              </>
            ) : (
              "🔄 Kiểm tra license"
            )}
          </button>
          {validateResult && (
            <span
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 4,
                background: validateResult.success
                  ? "rgba(16,185,129,0.1)"
                  : "rgba(239,68,68,0.1)",
                color: validateResult.success
                  ? "var(--accent-green)"
                  : "var(--accent-red)",
              }}
            >
              {validateResult.message}
            </span>
          )}
        </div>
      </div>

      {/* Devices Card */}
      <div className="card account-card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          💻 Thiết bị
        </h3>
        {licenseInfo?.devices?.length > 0 ? (
          <div>
            {licenseInfo.devices.map((d, i) => (
              <div
                key={d.id || i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom:
                    i < licenseInfo.devices.length - 1
                      ? "1px solid var(--border-light)"
                      : "none",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {d.os === "win32" ? "🖥️" : d.os === "darwin" ? "🍎" : "🐧"}{" "}
                    {d.deviceName}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Lần cuối:{" "}
                    {new Date(d.lastSeenAt).toLocaleDateString("vi-VN")}
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDeactivateDevice(d.id)}
                  style={{ fontSize: 11 }}
                >
                  Gỡ
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Chưa có thiết bị nào
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
          Tối đa {license?.limits?.maxDevices || 1} thiết bị cho gói {planLabel}
        </div>
      </div>

      {/* Orders History Card */}
      {orders.length > 0 && (
        <div className="card account-card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            📦 Lịch sử đơn hàng
          </h3>
          <div>
            {orders.map((order, i) => {
              const st =
                STATUS_LABELS[order.paymentStatus] || STATUS_LABELS.pending;
              return (
                <div
                  key={order._id || order.id || i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom:
                      i < orders.length - 1
                        ? "1px solid var(--border-light)"
                        : "none",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span
                        className="plan-badge"
                        style={{
                          background: PLAN_COLORS[order.plan],
                          fontSize: 11,
                          padding: "2px 8px",
                        }}
                      >
                        {PLAN_LABELS[order.plan]}
                      </span>
                      <span
                        style={{ fontSize: 12, color: "var(--text-secondary)" }}
                      >
                        {PERIOD_LABELS[order.period] || order.period}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: st.bg,
                          color: st.color,
                        }}
                      >
                        {st.text}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 4,
                      }}
                    >
                      {new Date(order.createdAt).toLocaleDateString("vi-VN")}
                      {order.couponCode && (
                        <span
                          style={{
                            marginLeft: 8,
                            color: "var(--accent-green)",
                          }}
                        >
                          🎫 {order.couponCode}
                        </span>
                      )}
                      {order.transferContent &&
                        order.paymentStatus === "pending" && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontFamily: "monospace",
                              color: "var(--accent-blue)",
                            }}
                          >
                            Nội dung CK: {order.transferContent}
                          </span>
                        )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {order.discountAmount > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          textDecoration: "line-through",
                        }}
                      >
                        {formatPrice(order.amount)}
                      </div>
                    )}
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {formatPrice(order.finalAmount)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upgrade CTA */}
      {plan !== "unlimited" && (
        <div className="card account-upgrade-cta" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28 }}>🚀</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Nâng cấp gói
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Nâng cấp để tạo nhiều bài hơn mỗi tháng và mở khoá thêm tính
                năng.
              </div>
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => setShowPricing(true)}
          >
            Xem bảng giá
          </button>
        </div>
      )}

      {/* Pricing Modal */}
      <PricingModal
        isOpen={showPricing}
        onClose={() => setShowPricing(false)}
      />
    </div>
  );
}
