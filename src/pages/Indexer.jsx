import { useState, useEffect } from "react";
import { api } from "../api";

const PLATFORM_LABELS = { bing: "🔵 Bing", google: "🔴 Google" };
const STATUS_COLORS = { submitted: "var(--accent-green)", failed: "var(--accent-red)", pending: "#f59e0b" };

export default function Indexer() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [platform, setPlatform] = useState("both");
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState("submit"); // submit | history

  useEffect(() => {
    loadProjects();
    loadHistory();
  }, []);

  async function loadProjects() {
    try {
      const data = await api.getProjects();
      setProjects(data || []);
      if (data?.length) setSelectedProject(data[0].id);
    } catch {}
  }

  async function loadHistory(projectId) {
    setLoadingHistory(true);
    try {
      const params = {};
      if (projectId) params.projectId = projectId;
      const data = await api.getIndexHistory(params);
      setHistory(data || []);
    } catch {}
    finally { setLoadingHistory(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const urls = urlInput.split("\n").map(u => u.trim()).filter(u => u.startsWith("http"));
    if (!urls.length) return alert("Nhập ít nhất 1 URL hợp lệ (bắt đầu bằng http/https)");

    setSubmitting(true);
    setResults(null);
    const combined = [];

    try {
      if (platform === "bing" || platform === "both") {
        const r = await api.submitToBing({ projectId: selectedProject || undefined, urls });
        combined.push({ platform: "bing", ...r });
      }
      if (platform === "google" || platform === "both") {
        const r = await api.submitToGoogle({ projectId: selectedProject || undefined, urls });
        combined.push({ platform: "google", ...r });
      }
      setResults(combined);
      loadHistory(selectedProject || undefined);
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClearHistory() {
    if (!confirm("Xóa toàn bộ lịch sử submit?")) return;
    try {
      await api.clearIndexHistory();
      setHistory([]);
    } catch (e) { alert("Lỗi: " + e.message); }
  }

  const successCount = history.filter(h => h.status === "submitted").length;
  const failCount = history.filter(h => h.status === "failed").length;

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>🚀 URL Indexer</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Submit URL lên Google & Bing để index bài viết nhanh hơn. Cần cấu hình key trong <strong>Project Settings → Indexing</strong>.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Tổng đã submit", value: history.length, icon: "📊" },
          { label: "Thành công", value: successCount, icon: "✅", color: "var(--accent-green)" },
          { label: "Thất bại", value: failCount, icon: "❌", color: "var(--accent-red)" },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: "16px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 24 }}>{s.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {[{ key: "submit", label: "📤 Submit URL" }, { key: "history", label: "📋 Lịch sử" }].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={activeTab === t.key ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Submit Tab */}
      {activeTab === "submit" && (
        <div className="card" style={{ padding: 24 }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Project select */}
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  Project (để dùng key đã cấu hình)
                </label>
                <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", fontSize: 14 }}>
                  <option value="">-- Không chọn (nhập key thủ công) --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name} {p.domain ? `(${p.domain})` : ""}</option>
                  ))}
                </select>
              </div>

              {/* Platform */}
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  Nền tảng
                </label>
                <select value={platform} onChange={e => setPlatform(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", fontSize: 14 }}>
                  <option value="both">🔵🔴 Bing + Google</option>
                  <option value="bing">🔵 Bing IndexNow</option>
                  <option value="google">🔴 Google Indexing API</option>
                </select>
              </div>
            </div>

            {/* URL input */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                Danh sách URL (mỗi dòng 1 URL) *
              </label>
              <textarea
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder={"https://example.com/bai-viet-1\nhttps://example.com/bai-viet-2\nhttps://example.com/bai-viet-3"}
                rows={8}
                style={{ width: "100%", padding: "10px 12px", fontSize: 13, fontFamily: "monospace", resize: "vertical" }}
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {urlInput.split("\n").filter(u => u.trim().startsWith("http")).length} URLs hợp lệ
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}
                style={{ background: "var(--accent-green)" }}>
                {submitting ? "⏳ Đang submit..." : "🚀 Submit Index"}
              </button>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                💡 Bing IndexNow nhanh và đơn giản hơn. Google cần Service Account + GSC Owner.
              </span>
            </div>
          </form>

          {/* Results */}
          {results && (
            <div style={{ marginTop: 20, padding: 16, background: "var(--bg-secondary)", borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>📊 Kết quả submit:</div>
              {results.map((r, i) => (
                <div key={i} style={{ marginBottom: 8, padding: 12, background: "var(--bg-card)", borderRadius: 6, border: `1px solid ${r.success ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{PLATFORM_LABELS[r.platform]}</span>
                    <span style={{ fontWeight: 600, color: r.success ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {r.success ? `✅ ${r.submitted || r.submitted === 0 ? r.submitted + " URLs submitted" : "Thành công"}` : `❌ Thất bại`}
                    </span>
                  </div>
                  {r.error && <div style={{ fontSize: 12, color: "var(--accent-red)", marginTop: 4 }}>{r.error}</div>}
                  {r.results && (
                    <div style={{ marginTop: 8 }}>
                      {r.results.map((item, j) => (
                        <div key={j} style={{ fontSize: 12, color: item.success ? "var(--accent-green)" : "var(--accent-red)" }}>
                          {item.success ? "✅" : "❌"} {item.url} {item.error && `— ${item.error}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === "history" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={selectedProject} onChange={e => { setSelectedProject(e.target.value); loadHistory(e.target.value || undefined); }}
                style={{ padding: "6px 10px", fontSize: 13 }}>
                <option value="">Tất cả project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {history.length > 0 && (
              <button className="btn btn-secondary btn-sm" style={{ color: "var(--accent-red)" }}
                onClick={handleClearHistory}>🗑️ Xóa lịch sử</button>
            )}
          </div>

          {loadingHistory ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>⏳ Đang tải...</div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
              <div style={{ color: "var(--text-muted)" }}>Chưa có lịch sử submit nào</div>
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden", padding: 0 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-secondary)" }}>
                    {["Nền tảng", "URL", "Trạng thái", "Thời gian"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={h.id} style={{ borderTop: "1px solid var(--border-subtle)", background: i % 2 ? "var(--bg-secondary)" : "transparent" }}>
                      <td style={{ padding: "10px 14px", fontSize: 13 }}>{PLATFORM_LABELS[h.platform] || h.platform}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12, maxWidth: 400 }}>
                        <a href={h.url} target="_blank" rel="noopener noreferrer"
                          style={{ color: "var(--accent-blue)", textDecoration: "none", wordBreak: "break-all" }}>{h.url}</a>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLORS[h.status], background: STATUS_COLORS[h.status] + "22", padding: "2px 8px", borderRadius: 20 }}>
                          {h.status === "submitted" ? "✅ Submitted" : h.status === "failed" ? "❌ Failed" : h.status}
                        </span>
                        {h.error && <div style={{ fontSize: 10, color: "var(--accent-red)", marginTop: 2 }}>{h.error}</div>}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {new Date(h.submittedAt).toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
