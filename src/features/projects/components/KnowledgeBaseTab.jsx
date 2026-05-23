import { useState, useEffect } from "react";
import { api } from "../../../api";

export default function KnowledgeBaseTab({ projectId }) {
  const [kbs, setKbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  useEffect(() => {
    api
      .getKnowledgeBases(projectId)
      .then(setKbs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleCreate = async () => {
    await api.createKnowledgeBase(projectId, form);
    setShowCreate(false);
    setForm({ name: "", description: "" });
    setKbs(await api.getKnowledgeBases(projectId));
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>📚 Knowledge Base</h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              margin: "4px 0 0",
            }}
          >
            Quản lý tài liệu tham khảo để tạo bài viết chính xác với RAG
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate(true)}
        >
          + Tạo KB
        </button>
      </div>

      {loading ? (
        <div className="loading-overlay">
          <span className="loader" />
        </div>
      ) : kbs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: 48 }}>
            📚
          </div>
          <h3>Chưa có Knowledge Base nào</h3>
          <p>Tạo KB để AI tham chiếu khi viết bài.</p>
        </div>
      ) : (
        <div>
          {kbs.map((kb) => (
            <div
              key={kb.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid var(--border-light)",
              }}
            >
              <span style={{ fontSize: 20 }}>📚</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{kb.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {kb.description || "Không có mô tả"} · {kb.documentCount || 0}{" "}
                  tài liệu
                </div>
              </div>
              <button
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  await api.deleteKnowledgeBase(projectId, kb.id);
                  setKbs(await api.getKnowledgeBases(projectId));
                }}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 420 }}
          >
            <h2>Tạo Knowledge Base</h2>
            <div className="form-group">
              <label>Tên *</label>
              <input
                placeholder="VD: Kiến thức sản phẩm, Dữ liệu ngành..."
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Mô tả</label>
              <textarea
                rows={3}
                placeholder="Mô tả ngắn về KB này (tuỳ chọn)"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreate(false)}
              >
                Hủy
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!form.name}
              >
                Tạo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
