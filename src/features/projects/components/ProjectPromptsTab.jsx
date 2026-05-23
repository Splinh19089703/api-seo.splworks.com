import { useState, useEffect } from "react";
import { api } from "../../../api";

const STEPS = [
  {
    id: "outline",
    label: "📋 Outline",
    description: "Prompt tạo cấu trúc bài viết (title, meta, H2/H3, FAQ)",
    placeholder: `Bạn là chuyên gia SEO về [niche của dự án]. Tạo OUTLINE chi tiết cho bài viết về "{keyword}".

📋 YÊU CẦU:
1. Title Tag (tối đa 60 ký tự, chứa keyword chính)
2. Meta Description (tối đa 160 ký tự)
3. Cấu trúc H2 → H3 chi tiết (tối thiểu 8 H2)
4. FAQ 5-7 câu hỏi phổ biến

📊 FORMAT OUTPUT (JSON):
{ "title": "...", "metaDescription": "...", "focusKeyword": "{keyword}",
  "outline": [ { "tag": "h2", "text": "...", "hint": "..." } ],
  "faq": [ { "question": "...", "answer": "..." } ] }`,
    variables: ["{keyword}", "{research_summary}"],
  },
  {
    id: "content",
    label: "✍️ Content",
    description: "Prompt viết nội dung bài hoàn chỉnh theo outline",
    placeholder: `Bạn là chuyên gia viết blog [niche] tiếng Việt, giọng văn [tone: thân thiện/chuyên nghiệp/...].

📌 KEYWORD: {keyword}
📏 ĐỘ DÀI: 2000+ từ
📋 OUTLINE: {outline}

✅ YÊU CẦU:
- Viết đầy đủ theo outline, mỗi H2 ít nhất 200 từ
- Keyword chính trong 100 từ đầu
- Tone phù hợp với đối tượng [mô tả đối tượng]
- Format Markdown`,
    variables: ["{keyword}", "{outline}", "{research_summary}"],
  },
  {
    id: "thumbnail",
    label: "🖼️ Thumbnail",
    description: "Prompt tạo ảnh thumbnail đại diện bài viết",
    placeholder: `Professional photo for blog post about "{keyword}" in [niche style].
Style: [ví dụ: clean minimal, vibrant lifestyle, corporate professional]
Mood: [ví dụ: warm, energetic, calm]
NO text, NO watermark, NO faces.
High quality, suitable for blog thumbnail 1200x630.`,
    variables: ["{keyword}", "{title}"],
  },
  {
    id: "section_image",
    label: "🎨 Section Images",
    description: "Prompt tạo ảnh minh họa cho từng section H2",
    placeholder: `Professional illustration for blog section: "{section_heading}".
Context: article about "{keyword}".
Style: [niche style], modern, bright lighting.
NO text, NO watermark.`,
    variables: ["{keyword}", "{section_heading}"],
  },
];

