import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import useUpgradePrompt from "../hooks/useUpgradePrompt";

export default function Projects() {
  const navigate = useNavigate();
  const { withUpgradePrompt, UpgradePromptUI } = useUpgradePrompt();
  const [projects, setProjects] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", domain: "" });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // id đang chờ confirm xóa
  const [deleteStats, setDeleteStats] = useState(null); // thống kê data con
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target))
        setMenuOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadProjects = () => {
    api
      .getProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleCreate = async () => {
    try {
      const p = await api.createProject(form);
      setShowModal(false);
      setForm({ name: "", description: "", domain: "" });
      loadProjects();
      navigate(`/projects/${p.id}`);
    } catch (e) {
      if (!withUpgradePrompt(e)) alert("Lỗi tạo dự án: " + e.message);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(true);
    try {
      await api.deleteProject(id);
      setMenuOpen(null);
      setConfirmDelete(null);
      setDeleteStats(null);
      loadProjects();
    } catch (e) {
      alert("Lỗi xóa: " + e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmDelete = async (id) => {
    setConfirmDelete(id);
    try {
      const res = await api.getProjectStats(id);
      setDeleteStats(res.stats || {});
    } catch {
      setDeleteStats({});
    }
  };

  const handleClone = async (id) => {
    await api.cloneProject(id);
    setMenuOpen(null);
    loadProjects();
  };

  const filtered = projects.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.domain || "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dự án</h1>
          <p className="subtitle">Quản lý các dự án WordPress của bạn</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ➕ Tạo dự án mới
        </button>
      </div>

      {/* Search */}
      {projects.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="🔍 Tìm kiếm dự án..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 400 }}
          />
        </div>
      )}

      {loading ? (
        <div className="loading-overlay">
          <span className="loader" /> Đang tải...
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <p>{search ? "Không tìm thấy dự án nào" : "Chưa có dự án nào"}</p>
          {!search && (
            <button
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
            >
              Tạo dự án đầu tiên
            </button>
          )}
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((project) => (
            <div
              key={project.id}
              className="card project-card"
              onClick={() => navigate(`/projects/${project.id}`)}
              style={{ cursor: "pointer" }}
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
                  <h3 style={{ fontSize: 16, fontWeight: 600 }}>
                    {project.name}
                  </h3>
                  {project.domain && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      🌐 {project.domain}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className={`badge ${project.config?.active !== false ? "badge-success" : "badge-secondary"}`}
                  >
                    {project.config?.active !== false
                      ? "Đang hoạt động"
                      : "Tạm dừng"}
                  </span>
                  <div
                    style={{ position: "relative" }}
                    ref={menuOpen === project.id ? menuRef : null}
                  >
                    <button
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(
                          menuOpen === project.id ? null : project.id,
                        );
                      }}
                    >
                      ⋮
                    </button>
                    {menuOpen === project.id && (
                      <div className="dropdown-menu">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/projects/${project.id}`);
                          }}
                        >
                          ✏️ Chỉnh sửa
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClone(project.id);
                          }}
                        >
                          📋 Nhân bản
                        </button>
                        <hr />
                        {confirmDelete === project.id ? (
                          <div style={{ padding: "6px 12px" }}>
                            <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 4, fontWeight: 600 }}>
                              ⚠️ Xóa dự án và toàn bộ dữ liệu?
                            </div>
                            {deleteStats && Object.values(deleteStats).some(v => v > 0) && (
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, lineHeight: 1.5 }}>
                                Sẽ xóa kèm:{" "}
                                {[
                                  deleteStats.articles > 0 && `${deleteStats.articles} bài viết`,
                                  deleteStats.videos > 0 && `${deleteStats.videos} video`,
                                  deleteStats.kwplans > 0 && `${deleteStats.kwplans} KW plan`,
                                  deleteStats["clustering-results"] > 0 && `${deleteStats["clustering-results"]} clustering`,
                                  deleteStats.knowledgebases > 0 && `${deleteStats.knowledgebases} KB`,
                                  deleteStats["internal-links"] > 0 && `${deleteStats["internal-links"]} liên kết`,
                                ].filter(Boolean).join(" · ")}
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                className="danger"
                                style={{ flex: 1, fontSize: 12 }}
                                disabled={deleting}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(project.id);
                                }}
                              >
                                {deleting ? "⏳..." : "🗑️ Xóa tất cả"}
                              </button>
                              <button
                                style={{ flex: 1, fontSize: 12 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDelete(null);
                                  setDeleteStats(null);
                                }}
                              >
                                Hủy
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConfirmDelete(project.id);
                            }}
                          >
                            🗑️ Xóa
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  marginBottom: 16,
                }}
              >
                {project.description || "Chưa có mô tả"}
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  textAlign: "center",
                  gap: 8,
                }}
              >
                {[
                  { label: "Videos", value: project.videos || 0 },
                  { label: "Bài viết", value: project.articles || 0 },
                  {
                    label: "Chờ duyệt",
                    value: project.pending || 0,
                    color: "orange",
                  },
                  {
                    label: "Đã đăng",
                    value: project.published || 0,
                    color: "green",
                  },
                ].map((s) => (
                  <div key={s.label}>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: s.color ? `var(--accent-${s.color})` : "inherit",
                      }}
                    >
                      {s.value}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>➕ Tạo dự án mới</h2>
            <div className="form-group">
              <label>Tên dự án *</label>
              <input
                type="text"
                placeholder="VD: Blog WordPress Tips"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Domain</label>
              <input
                type="text"
                placeholder="VD: https://example.com"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Mô tả</label>
              <textarea
                placeholder="Mô tả dự án..."
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
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
                disabled={!form.name}
              >
                Tạo
              </button>
            </div>
          </div>
        </div>
      )}

      {UpgradePromptUI}
    </div>
  );
}
