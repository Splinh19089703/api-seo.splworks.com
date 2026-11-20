import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api";

// =====================================================================
// Sub-components
// =====================================================================

/** Stat card tổng quan */
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

/** Skeleton row */
function SkeletonRows({ count = 6, cols = 5 }) {
  return Array.from({ length: count }).map((_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j}><div className="skeleton" style={{ height: 14, borderRadius: 4, width: j === 0 ? "70%" : "50%" }} /></td>
      ))}
    </tr>
  ));
}

/** CTR badge color */
function ctrColor(ctr) {
  if (ctr >= 5) return "#10b981";
  if (ctr >= 2) return "#f59e0b";
  return "#6b7280";
}

/** Position badge color */
function posColor(pos) {
  if (pos <= 3) return "#10b981";
  if (pos <= 10) return "#6366f1";
  if (pos <= 20) return "#f59e0b";
  return "#ef4444";
}

function mapCallbackError(msg) {
  if (msg === "missing_scope") {
    return {
      message:
        "Bạn chưa tích chọn ô cấp quyền Google Search Console ở màn hình đăng nhập Google. Vui lòng bấm 'Cấp lại quyền Google' và tích chọn đầy đủ quyền.",
      code: "GSC_MISSING_SCOPE",
    };
  }
  if (msg === "access_denied") {
    return {
      message: "Bạn đã hủy cấp quyền trên màn hình Google OAuth.",
      code: "GSC_ACCESS_DENIED",
    };
  }
  return {
    message: `Kết nối GSC thất bại: ${msg || "lỗi không xác định"}`,
    code: "GSC_CALLBACK_ERROR",
  };
}

// =====================================================================
// Main component
// =====================================================================

const DAYS_OPTIONS = [7, 14, 28, 90];

