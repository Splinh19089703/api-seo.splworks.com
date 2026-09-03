import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function AuditList() {
  const [audits, setAudits] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [domain, setDomain] = useState("");
  const [maxPages, setMaxPages] = useState(200);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  const loadAudits = () => {
    api
      .getAudits()
      .then(setAudits)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAudits();
    // Cleanup polling khi rời trang — tránh interval chạy ngầm 5 phút
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const handleStart = async () => {
    setStarting(true);
    try {
      let d = domain.trim();
      if (!d.startsWith("http")) d = "https://" + d;
      await api.startAudit({ domain: d, maxPages });
      setShowModal(false);
      setDomain("");
      // Poll for updates — track interval để cleanup khi unmount
      setTimeout(loadAudits, 2000);
      pollRef.current = setInterval(() => {
        loadAudits();
      }, 5000);
      setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }, 300000);
    } catch (error) {
      alert("Lỗi: " + error.message);
    }
    setStarting(false);
  };

  const getScoreColor = (score) => {
    if (score >= 80) return "var(--accent-green)";
    if (score >= 50) return "var(--accent-orange)";
    return "var(--accent-red)";
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>
            SEO Audit <span className="badge badge-success">Beta</span>
          </h1>
          <p className="subtitle">
            Phân tích toàn diện SEO cho website của bạn
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ➕ Audit mới
        </button>
      </div>

      <div className="filters">
        <button className="filter-btn active">Tất cả</button>
        <button className="filter-btn">
          Hoàn thành {audits.filter((a) => a.status === "completed").length}
        </button>
      </div>

      {loading ? (
        <div className="loading-overlay">
          <span className="loader" /> Đang tải...
        </div>
      ) : audits.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <p>Chưa có audit nào. Bắt đầu audit website đầu tiên!</p>
          <button
            className="btn btn-primary"
            onClick={() => setShowModal(true)}
          >
            Bắt đầu Audit
          </button>
        </div>
      ) : (
        <div className="card-grid">
          {audits.map((audit) => (
            <div key={audit.id} className="card">
              <Link
                to={`/audit/${audit.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600 }}>
                      {audit.domain}
                    </h3>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {new Date(audit.createdAt).toLocaleString("vi-VN")} · ⏱{" "}
                      {audit.duration || "?"}s
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: getScoreColor(audit.score),
                    }}
                  >
                    {audit.score}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginBottom: 8,
                  }}
                >
                  📄 {audit.totalPages || 0} trang
                  {audit.stats && (
                    <>
                      {" · "}
                      <span style={{ color: "var(--accent-red)" }}>
                        ● {audit.stats.critical || 0}
                      </span>
                      {" · "}
                      <span style={{ color: "var(--accent-orange)" }}>
                        ● {audit.stats.warning || 0}
                      </span>
                      {" · "}
                      <span style={{ color: "var(--accent-blue)" }}>
                        ● {audit.stats.info || 0}
                      </span>
                    </>
                  )}
                </div>
                {audit.status === "running" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: "var(--accent-orange)",
                    }}
                  >
                    <span className="loader" /> Đang crawl...
                  </div>
                )}
              </Link>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--border-light)",
                }}
              >
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1 }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const pages = prompt(
                      "Số trang tối đa:",
                      audit.maxPages || 200,
                    );
                    if (!pages) return;
                    await api.recrawlAudit(audit.id, {
                      maxPages: parseInt(pages) || 200,
                    });
                    loadAudits();
                    const interval = setInterval(loadAudits, 5000);
                    setTimeout(() => clearInterval(interval), 300000);
                  }}
                >
                  🔄 Crawl lại
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm("Xóa audit này?")) return;
                    await api.deleteAudit(audit.id);
                    loadAudits();
                  }}
                >
                  🗑️ Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🔍 Audit mới</h2>
            <div className="form-group">
              <label>Domain / URL *</label>
              <input
                type="text"
                placeholder="VD: example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Số trang tối đa</label>
              <select
                value={maxPages}
                onChange={(e) => setMaxPages(parseInt(e.target.value) || 200)}
                style={{ width: "100%" }}
              >
                <option value={50}>50 trang (~10s)</option>
                <option value={200}>200 trang (~30s)</option>
                <option value={500}>500 trang (~1 phút)</option>
                <option value={1000}>1,000 trang (~2 phút)</option>
                <option value={2000}>2,000 trang (~5 phút)</option>
                <option value={5000}>5,000 trang (~10 phút)</option>
                <option value={10000}>10,000 trang (~20 phút)</option>
                <option value={20000}>20,000 trang (~40 phút)</option>
                <option value={50000}>50,000 trang (~1.5 giờ)</option>
              </select>
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
                onClick={handleStart}
                disabled={!domain || starting}
              >
                {starting ? (
                  <>
                    <span className="loader" /> Đang bắt đầu...
                  </>
                ) : (
                  "Bắt đầu Audit"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