export default function ProjectPromptsTab({ projectId, project }) {
  const [prompts, setPrompts] = useState({});
  const [saving, setSaving] = useState({});
  const [saved, setSaved]   = useState({});
  const [globals, setGlobals] = useState([]);

  // Init from project.prompts
  useEffect(() => {
    const init = {};
    STEPS.forEach(s => {
      init[s.id] = {
        enabled: project?.prompts?.[s.id]?.enabled ?? false,
        content: project?.prompts?.[s.id]?.content ?? "",
      };
    });
    setPrompts(init);
    api.getPrompts().then(list => setGlobals(list || [])).catch(() => {});
  }, [project]);

  const update = (stepId, field, value) => {
    setPrompts(prev => ({
      ...prev,
      [stepId]: { ...prev[stepId], [field]: value },
    }));
    setSaved(prev => ({ ...prev, [stepId]: false }));
  };

  const save = async (stepId) => {
    setSaving(prev => ({ ...prev, [stepId]: true }));
    try {
      const currentPrompts = { ...project?.prompts };
      currentPrompts[stepId] = prompts[stepId];
      await api.updateProject(projectId, { prompts: currentPrompts });
      setSaved(prev => ({ ...prev, [stepId]: true }));
      setTimeout(() => setSaved(prev => ({ ...prev, [stepId]: false })), 2000);
    } catch (e) {
      alert("Lưu thất bại: " + e.message);
    } finally {
      setSaving(prev => ({ ...prev, [stepId]: false }));
    }
  };

  const loadGlobal = (stepId) => {
    const globalPrompt = globals.find(g => g.type === stepId && g.isDefault);
    if (globalPrompt) {
      update(stepId, "content", globalPrompt.content);
    } else {
      const step = STEPS.find(s => s.id === stepId);
      update(stepId, "content", step?.placeholder || "");
    }
  };

  return (
    <div style={{ maxWidth: 860, paddingTop: 8 }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>⚙️ Prompt Template cho dự án</h3>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Tùy chỉnh prompt cho từng bước pipeline. Khi bật, hệ thống sẽ dùng prompt này thay vì global default.
          Dùng <code style={{ background: "var(--bg-tertiary)", padding: "1px 5px", borderRadius: 4 }}>{"{keyword}"}</code>,{" "}
          <code style={{ background: "var(--bg-tertiary)", padding: "1px 5px", borderRadius: 4 }}>{"{outline}"}</code>, v.v. làm biến động.
        </p>
      </div>

      {STEPS.map(step => {
        const p = prompts[step.id] || { enabled: false, content: "" };
        const isSaving = saving[step.id];
        const isSaved  = saved[step.id];

        return (
          <div key={step.id} className="card" style={{
            marginBottom: 16,
            border: p.enabled
              ? "1px solid rgba(59,130,246,0.35)"
              : "1px solid var(--border-light)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{step.label}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{step.description}</div>
              </div>

              {/* Toggle */}
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0 }}>
                <div style={{
                  width: 38, height: 22, borderRadius: 11, position: "relative", cursor: "pointer",
                  background: p.enabled ? "var(--accent-primary)" : "var(--bg-tertiary)",
                  border: "1px solid var(--border-light)",
                  transition: "background 0.2s",
                }}>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={e => update(step.id, "enabled", e.target.checked)}
                    style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer", margin: 0 }}
                  />
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    position: "absolute", top: 2,
                    left: p.enabled ? 18 : 2,
                    transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: p.enabled ? "var(--accent-primary)" : "var(--text-muted)" }}>
                  {p.enabled ? "Đang dùng" : "Dùng global"}
                </span>
              </label>
            </div>

            {/* Variables hint */}
            <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {step.variables.map(v => (
                <span key={v} style={{
                  fontSize: 11, padding: "1px 7px", borderRadius: 6,
                  background: "var(--bg-tertiary)", color: "var(--text-muted)",
                  fontFamily: "monospace",
                }}>{v}</span>
              ))}
              <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>← biến động trong prompt</span>
            </div>

            {/* Textarea */}
            <textarea
              value={p.content}
              onChange={e => update(step.id, "content", e.target.value)}
              placeholder={p.enabled ? step.placeholder : `Đang dùng Global Default. Bật toggle để tùy chỉnh.`}
              disabled={!p.enabled}
              rows={8}
              style={{
                width: "100%", resize: "vertical", fontFamily: "monospace",
                fontSize: 12, lineHeight: 1.6, padding: "10px 12px",
                borderRadius: 8, border: "1px solid var(--border-light)",
                background: p.enabled ? "var(--bg-secondary)" : "var(--bg-tertiary)",
                color: p.enabled ? "var(--text-primary)" : "var(--text-muted)",
                boxSizing: "border-box",
                opacity: p.enabled ? 1 : 0.6,
              }}
            />

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => save(step.id)}
                disabled={isSaving}
                style={{ minWidth: 80 }}
              >
                {isSaving ? <><span className="loader" style={{ width: 10, height: 10 }} /> Lưu...</> : "💾 Lưu"}
              </button>

              {p.enabled && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => loadGlobal(step.id)}
                  title="Copy từ global prompt default vào đây"
                >
                  📋 Copy từ Global
                </button>
              )}

              {p.enabled && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { update(step.id, "content", ""); }}
                  style={{ color: "#ef4444" }}
                >
                  🗑️ Xóa
                </button>
              )}

              {isSaved && (
                <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>✓ Đã lưu!</span>
              )}

              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
                {p.content.length > 0 ? `${p.content.length} ký tự` : ""}
              </span>
            </div>
          </div>
        );
      })}

      {/* Info box */}
      <div style={{
        padding: "12px 16px", borderRadius: 10, fontSize: 12,
        background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)",
        color: "var(--text-secondary)", lineHeight: 1.7,
      }}>
        <strong>💡 Hướng dẫn:</strong><br />
        — Bật toggle để kích hoạt prompt riêng cho dự án này<br />
        — Tắt toggle = pipeline dùng Global Default (trong Settings → Prompts)<br />
        — Dùng <code style={{ fontFamily: "monospace" }}>{"{keyword}"}</code> để AI điền keyword tự động<br />
        — "Copy từ Global" giúp bạn lấy template gốc rồi chỉnh thêm nhanh hơn
      </div>
    </div>
  );
}
