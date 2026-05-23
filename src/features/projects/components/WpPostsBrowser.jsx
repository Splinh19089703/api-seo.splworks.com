import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../../api";

// B1: Skeleton shimmer component
const SkeletonRow = () => (
  <div style={{
    padding: "12px 18px", borderBottom: "1px solid var(--border)",
    display: "flex", alignItems: "center", gap: 12, animation: "pulse 1.5s infinite",
  }}>
    <div style={{ flex: 1 }}>
      <div style={{ height: 14, width: "60%", background: "rgba(255,255,255,0.06)", borderRadius: 4, marginBottom: 6 }} />
      <div style={{ height: 10, width: "80%", background: "rgba(255,255,255,0.04)", borderRadius: 3 }} />
    </div>
    <div style={{ width: 60, height: 30, background: "rgba(255,255,255,0.05)", borderRadius: 6 }} />
  </div>
);

// D2: Rewrite status badge component
const RewriteStatusBadge = ({ status }) => {
  if (!status || status.status === "none") return null;
  
  const { status: st, rewriteCount } = status;
  const configs = {
    draft: { label: "✍️ Đã viết lại", bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
    pushed: { label: "✅ Đã cập nhật", bg: "rgba(16,185,129,0.12)", color: "#10b981" },
    scheduled: { label: `📅 Lên lịch`, bg: "rgba(99,102,241,0.12)", color: "#818cf8" },
  };
  const cfg = configs[st] || configs.draft;
  
  return (
    <span style={{
      fontSize: 9, padding: "2px 7px", borderRadius: 6,
      background: cfg.bg, color: cfg.color, fontWeight: 600,
      display: "inline-flex", alignItems: "center", gap: 3,
      flexShrink: 0,
    }}>
      {cfg.label}
      {rewriteCount > 1 && <span style={{ opacity: 0.7 }}>×{rewriteCount}</span>}
    </span>
  );
};

// F1: Queue status badge — shows when background rewrite is active
const QueueStatusBadge = ({ queueItem }) => {
  if (!queueItem) return null;
  const configs = {
    rewriting: { label: "⏳ Đang rewrite...", bg: "rgba(99,102,241,0.15)", color: "#818cf8", animate: true },
    pushing: { label: "🚀 Đang push...", bg: "rgba(59,130,246,0.15)", color: "#3b82f6", animate: true },
    done: { label: "✅ Xong", bg: "rgba(16,185,129,0.12)", color: "#10b981" },
    pushed: { label: "📤 Đã push", bg: "rgba(16,185,129,0.12)", color: "#10b981" },
    error: { label: "❌ Lỗi", bg: "rgba(239,68,68,0.12)", color: "#ef4444" },
  };
  const cfg = configs[queueItem.status] || configs.rewriting;
  return (
    <span style={{
      fontSize: 9, padding: "2px 7px", borderRadius: 6,
      background: cfg.bg, color: cfg.color, fontWeight: 600,
      display: "inline-flex", alignItems: "center", gap: 3,
      flexShrink: 0,
      animation: cfg.animate ? "pulse 1.5s infinite" : "none",
    }}>
      {cfg.label}
    </span>
  );
};

export default function WpPostsBrowser({
  siteId, siteName, projectId, projectDomain, wpSites, onSelectPost,
  // F1: Background rewrite queue
  rewriteQueue = {},
  // F2: Multi-select
  selectedPosts, setSelectedPosts,
  onBatchRewrite, onBackgroundRewrite,
}) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false); // E2: Lazy load — chỉ load khi user click
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [fetchingId, setFetchingId] = useState(null);
  const [rewriteStatuses, setRewriteStatuses] = useState({});
  // E2: Category filter
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState("");
  const [catsLoading, setCatsLoading] = useState(false);
  // E1: Site selector
  const [activeSiteId, setActiveSiteId] = useState(siteId);
  const debounceRef = useRef(null);

  // Resolve active site info
  const activeSite = wpSites?.find(s => s.id === activeSiteId);
  const activeSiteUrl = activeSite?.siteUrl || activeSite?.url || siteName || "";
  const activeSiteName = activeSite?.name || activeSiteUrl;

  // E1: Domain mismatch warning
  const domainMismatch = (() => {
    if (!projectDomain || !activeSiteUrl) return false;
    const cleanProject = projectDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    const cleanSite = activeSiteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    return cleanProject !== cleanSite && !cleanSite.includes(cleanProject) && !cleanProject.includes(cleanSite);
  })();

  // F2: Multi-select helpers
  const isSelected = (postId) => selectedPosts?.has(postId);
  const toggleSelect = (postId) => {
    setSelectedPosts?.(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };
  const selectAll = () => {
    setSelectedPosts?.(new Set(posts.map(p => p.id)));
  };
  const deselectAll = () => {
    setSelectedPosts?.(new Set());
  };
  const selectedCount = selectedPosts?.size || 0;

  // E2: Load categories when site changes
  useEffect(() => {
    if (!activeSiteId) return;
    setCatsLoading(true);
    api.get(`/audit/wp-categories/${activeSiteId}`)
      .then(cats => setCategories(cats || []))
      .catch(() => setCategories([]))
      .finally(() => setCatsLoading(false));
  }, [activeSiteId]);

  // Reset when site changes
  useEffect(() => {
    setPosts([]);
    setLoaded(false);
    setPage(1);
    setSelectedCat("");
    setTotal(0);
    setSelectedPosts?.(new Set());
  }, [activeSiteId]);

  const loadPosts = useCallback(async () => {
    if (!activeSiteId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, per_page: 15 });
      if (search) params.set("search", search);
      if (selectedCat) params.set("categories", selectedCat);
      const res = await api.get(`/audit/wp-posts/${activeSiteId}?${params}`);
      setPosts(res.posts || []);
      setTotalPages(res.totalPages || 1);
      setTotal(res.total || 0);
      setLoaded(true);
    } catch (e) {
      console.error("WP posts error:", e);
    } finally {
      setLoading(false);
    }
  }, [activeSiteId, page, search, selectedCat]);

  // D2: Load rewrite statuses for visible posts
  useEffect(() => {
    if (!projectId || posts.length === 0) return;
    const wpPostIds = posts.map(p => p.id);
    api.post("/audit/rewrite-status-batch", { projectId, wpPostIds })
      .then(statusMap => setRewriteStatuses(statusMap))
      .catch(err => console.warn("[D2] Status batch error:", err.message));
  }, [projectId, posts]);

  // C2: Debounce search — 400ms delay
  const handleSearchInput = (val) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      // Auto-load khi search thay đổi (nếu đã loaded lần đầu)
      if (loaded) loadPosts();
    }, 400);
  };

  const handleSelect = async (post) => {
    setFetchingId(post.id);
    try {
      const article = await api.get(`/audit/wp-posts/${activeSiteId}/${post.id}`);
      onSelectPost(article);
    } catch (e) {
      alert("Lỗi fetch bài viết: " + e.message);
    } finally {
      setFetchingId(null);
    }
  };

  // F1: Background rewrite — fetch then rewrite in parent
  const handleBackgroundRewrite = async (post) => {
    if (!onBackgroundRewrite) return handleSelect(post);
    setFetchingId(post.id);
    try {
      const article = await api.get(`/audit/wp-posts/${activeSiteId}/${post.id}`);
      onBackgroundRewrite(post.id, article);
    } catch (e) {
      alert("Lỗi fetch bài viết: " + e.message);
    } finally {
      setFetchingId(null);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadPosts();
  };

  // B1: Estimate word count from excerpt
  const estimateWords = (excerpt) => {
    if (!excerpt) return null;
    const excerptWords = excerpt.split(/\s+/).length;
    const est = Math.round(excerptWords * 18);
    if (est < 300) return null;
    return est;
  };

  // E2: Khi đổi page → auto load nếu đã loaded
  useEffect(() => {
    if (loaded) loadPosts();
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // E2: Khi đổi category → reset page + load
  useEffect(() => {
    if (loaded) {
      setPage(1);
      loadPosts();
    }
  }, [selectedCat]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!siteId && (!wpSites || wpSites.length === 0)) return null;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 14, overflow: "hidden", marginBottom: 20,
    }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {/* Header */}
      <div style={{
        padding: "14px 18px", borderBottom: "1px solid var(--border)",
        background: "rgba(59,130,246,0.04)",
      }}>
        {/* Row 1: Title + Site selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14, flexShrink: 0 }}>📄 Bài viết trên WordPress</div>
          <div style={{ flex: 1 }} />
          {/* E1: Site selector */}
          {wpSites && wpSites.length > 1 && (
            <select
              value={activeSiteId}
              onChange={(e) => setActiveSiteId(e.target.value)}
              style={{
                padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)", fontSize: 11,
                maxWidth: 220,
              }}
            >
              {wpSites.map(s => (
                <option key={s.id} value={s.id}>
                  🌐 {s.name || s.siteUrl || s.url}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Row 2: Site info + domain warning */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 11, color: "var(--accent-blue)", fontWeight: 500,
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            🌐 {activeSiteUrl || "Chưa chọn site"}
          </span>
          {loaded && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              · {total} bài viết
            </span>
          )}
          {domainMismatch && (
            <span style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 6,
              background: "rgba(245,158,11,0.12)", color: "#f59e0b", fontWeight: 600,
            }}>
              ⚠️ Site khác domain dự án ({projectDomain})
            </span>
          )}
        </div>

        {/* Row 3: Controls — Category + Search + Load button */}
        <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
          {/* E2: Category dropdown */}
          {categories.length > 0 && (
            <select
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
              style={{
                padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)", fontSize: 12, minWidth: 140,
              }}
            >
              <option value="">📂 Tất cả danh mục</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
              ))}
            </select>
          )}

          {/* Search */}
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 6, flex: 1 }}>
            <input
              placeholder="Tìm bài viết..."
              value={search}
              onChange={(e) => handleSearchInput(e.target.value)}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)", fontSize: 12, flex: 1, minWidth: 120,
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => e.target.style.borderColor = "var(--accent-blue)"}
              onBlur={(e) => e.target.style.borderColor = "var(--border)"}
            />
          </form>

          {/* E2: Load button */}
          <button
            className="btn btn-primary btn-sm"
            onClick={loadPosts}
            disabled={loading || !activeSiteId}
            style={{ flexShrink: 0, padding: "6px 14px", fontSize: 12, fontWeight: 600 }}
          >
            {loading ? "⏳ Đang tải..." : loaded ? "🔄 Làm mới" : "📥 Tải bài viết"}
          </button>
        </div>
      </div>

      {/* F2: Batch Selection Toolbar */}
      {selectedCount > 0 && (
        <div style={{
          padding: "10px 18px", borderBottom: "1px solid var(--border)",
          background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.06) 100%)",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          animation: "fadeIn 0.2s ease-out",
        }}>
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          <span style={{
            fontSize: 12, fontWeight: 700, color: "#818cf8",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            ☑️ {selectedCount} bài đã chọn
          </span>
          <button
            className="btn btn-sm"
            onClick={() => onBatchRewrite?.(Array.from(selectedPosts))}
            style={{
              background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
              color: "#fff", fontWeight: 600, border: "none", fontSize: 11, padding: "5px 12px",
              boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
            }}
          >
            ✨ Rewrite {selectedCount} bài (nền)
          </button>
          {/* D3: Rewrite & Push combo button */}
          <button
            className="btn btn-sm"
            onClick={() => onBatchRewrite?.(Array.from(selectedPosts), { autoPush: true })}
            style={{
              background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
              color: "#fff", fontWeight: 600, border: "none", fontSize: 11, padding: "5px 12px",
              boxShadow: "0 2px 8px rgba(245,158,11,0.3)",
            }}
          >
            🚀 Rewrite & Push {selectedCount} bài
          </button>
          {/* Import to Articles button */}
          <button
            className="btn btn-sm"
            onClick={async () => {
              const selectedDetails = posts.filter(p => selectedPosts?.has(p.id));
              if (selectedDetails.length === 0) return;
              try {
                const payload = selectedDetails.map(p => ({
                  wpPostId: p.id,
                  title: p.title?.rendered || p.title || "",
                  url: p.link || "",
                  slug: p.slug || "",
                  content: p.content?.rendered || p.content || "",
                  excerpt: p.excerpt?.rendered || p.excerpt || "",
                  thumbnailUrl: p.thumbnail || p.featured_media_url || null,
                }));
                const res = await api.post(`/projects/${projectId}/articles/import-wp`, { posts: payload, siteId: activeSiteId });
                const { created = [], skipped = [] } = res.data;
                const msg = [];
                if (created.length > 0) msg.push(`✅ Import ${created.length} bài thành công`);
                if (skipped.length > 0) msg.push(`⏭️ Bỏ qua ${skipped.length} bài (đã import)`);
                alert(msg.join("\n") || "Đã import xong!");
                deselectAll();
              } catch (err) {
                alert("❌ Import thất bại: " + (err.response?.data?.error || err.message));
              }
            }}
            style={{
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              color: "#fff", fontWeight: 600, border: "none", fontSize: 11, padding: "5px 12px",
              boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
            }}
          >
            📥 Thêm vào Bài viết
          </button>
          <button className="btn btn-sm btn-secondary" onClick={selectAll}
            style={{ fontSize: 11, padding: "5px 10px" }}>
            ☑ Chọn tất cả
          </button>
          <button className="btn btn-sm btn-secondary" onClick={deselectAll}
            style={{ fontSize: 11, padding: "5px 10px" }}>
            ✕ Bỏ chọn
          </button>
        </div>
      )}

      {/* Posts list */}
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {!loaded && !loading ? (
          /* E2: Chưa load — hiện prompt */
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              Nhấn "Tải bài viết" để xem danh sách
            </div>
            <div style={{ fontSize: 12 }}>
              {categories.length > 0
                ? `${categories.length} danh mục · Chọn danh mục rồi nhấn tải`
                : catsLoading ? "Đang tải danh mục..." : "Sẽ hiển thị bài viết từ WordPress"}
            </div>
            {/* E2: Future — Ghi chú plan */}
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 12, opacity: 0.6 }}>
              Hỗ trợ: Posts · Tương lai: Products (WooCommerce) · Custom Post Types
            </div>
          </div>
        ) : loading ? (
          <>
            {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
          </>
        ) : posts.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>
            Không tìm thấy bài viết nào
          </div>
        ) : (
          posts.map((p) => {
            const wordEst = estimateWords(p.excerpt);
            const rwStatus = rewriteStatuses[p.id];
            const queueItem = rewriteQueue[p.id];
            const isInQueue = !!queueItem;
            const isRewriting = queueItem?.status === "rewriting" || queueItem?.status === "pushing";
            const selected = isSelected(p.id);
            return (
              <div
                key={p.id}
                style={{
                  padding: "10px 18px", borderBottom: "1px solid var(--border)",
                  display: "flex", alignItems: "center", gap: 10,
                  cursor: "pointer", transition: "all 0.2s",
                  background: selected ? "rgba(99,102,241,0.06)"
                    : isRewriting ? "rgba(99,102,241,0.03)" : "transparent",
                  borderLeft: isRewriting ? "3px solid #818cf8"
                    : queueItem?.status === "done" ? "3px solid #10b981"
                    : queueItem?.status === "error" ? "3px solid #ef4444"
                    : rwStatus?.status === "pushed" ? "3px solid #10b981"
                    : rwStatus?.status === "draft" ? "3px solid #f59e0b"
                    : rwStatus?.status === "scheduled" ? "3px solid #818cf8"
                    : "3px solid transparent",
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.background = "rgba(59,130,246,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (!selected) e.currentTarget.style.background = isRewriting ? "rgba(99,102,241,0.03)" : "transparent";
                }}
              >
                {/* F2: Checkbox */}
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => { e.stopPropagation(); toggleSelect(p.id); }}
                  style={{
                    width: 16, height: 16, flexShrink: 0, cursor: "pointer",
                    accentColor: "#6366f1", borderRadius: 4,
                  }}
                />

                {/* Article info */}
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => handleSelect(p)}>
                  <div style={{
                    fontWeight: 600, fontSize: 13,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span dangerouslySetInnerHTML={{ __html: p.title || "(Không tiêu đề)" }} />
                    <RewriteStatusBadge status={rwStatus} />
                    <QueueStatusBadge queueItem={queueItem} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300 }}>
                      {p.excerpt?.substring(0, 100) || p.slug}
                    </span>
                    {wordEst && (
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 3,
                        background: "rgba(139,92,246,0.1)", color: "#8b5cf6",
                        flexShrink: 0,
                      }}>
                        ~{wordEst.toLocaleString()} từ
                      </span>
                    )}
                  </div>
                </div>

                {/* Date + status */}
                <div style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, textAlign: "right" }}>
                  <div>{new Date(p.modified || p.date).toLocaleDateString("vi-VN")}</div>
                  <div style={{
                    fontSize: 10, marginTop: 2, padding: "1px 6px", borderRadius: 4,
                    background: p.status === "publish" ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
                    color: p.status === "publish" ? "#10b981" : "#f59e0b",
                    display: "inline-block",
                  }}>
                    {p.status === "publish" ? "Đã đăng" : p.status}
                  </div>
                </div>

                {/* Action buttons — F3: Better visibility */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {/* Review/Open button */}
                  <button
                    className="btn btn-sm"
                    disabled={fetchingId === p.id}
                    onClick={(e) => { e.stopPropagation(); handleSelect(p); }}
                    style={{
                      background: rwStatus?.status === "draft" || queueItem?.status === "done"
                        ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                        : "rgba(255,255,255,0.06)",
                      color: rwStatus?.status === "draft" || queueItem?.status === "done" ? "#fff" : "var(--text-secondary)",
                      border: rwStatus?.status === "draft" || queueItem?.status === "done"
                        ? "none" : "1px solid var(--border)",
                      fontWeight: 600, fontSize: 11, padding: "5px 10px",
                      boxShadow: rwStatus?.status === "draft" || queueItem?.status === "done"
                        ? "0 2px 6px rgba(16,185,129,0.25)" : "none",
                    }}
                  >
                    {fetchingId === p.id ? "⏳" : rwStatus?.status === "draft" || queueItem?.status === "done" ? "👁️ Review" : "📝 Mở"}
                  </button>
                  {/* Rewrite button — F1: Background rewrite */}
                  <button
                    className="btn btn-sm"
                    disabled={fetchingId === p.id || isRewriting}
                    onClick={(e) => { e.stopPropagation(); handleBackgroundRewrite(p); }}
                    style={{
                      background: isRewriting ? "var(--bg-tertiary)"
                        : "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
                      color: "#fff", border: "none", fontWeight: 600,
                      fontSize: 11, padding: "5px 10px",
                      boxShadow: isRewriting ? "none" : "0 2px 6px rgba(139,92,246,0.25)",
                      opacity: isRewriting ? 0.6 : 1,
                    }}
                  >
                    {isRewriting ? "⏳..." : "✨ Rewrite"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {loaded && totalPages > 1 && (
        <div style={{
          padding: "10px 18px", display: "flex", alignItems: "center",
          justifyContent: "center", gap: 8, borderTop: "1px solid var(--border)",
        }}>
          <button className="btn btn-sm btn-secondary" disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}>← Trước</button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Trang {page}/{totalPages}
          </span>
          <button className="btn btn-sm btn-secondary" disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}>Sau →</button>
        </div>
      )}
    </div>
  );
}
