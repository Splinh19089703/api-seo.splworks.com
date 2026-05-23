import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function AddToProjectModal({
  open,
  projects,
  keywords,
  seedKeyword,
  onClose,
}) {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState("kwplan");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  );

  if (!open) return null;

  const handleSubmit = async () => {
    if (!projectId || keywords.length === 0) return;
    setSubmitting(true);
    setError("");

    try {
      if (mode === "kwplan") {
        const result = await api.importProjectKeywords(projectId, {
          keywords,
          source: "keyword-planner",
          seedKeyword,
          mode: "kwplan",
        });
        const planId = result.plan?.id;
        onClose();
        navigate(`/projects/${projectId}?tab=kwplan${planId ? `&plan=${planId}` : ""}`);
        return;
      }

      await api.importProjectKeywords(projectId, {
        keywords,
        source: "keyword-planner",
        seedKeyword,
        mode: "raw",
      });
      const clustering = await api.startClustering(projectId, { keywords });
      onClose();
      navigate(`/projects/${projectId}?tab=clustering&clustering=${clustering.id}`);
    } catch (err) {
      setError(err.message || "Không thể thêm từ khóa vào dự án.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Thêm vào Dự án</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
            Đã chọn <strong>{keywords.length}</strong> từ khóa.
          </p>

          <div className="form-group">
            <label>Dự án *</label>
            <select
              className="select-field"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Chọn dự án</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Chế độ *</label>
            <div style={{ display: "grid", gap: 8 }}>
              <button
                type="button"
                className={`btn ${mode === "kwplan" ? "btn-primary" : ""}`}
                onClick={() => setMode("kwplan")}
                style={{ justifyContent: "flex-start", textAlign: "left" }}
              >
                Lưu thành Keyword Plan
              </button>
              <button
                type="button"
                className={`btn ${mode === "clustering" ? "btn-primary" : ""}`}
                onClick={() => setMode("clustering")}
                style={{ justifyContent: "flex-start", textAlign: "left" }}
              >
                Chạy AI Clustering ngay
              </button>
            </div>
          </div>

          {selectedProject && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Đích: {selectedProject.name}
            </div>
          )}

          {error && (
            <div style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Hủy
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!projectId || submitting}
          >
            {submitting ? "Đang thêm..." : "Thêm vào dự án"}
          </button>
        </div>
      </div>
    </div>
  );
}
