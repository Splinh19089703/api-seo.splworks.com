import { useState, useEffect } from "react";
import { TaskQueueWidget, useTaskQueue } from "../../../context/TaskQueueContext";
import { api } from "../../../api";

export default function OverviewTab({ project, checklist, onTabChange }) {
  const { tasks } = useTaskQueue();
  const [auditCount, setAuditCount] = useState(0);
  const [recentArticles, setRecentArticles] = useState([]);

  // Load audit count for this project's domain
  useEffect(() => {
    if (project?.id) {
      api.get(`/audit/by-project/${project.id}`)
        .then(data => setAuditCount(data?.audits?.length || 0))
        .catch(() => setAuditCount(0));

      // Load recent articles
      api.getDrafts(project.id)
        .then(data => setRecentArticles((data?.drafts || data || []).slice(0, 6)))
        .catch(() => setRecentArticles([]));
    }
  }, [project?.id]);

  // Count pending tasks for this project
  const allTasks = Object.values(tasks);
  const projectTasks = allTasks.filter(t => t.projectId === project?.id);
  const pendingJobs = projectTasks.filter(t => t.status === "pending" || t.status === "running").length;
  const waitingPush = projectTasks.filter(t => t.status === "done" && !t.pushed).length;

  const stats = [
    { label: "Bài viết", value: project.articles || 0, icon: "📝", accent: "#8b5cf6", bg: "rgba(139,92,246,0.1)", tabId: "articles" },
    { label: "Đã đăng", value: project.published || 0, icon: "✅", accent: "#10b981", bg: "rgba(16,185,129,0.1)", tabId: "articles" },
    { label: "Chờ duyệt", value: waitingPush, icon: "⏳", accent: "#f59e0b", bg: "rgba(245,158,11,0.1)", tabId: "audit" },
    { label: "Videos", value: project.videos || 0, icon: "▶️", accent: "#3b82f6", bg: "rgba(59,130,246,0.1)", tabId: "youtube" },
    { label: "KW Plans", value: project.kwPlans || 0, icon: "📋", accent: "#6366f1", bg: "rgba(99,102,241,0.1)", tabId: "kwplan" },
    { label: "SEO Audits", value: auditCount, icon: "🔍", accent: "#06b6d4", bg: "rgba(6,182,212,0.1)", tabId: "audit" },
    { label: "Jobs chờ", value: pendingJobs, icon: "⏰", accent: "#6b7280", bg: "rgba(107,114,128,0.1)", tabId: "audit" },
  ];

  const checklistPct = checklist ? Math.round((checklist.completed / checklist.total) * 100) : 0;

  return (
    <div style={{ marginTop: 20 }}>
      {/* F4: Project-scoped Task Queue Widget */}
      <TaskQueueWidget projectId={project?.id} />

      <div className="section-label">THỐNG KÊ DỰ ÁN</div>
      <div className="overview-stats-grid">
        {stats.map((s) => (
          <div
            key={s.label}
            className="overview-stat-card"
            style={{ "--card-accent": s.accent }}
            onClick={() => onTabChange?.(s.tabId)}
          >
            <div className="stat-accent-strip" />
            <div className="stat-icon-wrapper" style={{ background: s.bg }}>
              <span>{s.icon}</span>
            </div>
            <div className="stat-value" style={{ color: s.accent }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-action">Xem chi tiết →</div>
          </div>
        ))}
      </div>

      {/* 2-col layout: main content LEFT + checklist sidebar RIGHT */}
      <div className="overview-2col">

        {/* LEFT: Recent Articles */}
        <div className="overview-main">
          {recentArticles.length > 0 && (
            <div className="card overview-recent-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                  📰 Bài viết gần đây
                </h3>
                <button className="btn btn-secondary btn-sm" onClick={() => onTabChange?.("articles")}>
                  Xem tất cả →
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentArticles.map((a, i) => (
                  <div key={a.id || i} className="overview-article-row">
                    <span className="overview-article-dot" style={{
                      background: a.status === "published" ? "#10b981"
                        : a.status === "draft" ? "#6366f1"
                        : "#f59e0b"
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.title || a.keyword || "Bài chưa có tiêu đề"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {a.status === "published" ? "✅ Đã đăng" : a.status === "draft" ? "📝 Nháp" : "⏳ Chờ"}
                        {a.createdAt && ` · ${new Date(a.createdAt).toLocaleDateString("vi-VN")}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentArticles.length === 0 && (
            <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📝</div>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
                Chưa có bài viết nào. Bắt đầu từ Pipeline hoặc tab Bài viết.
              </p>
              <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => onTabChange?.("articles")}>
                Tạo bài viết đầu tiên →
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: Checklist Sidebar */}
        {checklist && (
          <div className="overview-sidebar">
            <div className="card overview-checklist-card">
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    ✅ Cấu hình sẵn sàng
                  </h3>
                  <span className={`badge ${checklistPct === 100 ? "badge-success" : "badge-info"}`} style={{ fontSize: 10 }}>
                    {checklist.completed}/{checklist.total}
                  </span>
                </div>
                {/* Progress bar */}
                <div style={{ height: 4, borderRadius: 2, background: "var(--bg-muted)", overflow: "hidden" }}>
                  <div style={{
                    width: `${checklistPct}%`,
                    height: "100%",
                    borderRadius: 2,
                    background: checklistPct === 100 ? "#10b981" : "var(--accent-primary, #6366f1)",
                    transition: "width .4s ease"
                  }} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {checklist.items.map((item) => (
                  <div key={item.key} className="checklist-item checklist-item--compact">
                    <span className={`checklist-icon ${item.ok ? "ok" : item.warning ? "warn" : "fail"}`} style={{ width: 18, height: 18, fontSize: 10, flexShrink: 0 }}>
                      {item.ok ? "✓" : item.warning ? "!" : "✕"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
                      {item.description && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>
                      )}
                    </div>
                    {!item.ok && (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: 10, padding: "2px 7px", flexShrink: 0 }}
                        onClick={() => onTabChange?.("prompts")}
                      >
                        Fix
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {checklistPct === 100 && (
                <div style={{ marginTop: 12, padding: "8px 10px", background: "rgba(16,185,129,0.08)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.2)", fontSize: 12, color: "#10b981", textAlign: "center" }}>
                  🚀 Sẵn sàng tạo bài viết!
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
