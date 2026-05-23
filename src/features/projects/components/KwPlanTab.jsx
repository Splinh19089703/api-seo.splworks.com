import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../api";
import KwPlanDetail from "./KwPlanDetail";

export default function KwPlanTab({ projectId, onUpdate }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    keywords: "",
    scheduleMode: "immediate",
  });

  useEffect(() => {
    api
      .getKwPlans(projectId)
      .then(setPlans)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    const planId = searchParams.get("plan");
    if (planId) setShowDetail(planId);
  }, [searchParams]);

  const handleCreate = async () => {
    const plan = await api.createKwPlan(projectId, form);
    setShowCreate(false);
    setForm({ name: "", description: "", keywords: "", scheduleMode: "immediate" });
    setPlans(await api.getKwPlans(projectId));
    onUpdate();
    setShowDetail(plan.id);
  };

  if (showDetail) {
    return (
      <KwPlanDetail
        projectId={projectId}
        planId={showDetail}
        onBack={() => {
          setShowDetail(null);
          setSearchParams({});
          api.getKwPlans(projectId).then(setPlans);
          onUpdate();
        }}
      />
    );
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>Keyword Plans</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate(true)}
        >
          + Tạo Plan
        </button>
      </div>

      {loading ? (
        <div className="loading-overlay">
          <span className="loader" />
        </div>
      ) : plans.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: 48 }}>
            📋
          </div>
          <h3>Chưa có KW Plan nào</h3>
          <p>Tạo KW Plan để tổ chức keywords theo cấu trúc pillar-cluster.</p>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
          >
            Tạo Plan đầu tiên
          </button>
        </div>
      ) : (
        <div>
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="plan-row"
              onClick={() => setShowDetail(plan.id)}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{plan.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {plan.description || `${plan.totalKeywords} keywords`}
                {plan.source === "keyword-planner" && (
                  <span style={{ marginLeft: 8, color: "#10b981" }}>• Nguồn: Keyword Planner</span>
                )}
              </div>
            </div>
              <span
                className={`badge ${plan.status === "analyzed" ? "badge-success" : "badge-info"}`}
              >
                {plan.status === "analyzed" ? "Chờ duyệt" : plan.status}
              </span>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {plan.totalKeywords} KWs · {plan.articlesPublished || 0} đã đăng
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <h2>Tạo Keyword Plan</h2>
            <div className="form-group">
              <label>Tên Plan *</label>
              <input
                placeholder="VD: SEO cơ bản"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Mô tả</label>
              <textarea
                rows={2}
                placeholder="Mô tả ngắn về plan..."
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Keywords (mỗi dòng 1 keyword) *</label>
              <textarea
                rows={5}
                placeholder={"xe điện\nxe đạp điện AI\nBluerabike"}
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Kiểu đăng bài</label>
              <select
                value={form.scheduleMode}
                onChange={(e) =>
                  setForm({ ...form, scheduleMode: e.target.value })
                }
              >
                <option value="immediate">Đăng ngay</option>
                <option value="delay">Delay giữa các bài</option>
              </select>
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
                disabled={!form.name || !form.keywords.trim()}
              >
                Tạo Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