export default function GSC() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Connection state
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [authUrl, setAuthUrl] = useState("");
  const [reconnecting, setReconnecting] = useState(false);

  // Sites
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [selectedSite, setSelectedSite] = useState("");

  // Data
  const [days, setDays] = useState(28);
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null); // { message, code, actionUrl, detail }

  // Dashboard totals
  const [totals, setTotals] = useState(null);

  // Trend
  const [trend, setTrend] = useState([]);

  // Tables
  const [activeTab, setActiveTab] = useState("queries"); // queries | pages
  const [queries, setQueries] = useState([]);
  const [pages, setPages] = useState([]);
  const [tableLoading, setTableLoading] = useState(false);

  // Import to Keyword Planner
  const [importing, setImporting] = useState(false);

  // Cache clearing loading state
  const [cacheClearing, setCacheClearing] = useState(false);

  // Mounted ref to prevent setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const setErrorFromException = (prefix, e) => {
    const rawMsg = e?.message || "Lỗi không xác định";
    // Tránh lặp tiền tố nếu thông báo từ server đã đầy đủ nghĩa tiếng Việt
    const cleanMsg =
      e?.code === "GSC_API_DISABLED" ||
      e?.code === "GSC_MISSING_SCOPE" ||
      e?.code === "GSC_TOKEN_EXPIRED"
        ? rawMsg
        : `${prefix}: ${rawMsg}`;
    setErrorInfo({
      message: cleanMsg,
      code: e?.code || "",
      actionUrl: e?.actionUrl || "",
      detail: e?.detail || "",
    });
  };

  // =====================================================================
  // Init — Check connection status + handle OAuth callback (1 lần duy nhất)
  // =====================================================================

  useEffect(() => {
    const gscParam = searchParams.get("gsc");
    const msgParam = searchParams.get("msg");

    if (gscParam === "error") {
      setErrorInfo(mapCallbackError(msgParam));
      navigate("/gsc", { replace: true });
    } else if (gscParam === "success") {
      setErrorInfo(null);
      navigate("/gsc", { replace: true });
    }

    checkStatus(gscParam === "success");
  }, []);

  const checkStatus = async (forceRefreshSites = false) => {
    setAuthLoading(true);
    try {
      const status = await api.gscStatus();
      if (!mountedRef.current) return;
      setConnected(status.connected);
      setEmail(status.email || "");
      if (status.connected) {
        if (status.missingScope) {
          setErrorInfo({
            message:
              "Tài khoản Google chưa cấp quyền đọc dữ liệu Search Console. Vui lòng bấm 'Cấp lại quyền Google' và tích chọn ô quyền Search Console.",
            code: "GSC_MISSING_SCOPE",
          });
        } else {
          await loadSites(forceRefreshSites);
        }
      } else {
        try {
          const { url } = await api.gscAuthUrl();
          if (mountedRef.current) setAuthUrl(url);
        } catch {}
      }
    } catch {
      if (mountedRef.current) setConnected(false);
    } finally {
      if (mountedRef.current) setAuthLoading(false);
    }
  };

  const loadSites = async (forceRefresh = false) => {
    setSitesLoading(true);
    try {
      const data = await api.get(forceRefresh ? "/gsc/sites?refresh=1" : "/gsc/sites");
      if (!mountedRef.current) return;
      const list = data?.sites || [];
      setSites(list);
      setErrorInfo(null);
      if (list.length > 0) {
        setSelectedSite((prev) =>
          prev && list.some((s) => s.siteUrl === prev) ? prev : list[0].siteUrl
        );
      }
    } catch (e) {
      if (mountedRef.current) {
        setErrorFromException("Không thể tải danh sách sites", e);
      }
    } finally {
      if (mountedRef.current) setSitesLoading(false);
    }
  };

  // =====================================================================
  // Load data when site or days changes
  // =====================================================================

  useEffect(() => {
    if (connected && selectedSite) {
      loadDashboard();
    }
  }, [connected, selectedSite, days]);

  const loadDashboard = useCallback(async () => {
    if (!selectedSite) return;
    setLoading(true);
    setErrorInfo(null);
    setTotals(null);
    setTrend([]);

    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

    try {
      // Load dimensionless accurate totals + daily trend in parallel
      const [summaryRes, trendRes] = await Promise.allSettled([
        api.gscData({ siteUrl: selectedSite, startDate, endDate, dimensions: [], rowLimit: 1 }),
        api.gscTrend({ siteUrl: selectedSite, days }),
      ]);

      if (!mountedRef.current) return;
      if (summaryRes.status === "fulfilled") {
        setTotals(summaryRes.value.totals);
      } else if (summaryRes.reason) {
        setErrorFromException("Lỗi tải tổng quan", summaryRes.reason);
      }
      if (trendRes.status === "fulfilled") {
        setTrend(trendRes.value.trend || []);
      }
    } catch (e) {
      if (mountedRef.current) setErrorFromException("Lỗi tải dữ liệu", e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }

    loadTable(activeTab);
  }, [selectedSite, days, activeTab]);

  const loadTable = async (tab) => {
    if (!selectedSite) return;
    setTableLoading(true);
    try {
      if (tab === "queries") {
        const { queries: q } = await api.gscTopQueries({ siteUrl: selectedSite, days, limit: 100 });
        if (mountedRef.current) setQueries(q || []);
      } else {
        const { pages: p } = await api.gscTopPages({ siteUrl: selectedSite, days, limit: 100 });
        if (mountedRef.current) setPages(p || []);
      }
    } catch (e) {
      if (mountedRef.current) setErrorFromException("Lỗi tải bảng", e);
    } finally {
      if (mountedRef.current) setTableLoading(false);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    loadTable(tab);
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
      const { url } = await api.gscAuthUrl();
      if (url) window.location.href = url;
    } catch (e) {
      setErrorFromException("Không tạo được link kết nối Google", e);
      setReconnecting(false);
    }
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const { url } = await api.gscAuthUrl();
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
    if (!window.confirm("Ngắt kết nối GSC? Toàn bộ cache và token sẽ bị xóa.")) return;
    try {
      await api.gscDisconnect();
      setConnected(false);
      setEmail("");
      setSites([]);
      setSelectedSite("");
      setTotals(null);
      setTrend([]);
      setQueries([]);
      setPages([]);
      setErrorInfo(null);
      try {
        const { url } = await api.gscAuthUrl();
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
      await api.gscClearCache();
      if (sites.length === 0) {
        await loadSites(true);
      } else {
        await loadDashboard();
      }
    } catch (e) {
      setErrorFromException("Xóa cache thất bại", e);
    } finally {
      if (mountedRef.current) setCacheClearing(false);
    }
  };

  // =====================================================================
  // Import to Keyword Planner
  // =====================================================================

  const handleImportToKW = async () => {
    if (!queries.length) return;
    setImporting(true);
    try {
      const kwList = queries.slice(0, 50).map((q) => ({
        keyword: q.query,
        type: "main",
        volume: Math.round(q.impressions / 30),
        _note: "estimated",
        kd: 0,
        cpc: 0,
        intent: "informational",
        wordCount: q.query.split(/\s+/).length,
        source: "gsc",
        trend: [],
      }));
      sessionStorage.setItem("gsc_import_kw", JSON.stringify(kwList));
      sessionStorage.setItem("gsc_import_site", selectedSite);
      navigate("/keyword-planner?from=gsc");
    } finally {
      setImporting(false);
    }
  };

  // =====================================================================
  // Error Banner Renderer
  // =====================================================================
  const renderErrorBanner = () => {
    if (!errorInfo) return null;
    const isApiDisabled = errorInfo.code === "GSC_API_DISABLED";
    const needsReauth =
      errorInfo.code === "GSC_MISSING_SCOPE" || errorInfo.code === "GSC_TOKEN_EXPIRED";

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
                🔗 Mở Google Cloud bật Search Console API
              </a>
            )}
            <button
              className="btn btn-sm"
              onClick={() => loadSites(true)}
              disabled={sitesLoading}
            >
              {sitesLoading ? "⏳ Đang kiểm tra..." : "🔄 Đã bật xong — Tải lại danh sách site"}
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
              {reconnecting ? "⏳ Đang chuyển hướng..." : "🔑 Cấp lại quyền Google Search Console"}
            </button>
          </div>
        )}
        {!isApiDisabled && !needsReauth && connected && (
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={() => (sites.length === 0 ? loadSites(true) : loadDashboard())}
              disabled={sitesLoading || loading}
            >
              🔄 Thử tải lại
            </button>
            <button
              className="btn btn-sm"
              onClick={handleReconnect}
              disabled={reconnecting}
            >
              🔑 Kết nối lại Google
            </button>
          </div>
        )}
      </div>
    );
  };

  // =====================================================================
  // Trend chart (simple SVG)
  // =====================================================================
  const TrendChart = ({ data }) => {
    if (!data || data.length === 0) return null;
    const clicks = data.map((d) => d.clicks);
    const impressions = data.map((d) => d.impressions);
    const maxImpr = Math.max(...impressions, 1);
    const maxClicks = Math.max(...clicks, 1);
    const W = 600, H = 120;
    const xStep = W / (data.length - 1 || 1);

    const pts = (arr, maxVal) =>
      arr
        .map((v, i) => `${i * xStep},${H - 8 - ((v / maxVal) * (H - 16))}`)
        .join(" ");

    return (
      <div className="gsc-trend-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 120 }}>
          {[0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t} x1={0} x2={W} y1={H - 8 - t * (H - 16)} y2={H - 8 - t * (H - 16)} stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
          ))}
          <polyline fill="none" stroke="rgba(99,102,241,0.35)" strokeWidth="1.5" points={pts(impressions, maxImpr)} />
          <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={pts(clicks, maxClicks)} />
        </svg>
        <div className="gsc-trend-labels">
          {data.filter((_, i) => i % Math.ceil(data.length / 7) === 0).map((d) => (
            <span key={d.date} style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.date.slice(5)}</span>
          ))}
        </div>
        <div className="gsc-trend-legend">
          <span><span style={{ color: "#6366f1", fontWeight: 700 }}>—</span> Clicks</span>
          <span><span style={{ color: "rgba(99,102,241,0.45)", fontWeight: 700 }}>—</span> Impressions</span>
        </div>
      </div>
    );
  };

  // =====================================================================
  // Render
  // =====================================================================

  if (authLoading) {
    return (
      <div className="page-container" style={{ textAlign: "center", paddingTop: 80 }}>
        <span className="loader" />
        <p style={{ marginTop: 16, color: "var(--text-muted)" }}>Đang kiểm tra kết nối GSC...</p>
      </div>
    );
  }

  // ─── Not connected ───────────────────────────────────────────────────
  if (!connected) {
    return (
      <div className="page-container">
        <h1 style={{ margin: "0 0 4px" }}>📈 Google Search Console</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 32 }}>
          Kết nối GSC để xem clicks, impressions, top keywords và top pages ngay trong SPLSEO.
        </p>

        {renderErrorBanner()}

        <div className="gsc-connect-card card">
          <div className="gsc-connect-icon">📈</div>
          <h2>Kết nối Google Search Console</h2>
          <p style={{ color: "var(--text-muted)", maxWidth: 480, margin: "0 auto 24px" }}>
            Sau khi kết nối, bạn có thể xem dữ liệu SEO thực tế: clicks, impressions, CTR,
            vị trí trung bình, top keywords và top pages trong cùng một giao diện.
          </p>
          <div className="gsc-features-preview">
            {[
              ["📊", "Clicks & Impressions", "Trend 28 ngày"],
              ["🔍", "Top Keywords", "100 từ khóa hàng đầu"],
              ["📄", "Top Pages", "Trang có hiệu suất tốt nhất"],
              ["📥", "Import vào KW Planner", "1-click chuyển sang nghiên cứu"],
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
              ⚠️ Chưa cấu hình Google OAuth. Vui lòng thêm{" "}
              <code style={{ background: "var(--bg-muted)", padding: "1px 6px", borderRadius: 4 }}>
                GOOGLE_CLIENT_ID
              </code>{" "}
              và{" "}
              <code style={{ background: "var(--bg-muted)", padding: "1px 6px", borderRadius: 4 }}>
                GOOGLE_CLIENT_SECRET
              </code>{" "}
              vào file <code>.env</code> của server.
            </div>
          ) : (
            <button className="btn btn-primary gsc-connect-btn" onClick={handleConnect} disabled={reconnecting}>
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                style={{ width: 18, height: 18 }}
              />
              {reconnecting ? "Đang chuyển hướng..." : "Kết nối với Google"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Connected ────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      {/* Header */}
      <div className="gsc-header">
        <div>
          <h1 style={{ margin: "0 0 4px" }}>📈 Google Search Console</h1>
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: 13 }}>
            ✅ Đã kết nối: <strong>{email}</strong>
          </p>
        </div>
        <div className="gsc-header-actions">
          {/* Site selector */}
          {sites.length > 0 && (
            <select
              className="select-field"
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
              style={{ minWidth: 240 }}
            >
              {sites.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl.replace(/^https?:\/\//, "")}
                </option>
              ))}
            </select>
          )}
          {/* Days selector */}
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
            onClick={handleClearCache}
            disabled={cacheClearing || sitesLoading}
            title="Xóa cache, tải lại dữ liệu"
          >
            {cacheClearing || sitesLoading ? "⏳" : "🔄"}
          </button>
          <button className="btn btn-sm" style={{ color: "#ef4444" }} onClick={handleDisconnect}>
            Ngắt kết nối
          </button>
        </div>
      </div>

      {renderErrorBanner()}

      {!errorInfo && !sitesLoading && sites.length === 0 && (
        <div
          className="card"
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.3)",
            padding: "14px 16px",
            marginBottom: 16,
            fontSize: 13.5,
          }}
        >
          ⚠️ Tài khoản <strong>{email}</strong> hiện chưa có website nào được xác minh trong{" "}
          <a
            href="https://search.google.com/search-console"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#6366f1", fontWeight: 600 }}
          >
            Google Search Console
          </a>
          . Hãy thêm property trên Search Console hoặc bấm <strong>Ngắt kết nối</strong> để chuyển sang Gmail khác.
        </div>
      )}

      {/* Stat Cards */}
      <div className="gsc-stats-row">
        <StatCard
          icon="👆"
          label="Clicks"
          value={loading ? "…" : totals?.clicks?.toLocaleString()}
          sub={`${days} ngày qua`}
          color="#6366f1"
        />
        <StatCard
          icon="👁️"
          label="Impressions"
          value={loading ? "…" : totals?.impressions?.toLocaleString()}
          sub={`${days} ngày qua`}
          color="#3b82f6"
        />
        <StatCard
          icon="🎯"
          label="CTR trung bình"
          value={loading ? "…" : totals?.avgCtr != null ? `${totals.avgCtr}%` : "—"}
          color="#10b981"
        />
        <StatCard
          icon="📍"
          label="Vị trí trung bình"
          value={loading ? "…" : totals?.avgPosition ?? "—"}
          color="#f59e0b"
        />
      </div>

      {/* Trend Chart */}
      <div className="card gsc-trend-card">
        <div className="gsc-trend-title">
          <strong>📊 Trend {days} ngày</strong>
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

      {/* Table — Top Queries / Top Pages */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="gsc-table-tabs">
          <button
            className={`gsc-table-tab${activeTab === "queries" ? " active" : ""}`}
            onClick={() => handleTabChange("queries")}
          >
            🔍 Top Keywords {queries.length > 0 && <span className="gsc-tab-count">{queries.length}</span>}
          </button>
          <button
            className={`gsc-table-tab${activeTab === "pages" ? " active" : ""}`}
            onClick={() => handleTabChange("pages")}
          >
            📄 Top Pages {pages.length > 0 && <span className="gsc-tab-count">{pages.length}</span>}
          </button>
          {activeTab === "queries" && queries.length > 0 && (
            <button
              className="btn btn-sm"
              style={{ marginLeft: "auto", marginRight: 12, fontSize: 12 }}
              onClick={handleImportToKW}
              disabled={importing}
            >
              {importing ? "⏳ Đang import..." : "📥 Import vào Keyword Planner"}
            </button>
          )}
        </div>

        <table className="data-table gsc-table">
          <thead>
            <tr>
              <th>{activeTab === "queries" ? "Từ khóa" : "URL"}</th>
              <th style={{ width: 90, textAlign: "right" }}>Clicks</th>
              <th style={{ width: 110, textAlign: "right" }}>Impressions</th>
              <th style={{ width: 80, textAlign: "right" }}>CTR</th>
              <th style={{ width: 90, textAlign: "right" }}>Vị trí</th>
            </tr>
          </thead>
          <tbody>
            {tableLoading ? (
              <SkeletonRows count={10} cols={5} />
            ) : activeTab === "queries" ? (
              queries.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Chưa có dữ liệu</td></tr>
              ) : (
                queries.map((q, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{q.query}</span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600, fontSize: 13 }}>{q.clicks.toLocaleString()}</td>
                    <td style={{ textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>{q.impressions.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ color: ctrColor(q.ctr), fontWeight: 600, fontSize: 12 }}>{q.ctr}%</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ color: posColor(q.position), fontWeight: 600, fontSize: 13 }}>{q.position}</span>
                    </td>
                  </tr>
                ))
              )
            ) : (
              pages.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Chưa có dữ liệu</td></tr>
              ) : (
                pages.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <a
                        href={p.page}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--accent-primary, #6366f1)", fontSize: 12, textDecoration: "none", wordBreak: "break-all" }}
                      >
                        {p.page.replace(/^https?:\/\/[^/]+/, "") || "/"}
                      </a>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600, fontSize: 13 }}>{p.clicks.toLocaleString()}</td>
                    <td style={{ textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>{p.impressions.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ color: ctrColor(p.ctr), fontWeight: 600, fontSize: 12 }}>{p.ctr}%</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ color: posColor(p.position), fontWeight: 600, fontSize: 13 }}>{p.position}</span>
                    </td>
                  </tr>
                ))
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
