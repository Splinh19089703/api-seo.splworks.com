import { useState, useEffect } from "react";
import { api } from "../api";

const TABS = [
  { id: "info", label: "Thông tin", icon: "ℹ️" },
  { id: "youtube", label: "YouTube", icon: "▶️" },
  { id: "publishing", label: "Đăng bài", icon: "🌐" },
  { id: "prompts", label: "Prompts AI", icon: "💬" },
  { id: "images", label: "Hình ảnh", icon: "🖼️" },
  { id: "ai", label: "AI Provider", icon: "🤖" },
  { id: "kb", label: "Knowledge Base", icon: "📚" },
  { id: "automation", label: "Tự động", icon: "🔄" },
  { id: "advanced", label: "Nâng cao", icon: "🚀" },
  { id: "indexing", label: "Indexing", icon: "📡" },
];

export default function ProjectConfig({ project, onClose, onSaved }) {
  const [tab, setTab] = useState("info");
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [wpTest, setWpTest] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [splseoIndexer, setSplseoIndexer] = useState(null); // { splseoSAEmail, hasSharedSA }
  const [wpSites, setWpSites] = useState([]); // Global WP sites from Settings

  useEffect(() => {
    if (project) {
      setForm({
        name: project.name || "",
        description: project.description || "",
        domain: project.domain || "",
        config: { ...(project.config || {}) },
      });
    }
    api
      .getPrompts()
      .then(setPrompts)
      .catch(() => {});
    // Load global WP sites from Settings
    api.getWpSites().then(s => setWpSites(s || [])).catch(() => {});
    // Fetch SPLSEO indexer config (SA email)
    api.get("/indexer/config").then(setSplseoIndexer).catch(() => {});
  }, [project]);

  const updateConfig = (path, value) => {
    setDirty(true);
    setForm((prev) => {
      const next = { ...prev, config: { ...prev.config } };
      const keys = path.split(".");
      let obj = next.config;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...(obj[keys[i]] || {}) };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const slug = (form.name || "")
        .toLowerCase()
        .replace(
          /[^a-z0-9àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]+/g,
          "-",
        )
        .replace(/^-|-$/g, "");
      await api.updateProject(project.id, {
        name: form.name,
        description: form.description,
        domain: form.domain,
        config: { ...form.config, slug },
      });
      setDirty(false);
      onSaved?.();
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestWp = async () => {
    setWpTest({ loading: true });
    try {
      // Save first so backend has latest config
      await handleSave();
      const result = await api.testWordpress(project.id);
      setWpTest(result);
    } catch (e) {
      setWpTest({ success: false, error: e.message });
    }
  };

  const cfg = form.config || {};
  const wp = cfg.publishing?.wordpress || {};

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal config-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 780, width: "95vw" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Cấu hình dự án</h2>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {form.name}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: 20, minHeight: 420 }}>
          {/* Sidebar tabs */}
          <nav className="config-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`config-tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 460 }}>
            {tab === "info" && (
              <div>
                <h3 className="config-section-title">Thông tin cơ bản</h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div className="form-group">
                    <label>Tên dự án</label>
                    <input
                      value={form.name || ""}
                      onChange={(e) => {
                        setForm({ ...form, name: e.target.value });
                        setDirty(true);
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Slug</label>
                    <input
                      value={cfg.slug || ""}
                      readOnly
                      style={{ opacity: 0.6 }}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Mô tả</label>
                  <textarea
                    rows={3}
                    value={form.description || ""}
                    onChange={(e) => {
                      setForm({ ...form, description: e.target.value });
                      setDirty(true);
                    }}
                  />
                </div>
                <h3 className="config-section-title" style={{ marginTop: 20 }}>
                  Ngôn ngữ
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div className="form-group">
                    <label>Ngôn ngữ video gốc</label>
                    <select
                      value={cfg.language?.video || "auto"}
                      onChange={(e) =>
                        updateConfig("language.video", e.target.value)
                      }
                    >
                      <option value="auto">Tự động nhận diện</option>
                      <option value="vi">Tiếng Việt</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Ngôn ngữ bài viết</label>
                    <select
                      value={cfg.language?.article || "vi"}
                      onChange={(e) =>
                        updateConfig("language.article", e.target.value)
                      }
                    >
                      <option value="vi">Tiếng Việt</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                </div>
                <ToggleRow
                  label="Tự động dịch nội dung"
                  desc="AI sẽ tự dịch nội dung từ ngôn ngữ gốc sang ngôn ngữ bài viết"
                  checked={cfg.autoTranslate !== false}
                  onChange={(v) => updateConfig("autoTranslate", v)}
                />
                <ToggleRow
                  label="Kích hoạt dự án"
                  desc="Dự án đang hoạt động và có thể xử lý nội dung"
                  checked={cfg.active !== false}
                  onChange={(v) => updateConfig("active", v)}
                />
              </div>
            )}

            {tab === "youtube" && (
              <div>
                <h3 className="config-section-title">Cấu hình YouTube</h3>
                <div className="form-group">
                  <label>YouTube API Key</label>
                  <input
                    type="password"
                    placeholder="AIza..."
                    value={cfg.youtubeApiKey || ""}
                    onChange={(e) =>
                      updateConfig("youtubeApiKey", e.target.value)
                    }
                  />
                  <small style={{ color: "var(--text-muted)" }}>
                    Lấy API Key từ Google Cloud Console
                  </small>
                </div>
              </div>
            )}

            {tab === "publishing" && (
              <div>
                <h3 className="config-section-title">Nền tảng đăng bài</h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 8,
                    marginBottom: 20,
                  }}
                >
                  {["wordpress", "shopify", "haravan", "webcake"].map((p) => (
                    <button
                      key={p}
                      className={`platform-card ${(cfg.publishing?.platform || "wordpress") === p ? "active" : ""}`}
                      onClick={() => updateConfig("publishing.platform", p)}
                    >
                      <div style={{ fontSize: 20 }}>
                        {p === "wordpress"
                          ? "🔵"
                          : p === "shopify"
                            ? "🟢"
                            : p === "haravan"
                              ? "🟠"
                              : "🟣"}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          textTransform: "capitalize",
                        }}
                      >
                        {p === "wordpress"
                          ? "WordPress"
                          : p === "shopify"
                            ? "Shopify Blog"
                            : p === "haravan"
                              ? "Haravan Blog"
                              : "Webcake Blog"}
                      </div>
                    </button>
                  ))}
                </div>

                <h3 className="config-section-title">Cấu hình WordPress</h3>

                {/* WP Site selector from global Settings */}
                {wpSites.length > 0 && (
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label>Chọn WP Site đã lưu</label>
                    <select
                      value={cfg.publishing?.wpSiteId || ""}
                      onChange={(e) => {
                        const siteId = e.target.value;
                        updateConfig("publishing.wpSiteId", siteId || null);
                        if (siteId) {
                          const site = wpSites.find(s => s.id === siteId);
                          if (site) {
                            updateConfig("publishing.wordpress.url", site.url || "");
                            updateConfig("publishing.wordpress.username", site.username || "");
                            updateConfig("publishing.wordpress.appPassword", site.appPassword || "");
                          }
                        }
                      }}
                      style={{ width: "100%" }}
                    >
                      <option value="">— Nhập thủ công bên dưới —</option>
                      {wpSites.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name || s.url} {s.url ? `(${s.url})` : ""}
                        </option>
                      ))}
                    </select>
                    {cfg.publishing?.wpSiteId && (
                      <small style={{ color: "var(--accent-green, #10b981)", marginTop: 4, display: "block" }}>
                        ✅ Đang dùng WP Site từ Cài đặt. Thông tin URL/username/password tự đồng bộ.
                      </small>
                    )}
                  </div>
                )}

                <div className="form-group">
                  <label>URL Website</label>
                  <input
                    placeholder="https://example.com"
                    value={wp.url || ""}
                    onChange={(e) =>
                      updateConfig("publishing.wordpress.url", e.target.value)
                    }
                    readOnly={!!cfg.publishing?.wpSiteId}
                    style={cfg.publishing?.wpSiteId ? { opacity: 0.6 } : {}}
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div className="form-group">
                    <label>Username</label>
                    <input
                      placeholder="admin"
                      value={wp.username || ""}
                      onChange={(e) =>
                        updateConfig(
                          "publishing.wordpress.username",
                          e.target.value,
                        )
                      }
                      readOnly={!!cfg.publishing?.wpSiteId}
                      style={cfg.publishing?.wpSiteId ? { opacity: 0.6 } : {}}
                    />
                  </div>
                  <div className="form-group">
                    <label>Application Password</label>
                    <input
                      type="password"
                      placeholder="xxxx xxxx xxxx xxxx"
                      value={wp.appPassword || ""}
                      onChange={(e) =>
                        updateConfig(
                          "publishing.wordpress.appPassword",
                          e.target.value,
                        )
                      }
                      readOnly={!!cfg.publishing?.wpSiteId}
                      style={cfg.publishing?.wpSiteId ? { opacity: 0.6 } : {}}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div className="form-group">
                    <label>Trạng thái mặc định</label>
                    <select
                      value={wp.defaultStatus || "publish"}
                      onChange={(e) =>
                        updateConfig(
                          "publishing.wordpress.defaultStatus",
                          e.target.value,
                        )
                      }
                    >
                      <option value="publish">Xuất bản (Publish)</option>
                      <option value="draft">Bản nháp (Draft)</option>
                      <option value="pending">Chờ duyệt (Pending)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Author ID mặc định</label>
                    <input
                      type="number"
                      value={wp.authorId || 1}
                      onChange={(e) =>
                        updateConfig(
                          "publishing.wordpress.authorId",
                          parseInt(e.target.value) || 1,
                        )
                      }
                    />
                  </div>
                </div>

                <h3 className="config-section-title" style={{ marginTop: 16 }}>
                  Cách chọn Category
                </h3>
                {[
                  {
                    value: "default",
                    label: "Mặc định WordPress",
                    desc: "Dùng category mặc định của WordPress",
                  },
                  {
                    value: "fixed",
                    label: "Category cố định",
                    desc: "Tất cả bài viết vào 1 category cố định",
                  },
                  {
                    value: "ai",
                    label: "AI tự chọn",
                    desc: "AI sẽ phân tích nội dung và tự động chọn category phù hợp",
                    badge: "SMART",
                  },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`radio-card ${(wp.categoryMode || "default") === opt.value ? "active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="categoryMode"
                      value={opt.value}
                      checked={(wp.categoryMode || "default") === opt.value}
                      onChange={() =>
                        updateConfig(
                          "publishing.wordpress.categoryMode",
                          opt.value,
                        )
                      }
                    />
                    <div>
                      <strong>{opt.label}</strong>{" "}
                      {opt.badge && (
                        <span
                          className="badge badge-success"
                          style={{ fontSize: 10 }}
                        >
                          {opt.badge}
                        </span>
                      )}
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {opt.desc}
                      </div>
                    </div>
                  </label>
                ))}

                {wpTest && (
                  <div
                    className={`alert ${wpTest.success ? "alert-success" : "alert-error"}`}
                    style={{ marginTop: 12 }}
                  >
                    {wpTest.loading
                      ? "⏳ Đang kiểm tra..."
                      : wpTest.success
                        ? `✅ ${wpTest.message}`
                        : `❌ ${wpTest.error}`}
                  </div>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: 12 }}
                  onClick={handleTestWp}
                >
                  🔗 Test kết nối WordPress
                </button>
              </div>
            )}

            {tab === "prompts" && (
              <div>
                <h3 className="config-section-title">
                  Tùy chỉnh phong cách viết
                </h3>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    marginBottom: 16,
                  }}
                >
                  Prompt của bạn thay thế hoàn toàn phong cách mặc định.
                </p>

                <div className="config-card">
                  <h4>Phong cách phân tích</h4>
                  <div className="form-group">
                    <label>Chọn prompt đã lưu</label>
                    <select
                      value={cfg.prompts?.analysisPromptId || ""}
                      onChange={(e) =>
                        updateConfig("prompts.analysisPromptId", e.target.value)
                      }
                    >
                      <option value="">-- Nhập tùy chỉnh bên dưới --</option>
                      {prompts
                        .filter((p) => p.type === "analysis")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Nội dung prompt</label>
                    <textarea
                      rows={3}
                      placeholder="Để trống để dùng phong cách mặc định"
                      value={cfg.prompts?.analysisCustom || ""}
                      onChange={(e) =>
                        updateConfig("prompts.analysisCustom", e.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="config-card" style={{ marginTop: 16 }}>
                  <h4>Phong cách viết blog</h4>
                  <div className="form-group">
                    <label>Chọn prompt đã lưu</label>
                    <select
                      value={cfg.prompts?.blogPromptId || ""}
                      onChange={(e) =>
                        updateConfig("prompts.blogPromptId", e.target.value)
                      }
                    >
                      <option value="">-- Nhập tùy chỉnh bên dưới --</option>
                      {prompts
                        .filter((p) => p.type === "blog")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Nội dung prompt</label>
                    <textarea
                      rows={3}
                      placeholder="Để trống để dùng phong cách mặc định"
                      value={cfg.prompts?.blogCustom || ""}
                      onChange={(e) =>
                        updateConfig("prompts.blogCustom", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {tab === "images" && (
              <div>
                <h3 className="config-section-title">Cấu hình Thumbnail</h3>
                <ToggleRow
                  label="Bật tạo thumbnail"
                  desc="AI sẽ tự động tạo ảnh đại diện cho mỗi bài viết"
                  checked={cfg.images?.thumbnailEnabled !== false}
                  onChange={(v) => updateConfig("images.thumbnailEnabled", v)}
                />
                {cfg.images?.thumbnailEnabled !== false && (
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label>Tùy chỉnh phong cách thumbnail</label>
                    <textarea
                      rows={2}
                      placeholder="Để trống để dùng mặc định (chuyên nghiệp, không chữ, 16:9)"
                      value={cfg.images?.thumbnailStyle || ""}
                      onChange={(e) =>
                        updateConfig("images.thumbnailStyle", e.target.value)
                      }
                    />
                  </div>
                )}

                <h3 className="config-section-title" style={{ marginTop: 20 }}>
                  Ảnh Section trong bài
                </h3>
                <ToggleRow
                  label="Bật tạo ảnh cho sections"
                  desc="AI tạo ảnh minh họa cho từng phần (heading H2) trong bài viết"
                  checked={cfg.images?.sectionImages || false}
                  onChange={(v) => updateConfig("images.sectionImages", v)}
                />

                <h3 className="config-section-title" style={{ marginTop: 20 }}>
                  Resize ảnh trước khi đăng
                </h3>
                <ToggleRow
                  label="Bật Resize ảnh tự động"
                  desc="Tự động thu nhỏ ảnh thumbnail và section trước khi đăng lên WordPress"
                  checked={cfg.images?.autoResize || false}
                  onChange={(v) => updateConfig("images.autoResize", v)}
                />
              </div>
            )}

            {tab === "ai" && (
              <div>
                <h3 className="config-section-title">Cài đặt AI cho dự án</h3>
                <ToggleRow
                  label="Tùy chỉnh"
                  desc="Dự án này sử dụng cài đặt AI chung từ Settings"
                  checked={!cfg.ai?.useGlobal}
                  onChange={(v) => updateConfig("ai.useGlobal", !v)}
                />
                {cfg.ai?.useGlobal !== false && (
                  <div className="alert alert-info" style={{ marginTop: 12 }}>
                    Dự án đang sử dụng cài đặt AI chung. Vào{" "}
                    <strong>Cài đặt → AI Provider</strong> để thay đổi.
                  </div>
                )}
              </div>
            )}

            {tab === "kb" && (
              <div>
                <h3 className="config-section-title">Knowledge Base RAG</h3>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    marginBottom: 16,
                  }}
                >
                  Khi bật, AI sẽ tham chiếu dữ liệu từ Knowledge Base của dự án
                  để tạo nội dung chính xác hơn.
                </p>
                <ToggleRow
                  label="Bật Knowledge Base RAG"
                  desc="AI sẽ tìm kiếm ngữ cảnh liên quan trong KB trước khi viết bài"
                  checked={cfg.knowledgeBase?.enableRAG || false}
                  onChange={(v) => updateConfig("knowledgeBase.enableRAG", v)}
                />
              </div>
            )}

            {tab === "automation" && (
              <div>
                <h3 className="config-section-title">Quy trình xuất bản</h3>
                <ToggleRow
                  label="Yêu cầu xem trước trước khi đăng"
                  desc="Bật: bài viết AI tạo sẽ ở trạng thái 'Chờ duyệt'. Tắt: bài được đăng tự động ngay khi xử lý xong."
                  checked={cfg.automation?.requireReview !== false}
                  onChange={(v) => updateConfig("automation.requireReview", v)}
                />
                <ToggleRow
                  label="Ping Sitemap sau khi đăng bài"
                  desc="Gửi thông báo tới Google và Bing rằng sitemap có bài mới, giúp index nhanh hơn."
                  checked={cfg.automation?.pingSitemap !== false}
                  onChange={(v) => updateConfig("automation.pingSitemap", v)}
                />
              </div>
            )}

            {tab === "advanced" && (
              <div>
                <div className="alert alert-info" style={{ marginBottom: 16 }}>
                  Các tính năng nâng cao giúp tối ưu SEO chuyên sâu. Bật tính
                  năng nào thì mới hiện các tùy chọn và giao diện liên quan
                  trong dự án.
                </div>

                <h3 className="config-section-title">
                  Phân tích SERP & Khoảng trống nội dung
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Phân tích top kết quả Google để tìm khoảng trống nội dung,
                  People Also Ask, và cấu trúc heading đối thủ.
                </p>
                <ToggleRow
                  label="Bật Phân tích SERP"
                  desc="Thêm bước phân tích SERP trước khi AI viết bài."
                  checked={cfg.advanced?.serpAnalysis || false}
                  onChange={(v) => updateConfig("advanced.serpAnalysis", v)}
                />

                <h3 className="config-section-title" style={{ marginTop: 20 }}>
                  Content Brief trước khi viết
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Tạo tài liệu brief chi tiết trước khi AI viết bài.
                </p>
                <ToggleRow
                  label="Bật Content Brief"
                  desc="Thêm bước tạo brief (bước 0) vào pipeline."
                  checked={cfg.advanced?.contentBrief || false}
                  onChange={(v) => updateConfig("advanced.contentBrief", v)}
                />

                <h3 className="config-section-title" style={{ marginTop: 20 }}>
                  Làm mới nội dung (Content Refresh)
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Tự động phát hiện bài viết cần cập nhật dựa trên dữ liệu GSC.
                </p>
                <ToggleRow
                  label="Bật Content Refresh"
                  desc="Phát hiện & đề xuất cập nhật bài viết. Cần kết nối Google Search Console."
                  checked={cfg.advanced?.contentRefresh || false}
                  onChange={(v) => updateConfig("advanced.contentRefresh", v)}
                />
              </div>
            )}

            {tab === "indexing" && (
              <div>
                <h3 className="config-section-title">Cấu hình Index tự động</h3>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
                  Submit URL lên Google &amp; Bing ngay sau khi đăng bài để được index nhanh hơn.
                  <strong> GA (Google Analytics) không cần thiết.</strong>
                </p>

                <ToggleRow
                  label="Tự động index sau khi publish"
                  desc="Sau khi đăng bài thành công, URL sẽ tự động được gửi lên Bing và Google"
                  checked={cfg.indexing?.autoIndexOnPublish !== false}
                  onChange={(v) => updateConfig("indexing.autoIndexOnPublish", v)}
                />

                <h3 className="config-section-title" style={{ marginTop: 20 }}>Domain</h3>
                <div className="form-group">
                  <label>Tên domain (không có http://)</label>
                  <input
                    placeholder="example.com"
                    value={cfg.indexing?.siteHost || ""}
                    onChange={(e) => updateConfig("indexing.siteHost", e.target.value)}
                  />
                  <small style={{ color: "var(--text-muted)" }}>VD: myblog.com (không cần https://)</small>
                </div>

                {/* ===== Bing IndexNow ===== */}
                <h3 className="config-section-title" style={{ marginTop: 20 }}>🔵 Bing IndexNow</h3>
                <div className="alert alert-info" style={{ marginBottom: 12 }}>
                  <strong>Setup (1 lần):</strong> Tạo key bất kỳ → Upload file <code>{cfg.indexing?.bingIndexNowKey || "your-key"}.txt</code> lên root website (nội dung = key) → Điền key vào đây.
                </div>
                <div className="form-group">
                  <label>Bing IndexNow Key</label>
                  <input
                    placeholder="abc123def456..."
                    value={cfg.indexing?.bingIndexNowKey || ""}
                    onChange={(e) => updateConfig("indexing.bingIndexNowKey", e.target.value)}
                  />
                  <small style={{ color: "var(--text-muted)" }}>Key tự tạo — chuỗi ký tự bất kỳ, không chứa ký tự đặc biệt</small>
                </div>

                {/* ===== Google Indexing API — dual mode ===== */}
                <h3 className="config-section-title" style={{ marginTop: 20 }}>🔴 Google Indexing API</h3>

                {/* Mode selector */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, padding: 14, border: `2px solid ${cfg.indexing?.useSharedSA !== false ? "var(--accent-green)" : "var(--border-light)"}`, borderRadius: 8, cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="radio" name="googleSAMode" checked={cfg.indexing?.useSharedSA !== false}
                        onChange={() => updateConfig("indexing.useSharedSA", true)} />
                      <strong>✅ Option A — Dùng SPLSEO SA (Đơn giản)</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 22 }}>
                      Chỉ cần add email SPLSEO vào GSC website của bạn. Không cần upload gì cả.
                    </div>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, padding: 14, border: `2px solid ${cfg.indexing?.useSharedSA === false ? "var(--accent-blue)" : "var(--border-light)"}`, borderRadius: 8, cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="radio" name="googleSAMode" checked={cfg.indexing?.useSharedSA === false}
                        onChange={() => updateConfig("indexing.useSharedSA", false)} />
                      <strong>🔧 Option B — SA riêng của bạn (Nâng cao)</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 22 }}>
                      Tự tạo Service Account trên Google Cloud → upload JSON. Kiểm soát hoàn toàn.
                    </div>
                  </label>
                </div>

                {/* Option A content */}
                {cfg.indexing?.useSharedSA !== false && (
                  <div>
                    {splseoIndexer?.splseoSAEmail ? (
                      <div className="alert alert-info">
                        <strong>Bước duy nhất cần làm:</strong><br />
                        Vào <strong>Google Search Console</strong> của website → Settings → Users and permissions → Add user<br />
                        Nhập email: <code style={{ userSelect: "all", background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: 4 }}>{splseoIndexer.splseoSAEmail}</code> → chọn <strong>Owner</strong><br />
                        <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
                          onClick={() => navigator.clipboard.writeText(splseoIndexer.splseoSAEmail)}>
                          📋 Copy email
                        </button>
                      </div>
                    ) : (
                      <div className="alert" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
                        ⚠️ SPLSEO chưa cấu hình Service Account trung tâm. Admin cần thêm <code>SPLSEO_GOOGLE_SA_EMAIL</code> và <code>SPLSEO_GOOGLE_SA_JSON</code> vào file <code>.env</code>.
                      </div>
                    )}
                  </div>
                )}

                {/* Option B content */}
                {cfg.indexing?.useSharedSA === false && (
                  <div>
                    <div className="alert alert-info" style={{ marginBottom: 12 }}>
                      <strong>Setup:</strong> Google Cloud Console → tạo Service Account → tải JSON key → add email SA làm <strong>Owner</strong> trong GSC
                    </div>
                    {cfg.indexing?.googleServiceAccount ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ color: "var(--accent-green)", fontSize: 13 }}>
                          ✅ Đã upload: <strong>{cfg.indexing.googleServiceAccount?.client_email}</strong>
                        </span>
                        <button className="btn btn-secondary btn-sm" style={{ color: "var(--accent-red)" }}
                          onClick={() => updateConfig("indexing.googleServiceAccount", null)}>🗑️ Xóa</button>
                      </div>
                    ) : (
                      <div className="form-group">
                        <label>Upload Google Service Account JSON</label>
                        <input type="file" accept=".json" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            try {
                              const json = JSON.parse(ev.target.result);
                              if (!json.client_email || !json.private_key) {
                                alert("File JSON không hợp lệ — cần có client_email và private_key");
                                return;
                              }
                              updateConfig("indexing.googleServiceAccount", json);
                            } catch { alert("Không thể đọc file JSON"); }
                          };
                          reader.readAsText(file);
                        }} />
                        <small style={{ color: "var(--text-muted)" }}>File JSON từ Google Cloud Console → Service Account → Keys</small>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px solid var(--border-light)",
          }}
        >
          <div>
            {dirty && (
              <span style={{ fontSize: 12, color: "var(--accent-orange)" }}>
                ⚠ Có thay đổi chưa lưu
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Hủy
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Đang lưu..." : "✓ Lưu thay đổi"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }) {
  return (
    <div className="toggle-row">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
        {desc && (
          <div
            style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}
          >
            {desc}
          </div>
        )}
      </div>
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}
