import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import GTMPanel from "../components/GTMPanel";

const GA4_HOME_URL = "https://analytics.google.com/analytics/web/";
const DAYS_OPTIONS = [7, 14, 28, 90];
const CHANNEL_OPTIONS = [
  { value: "all", label: "🌐 Tất cả kênh" },
  { value: "Organic Search", label: "🔍 Organic Search (SEO)" },
  { value: "Direct", label: "🔗 Direct (Trực tiếp)" },
  { value: "Organic Social", label: "📱 Organic Social" },
  { value: "Referral", label: "↩️ Referral (Giới thiệu)" },
  { value: "AI Assistants", label: "🤖 AI Assistants" },
];

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}p ${rem < 10 ? "0" : ""}${rem}s`;
}

function formatCurrency(amount, currency = "VND") {
  const n = Number(amount) || 0;
  if (n === 0) return currency === "VND" ? "0 ₫" : "0,00 $";
  try {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: currency || "VND",
      maximumFractionDigits: currency === "VND" ? 0 : 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString("vi-VN")} ${currency}`;
  }
}

function StatCard({ icon, label, value, sub, color = "#6366f1" }) {
  return (
    <div className="gsc-stat-card" style={{ "--card-accent": color }}>
      <div className="gsc-stat-icon">{icon}</div>
      <div className="gsc-stat-value" style={{ color }}>{value ?? "—"}</div>
      <div className="gsc-stat-label">{label}</div>
      {sub && <div className="gsc-stat-sub">{sub}</div>}
    </div>
  );
}

function SkeletonRows({ count = 6, cols = 6 }) {
  return Array.from({ length: count }).map((_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j}>
          <div
            className="skeleton"
            style={{ height: 14, borderRadius: 4, width: j === 0 ? "70%" : "50%" }}
          />
        </td>
      ))}
    </tr>
  ));
}

function mapCallbackError(msg) {
  if (msg === "missing_scope") {
    return {
      message:
        "Bạn chưa tích chọn ô cấp quyền đọc dữ liệu Google Analytics ở màn hình đăng nhập Google. Vui lòng bấm 'Cấp lại quyền Google' và tích chọn đầy đủ quyền.",
      code: "GA4_MISSING_SCOPE",
    };
  }
  if (msg === "access_denied") {
    return {
      message: "Bạn đã hủy cấp quyền trên màn hình Google OAuth.",
      code: "GA4_ACCESS_DENIED",
    };
  }
  return {
    message: `Kết nối Google Analytics thất bại: ${msg || "lỗi không xác định"}`,
    code: "GA4_CALLBACK_ERROR",
  };
}

function categoryBadgeStyle(category) {
  if (category === "conversion") {
    return {
      background: "rgba(16, 185, 129, 0.14)",
      color: "#10b981",
      border: "1px solid rgba(16, 185, 129, 0.3)",
    };
  }
  if (category === "custom") {
    return {
      background: "rgba(99, 102, 241, 0.14)",
      color: "#6366f1",
      border: "1px solid rgba(99, 102, 241, 0.3)",
    };
  }
  if (category === "interaction") {
    return {
      background: "rgba(245, 158, 11, 0.14)",
      color: "#f59e0b",
      border: "1px solid rgba(245, 158, 11, 0.3)",
    };
  }
  return {
    background: "var(--bg-surface)",
    color: "var(--text-muted)",
    border: "1px solid var(--border-light)",
  };
}

