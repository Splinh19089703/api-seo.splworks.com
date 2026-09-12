import { useState, useMemo, useEffect } from "react";
import { api } from "../api";
import AddToProjectModal from "../components/AddToProjectModal";

const PAGE_SIZE = 20;

const keywordKey = (kw) => `${kw.keyword || ""}`.toLowerCase().trim().replace(/\s+/g, " ");

const TYPE_MAP = {
  main:     { label: "Chính",     color: "#6366f1" },
  related:  { label: "Liên quan", color: "#3b82f6" },
  expanded: { label: "Mở rộng",  color: "#10b981" },
  lsi:      { label: "LSI",      color: "#f59e0b" },
};

const INTENT_MAP = {
  informational: { label: "Thông tin", icon: "ℹ️" },
  commercial:    { label: "Thương mại", icon: "💰" },
  transactional: { label: "Giao dịch", icon: "🛒" },
  navigational:  { label: "Điều hướng", icon: "🔗" },
  local:         { label: "Địa phương", icon: "📍" },
};

const COUNTRY_OPTIONS = {
  vn: { label: "🇻🇳 Việt Nam", shortLabel: "VN", language: "vi" },
  us: { label: "🇺🇸 Hoa Kỳ", shortLabel: "US", language: "en" },
  sg: { label: "🇸🇬 Singapore", shortLabel: "SG", language: "en" },
};

// Sparkline renderer (simple SVG) — module scope, không remount mỗi render
function Sparkline({ data, width = 80, height = 20 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 2) - 1}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline fill="none" stroke="#6366f1" strokeWidth="1.5" points={points} />
    </svg>
  );
}

