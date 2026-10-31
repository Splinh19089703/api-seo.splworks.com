import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api";
import SafeHtml from "../components/SafeHtml";
import { parseHtmlSections, mergeSections, replaceSectionHtml } from "../utils/parseHtmlSections";
import ImageReplacer from "../components/ImageReplacer";
import PublishSection from "../components/PublishSection";
import useUpgradePrompt from "../hooks/useUpgradePrompt";
import { ARTICLE_STATUS } from "../constants/plans";

const INTENT_COLORS = { informational: "#3b82f6", commercial: "#f59e0b", transactional: "#10b981", navigational: "#8b5cf6", local: "#ef4444" };
const INTENT_LABELS = { informational: "Informational", commercial: "Commercial", transactional: "Transactional", navigational: "Navigational", local: "Local" };
const ANGLE_COLORS = { guide: "#3b82f6", list: "#10b981", review: "#f59e0b", comparison: "#ef4444", definition: "#8b5cf6", tutorial: "#06b6d4", local: "#f97316", cost: "#84cc16" };
const STATUS_MAP = {
  pending: { label: "Chờ", color: "#6b7280", bg: "rgba(107,114,128,0.1)", icon: "⏳" },
  research: { label: "Đang nghiên cứu", color: "#3b82f6", bg: "rgba(59,130,246,0.1)", icon: "🔍" },
  outline: { label: "Đang tạo outline", color: "#8b5cf6", bg: "rgba(139,92,246,0.1)", icon: "📋" },
  content: { label: "Đang viết bài", color: "#f59e0b", bg: "rgba(245,158,11,0.1)", icon: "✍️" },
  thumbnail: { label: "Đang tạo ảnh", color: "#06b6d4", bg: "rgba(6,182,212,0.1)", icon: "🖼️" },
  sections: { label: "Đang tạo ảnh sections", color: "#06b6d4", bg: "rgba(6,182,212,0.1)", icon: "🎨" },
  review: { label: "Hoàn thành", color: "#10b981", bg: "rgba(16,185,129,0.1)", icon: "✅" },
  error: { label: "Lỗi", color: "#ef4444", bg: "rgba(239,68,68,0.1)", icon: "❌" },
};
// Fallback cho status không nằm trong STATUS_MAP (draft/published...) — dùng constants chung
const statusMapWith = (s) => STATUS_MAP[s] || (() => {
  const info = ARTICLE_STATUS[s];
  return info ? { label: info.label, color: info.color, bg: `${info.color}1a`, icon: info.icon } : { label: s, color: "#6b7280", bg: "rgba(107,114,128,0.1)", icon: "❔" };
})();

