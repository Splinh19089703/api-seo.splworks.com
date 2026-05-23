import { useState, useEffect } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import ProjectConfig from "../components/ProjectConfig";
import OverviewTab from "../features/projects/components/OverviewTab";
import YouTubeTab from "../features/projects/components/YouTubeTab";
import KeywordClusteringTab from "../features/projects/components/KeywordClusteringTab";
import KwPlanTab from "../features/projects/components/KwPlanTab";
import ArticlesTab from "../features/projects/components/ArticlesTab";
import InternalLinksTab from "../features/projects/components/InternalLinksTab";
import KnowledgeBaseTab from "../features/projects/components/KnowledgeBaseTab";
import ProjectPromptsTab from "../features/projects/components/ProjectPromptsTab";
import ProjectAuditTab from "../features/projects/components/ProjectAuditTab";

const TABS = [
  { id: "overview",    label: "Tổng quan" },
  { id: "audit",       label: "🔍 SEO Audit" },
  { id: "clustering",  label: "🪄 AI Clustering" },
  { id: "kwplan",      label: "Keyword Plan",      countKey: "kwPlans" },
  { id: "articles",    label: "Bài viết",          countKey: "articles" },
  { id: "intlinks",    label: "Liên kết nội bộ",   countKey: "intlinks" },
  { id: "kb",          label: "Knowledge Base" },
  { id: "youtube",     label: "YouTube",            countKey: "videos" },
  { id: "prompts",     label: "⚙️ Prompts" },
];

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [showConfig, setShowConfig] = useState(false);
  const [checklist, setChecklist] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadProject = () => {
    Promise.all([api.getProject(id), api.getChecklist(id)])
      .then(([p, c]) => {
        setProject(p);
        setChecklist(c);
      })
      .catch((e) => {
        console.error(e);
        navigate("/projects");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProject();
  }, [id]);

  useEffect(() => {
    const nextTab = searchParams.get("tab");
    if (nextTab && TABS.some((item) => item.id === nextTab)) {
      setTab(nextTab);
    }
  }, [searchParams]);

  if (loading)
    return (
      <div className="loading-overlay">
        <span className="loader" /> Đang tải...
      </div>
    );
  if (!project) return null;

  const counts = {
    videos: project.videos || 0,
    kwPlans: project.kwPlans || 0,
    articles: project.articles || 0,
    intlinks: 0,
  };

  return (
    <div>
      <div className="project-header">
        <Link to="/projects" className="back-link">←</Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>{project.name}</h1>
          {project.domain && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              🌐 {project.domain}
            </div>
          )}
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowConfig(true)}
        >
          ⚙️ Cấu hình
        </button>
        {confirmDelete ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>Chắc chắn xóa?</span>
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                await api.deleteProject(id);
                navigate("/projects");
              }}
            >
              Xóa
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>
              Hủy
            </button>
          </div>
        ) : (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setConfirmDelete(true)}
          >
            🗑️
          </button>
        )}
      </div>

      <div className="project-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`project-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.countKey && counts[t.countKey] !== undefined && (
              <span className="tab-count">{counts[t.countKey]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab project={project} checklist={checklist} onTabChange={setTab} />
      )}
      {tab === "youtube" && (
        <YouTubeTab projectId={id} onUpdate={loadProject} />
      )}
      {tab === "clustering" && <KeywordClusteringTab projectId={id} />}
      {tab === "kwplan" && <KwPlanTab projectId={id} onUpdate={loadProject} />}
      {tab === "articles" && (
        <ArticlesTab projectId={id} onUpdate={loadProject} />
      )}
      {tab === "intlinks" && <InternalLinksTab projectId={id} />}
      {tab === "kb"       && <KnowledgeBaseTab projectId={id} />}
      {tab === "audit"    && <ProjectAuditTab projectId={id} project={project} />}
      {tab === "prompts"  && <ProjectPromptsTab projectId={id} project={project} />}

      {showConfig && (
        <ProjectConfig
          project={project}
          onClose={() => setShowConfig(false)}
          onSaved={() => {
            setShowConfig(false);
            loadProject();
          }}
        />
      )}
    </div>
  );
}
