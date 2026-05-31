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

/** Mini sparkline SVG */
function Sparkline({ data, width = 80, height = 24, color = "#6366f1" }) {
  if (!data || data.length < 2) return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / range) * (height - 4)}`)
    .join(" ");
  return (
    <svg width={width} height={height}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
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

  // Sites
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState("");

  // Data
  const [days, setDays] = useState(28);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  // =====================================================================
  // Init — Check connection status + handle OAuth callback
  // =====================================================================

  useEffect(() => {
    checkStatus();
    // Handle OAuth callback result
    const gscParam = searchParams.get("gsc");
    if (gscParam === "success") {
      setError("");
      checkStatus();
    } else if (gscParam === "error") {
      setError(`Kết nối GSC thất bại: ${searchParams.get("msg") || "lỗi không xác định"}`);
    }
  }, []);

  const checkStatus = async () => {
    setAuthLoading(true);
    try {
      const status = await api.gscStatus();
      setConnected(status.connected);
      setEmail(status.email || "");
      if (status.connected) {
        loadSites();
      } else {
        // Pre-fetch auth URL
        try {
          const { url } = await api.gscAuthUrl();
          setAuthUrl(url);
        } catch {}
      }
    } catch {
      setConnected(false);
    } finally {
      setAuthLoading(false);
    }
  };

  const loadSites = async () => {
    try {
      const { sites } = await api.gscSites();
      setSites(sites || []);
      if (sites && sites.length > 0 && !selectedSite) {
        setSelectedSite(sites[0].siteUrl);
      }
    } catch (e) {
      setError("Không thể tải danh sách sites: " + e.message);
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
    setError("");
    setTotals(null);
    setTrend([]);

    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

    try {
      // Load summary + trend parallel
      const [summaryRes, trendRes] = await Promise.allSettled([
        api.gscData({ siteUrl: selectedSite, startDate, endDate, dimensions: ["date"], rowLimit: days }),
        api.gscTrend({ siteUrl: selectedSite, days }),
      ]);

      if (!mountedRef.current) return;
      if (summaryRes.status === "fulfilled") {
        setTotals(summaryRes.value.totals);
      }
      if (trendRes.status === "fulfilled") {
        setTrend(trendRes.value.trend || []);
      }
    } catch (e) {
      if (mountedRef.current) setError("Lỗi tải dữ liệu: " + e.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }

    // Load table data
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
      if (mountedRef.current) setError("Lỗi tải bảng: " + e.message);
    } finally {
      if (mountedRef.current) setTableLoading(false);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    loadTable(tab);
  };

  // =====================================================================
  // Connect / Disconnect
  // =====================================================================

  const handleConnect = () => {
    if (authUrl) window.location.href = authUrl;
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
    } catch (e) {
      setError("Ngắt kết nối thất bại: " + e.message);
    }
  };

  const handleClearCache = async () => {
    if (cacheClearing) return;
    setCacheClearing(true);
    try {
      await api.gscClearCache();
      loadDashboard();
    } catch (e) {
      setError("Xóa cache thất bại: " + e.message);
    } finally {
      setCacheClearing(false);
    }
  };

  // =====================================================================
  // Import to Keyword Planner
  // =====================================================================

  const handleImportToKW = async () => {
    if (!queries.length) return;
    setImporting(true);
    try {
      // Chuyển GSC queries sang format Keyword Planner
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
      // Store in sessionStorage to pass to Keyword Planner
      sessionStorage.setItem("gsc_import_kw", JSON.stringify(kwList));
      sessionStorage.setItem("gsc_import_site", selectedSite);
      // Navigate đúng với BrowserRouter
      navigate("/keyword-planner?from=gsc");
    } finally {
      setImporting(false);
    }
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
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t} x1={0} x2={W} y1={H - 8 - t * (H - 16)} y2={H - 8 - t * (H - 16)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          ))}
          {/* Impressions line (muted) */}
          <polyline fill="none" stroke="rgba(99,102,241,0.3)" strokeWidth="1.5" points={pts(impressions, maxImpr)} />
          {/* Clicks line (vivid) */}
          <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={pts(clicks, maxClicks)} />
        </svg>
        <div className="gsc-trend-labels">
          {data.filter((_, i) => i % Math.ceil(data.length / 7) === 0).map((d) => (
            <span key={d.date} style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.date.slice(5)}</span>
          ))}
        </div>
        <div className="gsc-trend-legend">
          <span><span style={{ color: "#6366f1", fontWeight: 700 }}>—</span> Clicks</span>
          <span><span style={{ color: "rgba(99,102,241,0.4)", fontWeight: 700 }}>—</span> Impressions</span>
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

        {error && (
          <div className="card" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: 16, marginBottom: 20 }}>
            <p style={{ color: "#ef4444", margin: 0 }}>❌ {error}</p>
          </div>
        )}

        <div className="gsc-connect-card card">
          <div className="gsc-connect-icon">📈</div>
          <h2>Kết nối Google Search Console</h2>
          <p style={{ color: "var(--text-muted)", maxWidth: 480, margin: "0 auto 24px" }}>
            Sau khi kết nối, bạn có thể xem dữ liệu SEO thực tế: clicks, impressions, CTR,
            vị trí trung bình, top keywords và top pages — tất cả trong 1 giao diện.
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
            <button className="btn btn-primary gsc-connect-btn" onClick={handleConnect}>
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                style={{ width: 18, height: 18 }}
              />
              Kết nối với Google
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
          <button className="btn btn-sm" onClick={handleClearCache} disabled={cacheClearing} title="Xóa cache, tải lại data">
            {cacheClearing ? "⏳" : "🔄"}
          </button>
          <button className="btn btn-sm" style={{ color: "#ef4444" }} onClick={handleDisconnect}>
            Ngắt kết nối
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: 12, marginBottom: 16 }}>
          <p style={{ color: "#ef4444", margin: 0, fontSize: 13 }}>❌ {error}</p>
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
        {/* Tab bar */}
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
