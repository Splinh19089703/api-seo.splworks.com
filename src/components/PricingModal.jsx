import { useState, useEffect } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const PLAN_COLORS = {
  basic: "#3b82f6",
  pro: "#8b5cf6",
  agency: "#f59e0b",
  unlimited: "#10b981",
};

const PLAN_TIERS = { trial: 0, basic: 1, pro: 2, agency: 3, unlimited: 4 };

const PLAN_NAMES = {
  trial: "Trial",
  basic: "Basic",
  pro: "Pro",
  agency: "Agency",
  unlimited: "Unlimited",
};

const PERIOD_LABELS = {
  "6months": "6 tháng",
  "1year": "1 năm",
  "2years": "2 năm",
  lifetime: "Vĩnh viễn",
};

const FEATURE_LABELS = {
  aiWriting: "AI viết bài",
  aiImage: "AI tạo ảnh",
  wpPublish: "Đăng WordPress",
  multiPlatform: "Đăng đa nền tảng",
  internalLinks: "Internal Links tự động",
  knowledgeBase: "Knowledge Base",
  seoAudit: "SEO Audit",
  googleSearchConsole: "Google Search Console",
  prioritySupport: "Hỗ trợ ưu tiên",
  affiliate: "CTV / Affiliate",
  sharedAiPool: "AI credit dùng chung",
  bringYourOwnKey: "Thêm API key riêng",
  priorityAiPool: "Ưu tiên hàng đợi AI",
};

function formatPrice(amount) {
  return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}

function formatLimit(value) {
  return value >= 999999 ? "∞" : new Intl.NumberFormat("vi-VN").format(value || 0);
}

function getVietQrUrl(bankInfo) {
  if (!bankInfo?.accountNumber) return "";
  const bankMap = {
    ACB: "ACB",
    "ACB Bank": "ACB",
    MB: "MB",
    "MB Bank": "MB",
    Vietcombank: "VCB",
    Techcombank: "TCB",
    BIDV: "BIDV",
    Agribank: "AGR",
    VPBank: "VPB",
    TPBank: "TPB",
    Sacombank: "STB",
    MSB: "MSB",
    VIB: "VIB",
  };
  const bankName = String(bankInfo.bankName || "").trim();
  const bankId =
    bankMap[bankName] || bankName.toUpperCase().replace(/\s+/g, "").slice(0, 10);
  const accountNumber = String(bankInfo.accountNumber || "").replace(/\s/g, "");
  const params = new URLSearchParams({
    amount: String(Math.round(bankInfo.amount || 0)),
    addInfo: bankInfo.transferContent || "",
    accountName: bankInfo.accountName || "",
  });
  return `https://img.vietqr.io/image/${bankId}-${accountNumber}-compact2.jpg?${params.toString()}`;
}

