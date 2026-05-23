import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

const INTENT_COLORS = { informational: "#3b82f6", commercial: "#f59e0b", transactional: "#10b981", navigational: "#8b5cf6" };
const ANGLE_ICONS = { guide: "📖", list: "📋", review: "⭐", comparison: "⚖️", definition: "📚", tutorial: "🎓", cost: "💰", faq: "❓" };
const PRIORITY_COLORS = { high: "#10b981", medium: "#f59e0b", low: "#6b7280" };

export default function TopicalMap() {
  const navigate = useNavigate();
  const [maps, setMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [seedKeyword, setSeedKeyword] = useState("");
  const [language, setLanguage] = useState("vi");
  const [totalArticles, setTotalArticles] = useState(20);
  const [selectedArticles, setSelectedArticles] = useState(new Set());
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    loadMaps();
    return () => clearInterval(pollRef.current);
  }, []);

  async function loadMaps() {
    try {
      const data = await api.getTopicalMaps();
      setMaps(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!seedKeyword.trim()) return;
    setGenerating(true);
    setShowForm(false);
    try {
      const record = await api.generateTopicalMap({ seedKeyword: seedKeyword.trim(), language, totalArticles });
      setMaps(prev => [{ ...record, stats: null }, ...prev]);
      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const updated = await api.getTopicalMap(record.id);
          setMaps(prev => prev.map(m => m.id === record.id ? { ...updated, stats: updated.map?.stats || null } : m));
          if (updated.status === "done" || updated.status === "failed") {
            clearInterval(pollRef.current);
            setGenerating(false);
            if (updated.status === "done") {
              setSelectedMap(updated);
              setSelectedArticles(new Set());
              setExpandedClusters(new Set(updated.map?.clusters?.map(c => c.id) || []));
            }
          }
        } catch {}
      }, 3000);
    } catch (e) {
      alert("Lỗi: " + e.message);
      setGenerating(false);
    }
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!confirm("Xóa topical map này?")) return;
    try {
      await api.deleteTopicalMap(id);
      setMaps(prev => prev.filter(m => m.id !== id));
      if (selectedMap?.id === id) setSelectedMap(null);
    } catch (e) { alert("Lỗi: " + e.message); }
  }

  async function handleViewMap(map) {
    try {
      const full = await api.getTopicalMap(map.id);
      setSelectedMap(full);
      setSelectedArticles(new Set());
      setExpandedClusters(new Set(full.map?.clusters?.map(c => c.id) || []));
    } catch (e) { alert("Lỗi: " + e.message); }
  }

  function toggleArticle(id) {
    setSelectedArticles(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (!selectedMap?.map) return;
    const all = new Set();
    all.add("pillar");
    selectedMap.map.clusters?.forEach(c => c.articles?.forEach(a => all.add(a.id)));
    setSelectedArticles(all);
  }

  function clearAll() { setSelectedArticles(new Set()); }

  async function handleImport() {
    if (!selectedArticles.size) return;
    setImporting(true);
    try {
      const result = await api.importTopicalMapToPipeline(selectedMap.id, [...selectedArticles]);
      alert(`✅ Đã import ${result.created} bài vào Pipeline!`);
      navigate("/pipeline");
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setImporting(false);
    }
  }

  // ===== DETAIL VIEW =====
  if (selectedMap) {
    const map = selectedMap.map;
    const allCount = 1 + (map?.clusters?.reduce((s, c) => s + (c.articles?.length || 0), 0) || 0);
    return (
      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelectedMap(null)}>← Quay lại</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>🗺️ {selectedMap.seedKeyword}</h1>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {map?.stats?.totalArticles} bài · {map?.stats?.clusters} clusters · {map?.stats?.totalWords?.toLocaleString()} từ ước tính
            </div>
          </div>
        </div>

        {/* Pillar Card */}
        {map?.pillar && (
          <div style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ background: "rgba(139,92,246,0.2)", color: "#8b5cf6", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>🏛️ PILLAR</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>~{map.pillar.estimatedWords?.toLocaleString()} từ</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{map.pillar.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{map.pillar.description}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 11, background: INTENT_COLORS[map.pillar.searchIntent] + "22", color: INTENT_COLORS[map.pillar.searchIntent], padding: "2px 8px", borderRadius: 20 }}>{map.pillar.searchIntent}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>🔑 {map.pillar.keyword}</span>
                </div>
              </div>
              <input type="checkbox" style={{ width: 18, height: 18, marginTop: 4, cursor: "pointer" }}
                checked={selectedArticles.has("pillar")}
                onChange={() => toggleArticle("pillar")} />
            </div>
          </div>
        )}

        {/* Clusters */}
        {map?.clusters?.map(cluster => (
          <div key={cluster.id} className="card" style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", cursor: "pointer", background: "var(--bg-secondary)" }}
              onClick={() => setExpandedClusters(prev => {
                const next = new Set(prev);
                next.has(cluster.id) ? next.delete(cluster.id) : next.add(cluster.id);
                return next;
              })}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13 }}>{expandedClusters.has(cluster.id) ? "▼" : "▶"}</span>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{cluster.name}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>({cluster.articles?.length || 0} bài)</span>
                  {cluster.description && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{cluster.description}</div>}
                </div>
              </div>
              <span style={{ fontSize: 11, background: INTENT_COLORS[cluster.searchIntent] + "22", color: INTENT_COLORS[cluster.searchIntent], padding: "2px 8px", borderRadius: 20 }}>{cluster.searchIntent}</span>
            </div>

            {expandedClusters.has(cluster.id) && (
              <div>
                {cluster.articles?.map((art, idx) => (
                  <div key={art.id} onClick={() => toggleArticle(art.id)} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--border-subtle)", cursor: "pointer", background: selectedArticles.has(art.id) ? "rgba(16,185,129,0.05)" : "transparent", transition: "background 0.15s" }}>
                    <input type="checkbox" style={{ width: 16, height: 16, marginTop: 3, cursor: "pointer" }} checked={selectedArticles.has(art.id)} onChange={() => toggleArticle(art.id)} onClick={e => e.stopPropagation()} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{art.title}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>🔑 {art.keyword}</span>
                        <span style={{ fontSize: 10, background: INTENT_COLORS[art.searchIntent] + "22", color: INTENT_COLORS[art.searchIntent], padding: "1px 6px", borderRadius: 10 }}>{art.searchIntent}</span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{ANGLE_ICONS[art.contentAngle]} {art.contentAngle}</span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>~{art.estimatedWords?.toLocaleString()} từ</span>
                        <span style={{ fontSize: 10, color: PRIORITY_COLORS[art.priority], fontWeight: 600 }}>● {art.priority}</span>
                      </div>
                      {art.notes && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontStyle: "italic" }}>💡 {art.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Floating Import Bar */}
        {selectedArticles.size > 0 && (
          <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--accent-green)", borderRadius: 12, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.3)", zIndex: 100 }}>
            <span style={{ fontWeight: 600 }}>✅ Đã chọn <strong>{selectedArticles.size}</strong> bài</span>
            <button className="btn btn-secondary btn-sm" onClick={selectAll}>Chọn tất cả ({allCount})</button>
            <button className="btn btn-secondary btn-sm" onClick={clearAll}>Bỏ chọn</button>
            <button className="btn btn-primary" onClick={handleImport} disabled={importing} style={{ background: "var(--accent-green)" }}>
              {importing ? "⏳ Đang import..." : `📥 Import ${selectedArticles.size} bài vào Pipeline →`}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ===== LIST VIEW =====
  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🗺️ Topical Map Generator</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>Nhập 1 seed keyword → AI tạo bản đồ nội dung hoàn chỉnh theo cấu trúc Pillar-Cluster</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(v => !v)} disabled={generating}>
          {generating ? "⏳ Đang tạo..." : showForm ? "✕ Đóng" : "+ Tạo Topical Map"}
        </button>
      </div>

      {/* Generate Form */}
      {showForm && (
        <div className="card" style={{ padding: 20, marginBottom: 20, border: "1px solid var(--accent-green)" }}>
          <form onSubmit={handleGenerate}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "end" }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Seed Keyword *</label>
                <input value={seedKeyword} onChange={e => setSeedKeyword(e.target.value)} placeholder="vd: vợt pickleball, đồng hồ thể thao..."
                  style={{ width: "100%", padding: "10px 12px", fontSize: 14 }} autoFocus required />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Ngôn ngữ</label>
                <select value={language} onChange={e => setLanguage(e.target.value)} style={{ padding: "10px 12px", fontSize: 14 }}>
                  <option value="vi">🇻🇳 Tiếng Việt</option>
                  <option value="en">🇺🇸 English</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Số bài (~)</label>
                <select value={totalArticles} onChange={e => setTotalArticles(Number(e.target.value))} style={{ padding: "10px 12px", fontSize: 14 }}>
                  <option value={10}>10 bài</option>
                  <option value={15}>15 bài</option>
                  <option value={20}>20 bài</option>
                  <option value={30}>30 bài</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" style={{ background: "var(--accent-green)" }} disabled={!seedKeyword.trim()}>🚀 Tạo Topical Map</button>
              <div style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>⏱️ AI sẽ tạo trong ~30-60 giây</div>
            </div>
          </form>
        </div>
      )}

      {/* Generating indicator */}
      {generating && (
        <div className="card" style={{ padding: 20, marginBottom: 20, textAlign: "center", border: "1px solid rgba(59,130,246,0.3)" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>AI đang phân tích niche và tạo Topical Map...</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Thường mất 30-60 giây. Bạn có thể làm việc khác trong lúc chờ.</div>
          <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 12 }}>
            {[0,1,2].map(i => <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-blue)", display: "inline-block", animation: `pulse 1.2s ease-in-out ${i * 0.4}s infinite` }} />)}
          </div>
        </div>
      )}

      {/* Map List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>⏳ Đang tải...</div>
      ) : maps.length === 0 && !generating ? (
        <div style={{ textAlign: "center", padding: 80 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🗺️</div>
          <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có Topical Map nào</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>Nhập 1 seed keyword và AI sẽ tạo toàn bộ kế hoạch nội dung cho niche đó.</p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Tạo Topical Map đầu tiên</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {maps.map(map => (
            <div key={map.id} className="card" style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: map.status === "done" ? "pointer" : "default" }}
              onClick={() => map.status === "done" && handleViewMap(map)}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>🔑 {map.seedKeyword}</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600,
                    background: map.status === "done" ? "rgba(16,185,129,0.1)" : map.status === "failed" ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.1)",
                    color: map.status === "done" ? "var(--accent-green)" : map.status === "failed" ? "var(--accent-red)" : "var(--accent-blue)" }}>
                    {map.status === "done" ? "✅ Hoàn thành" : map.status === "failed" ? "❌ Thất bại" : "⏳ Đang tạo..."}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  {map.status === "done" && map.stats ? (
                    <span>{map.stats.totalArticles} bài · {map.stats.clusters} clusters · {map.stats.totalWords?.toLocaleString()} từ</span>
                  ) : map.status === "failed" ? (
                    <span style={{ color: "var(--accent-red)" }}>{map.error}</span>
                  ) : (
                    <span>AI đang xử lý...</span>
                  )}
                  <span style={{ marginLeft: 12 }}>📅 {new Date(map.createdAt).toLocaleDateString("vi-VN")}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {map.status === "done" && (
                  <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); handleViewMap(map); }}>Xem chi tiết →</button>
                )}
                <button className="btn btn-secondary btn-sm" style={{ color: "var(--accent-red)" }}
                  onClick={e => handleDelete(map.id, e)}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
