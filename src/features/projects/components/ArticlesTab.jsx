import { useState, useEffect } from "react";
import { api } from "../../../api";
import ArticleDetailView from "./ArticleDetailView";

export default function ArticlesTab({ projectId, onUpdate }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState("single");
  const [kwInput, setKwInput] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedArticle, setSelectedArticle] = useState(null);

  useEffect(() => {
    api.getArticles(projectId).then(setArticles).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  const handleCreate = async () => {
    const kws = createMode === "single" ? [kwInput] : kwInput.split("\n").filter(Boolean);
    await api.createArticles(projectId, {
      keywords: kws.map((k) => ({ keyword: k.trim(), contentAngle: "basic", estimatedWords: 2000, searchIntent: "informational" })),
      mode: createMode,
    });
    setShowCreate(false);
    setKwInput("");
    setArticles(await api.getArticles(projectId));
    onUpdate();
  };

  const pipelineSteps = ["research", "outline", "content", "thumbnail", "sections", "publish"];
  const stepLabels = { research: "Research", outline: "Outline", content: "Nội dung", thumbnail: "Thumb", sections: "Section", publish: "GSC" };
  const stepIcons = { pending: "—", processing: "🔄", done: "✅", error: "❌", failed: "❌", generating: "🔄", imported: "📥", skipped: "⏭️", published: "✅" };

  const QualityBadge = ({ quality }) => {
    if (!quality) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>;
    const { score, passed, issues, warnings } = quality;
    const color = score >= 80 ? "var(--accent-green)" : score >= 60 ? "var(--accent-orange)" : "var(--accent-red)";
    const bg = score >= 80 ? "rgba(52,199,89,0.12)" : score >= 60 ? "rgba(255,159,10,0.12)" : "rgba(255,59,48,0.12)";
    const icon = passed ? "✅" : issues?.length > 0 ? "❌" : "⚠️";
    return (
      <span title={`${score}/100 | ${issues?.length || 0} lỗi, ${warnings?.length || 0} cảnh báo`}
        style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, color, background: bg, cursor: "default" }}>
        {icon} {score}
      </span>
    );
  };

  const filtered = articles.filter((a) => {
    if (filter === "all") return true;
    if (filter === "error") return Object.values(a.pipeline || {}).some((s) => s.status === "error" || s.status === "failed");
    if (filter === "processing") return a.status === "processing";
    if (filter === "pending") return a.approvalStatus === "pending" || (!a.approvalStatus && a.pipeline?.content?.status === "done");
    if (filter === "approved") return a.approvalStatus === "approved";
    if (filter === "rejected") return a.approvalStatus === "rejected" || a.approvalStatus === "revision";
    if (filter === "imported") return a.source === "wp-import";
    return true;
  });

  const openArticleDetail = async (article) => {
    try { const fresh = await api.getArticle(projectId, article.id); setSelectedArticle(fresh); }
    catch (e) { setSelectedArticle(article); }
  };

  if (selectedArticle) {
    return (
      <ArticleDetailView
        article={selectedArticle}
        projectId={projectId}
        onBack={async () => {
          try {
            const fresh = await api.getArticle(projectId, selectedArticle.id);
            setSelectedArticle(fresh);
            setArticles(await api.getArticles(projectId));
          } catch (e) {
            setSelectedArticle(null);
          }
        }}
      />
    );
  }

  // === ARTICLE LIST VIEW (default) ===
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ flex: 1 }}><input type="text" placeholder="🔍 Tìm kiếm bài viết..." style={{ width: "100%", maxWidth: 400 }} /></div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Thêm bài</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "all", label: `Tất cả (${articles.length})` },
          { id: "pending", label: `⏳ Chờ duyệt (${articles.filter((a) => a.approvalStatus === "pending" || (!a.approvalStatus && a.pipeline?.content?.status === "done")).length})` },
          { id: "approved", label: `✅ Đã duyệt (${articles.filter((a) => a.approvalStatus === "approved").length})` },
          { id: "rejected", label: `❌ Từ chối (${articles.filter((a) => a.approvalStatus === "rejected" || a.approvalStatus === "revision").length})` },
          { id: "error", label: `Lỗi (${articles.filter((a) => Object.values(a.pipeline || {}).some((s) => s.status === "error" || s.status === "failed")).length})` },
          { id: "imported", label: `📥 WP Import (${articles.filter((a) => a.source === "wp-import").length})` },
        ].map((f) => (
          <button key={f.id} className={`btn ${filter === f.id ? "btn-primary" : "btn-secondary"} btn-sm`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      {loading ? (
        <div className="loading-overlay"><span className="loader" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon" style={{ fontSize: 48 }}>📝</div><h3>Chưa có bài viết nào</h3><p>Thêm bài viết hoặc tạo từ Keyword Plan.</p></div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead><tr>
              <th style={{ width: 30 }}><input type="checkbox" /></th>
              <th>Ảnh</th><th>Tiêu đề</th>
              {pipelineSteps.map((s) => (<th key={s} style={{ textAlign: "center" }}>{stepLabels[s]}</th>))}
              <th style={{ textAlign: "center" }}>QC</th><th>Trạng thái</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.map((article) => (
                <tr key={article.id} style={{ cursor: "pointer" }} onClick={() => openArticleDetail(article)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" /></td>
                  <td>{article.pipeline?.thumbnail?.data?.url ? (<img src={article.pipeline.thumbnail.data.url} alt="" style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover" }} />) : (<div style={{ width: 40, height: 40, background: "var(--bg-tertiary)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🖼️</div>)}</td>
                  <td><div style={{ fontWeight: 500, fontSize: 14, color: "var(--accent-blue)" }}>{article.title}</div><div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>{article.source === "wp-import" ? (<><span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 6px", borderRadius: 4, background: "rgba(16,185,129,0.12)", color: "#10b981", fontSize: 10, fontWeight: 600 }}>📥 WP Import</span>{article.originalWordCount ? <span>{article.originalWordCount} từ</span> : null}</>) : article.source === "keyword" ? "Keyword" : article.source}{article.wpUrl ? <a href={article.wpUrl} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} style={{ fontSize: 10, color: "var(--text-muted)", opacity: 0.7 }}>🔗</a> : null}</div></td>
                  {pipelineSteps.map((s) => (<td key={s} style={{ textAlign: "center" }}><span>{stepIcons[article.pipeline?.[s]?.status || "pending"]}</span></td>))}
                  <td style={{ textAlign: "center" }}><QualityBadge quality={article.pipeline?.quality} /></td>
                  <td><span className={`badge ${article.approvalStatus === "approved" ? "badge-success" : article.approvalStatus === "rejected" ? "badge-error" : article.approvalStatus === "revision" ? "badge-warning" : article.status === "imported" ? "badge-info" : "badge-info"}`}>{article.approvalStatus === "approved" ? "✅ Duyệt" : article.approvalStatus === "rejected" ? "❌ Từ chối" : article.approvalStatus === "revision" ? "✏️ Sửa" : article.status === "imported" ? "📥 Đã import" : article.status === "published" ? "Đã đăng" : "Đợi xử lý"}</span></td>
                  <td onClick={(e) => e.stopPropagation()}><button className="btn btn-danger btn-sm" onClick={async () => { await api.deleteArticle(projectId, article.id); setArticles(await api.getArticles(projectId)); onUpdate(); }}>🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2>Thêm bài viết</h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[{ id: "single", label: "Bài đơn" }, { id: "bulk", label: "Nhiều bài" }, { id: "url", label: "Từ URL" }, { id: "kb", label: "Từ KB" }].map((m) => (
                <button key={m.id} className={`btn ${createMode === m.id ? "btn-primary" : "btn-secondary"} btn-sm`} onClick={() => setCreateMode(m.id)}>{m.label}</button>
              ))}
            </div>
            <div className="form-group">
              <label>{createMode === "single" ? "Keyword" : createMode === "bulk" ? "Keywords (mỗi dòng 1 keyword)" : createMode === "url" ? "URLs (1-5 URL, mỗi dòng 1)" : "Keyword để tìm trong KB"}</label>
              {createMode === "single" || createMode === "kb" ? (
                <input placeholder={createMode === "single" ? "VD: xe điện 2026" : "VD: xe đạp điện"} value={kwInput} onChange={(e) => setKwInput(e.target.value)} />
              ) : (
                <textarea rows={5} placeholder={createMode === "bulk" ? "xe điện\nxe đạp điện\n..." : "https://example.com/article-1\nhttps://example.com/article-2"} value={kwInput} onChange={(e) => setKwInput(e.target.value)} />
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Hủy</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!kwInput.trim()}>Tạo bài viết</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