export default function Pipeline() {
  const { withUpgradePrompt, UpgradePromptUI } = useUpgradePrompt();
  const [view, setView] = useState("input");
  const [clusters, setClusters] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [kwInput, setKwInput] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [subTab, setSubTab] = useState("clusters");
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [editingDraft, setEditingDraft] = useState(null);
  const [showAddCluster, setShowAddCluster] = useState(false);
  const [newClusterName, setNewClusterName] = useState("");
  const [newClusterKw, setNewClusterKw] = useState("");
  const [moveTarget, setMoveTarget] = useState(null); // {kwId, fromClusterId}
  const [kwFilter, setKwFilter] = useState("all");
  const pollingRef = useRef(null);
  // Multi-select for batch add-to-project
  const [checkedDrafts, setCheckedDrafts] = useState(new Set());
  const [showBatchProjectPicker, setShowBatchProjectPicker] = useState(false);
  const [batchProjectsList, setBatchProjectsList] = useState([]);
  const [batchAdding, setBatchAdding] = useState(false);

  // Load drafts
  const loadDrafts = useCallback(async () => {
    try { setDrafts(await api.getDrafts()); } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { loadDrafts(); }, []);

  // Polling for auto-pipeline progress
  useEffect(() => {
    const processing = drafts.filter(d => d.pipeline?.autoStep && !["done", "error"].includes(d.pipeline.autoStep));
    if (processing.length > 0) {
      pollingRef.current = setInterval(() => loadDrafts(), 3000);
    } else if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [drafts]);

  // Analyze keywords
  const handleAnalyze = async () => {
    if (!kwInput.trim()) return;
    setAnalyzing(true);
    try {
      const result = await api.analyzeKeywords(kwInput);
      setClusters(result.clusters || []);
      setExpandedClusters(new Set((result.clusters || []).map(c => c.id)));
      setView("clusters");
      setSubTab("clusters");
    } catch (e) { alert("Lỗi: " + e.message); }
    setAnalyzing(false);
  };

  // Toggle
  const toggleSelect = (kw) => { const n = new Set(selected); n.has(kw) ? n.delete(kw) : n.add(kw); setSelected(n); };
  const selectAllInCluster = (cluster) => {
    const n = new Set(selected);
    const allSel = cluster.keywords.every(k => n.has(k.keyword));
    cluster.keywords.forEach(k => allSel ? n.delete(k.keyword) : n.add(k.keyword));
    setSelected(n);
  };
  const selectAll = () => {
    const all = clusters.flatMap(c => c.keywords.map(k => k.keyword));
    const n = all.every(k => selected.has(k)) ? new Set() : new Set(all);
    setSelected(n);
  };

  // Create articles
  const handleCreateArticles = async () => {
    const kws = clusters.flatMap(c => c.keywords).filter(k => selected.has(k.keyword));
    if (kws.length === 0) return;
    setLoading(true);
    try {
      const created = [];
      for (const k of kws) {
        const cluster = clusters.find(c => c.keywords.some(kk => kk.keyword === k.keyword));
        const d = await api.createDraft({
          keyword: k.keyword,
          cluster: cluster?.name || "",
          searchIntent: cluster?.searchIntent || k.searchIntent || "informational",
          contentAngle: cluster?.contentAngle || k.contentAngle || "guide",
          estimatedWords: cluster?.estimatedWords || 2500,
          status: "pending",
          pipeline: {},
        });
        created.push(d);
      }
      // Start auto-pipeline for all
      for (const d of created) {
        try { await api.runAutoPipeline(d.id); } catch (e) { console.error(e); }
      }
      // Mark selected keywords as processing
      setClusters(clusters.map(c => ({
        ...c,
        keywords: c.keywords.map(k => selected.has(k.keyword) ? { ...k, status: "processing" } : k),
      })));
      setSelected(new Set());
      await loadDrafts();
      setSubTab("articles");
    } catch (e) {
      if (!withUpgradePrompt(e)) alert("Lỗi: " + e.message);
    }
    setLoading(false);
  };

  // Add cluster
  const handleAddCluster = () => {
    if (!newClusterName.trim()) return;
    const kws = newClusterKw.split("\n").map(k => k.trim()).filter(Boolean);
    const newCluster = {
      id: `c_${Date.now()}_new`,
      name: newClusterName,
      description: "",
      searchIntent: "informational",
      contentAngle: "guide",
      estimatedWords: 2500,
      keywords: kws.length > 0
        ? kws.map((k, i) => ({ keyword: k, type: i === 0 ? "pillar" : "cluster", id: `k_new_${Date.now()}_${i}`, status: "pending" }))
        : [{ keyword: newClusterName, type: "pillar", id: `k_new_${Date.now()}_0`, status: "pending" }],
    };
    setClusters([...clusters, newCluster]);
    setExpandedClusters(new Set([...expandedClusters, newCluster.id]));
    setShowAddCluster(false);
    setNewClusterName("");
    setNewClusterKw("");
  };

  // Move keyword to another cluster
  const handleMoveKw = (kwId, fromClusterId, toClusterId) => {
    const fromCluster = clusters.find(c => c.id === fromClusterId);
    const kw = fromCluster?.keywords.find(k => k.id === kwId);
    if (!kw) return;
    setClusters(clusters.map(c => {
      if (c.id === fromClusterId) return { ...c, keywords: c.keywords.filter(k => k.id !== kwId) };
      if (c.id === toClusterId) return { ...c, keywords: [...c.keywords, { ...kw }] };
      return c;
    }));
    setMoveTarget(null);
  };

  // Delete keyword
  const handleDeleteKw = (kwId, clusterId) => {
    setClusters(clusters.map(c => c.id === clusterId ? { ...c, keywords: c.keywords.filter(k => k.id !== kwId) } : c));
  };

  // Open draft editor
  const handleEditDraft = (d) => setEditingDraft(d);
  const handleDeleteDraft = async (id) => { if (!confirm("Xoá?")) return; await api.deleteDraft(id); loadDrafts(); };

  // Draft editor (simple inline)
  if (editingDraft) return <DraftViewer draft={editingDraft} onBack={() => { setEditingDraft(null); loadDrafts(); }} />;

  const allKeywords = clusters.flatMap(c => c.keywords);
  const totalKw = allKeywords.length;
  const kwWithArticles = drafts.length;
  const processingDrafts = drafts.filter(d => d.pipeline?.autoStep && !["done", "error"].includes(d.pipeline.autoStep));

  return (
    <div>
      <div className="page-header">
        <div><h1>✍️ Tạo bài viết</h1><p className="subtitle">Phân tích & nhóm từ khoá → Tạo bài viết hàng loạt tự động</p></div>
      </div>

      {/* ---- INPUT VIEW: Paste keywords ---- */}
      {view === "input" && (
        <div style={{ maxWidth: 700 }}>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 12 }}>🔍 Nhập danh sách từ khoá</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>Mỗi dòng 1 từ khoá. AI sẽ phân tích và nhóm theo Search Intent & Topic Cluster.</p>
            <textarea rows={10} placeholder="pickleball là gì&#10;cách chơi pickleball&#10;vợt pickleball tốt nhất&#10;luật pickleball&#10;pickleball ở đâu&#10;..." value={kwInput} onChange={e => setKwInput(e.target.value)} style={{ fontSize: 14, fontFamily: "Monaco, Consolas, monospace" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{kwInput.split("\n").filter(k => k.trim()).length} từ khoá</span>
              <button className="btn btn-primary btn-lg" disabled={!kwInput.trim() || analyzing} onClick={handleAnalyze}>
                {analyzing ? <><span className="loader" /> Đang phân tích...</> : "🚀 Phân tích & Nhóm"}
              </button>
            </div>
          </div>
          {drafts.length > 0 && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ margin: 0 }}>📄 Đã có {drafts.length} bản nháp</h4>
                <button className="btn btn-secondary btn-sm" onClick={() => { setView("clusters"); setSubTab("articles"); }}>Xem tất cả →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- CLUSTER VIEW ---- */}
      {view === "clusters" && (
        <div>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setView("input")}>← Nhập lại</button>
            <div style={{ display: "flex", background: "var(--bg-tertiary)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              {[
                { key: "clusters", label: "Cấu trúc", count: clusters.length },
                { key: "articles", label: "Bài viết", count: `${drafts.filter(d => d.pipeline?.autoStep === "done").length}/${drafts.length}` },
              ].map(t => (
                <button key={t.key} className={`btn btn-sm ${subTab === t.key ? "btn-primary" : ""}`}
                  style={{ borderRadius: 0, border: "none", minWidth: 100 }}
                  onClick={() => setSubTab(t.key)}>
                  {t.label} <span style={{ opacity: 0.7 }}>{t.count}</span>
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            {subTab === "clusters" && (
              <>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Đã chọn: {selected.size} keywords</span>
                <button className="btn btn-secondary btn-sm" onClick={selectAll}>{selected.size === totalKw ? "Bỏ chọn tất cả" : "Chọn tất cả"}</button>
                <button className="btn btn-primary" onClick={handleCreateArticles} disabled={selected.size === 0 || loading}>
                  {loading ? <><span className="loader" /> Đang tạo...</> : `+ Tạo bài viết (${selected.size})`}
                </button>
              </>
            )}
          </div>

          {/* ---- TAB: CLUSTERS ---- */}
          {subTab === "clusters" && (
            <div>
              {/* Filters */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {[
                  { key: "all", label: `Tất cả (${totalKw})` },
                  { key: "pending", label: `Chưa có bài (${allKeywords.filter(k => k.status === "pending").length})` },
                  { key: "processing", label: `Đang xử lý (${processingDrafts.length})` },
                ].map(f => (
                  <button key={f.key} className={`btn btn-sm ${kwFilter === f.key ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setKwFilter(f.key)}>{f.label}</button>
                ))}
              </div>

              {/* Cluster Cards */}
              {clusters.map((cluster, ci) => {
                const isExpanded = expandedClusters.has(cluster.id);
                const filteredKws = kwFilter === "pending" ? cluster.keywords.filter(k => k.status === "pending")
                  : kwFilter === "processing" ? cluster.keywords.filter(k => k.status === "processing" || drafts.some(d => d.keyword === k.keyword && d.pipeline?.autoStep))
                  : cluster.keywords;
                if (filteredKws.length === 0 && kwFilter !== "all") return null;

                return (
                  <div key={cluster.id} style={{ marginBottom: 16, border: "1px solid var(--border-color)", borderRadius: "var(--radius)", background: "var(--bg-card)" }}>
                    {/* Cluster Header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", borderBottom: isExpanded ? "1px solid var(--border-light)" : "none" }}
                      onClick={() => { const n = new Set(expandedClusters); n.has(cluster.id) ? n.delete(cluster.id) : n.add(cluster.id); setExpandedClusters(n); }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-muted)" }}>#{ci+1}</span>
                      <span style={{ fontSize: 16, transform: isExpanded ? "rotate(90deg)" : "none", transition: "0.2s" }}>▶</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{cluster.name}</span>
                        {cluster.description && <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>({cluster.description})</span>}
                      </div>
                      <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: INTENT_COLORS[cluster.searchIntent] + "20", color: INTENT_COLORS[cluster.searchIntent] }}>{INTENT_LABELS[cluster.searchIntent] || cluster.searchIntent}</span>
                      <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, background: (ANGLE_COLORS[cluster.contentAngle] || "#6b7280") + "20", color: ANGLE_COLORS[cluster.contentAngle] || "#6b7280" }}>{cluster.contentAngle}</span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>~{(cluster.estimatedWords || 2500).toLocaleString()} từ</span>
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{cluster.keywords.length} keywords</span>
                      <button className="btn btn-secondary btn-sm" style={{ padding: "2px 6px", fontSize: 11 }} onClick={(e) => { e.stopPropagation(); selectAllInCluster(cluster); }}>
                        {cluster.keywords.every(k => selected.has(k.keyword)) ? "Bỏ chọn" : "Chọn tất cả"}
                      </button>
                    </div>

                    {/* Keywords */}
                    {isExpanded && (
                      <div style={{ padding: "8px 16px 12px" }}>
                        {filteredKws.map((kw, ki) => {
                          const draft = drafts.find(d => d.keyword === kw.keyword);
                          const autoStep = draft?.pipeline?.autoStep;
                          const st = autoStep ? STATUS_MAP[autoStep] || STATUS_MAP.pending : STATUS_MAP.pending;
                          const isSelected = selected.has(kw.keyword);

                          return (
                            <div key={kw.id || ki} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: ki < filteredKws.length - 1 ? "1px solid var(--border-light)" : "none" }}>
                              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(kw.keyword)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                              {kw.type === "pillar" && <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#10b981", color: "#fff" }}>PILLAR</span>}
                              <span style={{ fontWeight: kw.type === "pillar" ? 600 : 400, fontSize: 14, flex: 1 }}>{kw.keyword}</span>
                              {autoStep && (
                                <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 500, background: st.bg, color: st.color }}>
                                  {st.icon} {st.label}
                                </span>
                              )}
                              {draft && (
                                <button className="btn btn-secondary btn-sm" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => handleEditDraft(draft)}>👁️ Xem</button>
                              )}
                              {/* Actions: Move, Delete */}
                              <div style={{ display: "flex", gap: 2 }}>
                                <button className="btn btn-secondary btn-sm" style={{ padding: "2px 4px", fontSize: 11 }} title="Chuyển cluster"
                                  onClick={() => setMoveTarget(moveTarget?.kwId === kw.id ? null : { kwId: kw.id, fromClusterId: cluster.id })}>↗</button>
                                <button className="btn btn-secondary btn-sm" style={{ padding: "2px 4px", fontSize: 11, color: "var(--accent-red)" }} title="Xoá"
                                  onClick={() => handleDeleteKw(kw.id, cluster.id)}>×</button>
                              </div>
                              {/* Move dropdown */}
                              {moveTarget?.kwId === kw.id && (
                                <div style={{ position: "absolute", right: 80, background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, padding: 8, zIndex: 100, boxShadow: "var(--shadow-lg)" }}>
                                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Chuyển sang cluster:</div>
                                  {clusters.filter(c => c.id !== cluster.id).map(c => (
                                    <div key={c.id} style={{ padding: "4px 8px", cursor: "pointer", fontSize: 13, borderRadius: 4 }}
                                      onMouseEnter={e => e.target.style.background = "var(--bg-tertiary)"}
                                      onMouseLeave={e => e.target.style.background = "transparent"}
                                      onClick={() => handleMoveKw(kw.id, cluster.id, c.id)}>
                                      {c.name}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add Cluster */}
              {!showAddCluster ? (
                <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setShowAddCluster(true)}>+ Thêm Cluster</button>
              ) : (
                <div className="card" style={{ marginTop: 8, maxWidth: 500 }}>
                  <h4 style={{ margin: "0 0 12px" }}>+ Thêm Cluster mới</h4>
                  <div className="form-group"><label>Tên cluster</label><input value={newClusterName} onChange={e => setNewClusterName(e.target.value)} placeholder="VD: vợt pickleball" /></div>
                  <div className="form-group"><label>Keywords (mỗi dòng 1 từ khoá, tuỳ chọn)</label><textarea rows={3} value={newClusterKw} onChange={e => setNewClusterKw(e.target.value)} placeholder="vợt pickleball tốt nhất&#10;review vợt pickleball" /></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={handleAddCluster} disabled={!newClusterName.trim()}>Thêm</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setShowAddCluster(false); setNewClusterName(""); setNewClusterKw(""); }}>Huỷ</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- TAB: ARTICLES ---- */}
          {subTab === "articles" && (
            <div>
              {/* Filters */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center" }}>
                {[
                  { key: "all", label: `Tất cả (${drafts.length})` },
                  { key: "processing", label: `Đang xử lý (${drafts.filter(d => d.pipeline?.autoStep && !["done","error"].includes(d.pipeline.autoStep)).length})` },
                  { key: "done", label: `Hoàn thành (${drafts.filter(d => d.pipeline?.autoStep === "done" || d.status === "review").length})` },
                  { key: "error", label: `Lỗi (${drafts.filter(d => d.pipeline?.autoStep === "error").length})` },
                ].map(f => (
                  <button key={f.key} className={`btn btn-sm ${kwFilter === f.key ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setKwFilter(f.key)}>{f.label}</button>
                ))}
              </div>

              {/* Batch Toolbar */}
              {checkedDrafts.size > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 14px", marginBottom: 12, borderRadius: 10,
                  background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#818cf8" }}>
                    ✓ Đã chọn {checkedDrafts.size} bài
                  </span>
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-sm" style={{
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff",
                    border: "none", padding: "6px 16px", borderRadius: 20, fontSize: 12.5, fontWeight: 600,
                  }} disabled={batchAdding} onClick={async () => {
                    try {
                      const projects = await api.getProjects();
                      setBatchProjectsList(projects);
                      setShowBatchProjectPicker(true);
                    } catch (e) { alert("Lỗi: " + e.message); }
                  }}>
                    📂 Thêm vào Dự án ({checkedDrafts.size})
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setCheckedDrafts(new Set())}>
                    ✕ Bỏ chọn
                  </button>
                </div>
              )}

              {/* Table */}
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 36, textAlign: "center" }}>
                        <input type="checkbox"
                          checked={drafts.length > 0 && checkedDrafts.size === drafts.length}
                          onChange={(e) => {
                            if (e.target.checked) setCheckedDrafts(new Set(drafts.map(d => d.id)));
                            else setCheckedDrafts(new Set());
                          }}
                          style={{ cursor: "pointer", width: 16, height: 16, accentColor: "#6366f1" }}
                        />
                      </th>
                      <th>Keyword</th>
                      <th>Cluster</th>
                      <th>Tiêu đề</th>
                      <th>Intent</th>
                      <th>Góc viết</th>
                      <th>Số từ</th>
                      <th>Trạng thái</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts
                      .filter(d => {
                        if (kwFilter === "processing") return d.pipeline?.autoStep && !["done","error"].includes(d.pipeline.autoStep);
                        if (kwFilter === "done") return d.pipeline?.autoStep === "done" || d.status === "review";
                        if (kwFilter === "error") return d.pipeline?.autoStep === "error";
                        return true;
                      })
                      .map(d => {
                        const autoStep = d.pipeline?.autoStep;
                        const st = autoStep ? STATUS_MAP[autoStep] || STATUS_MAP.pending : STATUS_MAP[d.status] || STATUS_MAP.pending;
                        const title = d.pipeline?.outline?.title || "Chưa có";
                        const wordCount = d.pipeline?.content?.wordCount || 0;
                        const isChecked = checkedDrafts.has(d.id);
                        return (
                          <tr key={d.id} style={{ cursor: "pointer", background: isChecked ? "rgba(99,102,241,0.06)" : undefined }} onClick={() => handleEditDraft(d)}>
                            <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={isChecked}
                                onChange={(e) => {
                                  const next = new Set(checkedDrafts);
                                  if (e.target.checked) next.add(d.id); else next.delete(d.id);
                                  setCheckedDrafts(next);
                                }}
                                style={{ cursor: "pointer", width: 16, height: 16, accentColor: "#6366f1" }}
                              />
                            </td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {d.pipeline?.thumbnail?.url && <img src={d.pipeline.thumbnail.url} alt="" style={{ width: 32, height: 22, borderRadius: 4, objectFit: "cover" }} />}
                                <strong>{d.keyword}</strong>
                              </div>
                            </td>
                            <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{d.cluster || "—"}</td>
                            <td style={{ fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</td>
                            <td><span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: (INTENT_COLORS[d.searchIntent] || "#6b7280") + "20", color: INTENT_COLORS[d.searchIntent] || "#6b7280" }}>{d.searchIntent || "—"}</span></td>
                            <td><span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, background: (ANGLE_COLORS[d.contentAngle] || "#6b7280") + "20", color: ANGLE_COLORS[d.contentAngle] || "#6b7280" }}>{d.contentAngle || "—"}</span></td>
                            <td style={{ fontSize: 13 }}>{wordCount > 0 ? `~${wordCount.toLocaleString()}` : "—"}</td>
                            <td>
                              <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                                {st.icon} {st.label}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button className="btn btn-secondary btn-sm" style={{ padding: "2px 6px" }} onClick={(e) => { e.stopPropagation(); handleEditDraft(d); }}>👁️</button>
                                <button className="btn btn-secondary btn-sm" style={{ padding: "2px 6px", color: "var(--accent-red)" }} onClick={(e) => { e.stopPropagation(); handleDeleteDraft(d.id); }}>🗑</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              {drafts.length === 0 && <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Chưa có bài viết nào. Chọn keywords và bấm "Tạo bài viết".</div>}

              {/* Batch Project Picker Modal */}
              {showBatchProjectPicker && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={() => setShowBatchProjectPicker(false)}>
                  <div style={{ background: "var(--bg-card)", borderRadius: 14, padding: 24, width: 440, maxHeight: "60vh", overflow: "auto", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border-color)" }}
                    onClick={e => e.stopPropagation()}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📂 Thêm {checkedDrafts.size} bài vào Dự án</h3>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px" }}>Chọn dự án để thêm các bài viết đã tích:</p>
                    {batchProjectsList.length === 0 ? (
                      <div style={{ fontSize: 13, color: "var(--text-muted)", padding: 20, textAlign: "center" }}>Chưa có dự án nào. Tạo dự án mới trước.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {batchProjectsList.map(proj => (
                          <button key={proj.id} className="btn btn-secondary" style={{ textAlign: "left", padding: "10px 14px", justifyContent: "flex-start" }}
                            disabled={batchAdding}
                            onClick={async () => {
                              setBatchAdding(true);
                              let successCount = 0;
                              const ids = [...checkedDrafts];
                              for (const draftId of ids) {
                                try {
                                  await api.convertDraftToProject(draftId, proj.id);
                                  successCount++;
                                } catch (e) { console.warn(`Lỗi chuyển draft ${draftId}:`, e.message); }
                              }
                              alert(`✅ Đã thêm ${successCount}/${ids.length} bài vào dự án "${proj.name}"!`);
                              setShowBatchProjectPicker(false);
                              setCheckedDrafts(new Set());
                              setBatchAdding(false);
                              loadDrafts();
                            }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{proj.name}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{proj.articles || 0} bài · {proj.niche || "—"}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      {batchAdding && <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}><span className="loader" style={{ width: 12, height: 12 }} /> Đang chuyển...</span>}
                      <button className="btn btn-secondary btn-sm" onClick={() => setShowBatchProjectPicker(false)}>Đóng</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {UpgradePromptUI}
    </div>
  );
}

// ===== Draft Viewer — Full stepper pipeline =====

function DraftViewer({ draft, onBack }) {
  const [d, setD] = useState(draft);
  const [activeStep, setActiveStep] = useState("research");
  const [contentViewMode, setContentViewMode] = useState("preview");
  const [showFullContent, setShowFullContent] = useState(false);
  const [processingStep, setProcessingStep] = useState(null);
  const [processingError, setProcessingError] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showImageReplacer, setShowImageReplacer] = useState(null);

  // T13 — F1/F2: Content Mode & Word Count
  const [contentGenMode, setContentGenMode] = useState("basic");
  const [targetWordCount, setTargetWordCount] = useState(2000);

  // T13 — F4: Auto-pipeline config popup
  const [showAutoConfig, setShowAutoConfig] = useState(false);
  const [autoMode, setAutoMode] = useState("basic");
  const [autoWordCount, setAutoWordCount] = useState(2000);

  // T13 — F3: Section Rewrite
  const [selectedSections, setSelectedSections] = useState(new Set());
  const [customInstructions, setCustomInstructions] = useState("");
  const [rewritingSection, setRewritingSection] = useState(false);
  const [showSectionPanel, setShowSectionPanel] = useState(false);

  // G9: Add to Project
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectsList, setProjectsList] = useState([]);
  const [addingToProject, setAddingToProject] = useState(false);

  // QC warnings
  const [showQcWarnings, setShowQcWarnings] = useState(false);

  const WORD_COUNT_PRESETS = [
    { label: "Ngắn 1000", value: 1000 },
    { label: "Vừa 1500", value: 1500 },
    { label: "Chuẩn 2000", value: 2000 },
    { label: "Dài 2500", value: 2500 },
    { label: "Chuyên sâu 3000", value: 3000 },
    { label: "Siêu dài 3500+", value: 3500 },
  ]; // { type: 'thumbnail' | 'section', index?: number }

  // Auto-poll for progress
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const updated = await api.getDraft(draft.id);
        setD(updated);
        if (updated.pipeline?.autoStep === null || updated.pipeline?.autoStep === "done" || updated.pipeline?.autoStep === "error") {
          if (processingStep) setProcessingStep(null);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(iv);
  }, [draft.id, processingStep]);

  useEffect(() => {
    if (!processingStep) { setElapsedTime(0); return; }
    const interval = setInterval(() => setElapsedTime(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [processingStep]);

  const p = d.pipeline || {};
  const autoStep = p.autoStep;
  const isAutoRunning = autoStep && !["done", "error", null].includes(autoStep);
  const content = p.content || {};
  const outline = p.outline || {};
  const research = p.research || {};

  const runStep = async (stepKey, apiCall) => {
    setProcessingStep(stepKey);
    setProcessingError(null);
    try {
      await apiCall();
      const updated = await api.getDraft(draft.id);
      setD(updated);
      setProcessingStep(null);
    } catch (e) {
      setProcessingStep(null);
      setProcessingError({ step: stepKey, message: e.message });
      try { const updated = await api.getDraft(draft.id); setD(updated); } catch {}
    }
  };

  const runAuto = async () => {
    // F4: show config popup first
    setShowAutoConfig(true);
  };

  const runAutoConfirmed = async () => {
    setShowAutoConfig(false);
    setProcessingStep("auto");
    setProcessingError(null);
    try { await api.runAutoPipeline(d.id, { mode: autoMode, targetWordCount: autoWordCount }); }
    catch (e) { setProcessingError({ step: "auto", message: e.message }); }
  };

  const STEPS = [
    { key: "research", label: "Nghiên cứu" },
    { key: "outline", label: "Dàn ý" },
    { key: "content", label: "Nội dung" },
    { key: "thumbnail", label: "Thumbnail" },
    { key: "sections", label: "Ảnh sections" },
    { key: "preview", label: "Xem & Xuất" },
  ];

  const getStepStatus = (key) => {
    if (processingStep === key) return "processing";
    if (key === "preview") return content.html ? "done" : "pending";
    if (key === "research") return research.keyword ? "done" : autoStep === "research" ? "processing" : "pending";
    if (key === "outline") return outline.title || outline.outline ? "done" : autoStep === "outline" ? "processing" : "pending";
    if (key === "content") return content.html ? "done" : autoStep === "content" ? "processing" : "pending";
    if (key === "thumbnail") return p.thumbnail?.status === "done" ? "done" : p.thumbnail?.status === "failed" ? "failed" : autoStep === "thumbnail" ? "processing" : "pending";
    if (key === "sections") return p.sections?.status === "done" ? "done" : p.sections?.status === "failed" ? "failed" : autoStep === "sections" ? "processing" : "pending";
    return "pending";
  };

  const stepIcon = (s) => s === "done" ? "\u2705" : s === "failed" ? "\ud83d\udd34" : s === "processing" ? "\ud83d\udd04" : "\u26aa";

  const ProcessingUI = ({ title, subtitle }) => (
    <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
      <div style={{ marginBottom: 20 }}><span className="loader" style={{ display: "inline-block", width: 40, height: 40 }} /></div>
      <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>{title}</h3>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{subtitle}</p>
      <div style={{ maxWidth: 400, margin: "0 auto" }}>
        <div style={{ height: 6, borderRadius: 3, background: "var(--bg-tertiary)", overflow: "hidden", marginBottom: 12 }}>
          <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, var(--accent-blue), var(--accent-green))", animation: "processingBar 2s ease-in-out infinite", width: "60%" }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{"⏱"} {"Đã chờ:"} {elapsedTime}s</div>
      </div>
    </div>
  );

  const ErrorAlert = ({ stepKey }) => {
    if (!processingError || processingError.step !== stepKey) return null;
    return (
      <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid var(--accent-red)", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16 }}>{"❌"}</span>
          <strong style={{ fontSize: 13, color: "var(--accent-red)" }}>Lỗi xử lý</strong>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>{processingError.message}</p>
      </div>
    );
  };

  return (
    <div>
      {/* Auto-pipeline Config Popup — F4 */}
      {showAutoConfig && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowAutoConfig(false)}>
          <div style={{ background: "var(--bg-card)", borderRadius: 14, padding: 28, width: 420, boxShadow: "var(--shadow-lg)", border: "1px solid var(--border-color)" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 20px", fontSize: 17 }}>🚀 Cài đặt Chạy Tự Động</h3>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Chế độ viết bài:</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[{ key: "basic", label: "⚡ Basic", sub: "~30s" }, { key: "quality", label: "🏆 Quality", sub: "~90s" }].map(m => (
                  <button key={m.key} className={`btn btn-sm ${autoMode === m.key ? "btn-primary" : "btn-secondary"}`}
                    style={{ flex: 1, padding: "10px 8px", flexDirection: "column", display: "flex", alignItems: "center", gap: 2 }}
                    onClick={() => setAutoMode(m.key)}>
                    {m.label}<span style={{ fontSize: 10, opacity: 0.7 }}>{m.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Số từ mục tiêu:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {WORD_COUNT_PRESETS.map(p => (
                  <button key={p.value} className={`btn btn-sm ${autoWordCount === p.value ? "btn-primary" : "btn-secondary"}`}
                    style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setAutoWordCount(p.value)}>{p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAutoConfig(false)}>Hủy</button>
              <button className="btn btn-primary" onClick={runAutoConfirmed}>🚀 Bắt đầu ({autoMode === "quality" ? "Quality" : "Basic"}, {autoWordCount} từ)</button>
            </div>
          </div>
        </div>
      )}
      {/* Project Picker Modal — G9 */}
      {showProjectPicker && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowProjectPicker(false)}>
          <div style={{ background: "var(--bg-card)", borderRadius: 14, padding: 24, width: 400, maxHeight: "60vh", overflow: "auto", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border-color)" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>📂 Chọn Dự án</h3>
            {projectsList.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: 20, textAlign: "center" }}>Chưa có dự án nào. Tạo dự án mới trước.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {projectsList.map(proj => (
                  <button key={proj.id} className="btn btn-secondary" style={{ textAlign: "left", padding: "10px 14px", justifyContent: "flex-start" }}
                    disabled={addingToProject}
                    onClick={async () => {
                      setAddingToProject(true);
                      try {
                        const res = await api.convertDraftToProject(d.id, proj.id);
                        alert(`✅ Đã thêm "${res.title}" vào dự án "${proj.name}"!`);
                        setShowProjectPicker(false);
                      } catch (e) { alert("❌ " + e.message); }
                      setAddingToProject(false);
                    }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{proj.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{proj.articles || 0} bài · {proj.niche || "—"}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowProjectPicker(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>{"← Quay lại"}</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>{outline.title || d.keyword}</h1>
          <p className="subtitle" style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{"🔑"} {d.keyword} {d.cluster && ` · 📁 ${d.cluster}`}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!isAutoRunning && (
            <button className="btn btn-primary btn-sm" onClick={runAuto} disabled={processingStep}>
              {"🚀"} Chạy tự động
            </button>
          )}
          {isAutoRunning && (
            <span style={{ padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: "rgba(59,130,246,0.1)", color: "var(--accent-blue)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="loader" style={{ width: 12, height: 12 }} /> Đang chạy tự động...
            </span>
          )}
          {content.html && (
            <button className="btn btn-secondary btn-sm" disabled={addingToProject} onClick={async () => {
              try {
                const projects = await api.getProjects();
                setProjectsList(projects);
                setShowProjectPicker(true);
              } catch (e) { alert("Lỗi: " + e.message); }
            }}>
              {"📂"} Thêm vào Dự án
            </button>
          )}
        </div>
      </div>

      {/* Auto error */}
      {autoStep === "error" && (
        <div className="card" style={{ marginBottom: 16, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", padding: "16px 20px" }}>
          <div style={{ fontWeight: 600, color: "var(--accent-red)", marginBottom: 4 }}>{"❌"} Pipeline gặp lỗi</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.error || "Không rõ lỗi"}</div>
        </div>
      )}

      {/* Pipeline Stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24, padding: "16px 20px", background: "var(--bg-card)", borderRadius: "var(--radius)", border: "1px solid var(--border-color)" }}>
        {STEPS.map((step, i) => {
          const status = getStepStatus(step.key);
          return (
            <div key={step.key} style={{ display: "flex", alignItems: "center", flex: 1, cursor: "pointer" }} onClick={() => setActiveStep(step.key)}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                  background: status === "done" ? "var(--accent-green)" : status === "failed" ? "var(--accent-red)" : status === "processing" ? "var(--accent-blue)" : "var(--bg-tertiary)",
                  color: status !== "pending" ? "#fff" : "var(--text-muted)",
                  boxShadow: activeStep === step.key ? "0 0 0 3px var(--accent-green)" : "none", transition: "box-shadow 0.2s" }}>
                  {stepIcon(status)}
                </div>
                <span style={{ fontSize: 11, fontWeight: activeStep === step.key ? 700 : 500,
                  color: activeStep === step.key ? "var(--accent-green)" : status === "done" ? "var(--accent-green)" : status === "failed" ? "var(--accent-red)" : "var(--text-muted)" }}>
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && <div style={{ height: 2, flex: "0.5", background: status === "done" ? "var(--accent-green)" : "var(--border-color)", margin: "0 4px", marginBottom: 18 }} />}
            </div>
          );
        })}
      </div>

      {/* ====== STEP: Research ====== */}
      {activeStep === "research" && (() => {
        const hasData = research.keyword && research.articles?.length > 0;
        if (processingStep === "research" || autoStep === "research") return <ProcessingUI title="Đang nghiên cứu..." subtitle={`Crawl top Google cho "${d.keyword}"`} />;
        if (!hasData) return (
          <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>{"🔍"}</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có dữ liệu nghiên cứu</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>AI sẽ crawl và phân tích top Google cho "<strong>{d.keyword}</strong>"</p>
            <ErrorAlert stepKey="research" />
            <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }} onClick={() => runStep("research", () => api.generateDraftResearch(d.id))} disabled={processingStep}>
              {"✨"} Bắt đầu nghiên cứu
            </button>
          </div>
        );
        return (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => runStep("research", () => api.generateDraftResearch(d.id))} disabled={processingStep}>{"🔄"} Nghiên cứu lại</button>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <div className="stat-card"><div className="stat-label">Bài phân tích</div><div className="stat-value">{research.articles?.length || 0}</div></div>
              {research.analysis && <>
                <div className="stat-card"><div className="stat-label">Avg. Words</div><div className="stat-value blue">~{research.analysis.avgWordCount || 0}</div></div>
                <div className="stat-card"><div className="stat-label">Avg. Headings</div><div className="stat-value">{research.analysis.avgHeadings || 0}</div></div>
              </>}
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 12px" }}>{"📊"} Top bài viết đã phân tích</h4>
              {(research.articles || []).map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: i < research.articles.length - 1 ? "1px solid var(--border-light)" : "none" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-muted)", width: 20 }}>#{i+1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.title || "Untitled"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 400 }}>{a.url}</div>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{a.wordCount?.toLocaleString()} từ</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{a.headings} headings</span>
                </div>
              ))}
            </div>
            {research.analysis?.commonHeadings?.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 12px" }}>{"📋"} Headings phổ biến</h4>
                {research.analysis.commonHeadings.slice(0, 10).map((h, i) => (
                  <div key={i} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--border-light)" }}>
                    <strong>{h.heading}</strong> <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({h.count}x)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ====== STEP: Outline ====== */}
      {activeStep === "outline" && (() => {
        const hasData = outline.title || outline.outline?.length > 0;
        if (processingStep === "outline" || autoStep === "outline") return <ProcessingUI title="Đang tạo dàn ý..." subtitle="AI đang tạo outline chi tiết" />;
        if (!hasData) return (
          <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>{"📝"}</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có dàn ý</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{!research.keyword ? "Cần hoàn thành bước Nghiên cứu trước." : "AI sẽ tạo outline dựa trên kết quả nghiên cứu."}</p>
            <ErrorAlert stepKey="outline" />
            <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }} disabled={!research.keyword || processingStep} onClick={() => runStep("outline", () => api.generateDraftOutline(d.id))}>
              {"✨"} Tạo dàn ý
            </button>
          </div>
        );
        const h2Sections = (outline.outline || []).filter(s => s.tag === "h2");
        const h3Sections = (outline.outline || []).filter(s => s.tag === "h3");
        return (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => runStep("outline", () => api.generateDraftOutline(d.id))} disabled={processingStep}>{"🔄"} Tạo lại dàn ý</button>
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Tiêu đề SEO</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{outline.title}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{(outline.title || "").length}/60 ký tự</div>
              </div>
              {outline.metaDescription && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Meta Description</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{outline.metaDescription}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{outline.metaDescription.length}/160 ký tự</div>
                </div>
              )}
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 12px" }}>Sections ({h2Sections.length} H2, {h3Sections.length} H3)</h4>
              {h2Sections.map((s, i) => {
                const children = (outline.outline || []).filter(sub => sub.tag === "h3" && sub.parent === i);
                return (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: i < h2Sections.length - 1 ? "1px solid var(--border-light)" : "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent-green)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{s.text}</div>
                      {s.hint && <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{s.hint}</div>}
                      {children.length > 0 && (
                        <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--border-light)" }}>
                          {children.map((sub, j) => (
                            <div key={j} style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>{"→"} {sub.text} {sub.hint ? ` — ${sub.hint}` : ""}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {outline.faq?.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 12px" }}>{"❓"} FAQ ({outline.faq.length})</h4>
                {outline.faq.map((f, i) => (
                  <div key={i} style={{ padding: "8px 0", borderBottom: i < outline.faq.length - 1 ? "1px solid var(--border-light)" : "none" }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{f.question}</div>
                    {f.answer && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{f.answer}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ====== STEP: Content ====== */}
      {activeStep === "content" && (() => {
        const hasContent = content.html;
        const sections = hasContent ? parseHtmlSections(content.html) : [];

        if (processingStep === "content" || autoStep === "content") return <ProcessingUI title="Đang viết bài..." subtitle={`AI đang viết nội dung (${contentGenMode === "quality" ? "Quality mode" : "Basic mode"}, ${targetWordCount} từ)`} />;
        if (!hasContent) return (
          <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>{"📄"}</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có nội dung</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{!(outline.title || outline.outline) ? "Cần hoàn thành bước Dàn ý trước." : "Chọn mode và số từ, rồi tạo nội dung."}</p>
            <ErrorAlert stepKey="content" />
            {(outline.title || outline.outline?.length > 0) && (
              <>
                {/* F1: Mode selector */}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12 }}>
                  {[{ key: "basic", label: "⚡ Basic", sub: "~30s" }, { key: "quality", label: "🏆 Quality", sub: "~90s" }].map(m => (
                    <button key={m.key} className={`btn btn-sm ${contentGenMode === m.key ? "btn-primary" : "btn-secondary"}`}
                      style={{ minWidth: 130, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 12px", gap: 2 }}
                      onClick={() => setContentGenMode(m.key)}>
                      {m.label}<span style={{ fontSize: 10, opacity: 0.7 }}>{m.sub}</span>
                    </button>
                  ))}
                </div>
                {/* F2: Word count presets */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 16 }}>
                  {WORD_COUNT_PRESETS.map(p => (
                    <button key={p.value} className={`btn btn-sm ${targetWordCount === p.value ? "btn-primary" : "btn-secondary"}`}
                      style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setTargetWordCount(p.value)}>{p.label}
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }}
                  disabled={processingStep}
                  onClick={() => runStep("content", () => api.generateDraftContent(d.id, contentGenMode, targetWordCount))}>
                  ✨ Tạo nội dung ({contentGenMode === "quality" ? "Quality" : "Basic"}, {targetWordCount} từ)
                </button>
              </>
            )}
          </div>
        );

        // Word count progress
        const actualWords = content.wordCount || 0;
        const wordProgress = actualWords > 0 ? Math.min(100, Math.round((actualWords / targetWordCount) * 100)) : 0;
        const wordDiff = actualWords - targetWordCount;
        const wordStatus = wordProgress >= 90 && wordProgress <= 120 ? "ok" : wordProgress < 70 ? "low" : wordProgress > 130 ? "over" : "warn";
        const wordColors = { ok: "#10b981", low: "#f59e0b", warn: "#f59e0b", over: "#ef4444" };
        const wordLabels = { ok: "✅ Đạt mục tiêu", low: "⚠️ Còn thiếu", warn: "⚠️ Gần đủ", over: "🔴 Vượt quá" };

        return (
          <div>
            {/* Word count indicator bar */}
            {actualWords > 0 && (
              <div style={{ marginBottom: 12, padding: "10px 16px", background: "var(--bg-card)", borderRadius: 8, border: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: wordColors[wordStatus] }}>{wordLabels[wordStatus]}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      <strong style={{ color: wordColors[wordStatus] }}>{actualWords.toLocaleString()}</strong>
                      {" / "}
                      <input
                        type="number" min={500} max={10000} step={100}
                        value={targetWordCount}
                        onChange={e => setTargetWordCount(Number(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        style={{ width: 72, fontSize: 12, fontWeight: 600, padding: "1px 6px", borderRadius: 5, border: "1px solid var(--border-color)", background: "var(--bg-tertiary)", color: "var(--text-primary)", textAlign: "center" }}
                      />
                      {" từ"}
                      {wordDiff !== 0 && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: wordDiff > 0 ? "#ef4444" : "#f59e0b" }}>
                          ({wordDiff > 0 ? "+" : ""}{wordDiff.toLocaleString()})
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(wordProgress, 100)}%`, background: wordColors[wordStatus], transition: "width 0.4s ease" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {WORD_COUNT_PRESETS.map(p => (
                    <button key={p.value} className={`btn btn-sm ${targetWordCount === p.value ? "btn-primary" : "btn-secondary"}`}
                      style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => setTargetWordCount(p.value)}>{p.value}</button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "var(--text-muted)" }}>
                <span>{"📄"} {content.wordCount?.toLocaleString() || 0} từ</span>
                <span>{"⏱"} ~{Math.ceil((content.wordCount || 0) / 200)} phút đọc</span>
                {content.mode && <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, background: content.mode === "quality" ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.15)", color: content.mode === "quality" ? "#a78bfa" : "#60a5fa" }}>{content.mode === "quality" ? "🏆 Quality" : "⚡ Basic"}</span>}
                {content.usedProvider && <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, background: "rgba(16,185,129,0.12)", color: "#10b981", fontWeight: 600 }} title={content.usedModel || ""}>🤖 {content.usedProvider}{content.usedModel ? ` · ${content.usedModel.split("/").pop().split(":")[0]}` : ""}</span>}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="btn btn-secondary btn-sm" title="Viết lại Basic"
                  onClick={() => runStep("content", () => api.generateDraftContent(d.id, "basic", targetWordCount))} disabled={processingStep}>⚡</button>
                <button className="btn btn-secondary btn-sm" title="Viết lại Quality"
                  onClick={() => runStep("content", () => api.generateDraftContent(d.id, "quality", targetWordCount))} disabled={processingStep}>🏆</button>
                <button className={`btn btn-sm ${contentViewMode === "preview" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentViewMode("preview")}>👁️ Xem</button>
                <button className={`btn btn-sm ${contentViewMode === "edit" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentViewMode("edit")}>✏️ Sửa</button>
                <button className={`btn btn-sm ${contentViewMode === "html" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentViewMode("html")}>{"</>"}HTML</button>
                <button className={`btn btn-sm ${showSectionPanel ? "btn-primary" : "btn-secondary"}`} onClick={() => setShowSectionPanel(v => !v)}>✂️ Viết lại Section</button>
              </div>
            </div>

            {/* F3: Section Rewrite Panel */}
            {showSectionPanel && sections.length > 1 && (
              <div className="card" style={{ marginBottom: 14, padding: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>✂️ Viết Lại Theo Section</div>
                <div style={{ marginBottom: 10, maxHeight: 220, overflowY: "auto" }}>
                  {sections.map((sec, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                      <input type="checkbox" checked={selectedSections.has(i)}
                        onChange={() => { const n = new Set(selectedSections); n.has(i) ? n.delete(i) : n.add(i); setSelectedSections(n); }}
                        style={{ width: 15, height: 15 }} />
                      <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sec.heading
                          ? sec.heading
                          : <em style={{ color: "var(--text-muted)", fontStyle: "italic" }}>{sec.contentSnippet?.slice(0, 60) || "Đoạn mở đầu"}...</em>
                        }
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{sec.wordCount} từ</span>
                      <button className="btn btn-secondary btn-sm" style={{ padding: "2px 6px", fontSize: 11 }}
                        disabled={rewritingSection}
                        onClick={async () => {
                          setRewritingSection(true);
                          try {
                            await api.rewriteDraftSections(d.id, { sectionIndexes: [i], targetWordCount, customInstructions });
                            const updated = await api.getDraft(d.id); setD(updated);
                          } catch (e) { alert("Lỗi: " + e.message); }
                          setRewritingSection(false);
                        }}>🔄</button>
                    </div>
                  ))}
                </div>
                <textarea rows={2} placeholder="Hướng dẫn thêm cho AI (tùy chọn)..." value={customInstructions}
                  onChange={e => setCustomInstructions(e.target.value)}
                  style={{ width: "100%", marginBottom: 10, fontSize: 13, resize: "vertical" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={selectedSections.size === 0 || rewritingSection}
                    onClick={async () => {
                      setRewritingSection(true);
                      try {
                        await api.rewriteDraftSections(d.id, { sectionIndexes: [...selectedSections], targetWordCount, customInstructions });
                        const updated = await api.getDraft(d.id); setD(updated); setSelectedSections(new Set());
                      } catch (e) { alert("Lỗi: " + e.message); }
                      setRewritingSection(false);
                    }}>
                    {rewritingSection ? <><span className="loader" /> Đang viết lại...</> : `🔄 Viết lại ${selectedSections.size} section`}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={rewritingSection}
                    onClick={async () => {
                      if (!confirm(`Viết lại toàn bộ ${sections.length} sections?`)) return;
                      setRewritingSection(true);
                      try {
                        await api.rewriteDraftSections(d.id, { sectionIndexes: sections.map((_, i) => i), targetWordCount, customInstructions });
                        const updated = await api.getDraft(d.id); setD(updated);
                      } catch (e) { alert("Lỗi: " + e.message); }
                      setRewritingSection(false);
                    }}>🔄 Viết lại tất cả</button>
                </div>
              </div>
            )}

            {contentViewMode === "preview" && (
              <div className="card" style={{ padding: 24 }}>
                <div style={{ maxHeight: showFullContent ? "none" : 500, overflow: showFullContent ? "visible" : "hidden", position: "relative" }}>
                  <SafeHtml className="article-content-preview" style={{ fontSize: 15, lineHeight: 1.8 }} html={content.html} />
                  {!showFullContent && (
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(transparent, var(--bg-card))", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => setShowFullContent(true)}>{"📖"} Xem toàn bộ nội dung</button>
                    </div>
                  )}
                </div>
                {showFullContent && <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => setShowFullContent(false)}>{"📖"} Thu gọn</button>}
              </div>
            )}
            {contentViewMode === "edit" && (
              <div className="card" style={{ padding: 16 }}>
                <textarea defaultValue={content.html} style={{ width: "100%", minHeight: 500, background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border-light)", borderRadius: 8, padding: 16, fontSize: 13, fontFamily: "Monaco, Consolas, monospace", resize: "vertical" }}
                  onBlur={async (e) => {
                    const html = e.target.value;
                    const wc = html.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
                    await api.updateDraft(d.id, { pipeline: { ...p, content: { ...content, html, wordCount: wc } } });
                    const updated = await api.getDraft(d.id);
                    setD(updated);
                  }} />
              </div>
            )}
            {contentViewMode === "html" && (
              <pre style={{ background: "var(--bg-tertiary)", padding: 16, borderRadius: 8, fontSize: 12, overflow: "auto", maxHeight: 600, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content.html}</pre>
            )}
          </div>
        );
      })()}


      {/* ====== STEP: Thumbnail ====== */}
      {activeStep === "thumbnail" && (() => {
        const thumb = p.thumbnail;
        const thumbUrl = thumb?.url;
        const thumbStatus = thumb?.status || "pending";
        if (processingStep === "thumbnail" || autoStep === "thumbnail") return <ProcessingUI title="Đang tạo thumbnail..." subtitle="AI đang tạo ảnh đại diện bài viết" />;
        if (thumbStatus === "done" && thumbUrl) return (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
              <img src={thumbUrl} alt="Thumbnail" style={{ width: "100%", height: "auto", display: "block" }} />
            </div>
            {thumb.prompt && <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, fontStyle: "italic" }}>{"📝"} Prompt: {thumb.prompt.substring(0, 200)}{thumb.prompt.length > 200 ? "..." : ""}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" style={{ flex: 1, background: "linear-gradient(135deg, #059669, #10b981)" }} onClick={() => runStep("thumbnail", () => api.autoAttachDraftImages(d.id))} disabled={processingStep}>{"⚡"} Tự động tìm & gắn đủ ảnh (Không bản quyền)</button>
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => runStep("thumbnail", () => api.generateDraftThumbnail(d.id))} disabled={processingStep}>{"🔄"} Tạo lại</button>
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setShowImageReplacer({ type: "thumbnail" })}>{"🔍"} Đổi thủ công</button>
              <a href={thumbUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ flex: 1, textAlign: "center" }}>{"🔗"} Mở ảnh gốc</a>
            </div>
            {showImageReplacer?.type === "thumbnail" && (
              <ImageReplacer label="Thay thumbnail" defaultQuery={d.keyword || outline.title || ""} onClose={() => setShowImageReplacer(null)}
                onReplace={async (data) => { await api.setDraftThumbnailUrl(d.id, data); const updated = await api.getDraft(d.id); setD(updated); }} />
            )}
          </div>
        );
        if (thumbStatus === "failed") return (
          <div className="card" style={{ textAlign: "center", padding: "40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{"❌"}</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--accent-red)" }}>Tạo thumbnail thất bại</h3>
            {thumb?.error && <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{thumb.error}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" style={{ background: "linear-gradient(135deg, #059669, #10b981)" }} onClick={() => runStep("thumbnail", () => api.autoAttachDraftImages(d.id))} disabled={processingStep}>{"⚡"} Tự động tìm & gắn đủ ảnh (Không bản quyền)</button>
              <button className="btn btn-secondary btn-sm" onClick={() => runStep("thumbnail", () => api.generateDraftThumbnail(d.id))} disabled={processingStep}>{"🔄"} Thử lại</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImageReplacer({ type: "thumbnail" })}>{"🔍"} Chọn ảnh thủ công</button>
            </div>
            {showImageReplacer?.type === "thumbnail" && (
              <ImageReplacer label="Chọn thumbnail" defaultQuery={d.keyword || outline.title || ""} onClose={() => setShowImageReplacer(null)}
                onReplace={async (data) => { await api.setDraftThumbnailUrl(d.id, data); const updated = await api.getDraft(d.id); setD(updated); }} />
            )}
          </div>
        );
        return (
          <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>{"🖼️"}</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có thumbnail</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>Hệ thống tự động tìm ảnh chuẩn chủ đề không bản quyền (Openverse CC0, Wikimedia, Google/Bing CC) và gắn trực tiếp vào bài viết.</p>
            <ErrorAlert stepKey="thumbnail" />
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" style={{ background: "linear-gradient(135deg, #059669, #10b981)" }} disabled={processingStep} onClick={() => runStep("thumbnail", () => api.autoAttachDraftImages(d.id))}>{"⚡"} Tự động tìm & gắn đủ ảnh (Không bản quyền)</button>
              <button className="btn btn-secondary btn-sm" disabled={!content.html || processingStep} onClick={() => runStep("thumbnail", () => api.generateDraftThumbnail(d.id))}>{"✨"} Chỉ tạo thumbnail</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImageReplacer({ type: "thumbnail" })}>{"🔍"} Chọn thủ công</button>
              <button className="btn btn-secondary btn-sm" onClick={async () => { await api.updateDraft(d.id, { pipeline: { ...p, thumbnail: { status: "done", url: null, prompt: "Skipped" } } }); const updated = await api.getDraft(d.id); setD(updated); }}>{"⏭️"} Bỏ qua</button>
            </div>
            {showImageReplacer?.type === "thumbnail" && (
              <ImageReplacer label="Chọn thumbnail" defaultQuery={d.keyword || outline.title || ""} onClose={() => setShowImageReplacer(null)}
                onReplace={async (data) => { await api.setDraftThumbnailUrl(d.id, data); const updated = await api.getDraft(d.id); setD(updated); }} />
            )}
          </div>
        );
      })()}

      {/* ====== STEP: Section Images ====== */}
      {activeStep === "sections" && (() => {
        const sectionData = p.sections || {};
        const sectionStatus = sectionData.status || "pending";
        const sectionImages = sectionData.images || [];
        const doneImages = sectionImages.filter(i => i.status === "done" && i.url);
        const isInserted = sectionData.insertedIntoContent;

        if (processingStep === "sections" || autoStep === "sections") return <ProcessingUI title="Đang tạo ảnh sections..." subtitle="AI đang chọn sections phù hợp và tạo ảnh minh hoạ" />;
        if (sectionStatus === "done" && sectionImages.length > 0) return (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{"✅"} {doneImages.length}/{sectionImages.length} ảnh đã tạo</span>
              <div style={{ display: "flex", gap: 6 }}>
                {doneImages.length > 0 && content.html && (
                  <button className="btn btn-primary btn-sm" style={{ background: isInserted ? "var(--accent-blue)" : "var(--accent-green)" }}
                    disabled={processingStep}
                    onClick={async () => {
                      try {
                        const result = await api.insertImagesIntoContent(d.id);
                        const updated = await api.getDraft(d.id);
                        setD(updated);
                        alert(`✅ Đã chèn ${result.insertedCount}/${result.totalImages} ảnh vào bài viết (SEO optimized)`);
                      } catch (e) { alert("Lỗi: " + e.message); }
                    }}>
                    {isInserted ? "🔄 Chèn lại ảnh" : "📥 Chèn ảnh vào bài viết"}
                  </button>
                )}
                <button className="btn btn-primary btn-sm" style={{ background: "linear-gradient(135deg, #059669, #10b981)" }} onClick={() => runStep("sections", () => api.autoAttachDraftImages(d.id))} disabled={processingStep}>{"⚡"} Tự động tìm & gắn đủ ảnh (Không bản quyền)</button>
                <button className="btn btn-secondary btn-sm" onClick={() => runStep("sections", () => api.generateDraftSectionImages(d.id))} disabled={processingStep}>{"🔄"} Tạo lại</button>
              </div>
            </div>

            {isInserted && (
              <div style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", marginBottom: 12, fontSize: 12, color: "var(--accent-green)", display: "flex", alignItems: "center", gap: 6 }}>
                {"✅"} Ảnh đã được chèn vào bài viết với alt text SEO. Xem tại bước "Nội dung" hoặc "Xem & Xuất".
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {sectionImages.map((img, idx) => (
                <div key={idx} className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{img.sectionHeading || `Section ${idx + 1}`}</div>
                    <button className="btn btn-secondary btn-sm" style={{ padding: "2px 8px", fontSize: 10 }}
                      onClick={() => setShowImageReplacer({ type: "section", index: idx })}>
                      {"🔍"} Đổi ảnh
                    </button>
                  </div>
                  {img.status === "done" && img.url ? (
                    <>
                      <img src={img.url} alt={img.sectionHeading} style={{ width: "100%", borderRadius: 6, display: "block", marginBottom: 8 }} />
                      {img.prompt && <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>{"📝"} {img.prompt.substring(0, 100)}</div>}
                    </>
                  ) : (
                    <div style={{ padding: 20, background: "var(--bg-tertiary)", borderRadius: 6, textAlign: "center", fontSize: 12, color: "var(--accent-red)" }}>
                      {"❌"} Thất bại {img.error && <div style={{ marginTop: 4, fontSize: 10 }}>{img.error}</div>}
                      <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
                        onClick={() => setShowImageReplacer({ type: "section", index: idx })}>
                        {"🔍"} Tìm ảnh Google / Upload
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {showImageReplacer?.type === "section" && (
              <ImageReplacer
                label={`Thay ảnh: ${sectionImages[showImageReplacer.index]?.sectionHeading || "Section"}`}
                defaultQuery={`${d.keyword || ""} ${sectionImages[showImageReplacer.index]?.sectionHeading || ""}`.trim()}
                onClose={() => setShowImageReplacer(null)}
                onReplace={async (data) => {
                  await api.setDraftSectionImage(d.id, showImageReplacer.index, data);
                  const updated = await api.getDraft(d.id);
                  setD(updated);
                }} />
            )}
          </div>
        );
        return (
          <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>{"🎨"}</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có ảnh sections</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>AI sẽ chọn 3-4 sections quan trọng nhất và tạo ảnh.</p>
            <ErrorAlert stepKey="sections" />
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" style={{ background: "linear-gradient(135deg, #059669, #10b981)" }} disabled={processingStep} onClick={() => runStep("sections", () => api.autoAttachDraftImages(d.id))}>{"⚡"} Tự động tìm & gắn đủ ảnh (Không bản quyền)</button>
              <button className="btn btn-secondary btn-sm" disabled={!(outline.title || outline.outline?.length) || processingStep} onClick={() => runStep("sections", () => api.generateDraftSectionImages(d.id))}>{"✨"} Chỉ tạo ảnh sections</button>
              <button className="btn btn-secondary btn-sm" onClick={async () => { await api.updateDraft(d.id, { pipeline: { ...p, sections: { status: "done", images: [], skipped: true } } }); const updated = await api.getDraft(d.id); setD(updated); }}>{"⏭️"} Bỏ qua</button>
            </div>
          </div>
        );
      })()}

      {/* ====== STEP: Preview & Export ====== */}
      {activeStep === "preview" && (() => {
        if (!content.html) return (
          <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>{"📋"}</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa sẵn sàng</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Cần hoàn thành ít nhất bước Nội dung.</p>
          </div>
        );
        // QC score từ pipeline
        const qcData = p.quality || p.qc || null;
        const previewActualWords = content.wordCount || 0;
        const previewWordProgress = previewActualWords > 0 ? Math.min(100, Math.round((previewActualWords / targetWordCount) * 100)) : 0;
        const previewWordStatus = previewWordProgress >= 90 && previewWordProgress <= 120 ? "ok" : previewWordProgress < 70 ? "low" : previewWordProgress > 130 ? "over" : "warn";
        const previewWordColors = { ok: "#10b981", low: "#f59e0b", warn: "#f59e0b", over: "#ef4444" };

        return (
          <div>
            {/* Word count summary + QC warnings */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div className="stat-card">
                <div className="stat-label">Số từ thực tế</div>
                <div className="stat-value" style={{ color: previewWordColors[previewWordStatus] }}>{previewActualWords.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>Mục tiêu: {targetWordCount.toLocaleString()}</div>
              </div>
              <div className="stat-card"><div className="stat-label">Thời gian đọc</div><div className="stat-value blue">~{Math.ceil((content.wordCount || 0) / 200)} phút</div></div>
              <div className="stat-card"><div className="stat-label">Thumbnail</div><div className="stat-value">{p.thumbnail?.status === "done" ? (p.thumbnail.url ? "✅" : "⏭️") : "—"}</div></div>
              <div className="stat-card"><div className="stat-label">Ảnh sections</div><div className="stat-value">{p.sections?.status === "done" ? `✅ ${(p.sections.images || []).filter(i => i.status === "done").length}` : "—"}</div></div>
            </div>

            {/* QC Warnings panel */}
            {qcData?.warnings?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                  background: qcData.passed ? "rgba(52,199,89,0.08)" : "rgba(255,150,30,0.08)",
                  borderRadius: showQcWarnings ? "8px 8px 0 0" : 8,
                  border: `1px solid ${qcData.passed ? "rgba(52,199,89,0.3)" : "rgba(255,150,30,0.3)"}`,
                  borderBottom: showQcWarnings ? "none" : undefined,
                  cursor: "pointer",
                }} onClick={() => setShowQcWarnings(v => !v)}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0, background: (qcData.score || 0) >= 80 ? "#10b981" : (qcData.score || 0) >= 60 ? "#f59e0b" : "#ef4444" }}>{qcData.score || "?"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>QC Score: {qcData.score || "?"}/100</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{qcData.issues?.length || 0} lỗi · {qcData.warnings?.length || 0} cảnh báo</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20, background: "rgba(255,150,30,0.15)", border: "1px solid rgba(255,150,30,0.3)", fontSize: 12, fontWeight: 600, color: "#f59e0b" }}>
                    ⚠️ {qcData.warnings.length} cảnh báo <span style={{ fontSize: 10, opacity: 0.8 }}>{showQcWarnings ? "▲" : "▼"}</span>
                  </div>
                </div>
                {showQcWarnings && (
                  <div style={{ border: "1px solid rgba(255,150,30,0.3)", borderTop: "1px solid rgba(255,150,30,0.1)", borderRadius: "0 0 8px 8px", background: "rgba(255,150,30,0.04)" }}>
                    <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,150,30,0.1)", fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>💡 Click vào cảnh báo để chuyển sang bước sửa</div>
                    {qcData.warnings.map((w, i) => {
                      const isLongParagraph = /Đoạn.*quá dài|paragraph.*long/i.test(w);
                      const isTooLong = /bài quá dài|quá.*từ/i.test(w);
                      const isNoImage = /chưa có.*ảnh|ảnh minh hoạ|image/i.test(w);
                      const isSpam = /sáo rỗng|spam|filler/i.test(w);
                      const canFix = isLongParagraph || isTooLong || isSpam;
                      return (
                        <div key={i}
                          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px", borderBottom: i < qcData.warnings.length - 1 ? "1px solid rgba(255,150,30,0.1)" : "none", cursor: canFix || isNoImage ? "pointer" : "default", transition: "background 0.15s" }}
                          onMouseEnter={e => { if (canFix || isNoImage) e.currentTarget.style.background = "rgba(255,150,30,0.08)"; }}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          onClick={() => {
                            if (isNoImage) { setActiveStep("sections"); setShowQcWarnings(false); }
                            else if (canFix) { setActiveStep("content"); setShowSectionPanel(true); setShowQcWarnings(false); }
                          }}
                        >
                          <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚠️</span>
                          <div style={{ flex: 1 }}><div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{w}</div></div>
                          {(canFix || isNoImage) && (
                            <div style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap", flexShrink: 0, background: isNoImage ? "rgba(99,102,241,0.15)" : "rgba(16,185,129,0.15)", color: isNoImage ? "#818cf8" : "#10b981", fontWeight: 600 }}>
                              {isNoImage ? "→ Tạo ảnh" : "→ Sửa section"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
                      <button className="btn btn-sm" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}
                        onClick={() => { setActiveStep("content"); setShowSectionPanel(true); setShowQcWarnings(false); }}>
                        ✂️ Sửa theo section
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setActiveStep("content"); setShowQcWarnings(false); }}>📄 Về tab Nội dung</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="card" style={{ marginBottom: 16, padding: 24 }}>
              {p.thumbnail?.url && <div style={{ marginBottom: 16, borderRadius: 8, overflow: "hidden" }}><img src={p.thumbnail.url} alt="Thumbnail" style={{ width: "100%", height: "auto", display: "block" }} /></div>}
              {outline.title && (
                <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--bg-tertiary)", borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "var(--accent-blue)", marginBottom: 4 }}>{outline.title}</div>
                  {outline.metaDescription && <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{outline.metaDescription}</div>}
                </div>
              )}
              <SafeHtml className="article-content-preview" style={{ fontSize: 15, lineHeight: 1.8 }} html={content.html} />
            </div>

            {p.sections?.images?.filter(i => i.status === "done" && i.url).length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 12px" }}>{"🖼️"} Ảnh sections ({p.sections.images.filter(i => i.status === "done").length})</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                  {p.sections.images.filter(i => i.status === "done" && i.url).map((img, i) => (
                    <div key={i}>
                      <img src={img.url} alt={img.sectionHeading} style={{ width: "100%", borderRadius: 6 }} />
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{img.sectionHeading}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Publish to WordPress */}
            <WpPublishSection draft={d} onPublished={() => {}} />

            {/* Publish to other platforms */}
            <PublishSection draftId={d.id} />

            <div className="card">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigator.clipboard.writeText(content.raw || content.html?.replace(/<[^>]*>/g, "") || "")}>{"📋"} Copy nội dung</button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { const blob = new Blob([content.html || ""], { type: "text/html" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${d.keyword || "article"}.html`; a.click(); URL.revokeObjectURL(url); }}>{"💾"} Tải HTML</button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onBack}>{"←"} Về danh sách</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ===== WordPress Publish Section — dùng trong DraftViewer step "Xem & Xuất" =====
function WpPublishSection({ draft, onPublished }) {
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [pubStatus, setPubStatus] = useState("draft");
  const [categoryIds, setCategoryIds] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [autoPublishOn, setAutoPublishOn] = useState(draft?.autoPublish?.enabled || false);
  const [autoSaving, setAutoSaving] = useState(false);

  useEffect(() => {
    api.getWpSites().then(list => {
      setSites(list);
      // Auto-select: prefer saved siteId from autoPublish, else first connected
      const savedSiteId = draft?.autoPublish?.siteId;
      const targetSite = (savedSiteId && list.find(s => s.id === savedSiteId))
        || list.find(s => s.lastTestOk === true) || list[0];
      if (targetSite) setSelectedSiteId(targetSite.id);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const saveAutoPublish = async (enabled, siteId) => {
    setAutoSaving(true);
    try {
      await api.setAutoPublish(draft.id, { enabled, siteId: siteId || selectedSiteId, status: pubStatus });
    } catch {} finally { setAutoSaving(false); }
  };

  const handleAutoToggle = async (e) => {
    const val = e.target.checked;
    setAutoPublishOn(val);
    await saveAutoPublish(val, selectedSiteId);
  };

  const handleSiteChange = async (id) => {
    setSelectedSiteId(id);
    if (autoPublishOn) await saveAutoPublish(autoPublishOn, id);
  };

  // Published history from pipeline
  const publishedTo = draft?.pipeline?.publishedTo || [];

  const handlePublish = async () => {
    if (!selectedSiteId && sites.length > 0) {
      setError("Vui lòng chọn WordPress site để đăng.");
      return;
    }
    setPublishing(true);
    setResult(null);
    setError(null);
    try {
      const res = await api.publishDraftToWp(draft.id, {
        siteId: selectedSiteId,
        status: pubStatus,
        categoryIds,
      });
      setResult(res);
      if (onPublished) onPublished(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  if (!loaded) return <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>⏳ Đang tải...</div>;

  const selectedSite = sites.find(s => s.id === selectedSiteId);
  const canPublish = draft?.pipeline?.content?.html && (selectedSiteId || sites.length === 0);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 16px", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
        🌐 Đăng lên WordPress
        {publishedTo.length > 0 && (
          <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: "rgba(16,185,129,0.15)", color: "#10b981" }}>
            ✅ Đã đăng {publishedTo.length} lần
          </span>
        )}
      </h4>

      {sites.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🌐</div>
          <p style={{ margin: "0 0 12px" }}>Chưa có kết nối WordPress nào.</p>
          <a href="/settings" style={{ color: "var(--accent-primary)", fontWeight: 600 }}>
            Thêm tại Cài đặt → Đăng bài →
          </a>
        </div>
      ) : (
        <>
          {/* Site Selector */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>Chọn site đăng bài:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sites.map(site => {
                const isSelected = selectedSiteId === site.id;
                const statusColor = site.lastTestOk === true ? "#10b981" : site.lastTestOk === false ? "#ef4444" : "#6b7280";
                const statusLabel = site.lastTestOk === true ? "🟢 OK" : site.lastTestOk === false ? "🔴 Lỗi" : "⚪ Chưa test";
                return (
                  <label key={site.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderRadius: 8, cursor: "pointer",
                    border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-light)",
                    background: isSelected ? "rgba(59,130,246,0.06)" : "var(--bg-secondary)",
                  }}>
                    <input type="radio" name="wp-site" checked={isSelected} onChange={() => handleSiteChange(site.id)}
                      style={{ width: 16, height: 16 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{site.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{site.siteUrl}</div>
                    </div>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: statusColor + "20", color: statusColor, fontWeight: 600 }}>
                      {statusLabel}
                    </span>
                    {site.lastTestOk === false && (
                      <span style={{ fontSize: 11, color: "#ef4444" }} title={site.lastTestMessage}>⚠️</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Publish status + Categories */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>Trạng thái</div>
              <select value={pubStatus} onChange={e => setPubStatus(e.target.value)}
                style={{ width: "100%", fontSize: 13, padding: "8px 10px" }}>
                <option value="draft">📝 Bản nháp</option>
                <option value="publish">🚀 Xuất bản ngay</option>
              </select>
            </div>
            {selectedSite?.categories?.length > 0 && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>Danh mục</div>
                <select onChange={e => setCategoryIds(e.target.value ? [parseInt(e.target.value)] : [])}
                  style={{ width: "100%", fontSize: 13, padding: "8px 10px" }}>
                  <option value="">— Không chọn —</option>
                  {selectedSite.categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name} ({cat.count})</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* SEO preview */}
          {draft?.pipeline?.outline && (
            <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 12 }}>
              <div style={{ color: "var(--text-muted)", fontWeight: 600, marginBottom: 4 }}>📊 SEO Meta (auto-fill)</div>
              <div style={{ color: "var(--accent-primary)", fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {draft.pipeline.outline.title || draft.keyword}
              </div>
              <div style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {draft.pipeline.outline.metaDescription || "—"}
              </div>
              <div style={{ marginTop: 4, color: "var(--text-muted)" }}>
                🔑 Focus keyword: <strong>{draft.pipeline.outline.focusKeyword || draft.keyword}</strong>
                {" · "}RankMath & Yoast auto-fill ✓
              </div>
            </div>
          )}

          {/* Publish button */}
          <button
            className="btn btn-primary"
            style={{ width: "100%", padding: "10px 16px", fontSize: 14, fontWeight: 600 }}
            disabled={!canPublish || publishing || (selectedSite?.lastTestOk === false)}
            onClick={handlePublish}
          >
            {publishing ? (
              <><span className="loader" style={{ width: 14, height: 14, marginRight: 8 }} /> Đang đăng bài...</>
            ) : (
              `📤 Đăng lên ${selectedSite?.name || "WordPress"} (${pubStatus === "publish" ? "Xuất bản ngay" : "Bản nháp"})`
            )}
          </button>

          {selectedSite?.lastTestOk === false && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444", textAlign: "center" }}>
              ⚠️ Kết nối bị lỗi. <a href="/settings" style={{ color: "#ef4444", textDecoration: "underline" }}>Vào Cài đặt → Đăng bài để sửa →</a>
            </div>
          )}

          {/* Auto-publish toggle */}
          {selectedSiteId && (
            <div style={{
              marginTop: 12, padding: "10px 14px", borderRadius: 8,
              background: autoPublishOn ? "rgba(16,185,129,0.06)" : "var(--bg-secondary)",
              border: `1px solid ${autoPublishOn ? "rgba(16,185,129,0.25)" : "var(--border-light)"}`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1 }}>
                <input type="checkbox" checked={autoPublishOn} onChange={handleAutoToggle}
                  style={{ width: 16, height: 16 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    🔁 Tự đăng sau khi pipeline xong
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {autoPublishOn
                      ? `Sẽ tự đăng lên ${selectedSite?.name} khi hoàn tất`
                      : "Bật để tự đăng khi AI viết xong"}
                  </div>
                </div>
              </label>
              {autoSaving && <span className="loader" style={{ width: 12, height: 12 }} />}
              {autoPublishOn && !autoSaving && <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>✓ Đã lưu</span>}
            </div>
          )}
        </>
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 8, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <div style={{ fontWeight: 600, color: "#10b981", marginBottom: 6 }}>✅ Đăng bài thành công!</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Site: <strong>{result.siteName}</strong> · WP Post ID: #{result.id}
            {" · "}<span style={{ color: result.status === "publish" ? "#10b981" : "#f59e0b", fontWeight: 600 }}>
              {result.status === "publish" ? "🟢 Đã xuất bản" : "📝 Bản nháp"}
            </span>
          </div>
          <a href={result.previewLink || result.link} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: 13, color: "var(--accent-primary)", fontWeight: 600 }}>
            🔗 {result.status === "draft" ? "Xem preview (cần đăng nhập WP admin)" : "Xem bài viết"} →
          </a>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 13, color: "#ef4444" }}>
          ❌ {error}
        </div>
      )}

      {/* Publish history */}
      {publishedTo.length > 0 && !result && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border-light)", paddingTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>📋 Lịch sử đăng:</div>
          {publishedTo.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", fontSize: 12 }}>
              ✅ <strong>{p.siteName}</strong>
              <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 11 }}>
                {p.publishedAt ? new Date(p.publishedAt).toLocaleString("vi-VN") : ""}
              </span>
              {(p.wpPreviewLink || p.wpLink) && (
                <a href={p.wpPreviewLink || p.wpLink} target="_blank" rel="noopener noreferrer"
                  title={p.wpStatus === "draft" ? "Cần đăng nhập WP admin để xem bản nháp" : "Xem bài viết"}
                  style={{ fontSize: 11 }}>🔗{p.wpStatus === "draft" ? " (draft)" : ""}</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


