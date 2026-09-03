import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import WpSiteCard from "../components/WpSiteCard";

const NAV_ITEMS = [
  { id: "api-keys", label: "🔑 API Keys", icon: "🔑" },
  { id: "ai-provider", label: "🤖 AI Provider", icon: "🤖" },
  { id: "publishing", label: "🌐 Đăng bài", icon: "🌐" },
  { id: "prompts", label: "📝 Prompts", icon: "📝" },
  { id: "system", label: "⚙️ Hệ thống", icon: "⚙️" },
];

export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();

  // Sync section với URL path — cho phép link sâu như /settings/ai-provider hoạt động
  const pathSection = location.pathname.replace(/^\/settings\/?/, "").split("/")[0];
  const activeSection = NAV_ITEMS.some(i => i.id === pathSection) ? pathSection : "api-keys";

  const switchSection = (id) => {
    navigate(`/settings/${id}`, { replace: true });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Cài đặt</h1>
          <p className="subtitle">Cấu hình AI, API keys, kết nối</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              className={activeSection === item.id ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                switchSection(item.id);
              }}
              href={`/settings/${item.id}`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="settings-content">
          {activeSection === "api-keys" && <ApiKeysSection />}
          {activeSection === "ai-provider" && <AiProviderSection />}
          {activeSection === "publishing" && <PublishingSection />}
          {activeSection === "prompts" && <PromptsSection />}
          {activeSection === "system" && <SystemSection />}
        </div>
      </div>
    </div>
  );
}