export default function KeywordPlanner() {
  // Input
  const [seedKeyword, setSeedKeyword] = useState("");
  const [niche, setNiche] = useState("");
  const [country, setCountry] = useState("vn");

  // Results
  const [keywords, setKeywords] = useState([]);
  const [stats, setStats] = useState(null);
  const [metricNotice, setMetricNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [volumeMin, setVolumeMin] = useState("");
  const [volumeMax, setVolumeMax] = useState("");
  const [kdMax, setKdMax] = useState("");
  const [intentFilter, setIntentFilter] = useState("all");
  const [sortBy, setSortBy] = useState("volume");
  const [sortDir, setSortDir] = useState("desc");

  // Selection
  const [selected, setSelected] = useState(new Set());

  // Pagination
  const [page, setPage] = useState(1);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  // Project picker for "Add to project"
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projects, setProjects] = useState([]);

  // ===========================
  // Research
  // ===========================

  const handleResearch = async () => {
    if (!seedKeyword.trim()) return;
    setLoading(true);
    setError("");
    setKeywords([]);
    setStats(null);
    setMetricNotice("");
    setSelected(new Set());
    setPage(1);

    try {
      const result = await api.kwResearch({
        keyword: seedKeyword.trim(),
        language: COUNTRY_OPTIONS[country]?.language || "vi",
        country,
        niche: niche.trim(),
      });
      setKeywords(result.keywords || []);
      setStats(result.stats || null);
      setMetricNotice(result.metricNotice || "");
    } catch (err) {
      setError(err.message || "Lỗi khi phân tích từ khóa");
    }
    setLoading(false);
  };

  // ===========================
  // Filtering & Sorting
  // ===========================

  // Reset page khi filter thay đổi
  useEffect(() => { setPage(1); }, [keywords, typeFilter, intentFilter, volumeMin, volumeMax, kdMax, sortBy, sortDir]);

  // Nhận keyword import từ GSC (sessionStorage handoff — lưu ý ở GSC.jsx trước khi navigate)
  useEffect(() => {
    const imported = sessionStorage.getItem("gsc_import_kw");
    if (imported) {
      try {
        const kwList = JSON.parse(imported);
        if (Array.isArray(kwList) && kwList.length > 0) {
          const avgVolume = Math.round(kwList.reduce((s, k) => s + (k.volume || 0), 0) / kwList.length);
          setKeywords(kwList);
          setStats({ total: kwList.length, avgVolume, avgKd: 0, byType: { main: kwList.length }, source: "Google Search Console" });
          setMetricNotice(`Đã nhập ${kwList.length} từ khóa từ Google Search Console (lượt tìm ước tính từ impressions).`);
          setPage(1);
          setSelected(new Set());
        }
      } catch { /* bỏ qua JSON hỏng */ }
      sessionStorage.removeItem("gsc_import_kw");
      sessionStorage.removeItem("gsc_import_site");
    }
  }, []);

  const filtered = useMemo(() => {
    let list = [...keywords];

    if (typeFilter !== "all") list = list.filter(k => k.type === typeFilter);
    if (intentFilter !== "all") list = list.filter(k => k.intent === intentFilter);
    if (volumeMin) list = list.filter(k => k.volume >= Number(volumeMin));
    if (volumeMax) list = list.filter(k => k.volume <= Number(volumeMax));
    if (kdMax) list = list.filter(k => k.kd <= Number(kdMax));

    list.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortBy === "keyword") return dir * a.keyword.localeCompare(b.keyword);
      return dir * ((a[sortBy] || 0) - (b[sortBy] || 0));
    });

    return list;
  }, [keywords, typeFilter, intentFilter, volumeMin, volumeMax, kdMax, sortBy, sortDir]);

  // ===========================
  // Selection
  // ===========================

  const toggleSelect = (kw) => {
    const key = keywordKey(kw);
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    const filteredKeys = filtered.map(keywordKey);
    const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((key) => selected.has(key));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredKeys.forEach((key) => next.delete(key));
      } else {
        filteredKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  };

  const selectedKeywords = useMemo(
    () => keywords.filter((kw) => selected.has(keywordKey(kw))),
    [keywords, selected]
  );

  // Paged data
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pagedData = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // ===========================
  // Actions
  // ===========================

  const handleExport = async () => {
    const toExport = selected.size > 0 ? selectedKeywords : filtered;
    if (!toExport.length) return;
    setExporting(true);
    setExportError("");
    try {
      const safeName = seedKeyword.trim() ? `kw-${seedKeyword.trim().replace(/\s+/g, "-")}` : "keyword-research";
      await api.kwExport(toExport, safeName);
    } catch (err) {
      setExportError(err.message || "Export thất bại, thử lại.");
    } finally {
      setExporting(false);
    }
  };

  const handleAddToProject = async () => {
    if (selectedKeywords.length === 0) return;
    if (!projects.length) {
      try {
        const p = await api.getProjects();
        setProjects(p);
      } catch {}
    }
    setShowProjectPicker(true);
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  };

  const sortIcon = (field) => sortBy === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // ===========================
  // KD color helper
  // ===========================
  const kdColor = (kd) => {
    if (kd <= 30) return "#10b981";
    if (kd <= 60) return "#f59e0b";
    return "#ef4444";
  };

  // Volume bar width
  const maxVolume = useMemo(() => Math.max(...keywords.map(k => k.volume), 1), [keywords]);

  return (
    <div className="page-container">
      {/* Header */}
      <h1 style={{ margin: "0 0 4px" }}>📊 Keyword Planner</h1>
      <p style={{ color: "var(--text-muted)", margin: "0 0 24px" }}>
        Nghiên cứu từ khóa — Volume, Keyword Difficulty, CPC, Trend 12 tháng
      </p>

      {/* Search Input */}
      <div className="card kw-search-card">
        <div className="kw-search-row">
          <div style={{ flex: 2, minWidth: 200 }}>
            <label className="label">Từ khóa chính</label>
            <input
              type="text"
              className="input-field kw-main-input"
              placeholder="VD: xe đạp điện, máy lọc nước..."
              value={seedKeyword}
              onChange={e => setSeedKeyword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleResearch()}
            />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label className="label">Lĩnh vực (tùy chọn)</label>
            <input
              type="text"
              className="input-field"
              placeholder="VD: công nghệ, sức khỏe..."
              value={niche}
              onChange={e => setNiche(e.target.value)}
            />
          </div>
          <div style={{ width: 160 }}>
            <label className="label">Quốc gia</label>
            <select className="select-field" value={country} onChange={e => setCountry(e.target.value)}>
              {Object.entries(COUNTRY_OPTIONS).map(([code, opt]) => (
                <option key={code} value={code}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <button
              className="btn btn-primary kw-search-btn"
              onClick={handleResearch}
              disabled={loading || !seedKeyword.trim()}
            >
              {loading ? "⏳ Đang phân tích..." : "🔍 Phân tích"}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: 16, marginBottom: 16 }}>
          <p style={{ color: "#ef4444", margin: 0 }}>❌ {error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <span className="loader" />
          <p style={{ color: "var(--text-muted)", marginTop: 16 }}>
            Đang phân tích từ khóa "{seedKeyword}"...<br />
            <small>Google Suggest + AI Semantic Expansion</small>
            <br />
            <small>Thị trường: {COUNTRY_OPTIONS[country]?.label || country}</small>
          </p>
        </div>
      )}

      {/* Results */}
      {!loading && keywords.length > 0 && (
        <>
          {/* Stats Bar */}
          {stats && (
            <div className="kw-stats-bar">
              <div className="kw-stat">
                <span className="kw-stat-value">{stats.total}</span>
                <span className="kw-stat-label">Từ khóa</span>
              </div>
              <div className="kw-stat">
                <span className="kw-stat-value">{stats.avgVolume?.toLocaleString()}</span>
                <span className="kw-stat-label">Vol trung bình</span>
              </div>
              <div className="kw-stat">
                <span className="kw-stat-value" style={{ color: kdColor(stats.avgKd) }}>{stats.avgKd}</span>
                <span className="kw-stat-label">KD trung bình</span>
              </div>
              <div className="kw-stat-types">
                {Object.entries(stats.byType || {}).map(([type, count]) => (
                  <span key={type} className="kw-type-badge" style={{ background: `${TYPE_MAP[type]?.color}20`, color: TYPE_MAP[type]?.color }}>
                    {TYPE_MAP[type]?.label}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {metricNotice && (
            <div className="card" style={{ padding: "10px 14px", marginBottom: 12, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.08)" }}>
              <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13 }}>
                {metricNotice} Ưu tiên quyết định theo <strong>Opportunity</strong>, <strong>Confidence</strong> và intent; nên xác minh lại bằng GSC/Keyword Planner trả phí trước khi triển khai ngân sách lớn.
              </p>
            </div>
          )}

          {/* Filters */}
          <div className="kw-filters">
            <div className="kw-filter-group">
              <label>Loại:</label>
              <select className="select-field" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="all">Tất cả</option>
                <option value="main">Chính</option>
                <option value="related">Liên quan</option>
                <option value="expanded">Mở rộng</option>
                <option value="lsi">LSI</option>
              </select>
            </div>
            <div className="kw-filter-group">
              <label>Vol:</label>
              <input type="number" className="input-field kw-filter-input" placeholder="Min" value={volumeMin} onChange={e => setVolumeMin(e.target.value)} />
              <span>—</span>
              <input type="number" className="input-field kw-filter-input" placeholder="Max" value={volumeMax} onChange={e => setVolumeMax(e.target.value)} />
            </div>
            <div className="kw-filter-group">
              <label>KD ≤</label>
              <input type="number" className="input-field kw-filter-input" placeholder="Max" value={kdMax} onChange={e => setKdMax(e.target.value)} />
            </div>
            <div className="kw-filter-group">
              <label>Intent:</label>
              <select className="select-field" value={intentFilter} onChange={e => setIntentFilter(e.target.value)}>
                <option value="all">Tất cả</option>
                <option value="informational">Thông tin</option>
                <option value="commercial">Thương mại</option>
                <option value="transactional">Giao dịch</option>
              </select>
            </div>
            <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
              {filtered.length} / {keywords.length} từ khóa
            </div>
          </div>

          {/* Batch Toolbar */}
          {selected.size > 0 && (
            <div className="kw-batch-toolbar">
              <span style={{ fontWeight: 600 }}>{selected.size} từ khóa đã chọn</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? "⏳ Đang export..." : `📥 Export CSV (${selected.size})`}
              </button>
              <button className="btn btn-sm" onClick={handleAddToProject}>
                📋 Thêm vào Dự án
              </button>
              <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
                ✕ Bỏ chọn
              </button>
            </div>
          )}

          {/* Table */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table kw-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((kw) => selected.has(keywordKey(kw)))}
                      onChange={selectAll}
                    />
                  </th>
                  <th onClick={() => handleSort("keyword")} className="kw-sortable">Từ khóa{sortIcon("keyword")}</th>
                  <th style={{ width: 70 }}>Loại</th>
                  <th onClick={() => handleSort("volume")} className="kw-sortable" style={{ width: 110 }}>Volume{sortIcon("volume")}</th>
                  <th onClick={() => handleSort("kd")} className="kw-sortable" style={{ width: 70 }}>KD{sortIcon("kd")}</th>
                  <th onClick={() => handleSort("cpc")} className="kw-sortable" style={{ width: 70 }}>CPC{sortIcon("cpc")}</th>
                  <th onClick={() => handleSort("opportunity")} className="kw-sortable" style={{ width: 92 }}>Cơ hội{sortIcon("opportunity")}</th>
                  <th onClick={() => handleSort("confidence")} className="kw-sortable" style={{ width: 78 }}>Tin cậy{sortIcon("confidence")}</th>
                  <th style={{ width: 80 }}>Intent</th>
                  <th style={{ width: 90 }}>Trend</th>
                  <th style={{ width: 50 }}>Từ</th>
                </tr>
              </thead>
              <tbody>
                {pagedData.map((kw) => {
                  const t = TYPE_MAP[kw.type] || TYPE_MAP.related;
                  const intent = INTENT_MAP[kw.intent] || INTENT_MAP.informational;
                  const key = keywordKey(kw);
                  const isSelected = selected.has(key);
                  return (
                    <tr key={key} style={{ background: isSelected ? "var(--bg-selected, rgba(99,102,241,0.08))" : undefined }}>
                      <td><input type="checkbox" checked={isSelected} onChange={() => toggleSelect(kw)} /></td>
                      <td>
                        <span
                          className="kw-keyword-text"
                          style={{
                            fontFamily: '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif',
                            fontFeatureSettings: 'normal',
                            unicodeBidi: 'plaintext',
                          }}
                        >{kw.keyword}</span>
                        <span style={{ fontSize: 9, color: "#6366f150", marginLeft: 4, letterSpacing: .5 }}>
                          {kw.source === "google_suggest" ? "G" : "AI"}
                        </span>
                        {kw.metricLabel && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                            {kw.metricLabel}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="kw-type-badge" style={{ background: `${t.color}18`, color: t.color }}>{t.label}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, minWidth: 45 }}>{kw.volume?.toLocaleString()}</span>
                          <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--bg-muted)" }}>
                            <div style={{ width: `${Math.min(100, (kw.volume / maxVolume) * 100)}%`, height: "100%", borderRadius: 2, background: "var(--accent-primary, #6366f1)" }} />
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: kdColor(kw.kd), fontSize: 13 }}>{kw.kd}</span>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        ${kw.cpc?.toFixed(2)}
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: kw.opportunity >= 70 ? "#10b981" : kw.opportunity >= 45 ? "#f59e0b" : "var(--text-muted)", fontSize: 13 }}>
                          {kw.opportunity ?? "-"}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: kw.confidence >= 75 ? "#10b981" : kw.confidence >= 55 ? "#f59e0b" : "#ef4444", fontSize: 13 }}>
                          {kw.confidence ?? "-"}%
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 11 }}>{intent.icon} {intent.label}</span>
                      </td>
                      <td>
                        <Sparkline data={kw.trend} />
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>{kw.wordCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="kw-pagination">
              <button
                className="kw-page-btn"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === "..." ? (
                    <span key={`ellipsis-${idx}`} className="kw-page-ellipsis">…</span>
                  ) : (
                    <button
                      key={p}
                      className={`kw-page-btn${page === p ? " active" : ""}`}
                      onClick={() => setPage(p)}
                    >{p}</button>
                  )
                )
              }
              <button
                className="kw-page-btn"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >›</button>
              <span className="kw-page-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} / {filtered.length}
              </span>
            </div>
          )}

          {/* Export error */}
          {exportError && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 16px", marginTop: 12 }}>
              <p style={{ color: "#ef4444", margin: 0, fontSize: 13 }}>❌ {exportError}</p>
            </div>
          )}

          {/* Bottom actions */}
          {selected.size === 0 && (
            <div style={{ display: "flex", gap: 12, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn" onClick={handleExport} disabled={exporting}>
                {exporting ? "⏳ Đang export..." : `📥 Export tất cả (${filtered.length})`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && keywords.length === 0 && !error && (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px", marginTop: 16 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h2 style={{ marginBottom: 8 }}>Bắt đầu nghiên cứu từ khóa</h2>
          <p style={{ color: "var(--text-muted)", maxWidth: 480, margin: "0 auto" }}>
            Nhập 1 từ khóa chính → nhận 50-100 từ khóa liên quan với dữ liệu Volume, KD, CPC, Trend 12 tháng.<br />
            Sử dụng Google Suggest + AI Semantic Expansion.
          </p>
        </div>
      )}

      {/* Project Picker Modal */}
      <AddToProjectModal
        open={showProjectPicker}
        projects={projects}
        keywords={selectedKeywords}
        seedKeyword={seedKeyword}
        onClose={() => setShowProjectPicker(false)}
      />
    </div>
  );
}