export default function GA4() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Top-level Mode: "ga4" (Báo cáo GA4) | "gtm" (Google Tag Manager)
  const [pageMode, setPageMode] = useState(() =>
    searchParams.get("mode") === "gtm" ? "gtm" : "ga4"
  );
  const [gtmCallbackStatus, setGtmCallbackStatus] = useState(null);
  const [streamMeasurementId, setStreamMeasurementId] = useState("");

  // Auth & Connection
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [authUrl, setAuthUrl] = useState("");
  const [reconnecting, setReconnecting] = useState(false);

  // Properties
  const [properties, setProperties] = useState([]);
  const [propsLoading, setPropsLoading] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(() => localStorage.getItem("splseo_ga4_prop") || "");
  const [adminApiWarning, setAdminApiWarning] = useState(null);

  // Manual Property Form
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualPropId, setManualPropId] = useState("");
  const [manualPropName, setManualPropName] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  // Filters & Guide
  const [days, setDays] = useState(28);
  const [channel, setChannel] = useState("all");
  const [showGuide, setShowGuide] = useState(false);

  // Overview state
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null);
  const [totals, setTotals] = useState(null);
  const [realtimeUsers, setRealtimeUsers] = useState(null);
  const [trend, setTrend] = useState([]);
  const [channels, setChannels] = useState([]);
  const [devices, setDevices] = useState([]);

  // Tabs & Tables
  const [activeTab, setActiveTab] = useState("events"); // events | pages | channels
  const [eventFilterMode, setEventFilterMode] = useState("all"); // all | custom
  const [eventSearch, setEventSearch] = useState("");
  const [eventsData, setEventsData] = useState({
    events: [],
    currencyCode: "VND",
    totalEvents: 0,
    customEventsCount: 0,
  });
  const [pages, setPages] = useState([]);
  const [tableLoading, setTableLoading] = useState(false);

  // Drill-down: which pages triggered a specific event
  const [expandedEvent, setExpandedEvent] = useState("");
  const [eventPagesMap, setEventPagesMap] = useState({});
  const [eventPagesLoading, setEventPagesLoading] = useState("");

  // Cache clear
  const [cacheClearing, setCacheClearing] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const setErrorFromException = (prefix, e) => {
    const rawMsg = e?.message || "Lỗi không xác định";
    const cleanMsg =
      e?.code === "GA4_API_DISABLED" ||
      e?.code === "GA4_MISSING_SCOPE" ||
      e?.code === "GA4_TOKEN_EXPIRED"
        ? rawMsg
        : `${prefix}: ${rawMsg}`;
    setErrorInfo({
      message: cleanMsg,
      code: e?.code || "",
      actionUrl: e?.actionUrl || "",
      secondaryUrl: e?.secondaryUrl || "",
      detail: e?.detail || "",
    });
  };

  // =====================================================================
  // Init
  // =====================================================================
  useEffect(() => {
    const modeParam = searchParams.get("mode");
    const ga4Param = searchParams.get("ga4");
    const gtmParam = searchParams.get("gtm");
    const msgParam = searchParams.get("msg");

    if (modeParam === "gtm" || gtmParam) {
      setPageMode("gtm");
    }

    if (gtmParam === "error") {
      setGtmCallbackStatus({
        type: "error",
        message:
          msgParam === "missing_scope"
            ? "Bạn chưa tích chọn đầy đủ quyền quản lý Google Tag Manager ở màn hình đăng nhập Google."
            : `Kết nối GTM thất bại: ${msgParam || "lỗi không xác định"}`,
        code: msgParam === "missing_scope" ? "GTM_MISSING_SCOPE" : "GTM_CALLBACK_ERROR",
      });
      navigate("/ga4?mode=gtm", { replace: true });
    } else if (gtmParam === "success") {
      setGtmCallbackStatus({ type: "success" });
      navigate("/ga4?mode=gtm", { replace: true });
    } else if (ga4Param === "error") {
      setErrorInfo(mapCallbackError(msgParam));
      navigate("/ga4", { replace: true });
    } else if (ga4Param === "success") {
      setErrorInfo(null);
      navigate("/ga4", { replace: true });
    }

    checkStatus(ga4Param === "success");
  }, []);

  const checkStatus = async (forceRefreshProps = false) => {
    setAuthLoading(true);
    try {
      const status = await api.ga4Status();
      if (!mountedRef.current) return;
      setConnected(status.connected);
      setEmail(status.email || "");
      if (status.connected) {
        if (status.missingScope) {
          setErrorInfo({
            message:
              "Tài khoản Google chưa cấp quyền đọc dữ liệu Google Analytics. Vui lòng bấm 'Cấp lại quyền Google' và tích chọn ô quyền Analytics.",
            code: "GA4_MISSING_SCOPE",
          });
        } else {
          await loadProperties(forceRefreshProps);
        }
      } else {
        try {
          const { url } = await api.ga4AuthUrl();
          if (mountedRef.current) setAuthUrl(url);
        } catch {}
      }
    } catch {
      if (mountedRef.current) setConnected(false);
    } finally {
      if (mountedRef.current) setAuthLoading(false);
    }
  };

  const loadProperties = async (forceRefresh = false) => {
    setPropsLoading(true);
    try {
      const data = await api.ga4Properties(forceRefresh);
      if (!mountedRef.current) return;
      const list = data?.properties || [];
      setProperties(list);
      setAdminApiWarning(data?.adminApiWarning || null);
      setErrorInfo(null);
      if (list.length > 0) {
        setSelectedProperty((prev) => {
          const next =
            prev && list.some((p) => p.propertyId === prev)
              ? prev
              : list[0].propertyId;
          localStorage.setItem("splseo_ga4_prop", next);
          return next;
        });
      } else {
        setSelectedProperty("");
      }
    } catch (e) {
      if (mountedRef.current) {
        setErrorFromException("Không thể tải danh sách GA4 Property", e);
      }
    } finally {
      if (mountedRef.current) setPropsLoading(false);
    }
  };

  const handleSelectProperty = (propId) => {
    setSelectedProperty(propId);
    localStorage.setItem("splseo_ga4_prop", propId);
    setExpandedEvent("");
    setEventPagesMap({});
  };

  // =====================================================================
  // Load Overview + Active Tab Data
  // =====================================================================
  useEffect(() => {
    if (connected && selectedProperty) {
      loadAllData();
      api
        .ga4Streams(selectedProperty)
        .then((res) => {
          if (mountedRef.current) {
            setStreamMeasurementId(res?.measurementId || "");
          }
        })
        .catch(() => {});
    } else {
      setStreamMeasurementId("");
    }
  }, [connected, selectedProperty, days, channel]);

  const loadAllData = useCallback(async () => {
    if (!selectedProperty) return;
    setLoading(true);
    setTableLoading(true);
    setErrorInfo(null);
    setExpandedEvent("");

    try {
      const [overviewRes, eventsRes, pagesRes] = await Promise.allSettled([
        api.ga4Overview({ propertyId: selectedProperty, days, channel }),
        api.ga4Events({ propertyId: selectedProperty, days, channel, limit: 200 }),
        api.ga4Pages({ propertyId: selectedProperty, days, channel, limit: 100 }),
      ]);

      if (!mountedRef.current) return;

      if (overviewRes.status === "fulfilled") {
        setTotals(overviewRes.value.totals || null);
        setRealtimeUsers(overviewRes.value.realtimeUsers ?? null);
        setTrend(overviewRes.value.trend || []);
        setChannels(overviewRes.value.channels || []);
        setDevices(overviewRes.value.devices || []);
      } else if (overviewRes.reason) {
        setErrorFromException("Lỗi tải chỉ số GA4", overviewRes.reason);
      }

      if (eventsRes.status === "fulfilled") {
        setEventsData({
          events: eventsRes.value.events || [],
          currencyCode: eventsRes.value.currencyCode || "VND",
          totalEvents: eventsRes.value.totalEvents || 0,
          customEventsCount: eventsRes.value.customEventsCount || 0,
        });
      }

      if (pagesRes.status === "fulfilled") {
        setPages(pagesRes.value.pages || []);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setTableLoading(false);
      }
    }
  }, [selectedProperty, days, channel]);

  // Drill-down: load pages that triggered a specific eventName
  const handleToggleEventPages = async (eventName) => {
    if (expandedEvent === eventName) {
      setExpandedEvent("");
      return;
    }
    setExpandedEvent(eventName);
    const key = `${selectedProperty}:${days}:${channel}:${eventName}`;
    if (eventPagesMap[key]) return;

    setEventPagesLoading(eventName);
    try {
      const res = await api.ga4EventPages({
        propertyId: selectedProperty,
        eventName,
        days,
        channel,
      });
      if (mountedRef.current) {
        setEventPagesMap((prev) => ({ ...prev, [key]: res.pages || [] }));
      }
    } catch {
      if (mountedRef.current) {
        setEventPagesMap((prev) => ({ ...prev, [key]: [] }));
      }
    } finally {
      if (mountedRef.current) setEventPagesLoading("");
    }
  };

  // =====================================================================
  // Manual Property Save
  // =====================================================================
  const handleAddManualProperty = async (e) => {
    e.preventDefault();
    if (!manualPropId.trim()) return;
    setSavingManual(true);
    try {
      const res = await api.ga4AddManualProperty({
        propertyId: manualPropId.trim(),
        displayName: manualPropName.trim(),
      });
      if (res?.property) {
        setProperties((prev) => {
          const exists = prev.some((p) => p.propertyId === res.property.propertyId);
          return exists ? prev : [...prev, res.property];
        });
        handleSelectProperty(res.property.propertyId);
        setManualPropId("");
        setManualPropName("");
        setShowManualForm(false);
      }
    } catch (err) {
      setErrorFromException("Không lưu được Property ID", err);
    } finally {
      setSavingManual(false);
    }
  };

  // =====================================================================
  // Connect / Reconnect / Disconnect / Clear Cache
  // =====================================================================
  const handleConnect = async () => {
    if (authUrl) {
      window.location.href = authUrl;
      return;
    }
    setReconnecting(true);
    try {
      const { url } = await api.ga4AuthUrl();
      if (url) window.location.href = url;
    } catch (e) {
      setErrorFromException("Không tạo được link kết nối Google", e);
      setReconnecting(false);
    }
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const { url } = await api.ga4AuthUrl();
      if (url) {
        window.location.href = url;
        return;
      }
    } catch (e) {
      setErrorFromException("Không tạo được link cấp quyền lại", e);
    }
    setReconnecting(false);
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Ngắt kết nối Google Analytics? Toàn bộ cache và token GA4 sẽ bị xóa.")) return;
    try {
      await api.ga4Disconnect();
      setConnected(false);
      setEmail("");
      setProperties([]);
      setSelectedProperty("");
      setTotals(null);
      setTrend([]);
      setEventsData({ events: [], currencyCode: "VND", totalEvents: 0, customEventsCount: 0 });
      setPages([]);
      setChannels([]);
      setDevices([]);
      setErrorInfo(null);
      try {
        const { url } = await api.ga4AuthUrl();
        if (mountedRef.current) setAuthUrl(url);
      } catch {}
    } catch (e) {
      setErrorFromException("Ngắt kết nối thất bại", e);
    }
  };

  const handleClearCache = async () => {
    if (cacheClearing) return;
    setCacheClearing(true);
    try {
      await api.ga4ClearCache();
      await loadProperties(true);
      if (selectedProperty) {
        await loadAllData();
      }
    } catch (e) {
      setErrorFromException("Xóa cache thất bại", e);
    } finally {
      if (mountedRef.current) setCacheClearing(false);
    }
  };

  // =====================================================================
  // Filtered Events List
  // =====================================================================
  const allEvents = eventsData.events || [];
  const customOnlyCount = allEvents.filter((e) => e.isCustomOrLead).length;
  const visibleEvents = allEvents.filter((ev) => {
    if (eventFilterMode === "custom" && !ev.isCustomOrLead) return false;
    if (eventSearch.trim()) {
      return ev.eventName.toLowerCase().includes(eventSearch.trim().toLowerCase());
    }
    return true;
  });

  // =====================================================================
  // Render Helpers
  // =====================================================================
  const renderErrorBanner = () => {
    if (!errorInfo) return null;
    const isApiDisabled = errorInfo.code === "GA4_API_DISABLED";
    const needsReauth =
      errorInfo.code === "GA4_MISSING_SCOPE" || errorInfo.code === "GA4_TOKEN_EXPIRED";

    return (
      <div
        className="card"
        style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <p style={{ color: "#dc2626", margin: 0, fontSize: 13.5, fontWeight: 600, lineHeight: 1.5 }}>
          ❌ {errorInfo.message}
        </p>
        {isApiDisabled && (
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {errorInfo.actionUrl && (
              <a
                href={errorInfo.actionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                style={{ textDecoration: "none" }}
              >
                🔗 Bật Google Analytics Data API
              </a>
            )}
            {errorInfo.secondaryUrl && errorInfo.secondaryUrl !== errorInfo.actionUrl && (
              <a
                href={errorInfo.secondaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm"
                style={{ textDecoration: "none" }}
              >
                🔗 Bật thêm Analytics Admin API (tự lấy danh sách web)
              </a>
            )}
            <button
              className="btn btn-sm"
              onClick={() => (selectedProperty ? loadAllData() : loadProperties(true))}
              disabled={propsLoading || loading}
            >
              🔄 Đã bật xong — Tải lại dữ liệu
            </button>
          </div>
        )}
        {needsReauth && (
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleReconnect}
              disabled={reconnecting}
            >
              {reconnecting ? "⏳ Đang chuyển hướng..." : "🔑 Cấp lại quyền Google Analytics"}
            </button>
          </div>
        )}
        {!isApiDisabled && !needsReauth && connected && (
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={() => (selectedProperty ? loadAllData() : loadProperties(true))}
              disabled={propsLoading || loading}
            >
              🔄 Thử tải lại
            </button>
            <button className="btn btn-sm" onClick={handleReconnect} disabled={reconnecting}>
              🔑 Kết nối lại Google
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderGuideOrEmptyProps = () => {
    const isEmptyProps = !errorInfo && !propsLoading && properties.length === 0;
    if (!isEmptyProps && !showGuide && !adminApiWarning && !showManualForm) return null;

    return (
      <div className="card gsc-guide-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--text-primary)" }}>
              {isEmptyProps
                ? `🚀 Tài khoản ${email} chưa có GA4 Property nào được tìm thấy`
                : "📖 Hướng dẫn kết nối Google Analytics 4 (GA4) & theo dõi Sự kiện chuyển đổi"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
              {adminApiWarning
                ? adminApiWarning.message
                : "Theo dõi đầy đủ người dùng, phiên truy cập và các sự kiện bấm gọi điện, Zalo, bản đồ, điền form..."}
            </div>
          </div>
          {!isEmptyProps && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setShowGuide(false);
                setShowManualForm(false);
              }}
              style={{ fontSize: 12 }}
            >
              Đóng ✕
            </button>
          )}
        </div>

        <div className="gsc-guide-grid">
          <div className="gsc-guide-step">
            <strong>1. Tạo GA4 Property cho website</strong>
            Mở{" "}
            <a href={GA4_HOME_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", fontWeight: 600 }}>
              Google Analytics
            </a>{" "}
            bằng Gmail <code>{email}</code>, tạo tài sản GA4 và gắn mã đo lường <code>G-XXXXXXXX</code> vào website (qua GTM, RankMath hoặc Header).
          </div>
          <div className="gsc-guide-step">
            <strong>2. Theo dõi sự kiện bấm Zalo / Gọi điện</strong>
            Các sự kiện tùy chỉnh như <code>click_hotline</code>, <code>click_zalo</code>, <code>article_click_call</code>, <code>form_submit</code> sẽ tự động được tách nhóm <strong>Chuyển đổi / Liên hệ</strong> ở bảng dưới.
          </div>
          <div className="gsc-guide-step">
            <strong>3. Chọn Property hoặc nhập mã số ID</strong>
            Hệ thống tự quét danh sách Property của bạn. Ngoài ra bạn có thể nhập thẳng dãy số <em>Property ID</em> (trong <em>GA4 Admin → Chi tiết tài sản</em>) nếu cần.
          </div>
        </div>

        {showManualForm && (
          <form
            onSubmit={handleAddManualProperty}
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              type="text"
              className="input-field"
              placeholder="Nhập mã số Property ID (VD: 412345678)"
              value={manualPropId}
              onChange={(e) => setManualPropId(e.target.value)}
              style={{ width: 250, fontSize: 13 }}
              required
            />
            <input
              type="text"
              className="input-field"
              placeholder="Tên gợi nhớ (VD: Reviewtop)"
              value={manualPropName}
              onChange={(e) => setManualPropName(e.target.value)}
              style={{ width: 220, fontSize: 13 }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={savingManual}>
              {savingManual ? "Đang lưu..." : "💾 Lưu Property"}
            </button>
          </form>
        )}

        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <a
            href={GA4_HOME_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
            style={{ textDecoration: "none" }}
          >
            🌐 Mở Google Analytics (GA4)
          </a>
          {adminApiWarning?.actionUrl && (
            <a
              href={adminApiWarning.actionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm"
              style={{ textDecoration: "none" }}
            >
              🔗 Bật Analytics Admin API (tự động lấy danh sách)
            </a>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowManualForm((v) => !v)}
          >
            🔢 Nhập tay mã Property ID
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => loadProperties(true)}
            disabled={propsLoading}
          >
            {propsLoading ? "⏳ Đang quét..." : "🔄 Quét lại danh sách Property"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleReconnect}
            disabled={reconnecting}
          >
            🔑 Đổi Gmail / Cấp lại quyền
          </button>
        </div>
      </div>
    );
  };

  const TrendChart = ({ data }) => {
    if (!data || data.length === 0) return null;
    const sessions = data.map((d) => d.sessions);
    const users = data.map((d) => d.users);
    const maxVal = Math.max(...sessions, ...users, 1);
    const W = 600, H = 120;
    const xStep = W / (data.length - 1 || 1);

    const pts = (arr) =>
      arr
        .map((v, i) => `${i * xStep},${H - 8 - ((v / maxVal) * (H - 16))}`)
        .join(" ");

    return (
      <div className="gsc-trend-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 120 }}>
          {[0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t} x1={0} x2={W} y1={H - 8 - t * (H - 16)} y2={H - 8 - t * (H - 16)} stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
          ))}
          <polyline fill="none" stroke="rgba(16,185,129,0.5)" strokeWidth="1.5" points={pts(users)} />
          <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={pts(sessions)} />
        </svg>
        <div className="gsc-trend-labels">
          {data.filter((_, i) => i % Math.ceil(data.length / 7) === 0).map((d) => (
            <span key={d.date} style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.date.slice(5)}</span>
          ))}
        </div>
        <div className="gsc-trend-legend">
          <span><span style={{ color: "#6366f1", fontWeight: 700 }}>—</span> Phiên truy cập (Sessions)</span>
          <span><span style={{ color: "#10b981", fontWeight: 700 }}>—</span> Người dùng (Users)</span>
        </div>
      </div>
    );
  };

  const renderModeSwitcher = () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 18,
        paddingBottom: 12,
        borderBottom: "1px solid var(--border-color)",
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className={`btn btn-sm ${pageMode === "ga4" ? "btn-primary" : ""}`}
          onClick={() => setPageMode("ga4")}
          style={{ borderRadius: 999, padding: "7px 16px", fontWeight: 700 }}
        >
          📉 Báo cáo Google Analytics (GA4)
        </button>
        <button
          className={`btn btn-sm ${pageMode === "gtm" ? "btn-primary" : ""}`}
          onClick={() => setPageMode("gtm")}
          style={{ borderRadius: 999, padding: "7px 16px", fontWeight: 700 }}
        >
          🏷️ Cấu hình Tag Manager (GTM)
        </button>
      </div>
      <button className="btn btn-sm" onClick={() => navigate("/gsc")} style={{ fontSize: 12 }}>
        📈 Sang Search Console
      </button>
    </div>
  );

  // =====================================================================
  // GTM Mode View (hoạt động độc lập ngay cả khi chưa kết nối GA4)
  // =====================================================================
  if (pageMode === "gtm") {
    return (
      <div className="page-container">
        {renderModeSwitcher()}
        <GTMPanel
          suggestedMeasurementId={streamMeasurementId}
          initialCallbackStatus={gtmCallbackStatus}
        />
      </div>
    );
  }

  // =====================================================================
  // Loading / Disconnected Views (GA4 Mode)
  // =====================================================================
  if (authLoading) {
    return (
      <div className="page-container">
        {renderModeSwitcher()}
        <div style={{ textAlign: "center", paddingTop: 60 }}>
          <span className="loader" />
          <p style={{ marginTop: 16, color: "var(--text-muted)" }}>Đang kiểm tra kết nối Google Analytics...</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="page-container">
        {renderModeSwitcher()}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: "0 0 4px" }}>📉 Google Analytics (GA4)</h1>
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            Theo dõi lưu lượng truy cập, hành vi người dùng và các sự kiện chuyển đổi thực tế (Zalo, Hotline, Form, Map...) ngay trên SPLSEO.
          </p>
        </div>

        {renderErrorBanner()}

        <div className="gsc-connect-card card">
          <div className="gsc-connect-icon">📉</div>
          <h2>Kết nối Google Analytics 4</h2>
          <p style={{ color: "var(--text-muted)", maxWidth: 500, margin: "0 auto 24px" }}>
            Xem trực tiếp lượng truy cập thực tế, người đang online 30 phút qua và bóc tách chính xác những bài viết nào mang lại lượt bấm gọi điện, nhắn Zalo hay điền form.
          </p>
          <div className="gsc-features-preview">
            {[
              ["👥", "Users, Sessions & Realtime", "Người dùng thực & đang online"],
              ["🎯", "Sự kiện Chuyển đổi (Events)", "Lọc riêng click_zalo, click_hotline..."],
              ["🔍", "Soi URL tạo ra chuyển đổi", "Biết ngay bài viết nào ra khách"],
              ["🌐", "Nguồn kênh SEO & AI", "Organic Search, Social, AI Assistants"],
            ].map(([icon, title, sub]) => (
              <div key={title} className="gsc-feature-item">
                <span style={{ fontSize: 24 }}>{icon}</span>
                <strong>{title}</strong>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{sub}</span>
              </div>
            ))}
          </div>

          {!authUrl ? (
            <div style={{ padding: "16px 0", color: "var(--text-muted)", fontSize: 13 }}>
              ⚠️ Chưa cấu hình <code>GOOGLE_CLIENT_ID</code> trên server.
            </div>
          ) : (
            <button className="btn btn-primary gsc-connect-btn" onClick={handleConnect} disabled={reconnecting}>
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                style={{ width: 18, height: 18 }}
              />
              {reconnecting ? "Đang chuyển hướng..." : "Kết nối Google Analytics"}
            </button>
          )}

          <div className="gsc-setup-box">
            <div className="gsc-setup-box__title">
              <span>💡 Hướng dẫn nhanh trước khi kết nối</span>
              <a
                href={GA4_HOME_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#6366f1", fontSize: 12, textDecoration: "none", fontWeight: 600 }}
              >
                Mở Google Analytics ↗
              </a>
            </div>
            <ul className="gsc-setup-steps">
              <li>
                <span className="gsc-step-num">1</span>
                <span>
                  Đảm bảo website đã gắn mã đo lường <strong>GA4</strong> trên{" "}
                  <a href={GA4_HOME_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", fontWeight: 600 }}>
                    analytics.google.com
                  </a>{" "}
                  bằng tài khoản Gmail của bạn (quyền tối thiểu: <em>Người xem / Viewer</em>).
                </span>
              </li>
              <li>
                <span className="gsc-step-num">2</span>
                <span>
                  Bấm <strong>Kết nối Google Analytics</strong> bên trên và{" "}
                  <strong>tích chọn ô quyền "Xem và tải dữ liệu Google Analytics của bạn xuống"</strong>.
                </span>
              </li>
              <li>
                <span className="gsc-step-num">3</span>
                <span>
                  Chọn tài sản (Property) website để xem báo cáo chỉ số, sự kiện chuyển đổi và bấm vào từng sự kiện để soi bài viết nào ra khách.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // =====================================================================
  // Connected View
  // =====================================================================
  return (
    <div className="page-container">
      {renderModeSwitcher()}
      {/* Header */}
      <div className="gsc-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: "0 0 4px" }}>📉 Google Analytics (GA4)</h1>
            {realtimeUsers !== null && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  background: "rgba(16, 185, 129, 0.14)",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                }}
                title="Số người dùng đang hoạt động trong 30 phút qua"
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                {realtimeUsers} online (30p)
              </span>
            )}
          </div>
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: 13 }}>
            ✅ Đã kết nối: <strong>{email}</strong>
            {streamMeasurementId && (
              <span style={{ marginLeft: 8, color: "#6366f1", fontWeight: 600 }}>
                · Mã đo lường: {streamMeasurementId}
              </span>
            )}
            {properties.length > 0 && (
              <span style={{ marginLeft: 8 }}>· {properties.length} tài sản (Property)</span>
            )}
          </p>
        </div>

        <div className="gsc-header-actions">
          {properties.length > 0 && (
            <select
              className="select-field"
              value={selectedProperty}
              onChange={(e) => handleSelectProperty(e.target.value)}
              style={{ minWidth: 220 }}
            >
              {properties.map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.displayName} ({p.propertyId})
                </option>
              ))}
            </select>
          )}

          <select
            className="select-field"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            style={{ minWidth: 175 }}
            title="Lọc theo kênh lưu lượng"
          >
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <div className="gsc-days-pills">
            {DAYS_OPTIONS.map((d) => (
              <button
                key={d}
                className={`gsc-days-pill${days === d ? " active" : ""}`}
                onClick={() => setDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>

          <button
            className="btn btn-sm"
            onClick={() => setShowGuide((v) => !v)}
            style={{
              fontSize: 12,
              borderColor: showGuide ? "#6366f1" : undefined,
              color: showGuide ? "#6366f1" : undefined,
            }}
            title="Hướng dẫn & thêm Property ID"
          >
            📖 Hướng dẫn
          </button>

          <button
            className="btn btn-sm"
            onClick={() => navigate("/gsc")}
            style={{ fontSize: 12 }}
            title="Chuyển nhanh sang Google Search Console"
          >
            📈 GSC
          </button>

          <button
            className="btn btn-sm"
            onClick={handleClearCache}
            disabled={cacheClearing || propsLoading || loading}
            title="Xóa cache, làm mới số liệu"
          >
            {cacheClearing || propsLoading ? "⏳" : "🔄"}
          </button>

          <button className="btn btn-sm" style={{ color: "#ef4444" }} onClick={handleDisconnect}>
            Ngắt kết nối
          </button>
        </div>
      </div>

      {renderErrorBanner()}
      {renderGuideOrEmptyProps()}

      {/* 6 KPI Stat Cards */}
      <div
        className="gsc-stats-row"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))" }}
      >
        <StatCard
          icon="👥"
          label="Tổng người dùng"
          value={loading ? "…" : totals?.totalUsers?.toLocaleString("vi-VN")}
          sub={totals ? `+${(totals.newUsers || 0).toLocaleString("vi-VN")} người mới` : `${days} ngày qua`}
          color="#6366f1"
        />
        <StatCard
          icon="⚡"
          label="Phiên truy cập"
          value={loading ? "…" : totals?.sessions?.toLocaleString("vi-VN")}
          sub={`${days} ngày qua`}
          color="#3b82f6"
        />
        <StatCard
          icon="👀"
          label="Lượt xem trang"
          value={loading ? "…" : totals?.pageviews?.toLocaleString("vi-VN")}
          sub="Screen / Page views"
          color="#0ea5e9"
        />
        <StatCard
          icon="🎯"
          label="Tỷ lệ tương tác"
          value={loading ? "…" : totals?.engagementRate != null ? `${totals.engagementRate}%` : "—"}
          sub={totals?.bounceRate != null ? `Thoát: ${totals.bounceRate}%` : ""}
          color="#10b981"
        />
        <StatCard
          icon="⏱️"
          label="Thời gian TB"
          value={loading ? "…" : totals?.avgSessionDuration != null ? formatDuration(totals.avgSessionDuration) : "—"}
          sub="Trung bình / phiên"
          color="#f59e0b"
        />
        <StatCard
          icon="🔥"
          label="Sự kiện chuyển đổi / riêng"
          value={loading ? "…" : (eventsData.customEventsCount || 0).toLocaleString("vi-VN")}
          sub={
            totals
              ? `Tổng tất cả event: ${(totals.eventCount || 0).toLocaleString("vi-VN")}`
              : "Click Zalo, Gọi, Form..."
          }
          color="#ec4899"
        />
      </div>

      {/* Daily Trend Chart */}
      <div className="card gsc-trend-card">
        <div className="gsc-trend-title">
          <strong>📊 Xu hướng {days} ngày qua</strong>
          {channel !== "all" && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#6366f1", fontWeight: 600 }}>
              · Kênh: {channel}
            </span>
          )}
          {trend.length === 0 && !loading && (
            <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 12 }}>Không có dữ liệu</span>
          )}
        </div>
        {loading ? (
          <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span className="loader" style={{ width: 24, height: 24 }} />
          </div>
        ) : (
          <TrendChart data={trend} />
        )}
      </div>

      {/* Main Data Card: Events | Pages | Channels */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="gsc-table-tabs" style={{ flexWrap: "wrap", gap: 4 }}>
          <button
            className={`gsc-table-tab${activeTab === "events" ? " active" : ""}`}
            onClick={() => setActiveTab("events")}
          >
            🎯 Sự kiện: Tên sự kiện{" "}
            {allEvents.length > 0 && <span className="gsc-tab-count">{allEvents.length}</span>}
          </button>
          <button
            className={`gsc-table-tab${activeTab === "pages" ? " active" : ""}`}
            onClick={() => setActiveTab("pages")}
          >
            📄 Trang & màn hình{" "}
            {pages.length > 0 && <span className="gsc-tab-count">{pages.length}</span>}
          </button>
          <button
            className={`gsc-table-tab${activeTab === "channels" ? " active" : ""}`}
            onClick={() => setActiveTab("channels")}
          >
            🌐 Nguồn lưu lượng & Thiết bị{" "}
            {channels.length > 0 && <span className="gsc-tab-count">{channels.length}</span>}
          </button>
        </div>

        {/* ─── TAB 1: EVENTS (Sự kiện: Tên sự kiện) ─── */}
        {activeTab === "events" && (
          <>
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                background: "var(--bg-surface)",
              }}
            >
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className={`gsc-days-pill${eventFilterMode === "all" ? " active" : ""}`}
                  onClick={() => setEventFilterMode("all")}
                >
                  📋 Tất cả sự kiện ({allEvents.length})
                </button>
                <button
                  className={`gsc-days-pill${eventFilterMode === "custom" ? " active" : ""}`}
                  onClick={() => setEventFilterMode("custom")}
                >
                  🔥 Chỉ Sự kiện Chuyển đổi / Riêng ({customOnlyCount})
                </button>
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 4 }}>
                  💡 Bấm vào tên sự kiện bất kỳ để xem bài viết / URL nào kích hoạt sự kiện đó.
                </span>
              </div>

              <input
                type="text"
                className="input-field"
                placeholder="🔍 Tìm tên sự kiện (VD: click_zalo, hotline...)"
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
                style={{ width: 270, padding: "6px 10px", fontSize: 12.5 }}
              />
            </div>

            <table className="data-table gsc-table">
              <thead>
                <tr>
                  <th style={{ width: 44, textAlign: "center" }}>#</th>
                  <th>Tên sự kiện</th>
                  <th style={{ width: 170, textAlign: "right" }}>Số lượng sự kiện</th>
                  <th style={{ width: 170, textAlign: "right" }}>Tổng người dùng</th>
                  <th style={{ width: 135, textAlign: "right" }}>Sự kiện / người dùng</th>
                  <th style={{ width: 130, textAlign: "right" }}>Tổng doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {tableLoading ? (
                  <SkeletonRows count={10} cols={6} />
                ) : visibleEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                      {eventFilterMode === "custom"
                        ? "Chưa ghi nhận sự kiện chuyển đổi / tùy chỉnh nào trong khoảng thời gian này."
                        : "Chưa có dữ liệu sự kiện."}
                    </td>
                  </tr>
                ) : (
                  visibleEvents.map((ev, idx) => {
                    const isExpanded = expandedEvent === ev.eventName;
                    const drillKey = `${selectedProperty}:${days}:${channel}:${ev.eventName}`;
                    const drillPages = eventPagesMap[drillKey] || [];
                    const isLoadingDrill = eventPagesLoading === ev.eventName;

                    return (
                      <Fragment key={ev.eventName}>
                        <tr
                          onClick={() => handleToggleEventPages(ev.eventName)}
                          style={{
                            cursor: "pointer",
                            background: ev.isCustomOrLead
                              ? "rgba(16, 185, 129, 0.04)"
                              : undefined,
                          }}
                          title="Bấm để xem chi tiết các trang phát sinh sự kiện này"
                        >
                          <td style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                            {idx + 1}
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: 13.5,
                                  color: ev.isCustomOrLead ? "#6366f1" : "var(--text-primary)",
                                  textDecoration: "underline",
                                  textDecorationColor: "rgba(99,102,241,0.35)",
                                  textUnderlineOffset: 3,
                                }}
                              >
                                {ev.eventName}
                              </span>
                              <span
                                style={{
                                  ...categoryBadgeStyle(ev.category),
                                  fontSize: 10.5,
                                  fontWeight: 600,
                                  padding: "1px 7px",
                                  borderRadius: 999,
                                }}
                              >
                                {ev.categoryLabel}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {isExpanded ? "▲ Ẩn URL" : "▼ Xem URL"}
                              </span>
                            </div>
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13 }}>
                            {ev.eventCount.toLocaleString("vi-VN")}{" "}
                            <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--text-muted)" }}>
                              ({ev.eventSharePct}%)
                            </span>
                          </td>
                          <td style={{ textAlign: "right", fontSize: 13 }}>
                            {ev.totalUsers.toLocaleString("vi-VN")}{" "}
                            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                              ({ev.userSharePct}%)
                            </span>
                          </td>
                          <td style={{ textAlign: "right", fontSize: 13, fontWeight: 500 }}>
                            {ev.eventsPerUser.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ textAlign: "right", fontSize: 12.5, color: "var(--text-secondary)" }}>
                            {formatCurrency(ev.totalRevenue, eventsData.currencyCode)}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr>
                            <td
                              colSpan={6}
                              style={{
                                background: "var(--bg-surface)",
                                padding: "12px 20px",
                                borderBottom: "2px solid rgba(99,102,241,0.25)",
                              }}
                            >
                              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>
                                📍 Top trang / bài viết phát sinh sự kiện <code>{ev.eventName}</code>:
                              </div>
                              {isLoadingDrill ? (
                                <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 0" }}>
                                  ⏳ Đang tải chi tiết URL...
                                </div>
                              ) : drillPages.length === 0 ? (
                                <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "6px 0" }}>
                                  Không có dữ liệu đường dẫn chi tiết cho sự kiện này.
                                </div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {drillPages.slice(0, 12).map((dp, i) => (
                                    <div
                                      key={`${dp.pagePath}-${i}`}
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 12,
                                        padding: "6px 10px",
                                        borderRadius: 6,
                                        background: "var(--bg-card)",
                                        border: "1px solid var(--border-light)",
                                        fontSize: 12.5,
                                      }}
                                    >
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {dp.pageTitle || dp.pagePath}
                                        </div>
                                        <div style={{ fontSize: 11.5, color: "#6366f1", wordBreak: "break-all" }}>
                                          {dp.pagePath}
                                        </div>
                                      </div>
                                      <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
                                        <span>
                                          <strong>{dp.eventCount.toLocaleString("vi-VN")}</strong> lần
                                        </span>
                                        <span style={{ color: "var(--text-muted)" }}>
                                          <strong>{dp.totalUsers.toLocaleString("vi-VN")}</strong> người
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </>
        )}

        {/* ─── TAB 2: PAGES (Trang & màn hình) ─── */}
        {activeTab === "pages" && (
          <table className="data-table gsc-table">
            <thead>
              <tr>
                <th>Trang / Bài viết</th>
                <th style={{ width: 100, textAlign: "right" }}>Lượt xem</th>
                <th style={{ width: 100, textAlign: "right" }}>Người dùng</th>
                <th style={{ width: 95, textAlign: "right" }}>Phiên</th>
                <th style={{ width: 110, textAlign: "right" }}>Tương tác</th>
                <th style={{ width: 105, textAlign: "right" }}>Thời gian TB</th>
                <th style={{ width: 105, textAlign: "right" }}>Tổng sự kiện</th>
              </tr>
            </thead>
            <tbody>
              {tableLoading ? (
                <SkeletonRows count={10} cols={7} />
              ) : pages.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                    Chưa có dữ liệu trang.
                  </td>
                </tr>
              ) : (
                pages.map((p, i) => (
                  <tr key={`${p.pagePath}-${i}`}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
                        {p.pageTitle || p.pagePath}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#6366f1", wordBreak: "break-all" }}>
                        {p.pagePath}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{p.pageviews.toLocaleString("vi-VN")}</td>
                    <td style={{ textAlign: "right" }}>{p.users.toLocaleString("vi-VN")}</td>
                    <td style={{ textAlign: "right" }}>{p.sessions.toLocaleString("vi-VN")}</td>
                    <td style={{ textAlign: "right", color: "#10b981", fontWeight: 600 }}>{p.engagementRate}%</td>
                    <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{formatDuration(p.avgDuration)}</td>
                    <td style={{ textAlign: "right" }}>{p.events.toLocaleString("vi-VN")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* ─── TAB 3: CHANNELS & DEVICES ─── */}
        {activeTab === "channels" && (
          <div style={{ padding: 16 }}>
            {devices.length > 0 && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                {devices.map((d) => {
                  const icon =
                    d.device === "mobile" ? "📱" : d.device === "desktop" ? "💻" : "📟";
                  return (
                    <div
                      key={d.device}
                      style={{
                        flex: "1 1 180px",
                        padding: "12px 16px",
                        borderRadius: 10,
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-light)",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "capitalize" }}>
                        {icon} Thiết bị: <strong>{d.device}</strong>
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
                        {d.sessions.toLocaleString("vi-VN")}{" "}
                        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
                          phiên ({d.users.toLocaleString("vi-VN")} user)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <table className="data-table gsc-table">
              <thead>
                <tr>
                  <th>Nhóm kênh mặc định (Channel Group)</th>
                  <th style={{ width: 120, textAlign: "right" }}>Phiên (Sessions)</th>
                  <th style={{ width: 120, textAlign: "right" }}>Người dùng</th>
                  <th style={{ width: 125, textAlign: "right" }}>Tỷ lệ tương tác</th>
                  <th style={{ width: 130, textAlign: "right" }}>Tổng sự kiện</th>
                  <th style={{ width: 130, textAlign: "right" }}>Key Events</th>
                </tr>
              </thead>
              <tbody>
                {channels.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                      Chưa có dữ liệu nguồn kênh.
                    </td>
                  </tr>
                ) : (
                  channels.map((c) => (
                    <tr key={c.channel}>
                      <td style={{ fontWeight: 600 }}>{c.channel}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{c.sessions.toLocaleString("vi-VN")}</td>
                      <td style={{ textAlign: "right" }}>{c.users.toLocaleString("vi-VN")}</td>
                      <td style={{ textAlign: "right", color: "#10b981", fontWeight: 600 }}>{c.engagementRate}%</td>
                      <td style={{ textAlign: "right" }}>{c.events.toLocaleString("vi-VN")}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{c.keyEvents.toLocaleString("vi-VN")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