/* ===== API Keys ===== */
function ApiKeysSection() {
  const [keys, setKeys] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingKey, setEditingKey] = useState(null); // null = create, id = edit
  const [form, setForm] = useState({
    name: "",
    provider: "gemini",
    apiKey: "",
    dailyLimit: 1500,
    priority: 1,
    active: true,
  });
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.getApiKeys().then(setKeys).catch(console.error);
  }, []);

  const handleCreate = async () => {
    try {
      if (editingKey) {
        // Update existing key
        await api.updateApiKey(editingKey, { ...form });
      } else {
        // Create new key
        await api.createApiKey({ ...form });
      }
      setShowModal(false);
      setEditingKey(null);
      setForm({
        name: "",
        provider: "gemini",
        apiKey: "",
        dailyLimit: 1500,
        priority: 1,
        active: true,
      });
      setTestResult(null);
      api.getApiKeys().then(setKeys);
    } catch (error) {
      alert(error.message || "Không thể lưu API key. Vui lòng thử lại.");
    }
  };

  const handleEdit = (key) => {
    setForm({
      name: key.name,
      provider: key.provider,
      apiKey: key.apiKey,
      dailyLimit: key.dailyLimit,
      priority: key.priority,
      active: key.active,
    });
    setEditingKey(key.id);
    setTestResult(null);
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Xóa API key này?")) return;
    try {
      await api.deleteApiKey(id);
      api.getApiKeys().then(setKeys);
    } catch (e) {
      alert("Lỗi xóa API key: " + e.message);
    }
  };

  const handleTest = async () => {
    if (!form.apiKey) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testApiKey({
        provider: form.provider,
        apiKey: form.apiKey,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, message: "❌ Lỗi: " + error.message });
    }
    setTesting(false);
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 18 }}>API Keys</h2>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowModal(true);
            setEditingKey(null);
            setForm({
              name: "",
              provider: "gemini",
              apiKey: "",
              dailyLimit: 1500,
              priority: 1,
              active: true,
            });
            setTestResult(null);
          }}
        >
          ➕ Thêm Key
        </button>
      </div>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 16,
        }}
      >
        Trial có thể dùng API chung và không cần thêm key. Từ Basic trở lên, bạn có thể thêm API key riêng để tăng quota, chọn provider/model theo nhu cầu; hệ thống luôn ưu tiên key riêng trước AI credit dùng chung.
      </p>

      <div className="stat-cards" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Tổng keys</div>
          <div className="stat-value">{keys.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Đang active</div>
          <div className="stat-value green">
            {keys.filter((k) => k.active).length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Requests hôm nay</div>
          <div className="stat-value blue">
            {keys.reduce((s, k) => s + (k.usageToday || 0), 0)}
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Tên / Provider</th>
              <th>API Key</th>
              <th>Ưu tiên</th>
              <th>Limit</th>
              <th>Trạng thái</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{key.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {key.provider}
                  </div>
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {key.apiKey.slice(0, 10)}...{key.apiKey.slice(-4)}
                </td>
                <td>{key.priority}</td>
                <td>{key.dailyLimit}</td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span
                      className={`badge ${key.active ? "badge-success" : "badge-critical"}`}
                      style={{ width: "fit-content" }}
                    >
                      {key.active ? "Hoạt động" : "Ngưng dùng"}
                    </span>
                    {key.cooldownSecondsLeft > 0 && (
                      <span
                        className="badge badge-warning"
                        style={{
                          backgroundColor: "rgba(245, 158, 11, 0.15)",
                          color: "#f59e0b",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                          width: "fit-content",
                          fontSize: 10,
                          padding: "2px 6px"
                        }}
                      >
                        ⏳ Nghỉ {key.cooldownSecondsLeft}s
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleEdit(key)}
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(key.id)}
                  >
                    Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingKey ? "✏️ Sửa API Key" : "🔑 Thêm API Key"}</h2>
            <div className="form-group">
              <label>Tên API Key *</label>
              <input
                type="text"
                placeholder="VD: Gemini Production"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Provider *</label>
              <div style={{ display: "flex", gap: 8 }}>
                {["gemini", "openai", "openrouter", "serper", "unsplash", "pexels", "pixabay"].map(
                  (p) => (
                    <button
                      key={p}
                      className={`btn ${form.provider === p ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => {
                        setForm({ ...form, provider: p });
                        setTestResult(null);
                      }}
                      style={{
                        flex: 1,
                        textTransform: "capitalize",
                        fontSize: 12,
                      }}
                    >
                      {p === "gemini"
                        ? "💎 Gemini"
                        : p === "openai"
                          ? "🟢 OpenAI"
                          : p === "serper"
                            ? "🔍 Serper"
                            : p === "unsplash"
                              ? "📷 Unsplash"
                              : p === "pexels"
                                ? "📸 Pexels"
                                : p === "pixabay"
                                  ? "🌄 Pixabay"
                                  : "🔀 OpenRouter"}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="form-group">
              <label>API Key *</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="password"
                  placeholder="AIza..."
                  value={form.apiKey}
                  style={{ flex: 1 }}
                  onChange={(e) => {
                    setForm({ ...form, apiKey: e.target.value });
                    setTestResult(null);
                  }}
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleTest}
                  disabled={!form.apiKey || testing}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {testing ? (
                    <>
                      <span
                        className="loader"
                        style={{ width: 14, height: 14 }}
                      />
                    </>
                  ) : (
                    "Test"
                  )}
                </button>
              </div>
              {testResult && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 12px",
                    borderRadius: 6,
                    fontSize: 13,
                    background: testResult.success
                      ? "rgba(16,185,129,0.1)"
                      : "rgba(239,68,68,0.1)",
                    border: `1px solid ${testResult.success ? "var(--accent-green)" : "var(--accent-red)"}`,
                    color: testResult.success
                      ? "var(--accent-green)"
                      : "var(--accent-red)",
                  }}
                >
                  {testResult.message}
                </div>
              )}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div className="form-group">
                <label>Daily Limit</label>
                <input
                  type="number"
                  value={form.dailyLimit}
                  onChange={(e) =>
                    setForm({ ...form, dailyLimit: parseInt(e.target.value) })
                  }
                />
              </div>
              <div className="form-group">
                <label>Priority (1-10)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: parseInt(e.target.value) })
                  }
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  1 = cao nhất
                </div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 0",
                borderTop: "1px solid var(--border-color)",
                marginBottom: 4,
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>Kích hoạt</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Key sẽ được sử dụng trong rotation
                </div>
              </div>
              <button
                onClick={() => setForm({ ...form, active: !form.active })}
                style={{
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  border: "none",
                  cursor: "pointer",
                  background: form.active
                    ? "var(--accent-green)"
                    : "var(--bg-tertiary)",
                  position: "relative",
                  transition: "background 0.2s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    left: form.active ? 23 : 3,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "white",
                    transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }}
                />
              </button>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
              >
                Hủy
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!form.name || !form.apiKey}
              >
                {editingKey ? "Lưu thay đổi" : "Thêm mới"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== AI Provider ===== */
function AiProviderSection() {
  const [settings, setSettings] = useState(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState("");

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
  }, []);

  const handleClearCache = async () => {
    if (!confirm("Bạn có chắc chắn muốn xóa toàn bộ cache phản hồi AI? Hành động này không thể hoàn tác.")) return;
    setClearingCache(true);
    setCacheMessage("");
    try {
      const res = await api.clearCache();
      setCacheMessage(res.message || "🧹 Xóa cache thành công!");
      setTimeout(() => setCacheMessage(""), 5000);
    } catch (error) {
      alert("Lỗi khi xóa cache: " + error.message);
    } finally {
      setClearingCache(false);
    }
  };

  const updateAiSettings = async (updates) => {
    const newSettings = {
      ...settings,
      aiProvider: { ...settings.aiProvider, ...updates },
    };
    setSettings(newSettings);
    await api.updateSettings(newSettings);
  };

  if (!settings)
    return (
      <div className="loading-overlay">
        <span className="loader" />
      </div>
    );

  const { aiProvider } = settings;

  // Smart Routing options (A6)
  const textRoutingModes = [
    { id: "auto-free", label: "✨ Auto-Free", desc: "Gemini free → OpenRouter free → OpenAI", badge: "🟢 FREE" },
    { id: "gemini", label: "💎 Gemini", desc: "Chỉ dùng Gemini API", badge: "🟢" },
    { id: "openai", label: "🟢 OpenAI", desc: "Chỉ dùng OpenAI", badge: "💰" },
    { id: "openrouter", label: "🔀 OpenRouter", desc: "300+ models", badge: "🟢" },
  ];
  const imageRoutingModes = [
    { id: "auto-best", label: "🎨 Auto-Best", desc: "Imagen → GPT Image → OpenRouter → Free", badge: "🏆" },
    { id: "gemini", label: "💎 Gemini", desc: "Imagen / Gemini Native", badge: "🟢 FREE" },
    { id: "openai", label: "🟢 OpenAI", desc: "GPT Image / DALL-E", badge: "💰" },
    { id: "openrouter", label: "🔀 OpenRouter", desc: "Via OpenRouter API", badge: "🟢" },
  ];

  const currentTextRouting = aiProvider.textRouting || (aiProvider.mode === "fallback" ? null : aiProvider.mode) || "auto-free";
  const currentImageRouting = aiProvider.imageRouting || "auto-best";

  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 6 }}>AI Provider</h2>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 20,
        }}
      >
        Cấu hình routing thông minh — ưu tiên FREE cho viết bài, chất lượng cao cho ảnh
      </p>

      {/* Text Routing */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          📝 Viết bài (Text Generation)
        </h4>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
          Chọn chiến lược chọn provider khi tạo nội dung văn bản
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 8,
          }}
        >
          {textRoutingModes.map((m) => (
            <div
              key={m.id}
              onClick={() => updateAiSettings({ textRouting: m.id })}
              className="card"
              style={{
                cursor: "pointer",
                padding: 12,
                border:
                  currentTextRouting === m.id
                    ? "2px solid var(--accent-green)"
                    : undefined,
                transition: "all 0.2s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: m.badge.includes("FREE") ? "rgba(16,185,129,0.15)" : m.badge.includes("💰") ? "rgba(245,158,11,0.15)" : "rgba(59,130,246,0.15)", color: m.badge.includes("FREE") ? "var(--accent-green)" : m.badge.includes("💰") ? "#f59e0b" : "var(--accent-blue)" }}>
                  {m.badge}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {m.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Image Routing */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          🖼️ Tạo ảnh (Image Generation)
        </h4>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
          Chọn chiến lược chọn provider khi tạo ảnh thumbnail và section
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 8,
          }}
        >
          {imageRoutingModes.map((m) => (
            <div
              key={m.id}
              onClick={() => updateAiSettings({ imageRouting: m.id })}
              className="card"
              style={{
                cursor: "pointer",
                padding: 12,
                border:
                  currentImageRouting === m.id
                    ? "2px solid var(--accent-green)"
                    : undefined,
                transition: "all 0.2s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: m.badge.includes("FREE") ? "rgba(16,185,129,0.15)" : m.badge.includes("💰") ? "rgba(245,158,11,0.15)" : "rgba(59,130,246,0.15)", color: m.badge.includes("FREE") ? "var(--accent-green)" : m.badge.includes("💰") ? "#f59e0b" : "var(--accent-blue)" }}>
                  {m.badge}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {m.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cost Estimate */}
      <div className="card" style={{ marginBottom: 16, padding: 14, background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--accent-green)" }}>
          💰 Chi phí ước tính
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
          <div>
            <div style={{ color: "var(--text-muted)" }}>1 bài (2500 từ)</div>
            <div style={{ fontWeight: 600, color: currentTextRouting === "auto-free" || currentTextRouting === "gemini" ? "var(--accent-green)" : "#f59e0b" }}>
              {currentTextRouting === "auto-free" || currentTextRouting === "gemini" ? "~$0.00" : currentTextRouting === "openrouter" ? "~$0.00" : "~$0.01"}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)" }}>10 bài bulk</div>
            <div style={{ fontWeight: 600, color: currentTextRouting === "auto-free" || currentTextRouting === "gemini" ? "var(--accent-green)" : "#f59e0b" }}>
              {currentTextRouting === "auto-free" || currentTextRouting === "gemini" ? "~$0.00" : currentTextRouting === "openrouter" ? "~$0.00" : "~$0.10"}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)" }}>10 bài + ảnh AI</div>
            <div style={{ fontWeight: 600, color: currentImageRouting === "auto-best" || currentImageRouting === "gemini" ? "var(--accent-green)" : "#f59e0b" }}>
              {currentImageRouting === "openai" ? "~$0.40" : "~$0.00"}
            </div>
          </div>
        </div>
      </div>

      {/* Response Cache Config */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
          ⚡ Bộ nhớ đệm phản hồi AI (Response Cache)
        </h4>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
          Lưu trữ phản hồi văn bản của AI để sử dụng lại cho các yêu cầu giống hệt nhau, giúp tiết kiệm chi phí token và tăng tốc sinh nội dung.
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border-color)", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Bật bộ nhớ đệm AI</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Sử dụng cache khi gửi câu lệnh viết bài
            </div>
          </div>
          <button
            onClick={() => updateAiSettings({ enableCache: !aiProvider.enableCache })}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: aiProvider.enableCache
                ? "var(--accent-green)"
                : "var(--bg-tertiary)",
              position: "relative",
              transition: "background 0.2s",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 3,
                left: aiProvider.enableCache ? 23 : 3,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "white",
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }}
            />
          </button>
        </div>

        {aiProvider.enableCache && (
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>Thời gian sống của bộ nhớ đệm (TTL) *</label>
            <select
              value={aiProvider.cacheTtl || 86400}
              onChange={(e) => updateAiSettings({ cacheTtl: parseInt(e.target.value) })}
              style={{ width: "100%", padding: "8px 12px" }}
            >
              <option value={3600}>1 giờ</option>
              <option value={21600}>6 giờ</option>
              <option value={43200}>12 giờ</option>
              <option value={86400}>24 giờ (Mặc định)</option>
              <option value={604800}>7 ngày</option>
            </select>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Dọn dẹp các dữ liệu cache đã lưu trong cơ sở dữ liệu SQLite.
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleClearCache}
            disabled={clearingCache}
            style={{ whiteSpace: "nowrap" }}
          >
            {clearingCache ? "Đang xóa..." : "🧹 Xóa toàn bộ Cache"}
          </button>
        </div>
        {cacheMessage && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 12,
              background: "rgba(16,185,129,0.1)",
              border: "1px solid var(--accent-green)",
              color: "var(--accent-green)",
            }}
          >
            {cacheMessage}
          </div>
        )}
      </div>

      {/* Legacy mode (backward compat, collapsed) */}
      {aiProvider.mode && aiProvider.mode !== "fallback" && !aiProvider.textRouting && (
        <div className="card" style={{ marginBottom: 16, opacity: 0.6 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            ⚠️ Đang dùng cấu hình cũ (mode: {aiProvider.mode}). Chọn routing mới ở trên để cập nhật.
          </div>
        </div>
      )}

      {/* Provider-specific settings */}
      {["gemini", "openai", "openrouter"].map((provider) => {
        const thumbnailModelSuggestions = {
          gemini: [
            { id: "gemini-2.5-flash-image", label: "Nano Banana (Nhanh, Hiệu quả)", group: "Gemini 2.5" },
            { id: "gemini-3.1-flash-image-preview", label: "Nano Banana 2 (Nhanh, Chất lượng cao)", group: "Gemini 3.1 (Mới nhất)" },
            { id: "gemini-3-pro-image-preview", label: "Nano Banana Pro (4K, Professional)", group: "Gemini 3.0" },
            { id: "imagen-4.0-fast-generate-001", label: "Imagen 4.0 Fast", group: "Imagen" },
            { id: "imagen-4.0-generate-001", label: "Imagen 4.0 (Chất lượng cao)", group: "Imagen" },
          ],
          openai: [
            { id: "gpt-image-1.5", label: "GPT Image 1.5 (Mới nhất, SOTA)", group: "GPT Image" },
            { id: "gpt-image-1", label: "GPT Image 1 (Ổn định)", group: "GPT Image" },
            { id: "gpt-image-1-mini", label: "GPT Image 1 Mini (Rẻ)", group: "GPT Image" },
            { id: "dall-e-3", label: "DALL-E 3 (Legacy)", group: "Legacy (Deprecated)" },
          ],
          openrouter: [
            { id: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash" },
            { id: "google/gemini-3-flash-preview", label: "Gemini 3.0 Flash" },
            { id: "openai/gpt-image-1", label: "GPT Image 1 via OR" },
            { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free)" },
            { id: "openai/dall-e-3", label: "DALL-E 3 via OR" },
          ],
        };
        const sectionModelSuggestions = {
          gemini: thumbnailModelSuggestions.gemini,
          openai: thumbnailModelSuggestions.openai,
          openrouter: thumbnailModelSuggestions.openrouter,
        };
        const defaultThumb = {
          gemini: "gemini-2.5-flash-image",
          openai: "gpt-image-1",
          openrouter: "google/gemini-2.0-flash-exp:free",
        };
        const defaultSection = {
          gemini: "gemini-2.5-flash-image",
          openai: "gpt-image-1",
          openrouter: "google/gemini-2.5-flash-preview",
        };
        const thumbSuggestions = thumbnailModelSuggestions[provider] || [];
        const secSuggestions = sectionModelSuggestions[provider] || [];

        // Group suggestions for display
        const groupedSuggestions = (list) => {
          const groups = {};
          list.forEach(m => {
            const g = m.group || "Khác";
            if (!groups[g]) groups[g] = [];
            groups[g].push(m);
          });
          return groups;
        };

        const renderModelPicker = (label, field, defaultVal, suggestions) => {
          const currentVal = aiProvider[provider]?.[field] || "";
          const grouped = groupedSuggestions(suggestions);
          return (
            <div className="form-group">
              <label>{label} ⓘ</label>
              <select
                value={currentVal}
                onChange={(e) =>
                  updateAiSettings({
                    [provider]: {
                      ...aiProvider[provider],
                      [field]: e.target.value,
                    },
                  })
                }
              >
                <option value="">Tìm model...</option>
                {Object.entries(grouped).map(([group, models]) => (
                  <optgroup key={group} label={group}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}{currentVal === m.id ? " ✓" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {currentVal
                  ? `Đang dùng: ${currentVal}`
                  : `Mặc định: ${defaultVal}`}
              </div>
            </div>
          );
        };

        return (
        <div key={provider} className="card" style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {provider === "gemini"
              ? "💎 Google Gemini"
              : provider === "openai"
                ? "🟢 OpenAI"
                : "🔀 OpenRouter"}
            {provider === "openrouter" && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginLeft: 8 }}>300+ models (Google, Anthropic, Meta, Mistral...)</span>}
          </h4>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <div className="form-group">
              <label>Text Model ⓘ</label>
              <input
                type="text"
                value={aiProvider[provider]?.textModel || ""}
                onChange={(e) =>
                  updateAiSettings({
                    [provider]: {
                      ...aiProvider[provider],
                      textModel: e.target.value,
                    },
                  })
                }
              />
            </div>
            {renderModelPicker("Model ảnh Thumbnail", "thumbnailImageModel", defaultThumb[provider], thumbSuggestions)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            {renderModelPicker("Model ảnh Section", "sectionImageModel", defaultSection[provider], secSuggestions)}
            <div className="form-group">
              <label>Timeout (giây) ⓘ</label>
              <input
                type="number"
                value={aiProvider[provider]?.timeout || 60}
                onChange={(e) =>
                  updateAiSettings({
                    [provider]: {
                      ...aiProvider[provider],
                      timeout: parseInt(e.target.value),
                    },
                  })
                }
              />
            </div>
          </div>
          { /* Legacy fallback: show old imageModel if set */}
          {aiProvider[provider]?.imageModel && !aiProvider[provider]?.thumbnailImageModel && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, padding: "4px 8px", background: "rgba(245,158,11,0.1)", borderRadius: 4 }}>
              ⚠️ Đang dùng imageModel cũ: <strong>{aiProvider[provider].imageModel}</strong> — Hãy chọn model mới ở trên để cập nhật.
            </div>
          )}
        </div>
        );
      })}

    </div>
  );
}

/* ===== Publishing (WordPress) ===== */
function PublishingSection() {
  const [sites, setSites] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: "",
    siteUrl: "",
    username: "",
    appPassword: "",
  });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState(null);

  const loadSites = useCallback(() => {
    api.getWpSites().then(setSites).catch(console.error);
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  const handleCreate = async () => {
    if (!form.name || !form.siteUrl || !form.username || !form.appPassword) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      let url = form.siteUrl.trim();
      if (!url.startsWith("http")) url = "https://" + url;
      url = url.replace(/\/+$/, "");
      await api.createWpSite({ ...form, siteUrl: url });
      setShowModal(false);
      setForm({ name: "", siteUrl: "", username: "", appPassword: "" });
      loadSites();
    } catch (e) {
      setCreateMsg(`❌ ${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteWpSite(id);
      loadSites();
    } catch (e) {
      alert("Lỗi xóa site: " + e.message);
    }
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <h2 style={{ fontSize: 18 }}>Nền tảng đăng bài</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Quản lý kết nối WordPress — test và chỉnh sửa ngay tại đây
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ➕ Thêm Site
        </button>
      </div>

      {/* Platform tabs */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className="tab active">🌐 WordPress</button>
        <button className="tab" disabled>🛒 Shopify (sắp có)</button>
        <button className="tab" disabled>📦 Blogger (sắp có)</button>
      </div>

      {/* Site cards grid */}
      {sites.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🌐</div>
          <p>Chưa có WordPress site nào</p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            Thêm site đầu tiên
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {sites.map((site) => (
            <WpSiteCard
              key={site.id}
              site={site}
              onUpdate={loadSites}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Add site modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🌐 Thêm WordPress Site</h2>
            <div className="form-group">
              <label>Tên Site *</label>
              <input
                type="text"
                placeholder="VĐ: Blog chính"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Site URL *</label>
              <input
                type="url"
                placeholder="https://your-site.com"
                value={form.siteUrl}
                onChange={(e) => setForm({ ...form, siteUrl: e.target.value })}
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Nhập domain chính, không bao gồm /wp-admin
              </div>
            </div>
            <div className="form-group">
              <label>Username *</label>
              <input
                type="text"
                placeholder="admin"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Application Password *</label>
              <input
                type="password"
                placeholder="xxxx xxxx xxxx xxxx"
                value={form.appPassword}
                onChange={(e) =>
                  setForm({ ...form, appPassword: e.target.value })
                }
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Tạo tại: WordPress → Users → Profile → Application Passwords
              </div>
            </div>
            {createMsg && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: 13,
                  background: "rgba(239,68,68,0.1)",
                  color: "var(--accent-red, #ef4444)",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
              >
                {createMsg}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => { setShowModal(false); setCreateMsg(null); }}
              >
                Hủy
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={
                  creating ||
                  !form.name ||
                  !form.siteUrl ||
                  !form.username ||
                  !form.appPassword
                }
              >
                {creating ? "⏳ Đang tạo..." : "Thêm mới"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Prompts ===== */

const PROMPT_TYPES = [
  { id: "all", label: "Tất cả", icon: "📑" },
  {
    id: "research",
    label: "Research",
    icon: "🔍",
    desc: "Phân tích từ khóa & search intent",
    variables: ["{keyword}", "{language}"],
  },
  {
    id: "write-article",
    label: "Write Article",
    icon: "✍️",
    desc: "Phong cách viết bài & tone giọng",
    variables: ["{keyword}", "{outline}", "{date}", "{title}", "{research_summary}"],
  },
  {
    id: "thumbnail",
    label: "Thumbnail",
    icon: "🖼️",
    desc: "Tạo ảnh đại diện bài viết",
    variables: ["{keyword}", "{title}"],
  },
  {
    id: "section-image",
    label: "Section Image",
    icon: "🎨",
    desc: "Tạo ảnh minh họa từng section H2",
    variables: ["{keyword}", "{section_heading}", "{title}"],
  },
];

const PROMPT_TYPE_COLORS = {
  research: "badge-info",
  "write-article": "badge-success",
  thumbnail: "badge-warning",
  "section-image": "badge-critical",
};

function PromptsSection() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [form, setForm] = useState({
    name: "",
    type: "write-article",
    content: "",
    isDefault: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [expandedMap, setExpandedMap] = useState({});
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadPrompts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getPrompts();
      setPrompts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Lỗi khi tải prompts:", err);
      showToast("❌ Không thể tải danh sách prompt: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const handleCreateNew = () => {
    setEditingPrompt(null);
    setForm({
      name: "",
      type: filter !== "all" ? filter : "write-article",
      content: "",
      isDefault: false,
    });
    setError(null);
    setShowModal(true);
  };

  const handleEdit = (prompt) => {
    setEditingPrompt(prompt);
    setForm({
      name: prompt.name || "",
      type: prompt.type || "write-article",
      content: prompt.content || "",
      isDefault: Boolean(prompt.isDefault),
    });
    setError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Vui lòng nhập tên template");
      return;
    }
    if (!form.content.trim()) {
      setError("Vui lòng nhập nội dung prompt");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingPrompt) {
        await api.updatePrompt(editingPrompt.id, {
          name: form.name.trim(),
          type: form.type,
          content: form.content.trim(),
          isDefault: form.isDefault,
        });
        showToast("✅ Đã cập nhật prompt thành công!");
      } else {
        await api.createPrompt({
          name: form.name.trim(),
          type: form.type,
          content: form.content.trim(),
          isDefault: form.isDefault,
        });
        showToast("✅ Đã thêm prompt template mới!");
      }
      setShowModal(false);
      await loadPrompts();
    } catch (err) {
      setError(err.message || "Lỗi khi lưu prompt template");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (prompt) => {
    try {
      await api.updatePrompt(prompt.id, {
        ...prompt,
        isDefault: true,
      });
      showToast(`⭐ Đã đặt "${prompt.name}" làm mặc định cho ${prompt.type}`);
      await loadPrompts();
    } catch (err) {
      alert("Lỗi khi đặt mặc định: " + err.message);
    }
  };

  const handleDelete = async (prompt) => {
    const isDef = prompt.isDefault;
    const msg = isDef
      ? `Prompt "${prompt.name}" đang là MẶC ĐỊNH cho bước ${prompt.type}. Bạn có chắc chắn muốn xóa không?`
      : `Bạn có chắc muốn xóa prompt template "${prompt.name}"?`;
    if (!confirm(msg)) return;

    try {
      await api.deletePrompt(prompt.id);
      showToast(`🗑️ Đã xóa prompt "${prompt.name}"`);
      await loadPrompts();
    } catch (err) {
      alert("Lỗi khi xóa prompt: " + err.message);
    }
  };

  const toggleExpand = (id) => {
    setExpandedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const insertVariable = (varTag) => {
    setForm((prev) => ({
      ...prev,
      content: prev.content ? `${prev.content} ${varTag}` : varTag,
    }));
  };

  const currentTypeConfig =
    PROMPT_TYPES.find((t) => t.id === form.type) || PROMPT_TYPES[2];

  const filtered =
    filter === "all" ? prompts : prompts.filter((p) => p.type === filter);

  return (
    <div>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "var(--card-bg, #1e293b)",
            color: "var(--text-primary, #fff)",
            padding: "12px 20px",
            borderRadius: 10,
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
            border: "1px solid var(--accent-green, #10b981)",
            zIndex: 9999,
            fontSize: 13,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 8,
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          {toast}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>Prompt Templates</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
            Quản lý và tùy biến prompt AI cho từng bước tạo bài viết (Research, Viết bài, Tạo ảnh)
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleCreateNew}>
          ➕ Thêm Prompt
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="filters" style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {PROMPT_TYPES.map((t) => {
          const count =
            t.id === "all"
              ? prompts.length
              : prompts.filter((p) => p.type === t.id).length;
          return (
            <button
              key={t.id}
              className={`filter-btn ${filter === t.id ? "active" : ""}`}
              onClick={() => setFilter(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 6px",
                  borderRadius: 10,
                  background: filter === t.id ? "rgba(255,255,255,0.2)" : "var(--bg-tertiary, rgba(255,255,255,0.08))",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Prompts List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <span className="loader" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
            Chưa có prompt template nào trong mục này
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
            Bấm nút bên dưới để tạo prompt tùy chỉnh đầu tiên.
          </p>
          <button className="btn btn-primary" onClick={handleCreateNew}>
            ➕ Thêm Prompt Template
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((prompt) => {
            const isExpanded = expandedMap[prompt.id];
            const isLong = (prompt.content || "").length > 180;
            const previewText =
              !isExpanded && isLong
                ? prompt.content.slice(0, 180) + "..."
                : prompt.content;

            return (
              <div
                key={prompt.id}
                className="card"
                style={{
                  padding: 16,
                  border: prompt.isDefault
                    ? "1px solid rgba(16, 185, 129, 0.4)"
                    : "1px solid var(--border-color, rgba(255,255,255,0.08))",
                  background: prompt.isDefault
                    ? "rgba(16, 185, 129, 0.03)"
                    : "var(--card-bg, rgba(255,255,255,0.04))",
                  transition: "all 0.2s ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 260 }}>
                    {/* Header line: Name & Badges */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
                        {prompt.name}
                      </span>
                      <span
                        className={`badge ${PROMPT_TYPE_COLORS[prompt.type] || "badge-info"}`}
                        style={{ textTransform: "capitalize", fontSize: 11 }}
                      >
                        {prompt.type}
                      </span>
                      {prompt.isDefault ? (
                        <span
                          className="badge badge-success"
                          style={{
                            background: "rgba(16, 185, 129, 0.15)",
                            color: "var(--accent-green, #10b981)",
                            border: "1px solid rgba(16, 185, 129, 0.3)",
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          ⭐ Mặc định
                        </span>
                      ) : null}
                    </div>

                    {/* Content text */}
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary, #94a3b8)",
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        background: "rgba(0,0,0,0.15)",
                        padding: "10px 12px",
                        borderRadius: 8,
                        fontFamily: "inherit",
                        border: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      {previewText}
                    </div>

                    {/* Expand toggle */}
                    {isLong && (
                      <button
                        onClick={() => toggleExpand(prompt.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent-blue, #3b82f6)",
                          fontSize: 12,
                          cursor: "pointer",
                          padding: "4px 0",
                          marginTop: 4,
                          fontWeight: 500,
                        }}
                      >
                        {isExpanded ? "▲ Thu gọn" : "▼ Xem đầy đủ"}
                      </button>
                    )}
                  </div>

                  {/* Actions buttons */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexShrink: 0,
                    }}
                  >
                    {!prompt.isDefault && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleSetDefault(prompt)}
                        title="Đặt làm template mặc định cho bước này"
                        style={{ fontSize: 12 }}
                      >
                        ⭐ Đặt mặc định
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleEdit(prompt)}
                      style={{ fontSize: 12 }}
                    >
                      ✏️ Sửa
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(prompt)}
                      style={{ fontSize: 12 }}
                    >
                      🗑️ Xóa
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Add / Edit Prompt */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 680, width: "95vw" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <h2 style={{ fontSize: 18, margin: 0 }}>
                {editingPrompt ? "✏️ Sửa Prompt Template" : "➕ Thêm Prompt Template"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
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

            {error && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  marginBottom: 14,
                  fontSize: 13,
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "var(--accent-red, #ef4444)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                }}
              >
                {error}
              </div>
            )}

            {/* Field: Name */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Tên Template *
              </label>
              <input
                type="text"
                placeholder="VD: Phong cách chuẩn E-E-A-T, Phong cách hài hước..."
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ width: "100%", fontSize: 13 }}
              />
            </div>

            {/* Field: Step Type */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Bước áp dụng (Loại Prompt) *
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: 8,
                }}
              >
                {PROMPT_TYPES.filter((t) => t.id !== "all").map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`btn ${form.type === t.id ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setForm({ ...form, type: t.id })}
                    style={{
                      fontSize: 12,
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      textAlign: "center",
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{t.icon}</span>
                    <span style={{ fontWeight: 600 }}>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Variable helper chips */}
            {currentTypeConfig?.variables?.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(59, 130, 246, 0.08)",
                  border: "1px solid rgba(59, 130, 246, 0.2)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--accent-blue, #60a5fa)",
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                >
                  💡 Biến số hỗ trợ (Bấm để chèn vào nội dung prompt):
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {currentTypeConfig.variables.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVariable(v)}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: "rgba(59, 130, 246, 0.18)",
                        color: "#93c5fd",
                        border: "1px solid rgba(59, 130, 246, 0.3)",
                        fontSize: 11,
                        fontFamily: "monospace",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                    >
                      + {v}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Field: Content */}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <label style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
                  Nội dung Prompt *
                </label>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {form.content.length} ký tự
                </span>
              </div>
              <textarea
                rows={9}
                placeholder="Nhập nội dung câu lệnh prompt chi tiết tại đây..."
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                style={{
                  width: "100%",
                  fontSize: 13,
                  lineHeight: 1.5,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </div>

            {/* Field: isDefault toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 0",
                borderTop: "1px solid var(--border-color, rgba(255,255,255,0.08))",
                marginBottom: 16,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
                  ⭐ Đặt làm prompt mặc định
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Tự động áp dụng template này cho các bài viết mới khi thực hiện bước {form.type}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, isDefault: !form.isDefault })}
                style={{
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  border: "none",
                  cursor: "pointer",
                  background: form.isDefault
                    ? "var(--accent-green, #10b981)"
                    : "var(--bg-tertiary, rgba(255,255,255,0.15))",
                  position: "relative",
                  transition: "background 0.2s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    left: form.isDefault ? 23 : 3,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "white",
                    transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }}
                />
              </button>
            </div>

            {/* Modal Actions */}
            <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
                disabled={saving}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.content.trim()}
              >
                {saving ? "⏳ Đang lưu..." : editingPrompt ? "💾 Lưu thay đổi" : "➕ Thêm mới"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== System ===== */
function SystemSection() {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
  }, []);

  const updateSettings = async (updates) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await api.updateSettings(newSettings);
  };

  if (!settings)
    return (
      <div className="loading-overlay">
        <span className="loader" />
      </div>
    );

  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 6 }}>Cài đặt hệ thống</h2>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 20,
        }}
      >
        Processing, storage và các cài đặt nâng cao
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          Giao diện
        </h4>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { id: "dark", label: "🌙 Tối" },
            { id: "light", label: "☀️ Sáng" },
            { id: "auto", label: "🖥️ Tự động" },
          ].map((t) => (
            <button
              key={t.id}
              className={`btn ${settings.theme === t.id ? "btn-primary" : "btn-secondary"}`}
              onClick={() => {
                updateSettings({ theme: t.id });
                localStorage.setItem("splseo-theme", t.id);
                document.documentElement.setAttribute(
                  "data-theme",
                  t.id === "auto"
                    ? window.matchMedia("(prefers-color-scheme: dark)").matches
                      ? "dark"
                      : "light"
                    : t.id,
                );
              }}
              style={{ flex: 1 }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          Xử lý
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          <div className="form-group">
            <label>Batch Size</label>
            <input
              type="number"
              value={settings.processing?.batchSize || 5}
              onChange={(e) =>
                updateSettings({
                  processing: {
                    ...settings.processing,
                    batchSize: parseInt(e.target.value),
                  },
                })
              }
            />
          </div>
          <div className="form-group">
            <label>Max Retries</label>
            <input
              type="number"
              value={settings.processing?.maxRetries || 3}
              onChange={(e) =>
                updateSettings({
                  processing: {
                    ...settings.processing,
                    maxRetries: parseInt(e.target.value),
                  },
                })
              }
            />
          </div>
          <div className="form-group">
            <label>Stuck Timeout (phút)</label>
            <input
              type="number"
              value={settings.processing?.stuckTimeout || 30}
              onChange={(e) =>
                updateSettings({
                  processing: {
                    ...settings.processing,
                    stuckTimeout: parseInt(e.target.value),
                  },
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