export default function PricingModal({ isOpen = true, onClose }) {
  const { license, refreshLicense } = useAuth();
  const [plans, setPlans] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("1year");
  const [loading, setLoading] = useState(true);

  // Order flow states
  const [step, setStep] = useState("plans"); // "plans" | "checkout" | "payment"
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [orderError, setOrderError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setStep("plans");
      setSelectedPlan(null);
      setCouponCode("");
      setCouponResult(null);
      setOrderResult(null);
      setOrderError("");
      api
        .getPlans()
        .then((data) => setPlans(data.plans || []))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentPlan = license?.plan || "trial";

  // === Coupon ===
  const handleApplyCoupon = async () => {
    if (!couponCode.trim() || !selectedPlan) return;
    setCouponLoading(true);
    setCouponResult(null);
    try {
      const result = await api.applyCoupon({
        plan: selectedPlan,
        period: selectedPeriod,
        couponCode: couponCode.trim(),
      });
      setCouponResult(result);
    } catch (e) {
      setCouponResult({ valid: false, error: e.message });
    }
    setCouponLoading(false);
  };

  const handleRemoveCoupon = () => {
    setCouponCode("");
    setCouponResult(null);
  };

  // === Select Plan ===
  const isUpgrade = (planId) =>
    (PLAN_TIERS[planId] || 0) > (PLAN_TIERS[currentPlan] || 0);
  const isDowngrade = (planId) =>
    (PLAN_TIERS[planId] || 0) < (PLAN_TIERS[currentPlan] || 0);

  const handleSelectPlan = (planId) => {
    if (planId === currentPlan) return;
    if (isDowngrade(planId)) {
      if (
        !confirm(
          `Bạn đang sử dụng gói ${PLAN_NAMES[currentPlan]}. Hạ xuống ${PLAN_NAMES[planId]} sẽ giảm giới hạn và tính năng. Bạn chắc chứ?`,
        )
      ) {
        return;
      }
    }
    setSelectedPlan(planId);
    setCouponResult(null);
    setCouponCode("");
    setOrderError("");
    setStep("checkout");
  };

  // === Create Order ===
  const handleCreateOrder = async () => {
    if (!selectedPlan) return;
    setOrderLoading(true);
    setOrderError("");
    try {
      const result = await api.createOrder({
        plan: selectedPlan,
        period: selectedPeriod,
        couponCode: couponResult?.valid ? couponCode.trim() : undefined,
        paymentMethod: "bank_transfer",
      });
      setOrderResult(result);
      setStep("payment");
    } catch (e) {
      setOrderError(e.message);
    }
    setOrderLoading(false);
  };

  // === Get price for display ===
  const getPrice = (planId) => {
    const plan = plans.find((p) => p.id === planId);
    return plan?.prices?.[selectedPeriod] || 0;
  };

  const getDiscountedPrice = () => {
    const originalPrice = getPrice(selectedPlan);
    if (couponResult?.valid) {
      return couponResult.finalAmount;
    }
    return originalPrice;
  };

  // ============ RENDER ============

  return (
    <div className="pricing-overlay" onClick={onClose}>
      <div className="pricing-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pricing-header">
          <div>
            <h2 className="pricing-title">
              {step === "plans" && "Bảng giá SPLSEO"}
              {step === "checkout" && "Xác nhận đơn hàng"}
              {step === "payment" && "Thông tin thanh toán"}
            </h2>
            <p className="pricing-subtitle">
              {step === "plans" && "Chọn gói phù hợp với nhu cầu của bạn"}
              {step === "checkout" && "Kiểm tra thông tin và áp mã giảm giá"}
              {step === "payment" && "Chuyển khoản để kích hoạt gói"}
            </p>
          </div>
          <button className="pricing-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Period selector - only on plans step */}
        {step === "plans" && (
          <div className="pricing-period-selector">
            {Object.entries(PERIOD_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={`pricing-period-btn ${selectedPeriod === key ? "active" : ""}`}
                onClick={() => setSelectedPeriod(key)}
              >
                {label}
                {key === "lifetime" && (
                  <span className="pricing-save-badge">Tiết kiệm</span>
                )}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div
              className="loader"
              style={{ width: 32, height: 32, margin: "0 auto 12px" }}
            />
            <span style={{ color: "var(--text-muted)" }}>
              Đang tải bảng giá...
            </span>
          </div>
        ) : (
          <>
            {/* ========== STEP 1: Plans ========== */}
            {step === "plans" && (
              <>
                <div className="pricing-grid">
                  {plans.map((plan) => {
                    const color = PLAN_COLORS[plan.id] || "#888";
                    const price = plan.prices?.[selectedPeriod];
                    const isPopular = plan.id === "pro";
                    const isCurrent = plan.id === currentPlan;

                    return (
                      <div
                        key={plan.id}
                        className={`pricing-card ${isPopular ? "popular" : ""} ${isCurrent ? "current" : ""}`}
                        style={{ "--plan-color": color }}
                      >
                        {isPopular && (
                          <div className="pricing-popular-badge">
                            🔥 Phổ biến nhất
                          </div>
                        )}
                        {isCurrent && (
                          <div className="pricing-current-badge">
                            Gói hiện tại
                          </div>
                        )}

                        <div className="pricing-card-header">
                          <h3 style={{ color }}>{PLAN_NAMES[plan.id]}</h3>
                          <div className="pricing-price">
                            {price ? (
                              <>
                                <span className="pricing-amount">
                                  {formatPrice(price)}
                                </span>
                                <span className="pricing-period">
                                  / {PERIOD_LABELS[selectedPeriod]}
                                </span>
                              </>
                            ) : (
                              <span className="pricing-amount">Liên hệ</span>
                            )}
                          </div>
                        </div>

                        <div className="pricing-card-limits">
                          <div className="pricing-limit-item">
                            <span>📝</span>{" "}
                            {plan.limits.maxArticlesPerMonth >= 999999
                              ? "∞"
                              : plan.limits.maxArticlesPerMonth}{" "}
                            bài/tháng
                          </div>
                          <div className="pricing-limit-item">
                            <span>📁</span>{" "}
                            {plan.limits.maxProjects >= 999999
                              ? "∞"
                              : plan.limits.maxProjects}{" "}
                            dự án
                          </div>
                          <div className="pricing-limit-item">
                            <span>💻</span> {plan.limits.maxDevices} thiết bị
                          </div>
                          {typeof plan.limits.aiCreditsPerMonth === "number" && (
                            <div className="pricing-limit-item">
                              <span>⚡</span>{" "}
                              {formatLimit(plan.limits.aiCreditsPerMonth)} AI credits/tháng
                            </div>
                          )}
                          {typeof plan.limits.maxUserApiKeys === "number" && (
                            <div className="pricing-limit-item">
                              <span>🔑</span>{" "}
                              {formatLimit(plan.limits.maxUserApiKeys)} API key riêng
                            </div>
                          )}
                        </div>

                        <div className="pricing-card-features">
                          {Object.entries(FEATURE_LABELS).map(
                            ([key, label]) => (
                              <div
                                key={key}
                                className={`pricing-feature ${plan.features[key] ? "enabled" : "disabled"}`}
                              >
                                <span>{plan.features[key] ? "✅" : "❌"}</span>
                                <span>{label}</span>
                              </div>
                            ),
                          )}
                        </div>

                        <button
                          className={`btn pricing-btn ${isCurrent ? "btn-secondary" : "btn-primary"}`}
                          style={
                            !isCurrent
                              ? { background: color, borderColor: color }
                              : {}
                          }
                          disabled={isCurrent}
                          onClick={() => handleSelectPlan(plan.id)}
                        >
                          {isCurrent
                            ? "Đang sử dụng"
                            : isUpgrade(plan.id)
                              ? "⬆️ Nâng cấp"
                              : isDowngrade(plan.id)
                                ? "⬇️ Hạ gói"
                                : "Chọn gói này"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="pricing-footer">
                  <p>
                    💡 Trial dùng API chung nên không cần thêm key. Từ Basic trở lên có thể thêm API key riêng; hệ thống ưu tiên key của bạn trước AI credit dùng chung.
                  </p>
                  <p>
                    🎁 Pro trở lên phù hợp khi cần quota ổn định, nhiều provider và chạy bulk thường xuyên.
                  </p>
                </div>
              </>
            )}

            {/* ========== STEP 2: Checkout ========== */}
            {step === "checkout" && selectedPlan && (
              <div style={{ padding: "8px 0" }}>
                {/* Back button */}
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setStep("plans");
                    setOrderError("");
                  }}
                  style={{ marginBottom: 16, fontSize: 12 }}
                >
                  ← Quay lại chọn gói
                </button>

                {/* Order summary card */}
                <div
                  style={{
                    background: "var(--bg-tertiary)",
                    borderRadius: 12,
                    border: "1px solid var(--border-color)",
                    padding: 20,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: PLAN_COLORS[selectedPlan],
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 20,
                        color: "white",
                        fontWeight: 800,
                      }}
                    >
                      {PLAN_NAMES[selectedPlan]?.[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 18 }}>
                        {PLAN_NAMES[selectedPlan]}
                      </div>
                      <div
                        style={{ color: "var(--text-secondary)", fontSize: 13 }}
                      >
                        {PERIOD_LABELS[selectedPeriod]}
                      </div>
                    </div>
                  </div>

                  {/* Price breakdown */}
                  <div
                    style={{
                      borderTop: "1px solid var(--border-light)",
                      paddingTop: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 14,
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        Giá gốc:
                      </span>
                      <span>{formatPrice(getPrice(selectedPlan))}</span>
                    </div>

                    {couponResult?.valid && (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 14,
                          marginBottom: 8,
                          color: "var(--accent-green)",
                        }}
                      >
                        <span>
                          Giảm giá (
                          {couponResult.coupon.discountType === "percent"
                            ? `${couponResult.coupon.discountValue}%`
                            : formatPrice(couponResult.coupon.discountValue)}
                          ):
                        </span>
                        <span>-{formatPrice(couponResult.discountAmount)}</span>
                      </div>
                    )}

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 18,
                        fontWeight: 700,
                        padding: "12px 0",
                        borderTop: "1px dashed var(--border-color)",
                      }}
                    >
                      <span>Tổng thanh toán:</span>
                      <span style={{ color: PLAN_COLORS[selectedPlan] }}>
                        {formatPrice(getDiscountedPrice())}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Coupon input */}
                <div
                  style={{
                    background: "var(--bg-tertiary)",
                    borderRadius: 12,
                    border: "1px solid var(--border-color)",
                    padding: 16,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}
                  >
                    🎫 Mã giảm giá
                  </div>
                  {couponResult?.valid ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "rgba(16,185,129,0.08)",
                        border: "1px solid var(--accent-green)",
                        borderRadius: 8,
                        padding: "8px 12px",
                      }}
                    >
                      <div>
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            color: "var(--accent-green)",
                          }}
                        >
                          {couponResult.coupon.code}
                        </span>
                        {couponResult.coupon.description && (
                          <span
                            style={{
                              color: "var(--text-secondary)",
                              fontSize: 12,
                              marginLeft: 8,
                            }}
                          >
                            — {couponResult.coupon.description}
                          </span>
                        )}
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleRemoveCoupon}
                        style={{ fontSize: 11 }}
                      >
                        Bỏ mã
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        placeholder="Nhập mã giảm giá..."
                        value={couponCode}
                        onChange={(e) =>
                          setCouponCode(e.target.value.toUpperCase())
                        }
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          fontSize: 13,
                          background: "var(--bg-primary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: 8,
                          color: "var(--text-primary)",
                          fontFamily: "monospace",
                          letterSpacing: 1,
                        }}
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleApplyCoupon()
                        }
                      />
                      <button
                        className="btn btn-secondary"
                        onClick={handleApplyCoupon}
                        disabled={!couponCode.trim() || couponLoading}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {couponLoading ? "..." : "Áp dụng"}
                      </button>
                    </div>
                  )}
                  {couponResult && !couponResult.valid && (
                    <div
                      style={{
                        color: "var(--accent-red)",
                        fontSize: 12,
                        marginTop: 6,
                      }}
                    >
                      ❌ {couponResult.error}
                    </div>
                  )}
                </div>

                {/* Error */}
                {orderError && (
                  <div
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid var(--accent-red)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      marginBottom: 16,
                      fontSize: 13,
                      color: "var(--accent-red)",
                    }}
                  >
                    ⚠️ {orderError}
                  </div>
                )}

                {/* Create Order button */}
                <button
                  className="btn btn-primary"
                  onClick={handleCreateOrder}
                  disabled={orderLoading}
                  style={{
                    width: "100%",
                    padding: "12px 24px",
                    fontSize: 15,
                    fontWeight: 700,
                    background: PLAN_COLORS[selectedPlan],
                    borderColor: PLAN_COLORS[selectedPlan],
                  }}
                >
                  {orderLoading ? (
                    <>
                      <span
                        className="loader"
                        style={{ width: 16, height: 16 }}
                      />{" "}
                      Đang tạo đơn...
                    </>
                  ) : (
                    `Thanh toán ${formatPrice(getDiscountedPrice())}`
                  )}
                </button>
              </div>
            )}

            {/* ========== STEP 3: Payment ========== */}
            {step === "payment" && orderResult && (
              <div style={{ padding: "8px 0" }}>
                {/* Success banner */}
                <div
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(59,130,246,0.1))",
                    border: "1px solid var(--accent-green)",
                    borderRadius: 12,
                    padding: 20,
                    marginBottom: 16,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                  <div
                    style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}
                  >
                    Đơn hàng đã tạo thành công!
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    Chuyển khoản theo thông tin bên dưới. License sẽ được kích
                    hoạt sau khi admin xác nhận.
                  </div>
                </div>

                {/* Bank transfer info */}
                <div
                  style={{
                    background: "var(--bg-tertiary)",
                    borderRadius: 12,
                    border: "2px solid var(--accent-blue)",
                    padding: 20,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 15,
                      marginBottom: 14,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    🏦 Thông tin chuyển khoản
                  </div>

                  {getVietQrUrl(orderResult.bankInfo) && (
                    <div style={{ textAlign: "center", marginBottom: 16 }}>
                      <div
                        style={{
                          display: "inline-block",
                          background: "#fff",
                          borderRadius: 12,
                          padding: 10,
                          boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
                        }}
                      >
                        <img
                          src={getVietQrUrl(orderResult.bankInfo)}
                          alt="Mã QR chuyển khoản"
                          style={{
                            display: "block",
                            width: 220,
                            height: 220,
                            borderRadius: 8,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {[
                    {
                      label: "Ngân hàng",
                      value: orderResult.bankInfo?.bankName,
                    },
                    {
                      label: "Số tài khoản",
                      value: orderResult.bankInfo?.accountNumber,
                      mono: true,
                    },
                    {
                      label: "Chủ tài khoản",
                      value: orderResult.bankInfo?.accountName,
                    },
                    {
                      label: "Số tiền",
                      value: formatPrice(orderResult.bankInfo?.amount),
                      highlight: true,
                    },
                    {
                      label: "Nội dung CK",
                      value: orderResult.bankInfo?.transferContent,
                      mono: true,
                      important: true,
                    },
                  ].map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 0",
                        borderBottom:
                          i < 4 ? "1px solid var(--border-light)" : "none",
                      }}
                    >
                      <span
                        style={{ color: "var(--text-secondary)", fontSize: 13 }}
                      >
                        {item.label}:
                      </span>
                      <span
                        style={{
                          fontWeight: item.important
                            ? 800
                            : item.highlight
                              ? 700
                              : 500,
                          fontSize: item.important
                            ? 16
                            : item.highlight
                              ? 15
                              : 14,
                          fontFamily: item.mono ? "monospace" : "inherit",
                          color: item.important
                            ? "var(--accent-red)"
                            : item.highlight
                              ? "var(--accent-green)"
                              : "var(--text-primary)",
                          letterSpacing: item.mono ? 1 : 0,
                        }}
                      >
                        {item.value}
                      </span>
                    </div>
                  ))}

                  <div
                    style={{
                      marginTop: 12,
                      padding: "8px 12px",
                      background: "rgba(239,68,68,0.08)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--accent-red)",
                      lineHeight: 1.5,
                    }}
                  >
                    ⚠️ <strong>Quan trọng:</strong> Vui lòng ghi đúng nội dung
                    chuyển khoản{" "}
                    <strong>{orderResult.bankInfo?.transferContent}</strong> để
                    đơn hàng được xử lý nhanh nhất.
                  </div>
                </div>

                {/* Order details */}
                <div
                  style={{
                    background: "var(--bg-tertiary)",
                    borderRadius: 12,
                    border: "1px solid var(--border-color)",
                    padding: 16,
                    marginBottom: 16,
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    📋 Chi tiết đơn hàng
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "6px 12px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span>Gói:</span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: PLAN_COLORS[orderResult.order?.plan],
                      }}
                    >
                      {PLAN_NAMES[orderResult.order?.plan]} —{" "}
                      {PERIOD_LABELS[orderResult.order?.period]}
                    </span>
                    <span>Trạng thái:</span>
                    <span
                      style={{ color: "var(--accent-yellow)", fontWeight: 600 }}
                    >
                      ⏳ Chờ thanh toán
                    </span>
                    {orderResult.order?.couponCode && (
                      <>
                        <span>Mã giảm giá:</span>
                        <span
                          style={{
                            fontFamily: "monospace",
                            color: "var(--accent-green)",
                          }}
                        >
                          {orderResult.order.couponCode}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    refreshLicense();
                    onClose();
                  }}
                  style={{ width: "100%", padding: "10px 24px" }}
                >
                  Đã hiểu, đóng
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
