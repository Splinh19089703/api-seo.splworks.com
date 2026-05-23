import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../api";
import * as XLSX from "xlsx";

export default function KeywordClusteringTab({ projectId }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadedKws, setUploadedKws] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [activeResult, setActiveResult] = useState(null);
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [copiedClusterId, setCopiedClusterId] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planName, setPlanName] = useState("");

  const loadResults = () => {
    api.getClusterings(projectId)
      .then(setResults)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadResults(); }, [projectId]);

  useEffect(() => {
    const clusteringId = searchParams.get("clustering");
    if (!clusteringId) return;
    api.getClustering(projectId, clusteringId)
      .then((item) => setActiveResult(item))
      .catch(() => {});
  }, [projectId, searchParams]);

  // Poll for progress when there's a processing result
  useEffect(() => {
    if (!activeResult || activeResult.status !== "processing") return;
    const interval = setInterval(async () => {
      try {
        const updated = await api.getClustering(projectId, activeResult.id);
        setActiveResult(updated);
        if (updated.status === "done" || updated.status === "failed") {
          clearInterval(interval);
          loadResults();
        }
      } catch (e) { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeResult?.id, activeResult?.status]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      const items = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });

      const parsed = [];
      items.forEach((item) => {
        const keys = Object.keys(item);
        if (keys.length === 0) return;
        const kwKey = keys.find(k => k.toLowerCase().includes("từ khóa") || k.toLowerCase().includes("keyword")) || keys[0];
        const volKey = keys.find(k => k.toLowerCase().includes("volume") || k.toLowerCase().includes("vol")) || keys[1];
        const keyword = String(item[kwKey] || "").trim();
        const volume = parseInt(String(item[volKey] || "0").replace(/[^\d]/g, ""), 10) || 0;
        if (keyword) parsed.push({ keyword, volume });
      });
      setUploadedKws(parsed);
      setShowUpload(true);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleStartClustering = async () => {
    if (uploadedKws.length === 0) return;
    setProcessing(true);
    try {
      const result = await api.startClustering(projectId, { keywords: uploadedKws });
      setActiveResult(result);
      setShowUpload(false);
      setUploadedKws([]);
      loadResults();
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveAsPlan = async () => {
    if (!activeResult) return;
    setSavingPlan(true);
    try {
      await api.saveClusteringAsPlan(projectId, activeResult.id, { planName: planName || activeResult.progress?.message });
      setShowSaveModal(false);
      setPlanName("");
      alert("Đã lưu thành Keyword Plan! Chuyển sang tab KW Plan để xem.");
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setSavingPlan(false);
    }
  };

  const handleCopyText = () => {
    if (!activeResult?.clusters) return;
    let text = "";
    activeResult.clusters.forEach((c, i) => {
      text += `\n=== ${i + 1}. ${c.name} (${c.searchIntent}) ===\n`;
      text += `Pillar: ${c.pillarKeyword} | Vol: ${c.totalVolume || 0}\n`;
      c.keywords.forEach(k => {
        text += `  - ${k.keyword} (${k.volume || 0})\n`;
      });
    });
    navigator.clipboard.writeText(text.trim());
    alert("Đã copy danh sách nhóm vào clipboard!");
  };

  const handleCopyCluster = (e, cluster) => {
    e.stopPropagation();
    let text = `=== ${cluster.name} (${cluster.searchIntent}) ===\n`;
    text += `Pillar: ${cluster.pillarKeyword} | Vol: ${cluster.totalVolume || 0}\n`;
    cluster.keywords.forEach(k => {
      text += `  - ${k.keyword} (${k.volume || 0})\n`;
    });
    navigator.clipboard.writeText(text.trim());
    setCopiedClusterId(cluster.id);
    setTimeout(() => setCopiedClusterId(null), 1500);
  };

  const handleExportExcel = () => {
    if (!activeResult?.clusters) return;
    const rows = [];
    activeResult.clusters.forEach(c => {
      c.keywords.forEach(k => {
        rows.push({
          "Nhóm": c.name,
          "Search Intent": c.searchIntent,
          "Content Angle": c.contentAngle,
          "Từ khóa": k.keyword,
          "Volume": k.volume || 0,
          "Loại": k.type === "pillar" ? "Pillar" : "Cluster",
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clusters");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-clustering-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleCluster = (id) => {
    const n = new Set(expandedClusters);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpandedClusters(n);
  };

  const expandAll = () => {
    if (!activeResult?.clusters) return;
    setExpandedClusters(new Set(activeResult.clusters.map(c => c.id)));
  };

  const collapseAll = () => setExpandedClusters(new Set());

  // If viewing a specific result
  if (activeResult) {
    const isProcessing = activeResult.status === "processing";
    const isDone = activeResult.status === "done";
    const isFailed = activeResult.status === "failed";
    const progress = activeResult.progress || {};
    const clusters = activeResult.clusters || [];

    return (
      <div style={{ marginTop: 20 }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setActiveResult(null);
            setSearchParams({});
          }}
          style={{ marginBottom: 16 }}
        >
          ← Quay lại danh sách
        </button>

        {/* Progress Section */}
        {isProcessing && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>🔄 Đang xử lý AI Clustering...</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px" }}>
              {progress.message || "Đang xử lý..."}
            </p>
            <div className="progress-bar-container">
              <div className="progress-bar-fill" style={{ width: `${progress.percent || 5}%`, transition: "width 0.5s ease" }} />
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, textAlign: "right" }}>
              {progress.percent || 5}%  ·  Bước {progress.step || 1}/{activeResult?.serpVerified !== undefined ? 5 : 3}
            </div>
          </div>
        )}

        {isFailed && (
          <div className="card" style={{ marginBottom: 20, background: "var(--error-bg, #fff0f0)" }}>
            <h3 style={{ margin: 0, color: "var(--color-danger, red)" }}>❌ Lỗi xử lý</h3>
            <p style={{ fontSize: 13, margin: "8px 0 0" }}>{progress.message || "Đã xảy ra lỗi."}</p>
          </div>
        )}

        {/* Results Review */}
        {isDone && (
          <>
            {/* Stats Summary */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>✅ Kết quả nhóm từ khoá</h3>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
                    {clusters.length} nhóm · {activeResult.totalAllocated || 0} từ khoá · Tổng Volume: {clusters.reduce((s, c) => s + (c.totalVolume || 0), 0).toLocaleString()}
                    {activeResult.serpVerified && (
                      <span className="badge badge-success" style={{ marginLeft: 8, fontSize: 11 }}>✅ SERP Verified ({activeResult.serpData?.queriesUsed || 0} queries)</span>
                    )}
                    {activeResult.serpVerified === false && (
                      <span className="badge badge-secondary" style={{ marginLeft: 8, fontSize: 11 }}>⚠️ AI Only (thêm Serper key để xác minh SERP)</span>
                    )}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-secondary btn-sm" onClick={handleCopyText}>📋 Copy Text</button>
                  <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}>⬇️ Xuất Excel</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { setShowSaveModal(true); setPlanName(""); }}>
                    💾 Lưu thành KW Plan
                  </button>
                </div>
              </div>
            </div>

            {/* Expand/Collapse */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={expandAll}>Mở rộng tất cả</button>
              <button className="btn btn-secondary btn-sm" onClick={collapseAll}>Thu gọn tất cả</button>
            </div>

            {/* Cluster Accordion */}
            {[...clusters].sort((a, b) => {
              if (a.name === "[Uncategorized]") return 1;
              if (b.name === "[Uncategorized]") return -1;
              return (b.totalVolume || 0) - (a.totalVolume || 0);
            }).map((cluster, idx) => {
              const isExpanded = expandedClusters.has(cluster.id);
              const isUncat = cluster.name === "[Uncategorized]";
              return (
                <div key={cluster.id} className="card" style={{
                  marginBottom: 8,
                  border: isUncat ? "1px solid var(--color-danger, #e55)" : "1px solid var(--border-light)",
                  opacity: isUncat ? 0.7 : 1,
                }}>
                  <div
                    onClick={() => toggleCluster(cluster.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "4px 0" }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, minWidth: 28 }}>{isExpanded ? "▼" : "▶"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {idx + 1}. {cluster.name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {cluster.description || ""}
                      </div>
                    </div>
                    <span className={`badge ${cluster.searchIntent === "commercial" || cluster.searchIntent === "transactional" ? "badge-warning" : "badge-info"}`}>
                      {cluster.searchIntent}
                    </span>
                    <span className="badge badge-secondary">{cluster.contentAngle}</span>
                    {cluster.serpVerified && <span className="badge badge-success" style={{ fontSize: 10 }}>🔍 SERP</span>}
                    {cluster.serpMerged && <span className="badge badge-warning" style={{ fontSize: 10 }}>🔗 Merged</span>}
                    <div style={{ textAlign: "right", minWidth: 80 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{cluster.keywords.length}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Vol: {(cluster.totalVolume || 0).toLocaleString()}</div>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      title="Copy nhóm này"
                      onClick={(e) => handleCopyCluster(e, cluster)}
                      style={{ padding: "4px 8px", fontSize: 12, minWidth: 32, position: "relative" }}
                    >
                      {copiedClusterId === cluster.id ? "✅" : "📋"}
                    </button>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-light)", paddingTop: 12 }}>
                      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>#</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>Từ khoá</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>Volume</th>
                            <th style={{ textAlign: "center", padding: "4px 8px", fontWeight: 600 }}>Loại</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cluster.keywords.map((kw, ki) => (
                            <tr key={ki} style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <td style={{ padding: "4px 8px", color: "var(--text-muted)" }}>{ki + 1}</td>
                              <td style={{ padding: "4px 8px", fontWeight: kw.type === "pillar" ? 600 : 400 }}>
                                {kw.type === "pillar" ? "⭐ " : ""}{kw.keyword}
                              </td>
                              <td style={{ padding: "4px 8px", textAlign: "right" }}>{(kw.volume || 0).toLocaleString()}</td>
                              <td style={{ padding: "4px 8px", textAlign: "center" }}>
                                <span className={`badge ${kw.type === "pillar" ? "badge-success" : "badge-secondary"}`} style={{ fontSize: 10 }}>
                                  {kw.type === "pillar" ? "Pillar" : "Cluster"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Save as Plan Modal */}
        {showSaveModal && (
          <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
              <h2>Lưu thành Keyword Plan</h2>
              <div className="form-group">
                <label>Tên Plan *</label>
                <input
                  placeholder="VD: Pickleball SEO Plan"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  autoFocus
                />
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Sẽ tạo KW Plan với {clusters.filter(c => c.name !== "[Uncategorized]").length} nhóm,
                bỏ qua nhóm [Uncategorized] nếu có.
                {" "}🪄 AI sẽ tự động gợi ý tiêu đề bài viết cho từng keyword.
              </p>
              {savingPlan && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: 8, marginBottom: 8 }}>
                  <span className="loader" style={{ width: 16, height: 16 }} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Đang tạo plan và generate tiêu đề AI... (có thể mất 10-30s)</span>
                </div>
              )}
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowSaveModal(false)} disabled={savingPlan}>Hủy</button>
                <button className="btn btn-primary" onClick={handleSaveAsPlan} disabled={!planName.trim() || savingPlan}>
                  {savingPlan ? "⏳ Đang xử lý..." : "💾 Lưu Plan"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main list view
  return (
    <div style={{ marginTop: 20 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>🪄 AI Keyword Clustering</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
              Upload file Excel chứa từ khoá, AI sẽ tự động phân nhóm theo cấu trúc Pillar-Cluster chuẩn SEO.
            </p>
          </div>
          <label className="btn btn-primary btn-sm" style={{ cursor: "pointer" }}>
            <input type="file" accept=".xlsx,.csv" style={{ display: "none" }} onChange={handleFileUpload} />
            📂 Upload Excel để bắt đầu
          </label>
        </div>
      </div>

      {/* Upload Preview Modal */}
      {showUpload && (
        <div className="modal-overlay" onClick={() => setShowUpload(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h2>📂 Xác nhận danh sách từ khoá</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Đã đọc được <strong>{uploadedKws.length}</strong> từ khoá từ file Excel.
              Tổng Volume: <strong>{uploadedKws.reduce((s, k) => s + k.volume, 0).toLocaleString()}</strong>
            </p>

            <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--border-light)", borderRadius: 8, marginBottom: 16 }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-secondary)", position: "sticky", top: 0 }}>
                    <th style={{ textAlign: "left", padding: "6px 10px" }}>#</th>
                    <th style={{ textAlign: "left", padding: "6px 10px" }}>Từ khoá</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadedKws.slice(0, 100).map((k, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-light)" }}>
                      <td style={{ padding: "4px 10px", color: "var(--text-muted)" }}>{i + 1}</td>
                      <td style={{ padding: "4px 10px" }}>{k.keyword}</td>
                      <td style={{ padding: "4px 10px", textAlign: "right" }}>{k.volume.toLocaleString()}</td>
                    </tr>
                  ))}
                  {uploadedKws.length > 100 && (
                    <tr><td colSpan={3} style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-muted)" }}>
                      ... và {uploadedKws.length - 100} từ khoá khác
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowUpload(false)}>Hủy</button>
              <button className="btn btn-primary" onClick={handleStartClustering} disabled={processing}>
                {processing ? "Đang gửi..." : `🪄 Bắt đầu nhóm ${uploadedKws.length} từ khoá`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Past Results */}
      {loading ? (
        <div className="loading-overlay"><span className="loader" /></div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: 48 }}>🪄</div>
          <h3>Chưa có kết quả clustering nào</h3>
          <p>Upload file Excel chứa danh sách từ khoá để AI tự động nhóm.</p>
        </div>
      ) : (
        <div>
          <div className="section-label">LỊCH SỬ CLUSTERING</div>
          {results.map(r => (
            <div key={r.id} className="plan-row" onClick={() => r.status !== "processing" && setActiveResult(r)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {r.totalKeywords} từ khoá → {r.totalClusters || "..."} nhóm
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {new Date(r.createdAt).toLocaleString("vi-VN")}
                </div>
              </div>
              <span className={`badge ${r.status === "done" ? "badge-success" : r.status === "processing" ? "badge-info" : r.status === "cancelled" ? "badge-warning" : "badge-danger"}`}>
                {r.status === "done" ? "Hoàn tất" : r.status === "processing" ? `Đang xử lý ${r.progress?.percent || 0}%` : r.status === "cancelled" ? "Đã dừng" : "Lỗi"}
              </span>
              {r.status === "processing" && (
                <button className="btn btn-secondary btn-sm" title="Tạm dừng" onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm("Tạm dừng clustering này?")) {
                    await api.cancelClustering(projectId, r.id);
                    loadResults();
                  }
                }}>⏸️</button>
              )}
              <button className="btn btn-danger btn-sm" title="Xóa" onClick={async (e) => {
                e.stopPropagation();
                if (confirm("Xóa kết quả clustering này?")) {
                  await api.deleteClustering(projectId, r.id);
                  if (activeResult?.id === r.id) setActiveResult(null);
                  loadResults();
                }
              }}>🗑️</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
