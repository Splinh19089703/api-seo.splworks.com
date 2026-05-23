import { useState, useEffect, useCallback } from "react";
import { api } from "../api";

const STATUS_MAP = {
  "not-optimized": { label: "Chưa tối ưu", color: "#6b7280", icon: "⬜" },
  "in-progress":   { label: "Đang xử lý",   color: "#3b82f6", icon: "🔄" },
  "optimized":     { label: "Đã tối ưu",    color: "#10b981", icon: "✅" },
  "needs-review":  { label: "Cần xem lại",  color: "#f59e0b", icon: "⚠️" },
};

const TONE_OPTIONS = [
  { value: "professional", label: "Chuyên nghiệp" },
  { value: "friendly", label: "Thân thiện" },
  { value: "sales", label: "Bán hàng" },
  { value: "technical", label: "Kỹ thuật" },
];

const LENGTH_OPTIONS = [
  { value: "short", label: "Ngắn (100-150 từ)" },
  { value: "medium", label: "Vừa (200-300 từ)" },
  { value: "long", label: "Dài (400-600 từ)" },
];

export default function WooProducts() {
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [products, setProducts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Selection
  const [selected, setSelected] = useState(new Set());

  // Generate panel
  const [genProduct, setGenProduct] = useState(null);
  const [genConfig, setGenConfig] = useState({ tone: "professional", length: "medium", focusKeyword: "", language: "Tiếng Việt" });
  const [genResult, setGenResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [pushing, setPushing] = useState(false);

  // Bulk
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);

  // Load WP sites that have plugin + woo
  useEffect(() => {
    api.getWpSites().then(allSites => {
      const wooSites = allSites.filter(s => s.pluginApiKey && s.pluginCapabilities?.woocommerce);
      setSites(wooSites);
      if (wooSites.length > 0) {
        setSelectedSite(wooSites[0]);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Load products when site/page/search changes
  const loadProducts = useCallback(async () => {
    if (!selectedSite) return;
    setLoading(true);
    try {
      const [prodData, statsData] = await Promise.all([
        api.wooGetProducts(selectedSite.id, { page, per_page: 20, search }),
        api.wooGetProductStats(selectedSite.id),
      ]);
      setProducts(prodData.products || []);
      setTotalPages(prodData.total_pages || 1);
      setStats(statsData);
    } catch (err) {
      console.error("Load products error:", err);
    }
    setLoading(false);
  }, [selectedSite, page, search]);

  useEffect(() => {
    if (selectedSite) loadProducts();
  }, [loadProducts, selectedSite]);

  // Selection handlers
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map(p => p.id)));
    }
  };

  // Generate description for single product
  const handleGenerate = async () => {
    if (!genProduct) return;
    setGenerating(true);
    setGenResult(null);
    try {
      const result = await api.wooGenerateDescription({
        productName: genProduct.name,
        attributes: genProduct.attributes || [],
        category: genProduct.categories?.[0] || "",
        tone: genConfig.tone,
        length: genConfig.length,
        focusKeyword: genConfig.focusKeyword,
        language: genConfig.language,
      });
      setGenResult(result);
    } catch (err) {
      setGenResult({ error: err.message });
    }
    setGenerating(false);
  };

  // Push generated content to WP
  const handlePush = async () => {
    if (!genProduct || !genResult || genResult.error) return;
    setPushing(true);
    try {
      await api.wooPush({
        siteId: selectedSite.id,
        productId: genProduct.id,
        description: genResult.description,
        shortDescription: genResult.short_description,
        seo: {
          title: genResult.seo_title,
          description: genResult.seo_description,
          focus_keyword: genResult.focus_keyword,
        },
      });
      // Update local state
      setProducts(prev => prev.map(p =>
        p.id === genProduct.id ? { ...p, splseo_status: "optimized", has_description: true } : p
      ));
      setGenProduct(null);
      setGenResult(null);
    } catch (err) {
      alert("Lỗi push: " + err.message);
    }
    setPushing(false);
  };

  // Bulk generate
  const handleBulkGenerate = async () => {
    if (selected.size === 0) return;
    setBulkGenerating(true);
    setBulkResults(null);
    try {
      const result = await api.wooBulkGenerate({
        siteId: selectedSite.id,
        productIds: Array.from(selected),
        tone: genConfig.tone,
        length: genConfig.length,
        language: genConfig.language,
      });
      setBulkResults(result);
    } catch (err) {
      setBulkResults({ error: err.message });
    }
    setBulkGenerating(false);
  };

  // No plugin-connected WooCommerce sites
  if (!loading && sites.length === 0) {
    return (
      <div className="page-container">
        <h1>🛒 WooCommerce AI</h1>
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔌</div>
          <h2 style={{ marginBottom: 8 }}>Chưa có site WooCommerce nào kết nối</h2>
          <p style={{ color: "var(--text-muted)", maxWidth: 480, margin: "0 auto 24px" }}>
            Để sử dụng tính năng AI Product Writer, bạn cần:<br />
            1. Cài plugin <strong>SPLSEO Connector</strong> trên WordPress<br />
            2. Bật WooCommerce trên site đó<br />
            3. Vào <strong>Cài đặt → WP Sites</strong> → thêm Plugin API Key
          </p>
          <a href="/settings" className="btn btn-primary">⚙️ Cài đặt WP Sites</a>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>🛒 WooCommerce AI</h1>
          <p style={{ color: "var(--text-muted)", margin: "4px 0 0" }}>Tạo mô tả sản phẩm AI — tối ưu SEO tự động</p>
        </div>
        {sites.length > 1 && (
          <select
            className="select-field"
            value={selectedSite?.id || ""}
            onChange={e => setSelectedSite(sites.find(s => s.id === e.target.value))}
          >
            {sites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.siteUrl})</option>)}
          </select>
        )}
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="woo-stats-grid">
          <div className="woo-stat-card">
            <div className="woo-stat-value">{stats.total_products}</div>
            <div className="woo-stat-label">Sản phẩm</div>
          </div>
          <div className="woo-stat-card" style={{ "--accent": "#10b981" }}>
            <div className="woo-stat-value">{stats.optimized || 0}</div>
            <div className="woo-stat-label">Đã tối ưu</div>
          </div>
          <div className="woo-stat-card" style={{ "--accent": "#f59e0b" }}>
            <div className="woo-stat-value">{stats.no_description || 0}</div>
            <div className="woo-stat-label">Thiếu mô tả</div>
          </div>
          <div className="woo-stat-card" style={{ "--accent": "#ef4444" }}>
            <div className="woo-stat-value">{stats.not_optimized || 0}</div>
            <div className="woo-stat-label">Chưa tối ưu</div>
          </div>
        </div>
      )}

      {/* Search + Config */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              className="input-field"
              placeholder="🔍 Tìm sản phẩm..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (setSearch(searchInput), setPage(1))}
            />
          </div>
          <select className="select-field" value={genConfig.tone} onChange={e => setGenConfig(p => ({ ...p, tone: e.target.value }))}>
            {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="select-field" value={genConfig.length} onChange={e => setGenConfig(p => ({ ...p, length: e.target.value }))}>
            {LENGTH_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button className="btn btn-sm" onClick={() => { setSearch(searchInput); setPage(1); }}>
            Tìm kiếm
          </button>
        </div>
      </div>

      {/* Batch Toolbar */}
      {selected.size > 0 && (
        <div className="woo-batch-toolbar">
          <span style={{ fontWeight: 600 }}>{selected.size} sản phẩm đã chọn</span>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleBulkGenerate}
            disabled={bulkGenerating}
          >
            {bulkGenerating ? "⏳ Đang tạo..." : `✨ Tạo mô tả cho ${selected.size} sản phẩm`}
          </button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
            ✕ Bỏ chọn
          </button>
        </div>
      )}

      {/* Bulk Results */}
      {bulkResults && (
        <div className="card" style={{ marginBottom: 16, border: "1px solid var(--accent-green, #10b981)" }}>
          <h3>📊 Kết quả tạo hàng loạt</h3>
          <p>Thành công: {bulkResults.success} / {bulkResults.total}</p>
          <button className="btn btn-sm" onClick={() => setBulkResults(null)}>Đóng</button>
        </div>
      )}

      {/* Products Table */}
      <div className="card">
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <span className="loader" />
            <p style={{ color: "var(--text-muted)", marginTop: 12 }}>Đang tải sản phẩm...</p>
          </div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
            <p>Không tìm thấy sản phẩm nào</p>
          </div>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === products.length && products.length > 0}
                      onChange={selectAll}
                    />
                  </th>
                  <th style={{ width: 50 }}>Ảnh</th>
                  <th>Tên sản phẩm</th>
                  <th style={{ width: 100 }}>Giá</th>
                  <th style={{ width: 110 }}>Mô tả</th>
                  <th style={{ width: 120 }}>SPLSEO</th>
                  <th style={{ width: 120 }}>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {products.map(product => {
                  const st = STATUS_MAP[product.splseo_status] || STATUS_MAP["not-optimized"];
                  const isSelected = selected.has(product.id);
                  return (
                    <tr
                      key={product.id}
                      style={{ background: isSelected ? "var(--bg-selected, rgba(99,102,241,0.08))" : undefined }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(product.id)}
                        />
                      </td>
                      <td>
                        {product.image ? (
                          <img
                            src={product.image}
                            alt=""
                            style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }}
                          />
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--bg-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                            📦
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{product.name}</div>
                        {product.categories?.length > 0 && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                            {product.categories.join(", ")}
                          </div>
                        )}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {product.price ? `${Number(product.price).toLocaleString("vi")}₫` : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <span
                            className="woo-desc-badge"
                            style={{ background: product.has_description ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: product.has_description ? "#10b981" : "#ef4444" }}
                          >
                            {product.has_description ? "✅ Có" : "❌ Thiếu"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className="woo-status-badge"
                          style={{ background: `${st.color}15`, color: st.color }}
                        >
                          {st.icon} {st.label}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            setGenProduct(product);
                            setGenResult(null);
                          }}
                          title="Tạo mô tả AI"
                        >
                          ✨ Tạo mô tả
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Trước</button>
                <span style={{ lineHeight: "32px", fontSize: 13, color: "var(--text-muted)" }}>
                  Trang {page} / {totalPages}
                </span>
                <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Sau →</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Generate Panel (Modal) */}
      {genProduct && (
        <div className="modal-overlay" onClick={() => { setGenProduct(null); setGenResult(null); }}>
          <div className="modal woo-gen-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0 }}>✨ Tạo mô tả AI</h2>
              <button className="btn-close" onClick={() => { setGenProduct(null); setGenResult(null); }}>✕</button>
            </div>

            <div className="modal-body" style={{ maxHeight: "70vh", overflow: "auto" }}>
              {/* Product info */}
              <div className="woo-gen-product-info">
                {genProduct.image && (
                  <img src={genProduct.image} alt="" style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }} />
                )}
                <div>
                  <h3 style={{ margin: 0 }}>{genProduct.name}</h3>
                  <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
                    {genProduct.categories?.join(", ")} · {genProduct.price ? `${Number(genProduct.price).toLocaleString("vi")}₫` : "Chưa có giá"}
                  </p>
                </div>
              </div>

              {/* Config */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label className="label">Giọng điệu</label>
                  <select className="select-field" value={genConfig.tone} onChange={e => setGenConfig(p => ({ ...p, tone: e.target.value }))}>
                    {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Độ dài</label>
                  <select className="select-field" value={genConfig.length} onChange={e => setGenConfig(p => ({ ...p, length: e.target.value }))}>
                    {LENGTH_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label className="label">Focus Keyword (SEO)</label>
                  <input
                    type="text"
                    className="input-field"
                    value={genConfig.focusKeyword}
                    onChange={e => setGenConfig(p => ({ ...p, focusKeyword: e.target.value }))}
                    placeholder="VD: máy lọc nước gia đình"
                  />
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={generating}
                style={{ width: "100%", marginBottom: 16 }}
              >
                {generating ? "⏳ Đang tạo mô tả..." : "✨ Tạo mô tả AI"}
              </button>

              {/* Result */}
              {genResult && !genResult.error && (
                <div className="woo-gen-result">
                  <div className="woo-gen-section">
                    <h4>📝 Mô tả ngắn</h4>
                    <p style={{ background: "var(--bg-muted)", padding: 12, borderRadius: 8, fontSize: 13 }}>
                      {genResult.short_description}
                    </p>
                  </div>

                  <div className="woo-gen-section">
                    <h4>📄 Mô tả đầy đủ</h4>
                    <div
                      className="woo-gen-preview"
                      dangerouslySetInnerHTML={{ __html: genResult.description }}
                    />
                  </div>

                  <div className="woo-gen-section" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <h4>🏷️ SEO Title</h4>
                      <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{genResult.seo_title}</p>
                    </div>
                    <div>
                      <h4>📋 Meta Description</h4>
                      <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{genResult.seo_description}</p>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                    <button
                      className="btn btn-primary"
                      onClick={handlePush}
                      disabled={pushing}
                      style={{ flex: 1 }}
                    >
                      {pushing ? "⏳ Đang đẩy lên WP..." : "🚀 Push lên WordPress"}
                    </button>
                    <button className="btn" onClick={handleGenerate} disabled={generating}>
                      🔄 Tạo lại
                    </button>
                  </div>
                </div>
              )}

              {genResult?.error && (
                <div className="card" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: 16 }}>
                  <p style={{ color: "#ef4444", margin: 0 }}>❌ {genResult.error}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
