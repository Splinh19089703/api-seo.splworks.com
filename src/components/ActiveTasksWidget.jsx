import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

const STEP_MAP = {
  research:  { label: "🔍 Nghiên cứu",    pct: 15 },
  outline:   { label: "📋 Tạo dàn ý",     pct: 35 },
  content:   { label: "✍️ Viết bài",      pct: 65 },
  thumbnail: { label: "🖼️ Tạo thumbnail", pct: 80 },
  sections:  { label: "📸 Ảnh section",   pct: 92 },
  review:    { label: "✅ Hoàn thành",    pct: 100 },
  error:     { label: "❌ Lỗi",           pct: 0  },
};

/**
 * Hook: poll /active-tasks every 5 seconds.
 * Returns { tasks, count } — usable outside the widget too (e.g. Layout badge).
 */
export function useActiveTasks() {
  const [tasks, setTasks] = useState([]);

  const fetch = useCallback(() => {
    api
      .get("/content/active-tasks")
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch(() => {}); // fail silently — don't break the UI
  }, []);

  useEffect(() => {
    fetch();
    const timer = setInterval(fetch, 5000);
    return () => clearInterval(timer);
  }, [fetch]);

  return tasks;
}

/**
 * Compact sidebar widget — shows running tasks with progress bars.
 * Collapses when no tasks are running.
 */
export default function ActiveTasksWidget() {
  const tasks = useActiveTasks();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  if (tasks.length === 0) return null;

  return (
    <div className="active-tasks-widget" style={{ marginBottom: 8 }}>
      {/* Header */}
      <button
        className="atw-header"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: "rgba(255,165,0,0.12)",
          border: "1px solid rgba(255,165,0,0.25)",
          borderRadius: collapsed ? 8 : "8px 8px 0 0",
          cursor: "pointer",
          color: "var(--accent-orange, #f97316)",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span style={{ flex: 1, textAlign: "left" }}>⚡ Đang chạy</span>
        <span
          style={{
            background: "var(--accent-orange, #f97316)",
            color: "#fff",
            borderRadius: 10,
            padding: "1px 7px",
            fontSize: 11,
          }}
        >
          {tasks.length}
        </span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>{collapsed ? "▸" : "▾"}</span>
      </button>

      {/* Task list */}
      {!collapsed && (
        <div
          style={{
            border: "1px solid rgba(255,165,0,0.2)",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            overflow: "hidden",
          }}
        >
          {tasks.map((task, i) => {
            const step =
              STEP_MAP[task.autoStep] ||
              STEP_MAP[task.status] ||
              { label: "⏳ Xử lý...", pct: 10 };
            const keyword =
              task.keyword.length > 26
                ? task.keyword.slice(0, 26) + "…"
                : task.keyword;

            return (
              <button
                key={task.id}
                onClick={() => navigate(`/pipeline?draft=${task.id}`)}
                style={{
                  width: "100%",
                  display: "block",
                  padding: "8px 10px",
                  background:
                    i % 2 === 0
                      ? "rgba(255,255,255,0.02)"
                      : "rgba(255,255,255,0.04)",
                  borderBottom:
                    i < tasks.length - 1
                      ? "1px solid rgba(255,255,255,0.06)"
                      : "none",
                  cursor: "pointer",
                  textAlign: "left",
                  border: "none",
                  color: "inherit",
                }}
              >
                {/* Step label */}
                <div style={{ fontSize: 11, color: "var(--accent-orange, #f97316)", marginBottom: 2 }}>
                  {step.label}
                </div>
                {/* Keyword */}
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary, #aaa)",
                    marginBottom: 4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {keyword}
                </div>
                {/* Progress bar */}
                <div
                  style={{
                    height: 3,
                    background: "rgba(255,255,255,0.1)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${step.pct}%`,
                      background: "var(--accent-orange, #f97316)",
                      borderRadius: 2,
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
                {/* Word count if available */}
                {task.wordCount > 0 && (
                  <div style={{ fontSize: 10, color: "var(--text-muted, #666)", marginTop: 3 }}>
                    {task.wordCount.toLocaleString()} từ
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
