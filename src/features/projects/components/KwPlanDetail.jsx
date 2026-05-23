import { useState, useEffect } from "react";
import { api } from "../../../api";
import ArticleDetailView from "./ArticleDetailView";

export default function KwPlanDetail({ projectId, planId, onBack }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState("overview");
  const [selected, setSelected] = useState(new Set());
  const [showAddCluster, setShowAddCluster] = useState(false);
  const [viewingArticle, setViewingArticle] = useState(null);
  const [kwFilter, setKwFilter] = useState("all");
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [generatingTitles, setGeneratingTitles] = useState(false);
  const [editingTitle, setEditingTitle] = useState(null); // { clusterId, kwIndex, value }
  const [clusterForm, setClusterForm] = useState({
    name: "",
    pillarKeyword: "",
    searchIntent: "informational",
  });

  useEffect(() => {
    api
      .getKwPlan(projectId, planId)
      .then((p) => {
        setPlan(p);
        setExpandedClusters(new Set((p.clusters || []).map((c) => c.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [planId]);

  if (loading || !plan)
    return (
      <div className="loading-overlay">
        <span className="loader" />
      </div>
    );
  if (viewingArticle)
    return (
      <ArticleDetailView
        article={viewingArticle}
        onBack={async () => {
          // Reload article from DB to get updated pipeline
          if (viewingArticle?.id) {
            try {
              const updated = await api.getArticle(
                projectId,
                viewingArticle.id,
              );
              if (updated) {
                setViewingArticle(updated);
                return;
              }
            } catch (e) {
              console.error(e);
            }
          }
          setViewingArticle(null);
        }}
        projectId={projectId}
      />
    );

  const allKeywords = plan.clusters?.flatMap((c) => c.keywords) || [];
  const totalKw = allKeywords.length;
  const kwWithArticles = allKeywords.filter(
    (k) => k.status === "done" || k.status === "has_article",
  );
  const kwPublished = allKeywords.filter((k) => k.status === "published");
  const kwPending = allKeywords.filter((k) => k.status === "pending");

  const toggleCluster = (id) => {
    const n = new Set(expandedClusters);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpandedClusters(n);
  };
  const toggleSelect = (kw) => {
    const n = new Set(selected);
    n.has(kw) ? n.delete(kw) : n.add(kw);
    setSelected(n);
  };
  const selectAllInCluster = (cluster) => {
    const n = new Set(selected);
    const allSelected = cluster.keywords.every((k) => n.has(k.keyword));
    cluster.keywords.forEach((k) =>
      allSelected ? n.delete(k.keyword) : n.add(k.keyword),
    );
    setSelected(n);
  };

  const handleRegenTitles = async () => {
    setGeneratingTitles(true);
    try {
      const updated = await api.generatePlanTitles(projectId, planId);
      setPlan(updated);
    } catch (e) {
      alert("Lỗi generate titles: " + e.message);
    } finally {
      setGeneratingTitles(false);
    }
  };

  const handleSaveTitle = async (clusterId, kwIndex, newTitle) => {
    const updatedClusters = (plan.clusters || []).map(c => {
      if (c.id !== clusterId) return c;
      return {
        ...c,
        keywords: c.keywords.map((k, i) =>
          i === kwIndex ? { ...k, suggestedTitle: newTitle } : k
        ),
      };
    });
    const updated = await api.updateKwPlan(projectId, planId, { clusters: updatedClusters });
    setPlan(updated);
    setEditingTitle(null);
  };

  const handleCreateArticles = async () => {
    const kws = allKeywords
      .filter((k) => selected.has(k.keyword))
      .map((k) => ({
        keyword: k.keyword,
        contentAngle: k.contentAngle,
        estimatedWords: k.estimatedWords,
        searchIntent: k.searchIntent || "informational",
      }));
    await api.createArticles(projectId, { keywords: kws, mode: "keyword" });
    setSelected(new Set());
    onBack();
  };

  const handleAddCluster = async () => {
    const nc = {
      id: Date.now().toString(),
      name: clusterForm.name,
      pillarKeyword: clusterForm.pillarKeyword,
      searchIntent: clusterForm.searchIntent,
      contentAngle: "basic",
      estimatedWords: 3500,
      keywords: [
        {
          keyword: clusterForm.pillarKeyword,
          type: "pillar",
          contentAngle: "basic",
          estimatedWords: 3500,
          status: "pending",
        },
      ],
    };
    const updated = {
      ...plan,
      clusters: [...(plan.clusters || []), nc],
      totalKeywords: totalKw + 1,
    };
    await api.updateKwPlan(projectId, planId, updated);
    setPlan(updated);
    setShowAddCluster(false);
    setClusterForm({
      name: "",
      pillarKeyword: "",
      searchIntent: "informational",
    });
    setExpandedClusters(new Set([...expandedClusters, nc.id]));
  };

  const handleViewArticle = async (kw) => {
    let articleId = kw.articleId || kw.id;
    let existingPipeline = kw.pipeline;
    let existingArticle = null;
    if (!articleId) {
      try {
        const allArticles = await api.getArticles(projectId);
        existingArticle = allArticles.find((a) => a.keyword === kw.keyword);
        if (existingArticle) {
          articleId = existingArticle.id;
          existingPipeline = existingArticle.pipeline;
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (!articleId) {
      try {
        const created = await api.createArticles(projectId, {
          keywords: [
            {
              keyword: kw.keyword,
              contentAngle: kw.contentAngle || "basic",
              estimatedWords: kw.estimatedWords || 3500,
              searchIntent: kw.searchIntent || "informational",
            },
          ],
        });
        if (Array.isArray(created) && created[0]) {
          articleId = created[0].id;
          existingPipeline = created[0].pipeline;
        }
      } catch (e) {
        console.error("Failed to create article:", e);
        alert("Lỗi tạo bài viết: " + e.message);
        return;
      }
    }
    setViewingArticle({
      id: articleId,
      keyword: kw.keyword,
      title: kw.suggestedTitle || `${kw.keyword}: Cẩm nang toàn diện`,
      contentAngle: kw.contentAngle,
      estimatedWords: kw.estimatedWords,
      searchIntent: kw.searchIntent || "informational",
      type: kw.type,
      status: kw.status,
      relatedKeywords: kw.relatedKeywords || [],
      pipeline: existingPipeline || {
        research: { status: "pending" },
        outline: { status: "pending" },
        content: { status: "pending" },
        thumbnail: { status: "pending" },
        sections: { status: "pending" },
        publish: { status: "pending" },
      },
    });
  };

  const filterKws = (keywords) => {
    if (kwFilter === "pending")
      return keywords.filter((k) => k.status === "pending");
    if (kwFilter === "has_article")
      return keywords.filter(
        (k) => k.status === "done" || k.status === "has_article",
      );
    if (kwFilter === "published")
      return keywords.filter((k) => k.status === "published");
    return keywords;
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <button className="btn btn-secondary btn-sm" onClick={onBack}>
          ‹ Quay lại
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{plan.name}</h2>
        </div>
        <span
          className={`badge ${plan.status === "analyzed" ? "badge-success" : "badge-info"}`}
        >
          {plan.status === "analyzed" ? "Chờ duyệt" : plan.status}
        </span>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Tổng: {totalKw} keywords · Đã publish: {plan.articlesPublished || 0}
        </div>
      </div>

      <div className="project-tabs" style={{ marginBottom: 16 }}>
        {[
          { id: "overview", label: "Tổng quan" },
          {
            id: "structure",
            label: "Cấu trúc",
            count: plan.clusters?.length || 0,
          },
          {
            id: "articles",
            label: "Bài viết",
            count: `${plan.articlesCreated || 0}/${totalKw}`,
          },
        ].map((t) => (
          <button
            key={t.id}
            className={`project-tab ${subTab === t.id ? "active" : ""}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}{" "}
            {t.count !== undefined && (
              <span className="tab-count">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {subTab === "overview" && (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {[
              { label: "Tổng keywords", value: totalKw, icon: "💎" },
              { label: "Cần tạo bài", value: kwPending.length, icon: "✏️" },
              { label: "Đã có bài", value: kwWithArticles.length, icon: "✅" },
              { label: "Đã xuất bản", value: kwPublished.length, icon: "📢" },
            ].map((s) => (
              <div key={s.label} className="stat-card-mini">
                <span>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {s.label}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h4 style={{ margin: "0 0 8px" }}>
              💎 Danh sách từ khóa gốc ({plan.originalKeywords?.length || 0}{" "}
              keywords)
            </h4>
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              {(plan.originalKeywords || []).map((kw, i) => (
                <div key={i}>{kw}</div>
              ))}
            </div>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            <div className="card">
              <h4 style={{ margin: "0 0 12px" }}>Công cụ nhanh</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  style={{ justifyContent: "flex-start" }}
                >
                  📥 Xuất CSV
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ justifyContent: "flex-start" }}
                >
                  🔄 Re-analyze AI
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ justifyContent: "flex-start" }}
                >
                  🔗 Tạo Internal Links
                </button>
              </div>
            </div>
            <div className="card">
              <h4 style={{ margin: "0 0 12px" }}>Thông tin plan</h4>
              <div style={{ fontSize: 13 }}>
                {[
                  {
                    label: "Trạng thái",
                    value: (
                      <span className="badge badge-success">Chờ duyệt</span>
                    ),
                  },
                  {
                    label: "Kiểu schedule",
                    value:
                      plan.scheduleMode === "immediate" ? "Đăng ngay" : "Delay",
                  },
                  {
                    label: "Ngày tạo",
                    value: new Date(plan.createdAt).toLocaleString("vi-VN"),
                  },
                  { label: "Tổng cộng", value: `${totalKw} keywords` },
                ].map((r) => (
                  <div
                    key={r.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderBottom: "1px solid var(--border-light)",
                    }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>
                      {r.label}
                    </span>
                    <span style={{ fontWeight: 500 }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === "structure" && (
        <div>
          {/* Toolbar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { id: "all", label: `Tất cả (${totalKw})` },
                { id: "pending", label: `Chưa có bài` },
                {
                  id: "has_article",
                  label: `Đã có bài (${kwWithArticles.length})`,
                },
                { id: "published", label: "Đã publish" },
              ].map((f) => (
                <button
                  key={f.id}
                  className={`btn ${kwFilter === f.id ? "btn-primary" : "btn-secondary"} btn-sm`}
                  onClick={() => setKwFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {selected.size > 0 && (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Đã chọn: {selected.size} keywords
                </span>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRegenTitles}
                disabled={generatingTitles}
                title="AI sẽ tạo tiêu đề bài viết SEO cho từng keyword"
              >
                {generatingTitles ? "⏳ Đang tạo..." : "🪄 AI Tiêu đề"}
              </button>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
                onClick={() => {
                  const n = new Set();
                  allKeywords.forEach((k) => n.add(k.keyword));
                  setSelected(n);
                }}
              >
                Chọn tất ↻
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreateArticles}
                disabled={selected.size === 0}
              >
                + Tạo bài viết ({selected.size})
              </button>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-start",
              marginBottom: 12,
            }}
          >
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAddCluster(true)}
            >
              + Thêm Cluster
            </button>
          </div>

          {/* Clusters */}
          {(plan.clusters || []).map((cluster, ci) => {
            const filteredKws = filterKws(cluster.keywords || []);
            const isExpanded = expandedClusters.has(cluster.id);
            return (
              <div
                key={cluster.id}
                className="card"
                style={{ marginBottom: 12 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                  }}
                  onClick={() => toggleCluster(cluster.id)}
                >
                  <span
                    style={{
                      fontSize: 14,
                      transition: "transform 0.2s",
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0)",
                    }}
                  >
                    ▶
                  </span>
                  <span className="badge badge-info">#{ci + 1}</span>
                  <strong>{cluster.name}</strong>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    (Pillar: {cluster.pillarKeyword})
                  </span>
                  <span
                    className="badge badge-success"
                    style={{ fontSize: 10 }}
                  >
                    {cluster.searchIntent}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    ~{cluster.estimatedWords?.toLocaleString()} từ
                  </span>
                  <div style={{ flex: 1 }} />
                  <span
                    style={{ fontSize: 12, color: "var(--text-secondary)" }}
                  >
                    {cluster.keywords?.length} keywords
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--accent-green)",
                      cursor: "pointer",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    + Thêm
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--accent-blue)",
                      cursor: "pointer",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectAllInCluster(cluster);
                    }}
                  >
                    Chọn tất cả
                  </span>
                </div>

                {isExpanded &&
                  filteredKws.map((kw, ki) => (
                    <div
                      key={ki}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 0 8px 24px",
                        borderTop: "1px solid var(--border-light)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(kw.keyword)}
                        onChange={() => toggleSelect(kw.keyword)}
                        style={{ accentColor: "var(--accent-green)" }}
                      />
                      <span>{kw.type === "pillar" ? "⭐" : "  "}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontWeight: kw.type === "pillar" ? 600 : 400,
                            }}
                          >
                            {kw.keyword}
                          </span>
                          {kw.type === "pillar" && (
                            <span
                              className="badge badge-success"
                              style={{ fontSize: 10 }}
                            >
                              PILLAR
                            </span>
                          )}
                          <span
                            className="badge badge-secondary"
                            style={{ fontSize: 10 }}
                          >
                            {kw.contentAngle || "Cơ bản"}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                            }}
                          >
                            ~{(kw.estimatedWords || 0).toLocaleString()} từ
                          </span>
                        </div>
                        {/* Suggested Title */}
                        {kw.suggestedTitle && (
                          <div style={{ marginTop: 4 }}>
                            {editingTitle?.clusterId === cluster.id && editingTitle?.kwIndex === ki ? (
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                  style={{ flex: 1, fontSize: 12, padding: "3px 8px", border: "1px solid var(--border-light)", borderRadius: 4 }}
                                  value={editingTitle.value}
                                  onChange={(e) => setEditingTitle({ ...editingTitle, value: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveTitle(cluster.id, ki, editingTitle.value);
                                    if (e.key === "Escape") setEditingTitle(null);
                                  }}
                                  autoFocus
                                />
                                <button
                                  className="btn btn-primary btn-sm"
                                  style={{ padding: "2px 8px", fontSize: 11 }}
                                  onClick={() => handleSaveTitle(cluster.id, ki, editingTitle.value)}
                                >✓</button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: "2px 8px", fontSize: 11 }}
                                  onClick={() => setEditingTitle(null)}
                                >✗</button>
                              </div>
                            ) : (
                              <div
                                style={{ fontSize: 12, color: "var(--accent-blue)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingTitle({ clusterId: cluster.id, kwIndex: ki, value: kw.suggestedTitle });
                                }}
                                title="Click để sửa tiêu đề"
                              >
                                <span style={{ opacity: 0.6, fontSize: 11 }}>📝</span>
                                {kw.suggestedTitle}
                              </div>
                            )}
                          </div>
                        )}
                        {!kw.suggestedTitle && (
                          <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                            Chưa có tiêu đề — bấm "🪄 AI Tiêu đề" để tạo
                          </div>
                        )}
                        {kw.relatedKeywords?.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                              }}
                            >
                              Liên kết:{" "}
                            </span>
                            {kw.relatedKeywords.map((rk, ri) => (
                              <span
                                key={ri}
                                className="badge badge-secondary"
                                style={{ fontSize: 10, marginRight: 4 }}
                              >
                                {rk}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span
                        className={`badge ${kw.status === "done" ? "badge-success" : kw.status === "error" ? "badge-error" : "badge-info"}`}
                        style={{ fontSize: 10 }}
                      >
                        {kw.status === "done"
                          ? "Đã tạo"
                          : kw.status === "error"
                            ? "Lỗi"
                            : "Chờ xử lý"}
                      </span>
                      <button
                        className="btn-icon"
                        title="Xem chi tiết"
                        onClick={() => handleViewArticle(kw)}
                        style={{ width: 28, height: 28, fontSize: 14 }}
                      >
                        👁️
                      </button>
                      <button
                        className="btn-icon"
                        title="Chỉnh sửa"
                        style={{ width: 28, height: 28, fontSize: 14 }}
                      >
                        ✏️
                      </button>
                      <button
                        className="btn-icon"
                        title="Xóa"
                        style={{
                          width: 28,
                          height: 28,
                          fontSize: 14,
                          color: "var(--accent-red)",
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
              </div>
            );
          })}

          {showAddCluster && (
            <div
              className="modal-overlay"
              onClick={() => setShowAddCluster(false)}
            >
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: 420 }}
              >
                <h2>Thêm Cluster mới</h2>
                <div className="form-group">
                  <label>Tên Cluster *</label>
                  <input
                    placeholder="VD: SEO Cơ Bản"
                    value={clusterForm.name}
                    onChange={(e) =>
                      setClusterForm({ ...clusterForm, name: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Pillar Keyword *</label>
                  <input
                    placeholder="VD: SEO là gì"
                    value={clusterForm.pillarKeyword}
                    onChange={(e) =>
                      setClusterForm({
                        ...clusterForm,
                        pillarKeyword: e.target.value,
                      })
                    }
                  />
                  <small style={{ color: "var(--text-muted)" }}>
                    Keyword chính đại diện cho cluster, sẽ tạo bài viết pillar
                  </small>
                </div>
                <div className="form-group">
                  <label>Search Intent</label>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    {[
                      {
                        value: "informational",
                        label: "Informational",
                        desc: "Tìm hiểu thông tin",
                      },
                      {
                        value: "transactional",
                        label: "Transactional",
                        desc: "Mua hàng, đăng ký",
                      },
                      {
                        value: "commercial",
                        label: "Commercial",
                        desc: "So sánh, đánh giá",
                      },
                      {
                        value: "navigational",
                        label: "Navigational",
                        desc: "Tìm trang cụ thể",
                      },
                    ].map((si) => (
                      <button
                        key={si.value}
                        className={`platform-card ${clusterForm.searchIntent === si.value ? "active" : ""}`}
                        onClick={() =>
                          setClusterForm({
                            ...clusterForm,
                            searchIntent: si.value,
                          })
                        }
                      >
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {si.label}
                        </div>
                        <div
                          style={{ fontSize: 11, color: "var(--text-muted)" }}
                        >
                          {si.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowAddCluster(false)}
                  >
                    Hủy
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleAddCluster}
                    disabled={!clusterForm.name || !clusterForm.pillarKeyword}
                  >
                    Thêm Cluster
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === "articles" && (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: 48 }}>
            📝
          </div>
          <p>
            Chưa có bài viết. Chọn keywords trong tab <strong>Cấu trúc</strong>{" "}
            để tạo bài viết.
          </p>
        </div>
      )}
    </div>
  );
}
