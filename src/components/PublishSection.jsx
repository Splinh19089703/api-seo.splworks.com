import { useState, useEffect } from "react";
import { api } from "../api";

// C5: Extracted from Pipeline.jsx — Legacy multi-platform publish section
const PM = {
  wordpress: { icon: "🔵", name: "WordPress" }, blogger: { icon: "📙", name: "Blogger" },
  medium: { icon: "✍️", name: "Medium" }, telegram: { icon: "✈️", name: "Telegram" },
  facebook: { icon: "📘", name: "Facebook" }, zalo: { icon: "💬", name: "Zalo OA" },
};

export default function PublishSection({ draftId }) {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [pubStatus, setPubStatus] = useState("draft");
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState(null);
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [accts, hist] = await Promise.all([
          api.getPublishAccounts(),
          api.getArticlePublishHistory(draftId),
        ]);
        setAccounts(accts.filter(a => a.active !== false));
        setHistory(hist);
      } catch {}
      setLoaded(true);
    })();
  }, [draftId]);

  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handlePublish = async () => {
    if (selected.length === 0) return;
    setPublishing(true);
    setResults(null);
    try {
      const res = await api.publishNow({
        articleId: draftId,
        articleType: "standalone",
        accounts: selected,
        options: { status: pubStatus },
      });
      setResults(res);
      const hist = await api.getArticlePublishHistory(draftId);
      setHistory(hist);
    } catch (e) {
      setResults({ success: false, message: e.message, results: [] });
    } finally {
      setPublishing(false);
    }
  };

  if (!loaded || accounts.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>📤 Đăng đa nền tảng khác</h4>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {accounts.map(a => {
          const pm = PM[a.platform] || { icon: "🌐", name: a.platform };
          const checked = selected.includes(a.id);
          return (
            <label key={a.id} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12,
              border: checked ? "2px solid var(--accent-primary)" : "1px solid var(--border-light)",
              background: checked ? "var(--accent-primary-muted)" : "transparent",
            }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(a.id)} style={{ width: 14, height: 14 }} />
              <span>{pm.icon}</span>
              <span style={{ fontWeight: 500 }}>{a.name}</span>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={pubStatus} onChange={e => setPubStatus(e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }}>
          <option value="draft">Bản nháp</option>
          <option value="publish">Xuất bản ngay</option>
        </select>
        <button className="btn btn-primary" style={{ flex: 1 }}
          disabled={selected.length === 0 || publishing} onClick={handlePublish}>
          {publishing ? "⏳ Đang đăng..." : `📤 Đăng lên ${selected.length} nền tảng`}
        </button>
      </div>
      {results && (
        <div style={{ marginTop: 12 }}>
          {results.results?.map((r, i) => (
            <div key={i} style={{ fontSize: 12, padding: "3px 0" }}>
              {r.success ? "✅" : "❌"} <strong>{r.accountName}</strong>
              {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, fontSize: 11 }}>🔗 Xem</a>}
              {r.error && <span style={{ marginLeft: 8, color: "var(--accent-red)", fontSize: 11 }}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
