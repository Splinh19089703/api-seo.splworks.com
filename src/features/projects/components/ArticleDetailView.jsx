import { useState, useEffect } from "react";
import { api } from "../../../api";
import { parseHtmlSections } from "../../../utils/parseHtmlSections";
import SafeHtml from "../../../components/SafeHtml";

export default function ArticleDetailView({ article, onBack, projectId }) {
  // For imported articles, default to content tab since research/outline are skipped
  const [activeStep, setActiveStep] = useState(article.source === "wp-import" ? "content" : "research");
  const [contentViewMode, setContentViewMode] = useState("preview");
  const [contentGenMode, setContentGenMode] = useState("basic"); // "basic" or "quality"
  const [processingStep, setProcessingStep] = useState(null);
  const [processingError, setProcessingError] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [reviewNotes, setReviewNotes] = useState("");
  const [showFullContent, setShowFullContent] = useState(false);
  // Section rewrite
  const [sectionEdits, setSectionEdits] = useState({});
  const [rewritingSection, setRewritingSection] = useState(null);
  const [sectionRewriteNotes, setSectionRewriteNotes] = useState({});
  // Word count target
  const [targetWordCount, setTargetWordCount] = useState(article.estimatedWords || 2000);
  const [showWarnings, setShowWarnings] = useState(false);

  useEffect(() => {
    if (!processingStep) { setElapsedTime(0); return; }
    const interval = setInterval(() => setElapsedTime((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [processingStep]);

  const runPipelineStep = async (stepKey, apiCall) => {
    setProcessingStep(stepKey); setProcessingError(null);
    try { await apiCall(); setProcessingStep(null); onBack(); }
    catch (e) { setProcessingStep(null); setProcessingError({ step: stepKey, message: e.message }); }
  };

  const ProcessingUI = ({ title, subtitle, showProgress }) => (
    <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
      <div style={{ marginBottom: 20 }}><span className="loader" style={{ display: "inline-block", width: 40, height: 40 }} /></div>
      <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>{title}</h3>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{subtitle}</p>
      {showProgress && (
        <div style={{ maxWidth: 400, margin: "0 auto" }}>
          <div style={{ height: 6, borderRadius: 3, background: "var(--bg-tertiary)", overflow: "hidden", marginBottom: 12 }}>
            <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, var(--accent-blue), var(--accent-green))", animation: "processingBar 2s ease-in-out infinite", width: "60%" }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>⏱ Đã chờ: {elapsedTime}s</div>
        </div>
      )}
    </div>
  );

  const ErrorAlert = ({ stepKey }) => {
    if (!processingError || processingError.step !== stepKey) return null;
    return (
      <div style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid var(--accent-red)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16 }}>❌</span>
          <strong style={{ fontSize: 13, color: "var(--accent-red)" }}>Lỗi xử lý</strong>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>{processingError.message}</p>
      </div>
    );
  };

  const STEPS = [
    { key: "research", label: "Nghiên cứu" }, { key: "outline", label: "Dàn ý" },
    { key: "content", label: "Nội dung" }, { key: "thumbnail", label: "Thumbnail" },
    { key: "sections", label: "Ảnh sections" }, { key: "publish", label: "Duyệt & Đăng" },
  ];

  const stepStatus = (key) => processingStep === key ? "processing" : article.pipeline?.[key]?.status || "pending";
  const stepIcon = (s) => s === "done" || s === "published" ? "✅" : s === "imported" ? "📥" : s === "skipped" ? "⏭️" : s === "error" || s === "failed" ? "🔴" : s === "processing" || s === "generating" ? "🔄" : "⚪";
  const hasError = Object.values(article.pipeline || {}).some((s) => s.status === "error" || s.status === "failed");

  const kw = article.keyword;
  const researchData = article.pipeline?.research?.data || {};
  const outlineData = article.pipeline?.outline?.data || {};
  const seoTitle = outlineData.title || researchData.suggestedTitle || article.title || `${kw}`;
  const metaDesc = outlineData.metaDescription || researchData.suggestedMetaDescription || "";
  const relatedKws = researchData.relatedKeywords || article.relatedKeywords || [];
  const questions = researchData.questionsToAnswer || researchData.peopleAlsoAsk || [];
  const targetAudience = typeof researchData.targetAudience === "string" ? researchData.targetAudience : researchData.targetAudienceText || "";
  const outlineSections = (outlineData.sections || []).map((s) => ({
    title: s.heading, desc: (s.keyPoints || []).join(". "), words: s.wordCount || 300,
    subsections: s.subsections || [], lsiTargets: s.lsiTargets || [], actionableTip: s.actionableTip || "",
  }));

  // Enriched research data
  const competitorAnalysis = researchData.competitorAnalysis || {};
  const contentStrategy = researchData.contentStrategy || {};
  const targetAudienceObj = researchData.targetAudienceObj || {};
  const lsiKeywords = researchData.lsiKeywords || [];
  const longTailKeywords = researchData.longTailKeywords || [];
  const peopleAlsoAsk = researchData.peopleAlsoAsk || [];
  const hasResearchPayload = researchData && Object.keys(researchData).length > 0;
  const rawResearchText = typeof researchData.rawResponse === "string" ? researchData.rawResponse : "";

  const InfoBadge = ({ icon, label, value, color }) => (
    <div style={{ padding: "10px 14px", background: "var(--bg-tertiary)", borderRadius: 8, flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );

  const KwPlanInfo = () => {
    const contentDataObj = article.pipeline?.content?.data || {};
    const actualWords = contentDataObj.wordCount || article.originalWordCount || 0;
    const targetWords = targetWordCount || article.estimatedWords || 2000;
    const wordProgress = Math.min(100, Math.round((actualWords / targetWords) * 100));
    const wordDiff = actualWords - targetWords;
    const wordStatus = wordProgress >= 90 && wordProgress <= 120
      ? "ok" : wordProgress < 70 ? "low" : wordProgress > 130 ? "over" : "warn";
    const wordColors = { ok: "#10b981", low: "#f59e0b", warn: "#f59e0b", over: "#ef4444" };
    const wordLabels = { ok: "✅ Đạt mục tiêu", low: "⚠️ Còn thiếu", warn: "⚠️ Gần đủ", over: "🔴 Vượt quá" };
    return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>📋 THÔNG TIN TỪ KW PLAN</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
          <div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Góc tiếp cận</div><div style={{ fontWeight: 600 }}><span className="badge badge-info">{article.contentAngle || "Đánh giá"}</span></div></div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Độ dài mục tiêu</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number" min={500} max={10000} step={100}
                value={targetWordCount}
                onChange={e => setTargetWordCount(Number(e.target.value))}
                style={{ width: 90, fontSize: 13, fontWeight: 600, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border-color)", background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
              />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>từ</span>
            </div>
          </div>
        </div>
        {/* Word count progress */}
        {actualWords > 0 && (
          <div style={{ marginBottom: 12, padding: "10px 14px", background: "var(--bg-tertiary)", borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: wordColors[wordStatus] }}>{wordLabels[wordStatus]}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                <strong style={{ color: wordColors[wordStatus] }}>{actualWords.toLocaleString()}</strong> / {targetWords.toLocaleString()} từ
                {wordDiff !== 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: wordDiff > 0 ? "#ef4444" : "#f59e0b" }}>
                    ({wordDiff > 0 ? "+" : ""}{wordDiff.toLocaleString()})
                  </span>
                )}
              </span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                width: `${Math.min(wordProgress, 100)}%`,
                background: wordColors[wordStatus],
                transition: "width 0.4s ease"
              }} />
            </div>
          </div>
        )}
        <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Thuộc Cluster</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{kw}</div>
        </div>
        <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: 10 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Từ khóa biến thể ({relatedKws.length > 0 ? 1 : 0})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{relatedKws.slice(0, 2).map((r, i) => (<span key={i} className="badge badge-secondary" style={{ fontSize: 11 }}>{r}</span>))}</div>
        </div>
      </div>
      {hasError && (
        <div className="card" style={{ marginBottom: 16, borderColor: "rgba(239,68,68,0.3)" }}>
          <h4 style={{ margin: "0 0 8px", color: "var(--accent-red)", fontSize: 14 }}>⚠️ Lỗi cấu hình API Key</h4>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>Kiểm tra quota của các API key.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-red)" }}>🔄 Thử lại bước lỗi</button>
            <button className="btn btn-secondary btn-sm" style={{ color: "var(--accent-red)", borderColor: "var(--accent-red)" }}>🔑 Thêm key ngay</button>
          </div>
        </div>
      )}
    </>
  );};

  return (
    <div style={{ marginTop: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>‹</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{seoTitle}</h2>
            {hasError && (<span className="badge badge-error" style={{ fontSize: 11 }}>Lỗi</span>)}
            {article.approvalStatus === "approved" && <span className="badge badge-success" style={{ fontSize: 11 }}>✅ Đã duyệt</span>}
            {article.approvalStatus === "rejected" && <span className="badge badge-error" style={{ fontSize: 11 }}>❌ Từ chối</span>}
            {article.approvalStatus === "revision" && <span className="badge badge-warning" style={{ fontSize: 11 }}>✏️ Cần sửa</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Từ khóa: {kw}</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>🔄 Làm mới</button>
      </div>

      {/* Pipeline Stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24, padding: "16px 20px", background: "var(--bg-card)", borderRadius: "var(--radius)", border: "1px solid var(--border-color)" }}>
        {STEPS.map((step, i) => (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: 1, cursor: "pointer" }} onClick={() => setActiveStep(step.key)}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                background: stepStatus(step.key) === "done" || stepStatus(step.key) === "published" ? "var(--accent-green)" : stepStatus(step.key) === "imported" ? "#10b981" : stepStatus(step.key) === "skipped" ? "rgba(100,100,100,0.5)" : stepStatus(step.key) === "error" || stepStatus(step.key) === "failed" ? "var(--accent-red)" : stepStatus(step.key) === "processing" || stepStatus(step.key) === "generating" ? "var(--accent-blue)" : "var(--bg-tertiary)",
                color: stepStatus(step.key) !== "pending" ? "#fff" : "var(--text-muted)",
                boxShadow: activeStep === step.key ? "0 0 0 3px var(--accent-green)" : "none", transition: "box-shadow 0.2s" }}>
                {stepIcon(stepStatus(step.key))}
              </div>
              <span style={{ fontSize: 11, fontWeight: activeStep === step.key ? 700 : 500,
                color: activeStep === step.key ? "var(--accent-green)" : stepStatus(step.key) === "done" || stepStatus(step.key) === "imported" || stepStatus(step.key) === "published" ? "var(--accent-green)" : stepStatus(step.key) === "error" || stepStatus(step.key) === "failed" ? "var(--accent-red)" : "var(--text-muted)" }}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (<div style={{ height: 2, flex: "0.5", background: stepStatus(step.key) === "done" ? "var(--accent-green)" : "var(--border-color)", margin: "0 4px", marginBottom: 18 }} />)}
          </div>
        ))}
      </div>

      {/* TAB: Nghiên cứu — UPGRADED with rich data */}
      {activeStep === "research" && (() => {
        const resStatus = processingStep === "research" ? "processing" : article.pipeline?.research?.status || "pending";
        const hasData = (resStatus === "done" || resStatus === "skipped") && hasResearchPayload;
        if (resStatus === "processing") return (<div><KwPlanInfo /><ProcessingUI title="Đang nghiên cứu chuyên sâu..." subtitle={`AI đang phân tích cạnh tranh, LSI keywords, content gaps cho "${kw}"`} showProgress={true} /></div>);
        if (!hasData) return (
          <div><KwPlanInfo />
            <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
              <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>🔍</div>
              <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có dữ liệu nghiên cứu</h3>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>AI sẽ phân tích keyword "<strong>{kw}</strong>" — bao gồm cạnh tranh, LSI, content gaps.</p>
              <ErrorAlert stepKey="research" />
              <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }} onClick={() => runPipelineStep("research", () => api.generateResearch(projectId, article.id))}>✨ Bắt đầu nghiên cứu</button>
            </div>
          </div>
        );
        return (
          <div><KwPlanInfo />
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}><button className="btn btn-secondary btn-sm" onClick={() => runPipelineStep("research", () => api.generateResearch(projectId, article.id))}>🔄 Nghiên cứu lại</button></div>
            
            {/* Search Intent + Difficulty */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              {researchData.searchIntent && <InfoBadge icon="🔎" label="Search Intent" value={researchData.searchIntent} color="var(--accent-blue)" />}
              {researchData.difficulty && <InfoBadge icon="📊" label="Difficulty" value={researchData.difficulty} color={researchData.difficulty === "hard" ? "var(--accent-red)" : researchData.difficulty === "medium" ? "var(--accent-orange)" : "var(--accent-green)"} />}
              {researchData.estimatedWords && <InfoBadge icon="📝" label="Word Count" value={`~${researchData.estimatedWords}`} />}
            </div>

            {/* Competitor Analysis */}
            {competitorAnalysis.contentGaps && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>⚔️ Phân tích cạnh tranh</h4>
                {competitorAnalysis.topFormats?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Top formats competitors dùng</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{competitorAnalysis.topFormats.map((f, i) => <span key={i} className="badge badge-info" style={{ fontSize: 11 }}>{f}</span>)}</div>
                  </div>
                )}
                {competitorAnalysis.contentGaps?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>🎯 Content Gaps (competitors thiếu)</div>
                    {competitorAnalysis.contentGaps.map((g, i) => <div key={i} style={{ fontSize: 13, color: "var(--accent-green)", padding: "4px 0", display: "flex", gap: 6 }}><span>✅</span><span>{g}</span></div>)}
                  </div>
                )}
                {competitorAnalysis.strengths && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}><strong>Điểm mạnh:</strong> {competitorAnalysis.strengths}</div>}
                {competitorAnalysis.weaknesses && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}><strong>Điểm yếu:</strong> {competitorAnalysis.weaknesses}</div>}
              </div>
            )}

            {/* Content Strategy */}
            {contentStrategy.uniqueAngle && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>🎯 Chiến lược nội dung</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ padding: 12, background: "var(--bg-tertiary)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>💡 Góc nhìn khác biệt</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6 }}>{contentStrategy.uniqueAngle}</div>
                  </div>
                  <div style={{ padding: 12, background: "var(--bg-tertiary)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>🪝 Hook Strategy</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6 }}>{contentStrategy.hookStrategy}</div>
                  </div>
                  {contentStrategy.ctaDirection && (
                    <div style={{ padding: 12, background: "var(--bg-tertiary)", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>📢 CTA Direction</div>
                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{contentStrategy.ctaDirection}</div>
                    </div>
                  )}
                  {contentStrategy.toneOfVoice && (
                    <div style={{ padding: 12, background: "var(--bg-tertiary)", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>🎭 Tone of Voice</div>
                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{contentStrategy.toneOfVoice}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Target Audience Deep Dive */}
            {targetAudienceObj.painPoints && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>👤 Đối tượng mục tiêu</h4>
                {targetAudienceObj.level && <div style={{ marginBottom: 8 }}><span className="badge badge-secondary" style={{ fontSize: 12, textTransform: "capitalize" }}>Level: {targetAudienceObj.level}</span></div>}
                {targetAudienceObj.painPoints?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Pain Points</div>
                    {targetAudienceObj.painPoints.map((p, i) => <div key={i} style={{ fontSize: 13, padding: "4px 0", display: "flex", gap: 6 }}><span>🔥</span><span>{p}</span></div>)}
                  </div>
                )}
                {targetAudienceObj.misconceptions?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Hiểu lầm phổ biến</div>
                    {targetAudienceObj.misconceptions.map((m, i) => <div key={i} style={{ fontSize: 13, padding: "4px 0", display: "flex", gap: 6 }}><span>❌</span><span>{m}</span></div>)}
                  </div>
                )}
              </div>
            )}

            {/* LSI + Long-tail Keywords */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {lsiKeywords.length > 0 && (
                <div className="card">
                  <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>🔗 LSI Keywords ({lsiKeywords.length})</h4>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{lsiKeywords.map((k, i) => (<span key={i} className="badge badge-secondary" style={{ fontSize: 11 }}>{k}</span>))}</div>
                </div>
              )}
              {longTailKeywords.length > 0 && (
                <div className="card">
                  <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>🔎 Long-tail Keywords ({longTailKeywords.length})</h4>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{longTailKeywords.map((k, i) => (<span key={i} className="badge badge-info" style={{ fontSize: 11 }}>{k}</span>))}</div>
                </div>
              )}
            </div>

            {/* People Also Ask + Related Keywords (fallback) */}
            {(peopleAlsoAsk.length > 0 || questions.length > 0) && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 8px" }}>❓ People Also Ask ({(peopleAlsoAsk.length || questions.length)})</h4>
                {(peopleAlsoAsk.length > 0 ? peopleAlsoAsk : questions).map((q, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}><span style={{ color: "var(--accent-green)" }}>🟢</span><span style={{ fontSize: 13 }}>{q}</span></div>))}
              </div>
            )}

            {/* Backward compat: show old-style related keywords if no LSI */}
            {lsiKeywords.length === 0 && relatedKws.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 8px" }}>🔗 Từ khóa liên quan</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{relatedKws.map((k, i) => (<span key={i} className="badge badge-secondary" style={{ fontSize: 12 }}>{k}</span>))}</div>
              </div>
            )}

            {rawResearchText && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 8px" }}>📄 Dữ liệu nghiên cứu AI</h4>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px" }}>
                  AI đã trả dữ liệu nhưng chưa đúng JSON chuẩn. Nội dung gốc vẫn được lưu để bạn đọc và tạo lại nếu cần.
                </p>
                <pre style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 420,
                  overflow: "auto",
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}>{rawResearchText}</pre>
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB: Dàn ý */}
      {activeStep === "outline" && (() => {
        const olStatus = processingStep === "outline" ? "processing" : article.pipeline?.outline?.status || "pending";
        const hasData = olStatus === "done" && outlineSections.length > 0;
        if (olStatus === "processing") return (<div><KwPlanInfo /><ProcessingUI title="Đang tạo dàn ý chiến lược..." subtitle="AI đang tạo dàn ý dựa trên research data, content gaps, và LSI keywords" showProgress={true} /></div>);
        if (!hasData) return (
          <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>📝</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có dàn ý</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{article.source === "wp-import" ? "Bài WP Import — có thể tạo dàn ý trực tiếp." : article.pipeline?.research?.status !== "done" ? "Cần hoàn thành bước Nghiên cứu trước khi tạo dàn ý." : "AI sẽ tạo dàn ý chiến lược dựa trên kết quả nghiên cứu."}</p>
            <ErrorAlert stepKey="outline" />
            <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }} disabled={article.pipeline?.research?.status !== "done" && article.source !== "wp-import"} onClick={() => runPipelineStep("outline", () => api.generateOutline(projectId, article.id))}>✨ Tạo dàn ý</button>
          </div>
        );
        return (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><button className="btn btn-secondary btn-sm" onClick={() => runPipelineStep("outline", () => api.generateOutline(projectId, article.id))}>🔄 Tạo lại dàn ý</button></div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 16 }}><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Tiêu đề SEO</div><div style={{ fontWeight: 600, fontSize: 15 }}>{seoTitle}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{seoTitle.length}/60 ký tự</div></div>
              {metaDesc && (<div><div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Meta Description</div><div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{metaDesc}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{metaDesc.length}/160 ký tự</div></div>)}
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 12px" }}>Các sections ({outlineSections.length})</h4>
              {outlineSections.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: i < outlineSections.length - 1 ? "1px solid var(--border-light)" : "none" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent-green)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{s.desc}</div>
                    {s.lsiTargets.length > 0 && <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>{s.lsiTargets.map((l, j) => <span key={j} className="badge badge-info" style={{ fontSize: 10 }}>LSI: {l}</span>)}</div>}
                    {s.actionableTip && <div style={{ marginTop: 4, fontSize: 11, color: "var(--accent-green)", fontStyle: "italic" }}>💡 {s.actionableTip}</div>}
                    {s.subsections?.length > 0 && (<div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--border-light)" }}>{s.subsections.map((sub, j) => (<div key={j} style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>→ {sub.heading} {sub.wordCount ? `(~${sub.wordCount} từ)` : ""}</div>))}</div>)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>~{s.words} từ</div>
                </div>
              ))}
            </div>
            {outlineData.faq?.length > 0 && (<div className="card" style={{ marginBottom: 16 }}><h4 style={{ margin: "0 0 12px" }}>❓ FAQ ({outlineData.faq.length})</h4>{outlineData.faq.map((f, i) => (<div key={i} style={{ padding: "8px 0", borderBottom: i < outlineData.faq.length - 1 ? "1px solid var(--border-light)" : "none" }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{f.question}</div>{f.answerHint && (<div style={{ fontSize: 12, color: "var(--text-muted)" }}>{f.answerHint}</div>)}</div>))}</div>)}
          </div>
        );
      })()}

      {/* TAB: Nội dung — with mode selector */}
      {activeStep === "content" && (() => {
        const ctStatus = processingStep === "content" ? "processing" : article.pipeline?.content?.status || "pending";
        const contentDataObj = article.pipeline?.content?.data || {};
        const hasContent = (ctStatus === "done" || ctStatus === "imported") && (contentDataObj.html || (typeof contentDataObj === "string" && contentDataObj));
        // For imported articles, content may be stored as string or in originalContent
        const contentHtml = contentDataObj.html || (typeof contentDataObj === "string" ? contentDataObj : null) || article.originalContent || "";
        const isImported = article.source === "wp-import";
        if (ctStatus === "processing") return (<div><KwPlanInfo /><ProcessingUI title={contentGenMode === "quality" ? "Đang viết bài Quality Mode..." : "Đang tạo nội dung..."} subtitle={contentGenMode === "quality" ? `AI đang viết từng section riêng biệt (${(outlineData.sections || []).length} sections). Mất 60-120 giây.` : "AI đang viết bài viết đầy đủ. Mất 30-60 giây."} showProgress={true} /></div>);
        if (!hasContent) return (
          <div><KwPlanInfo />
            <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
              <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>📄</div>
              <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có nội dung</h3>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{isImported ? "Bài WP Import — chạy Research + Outline trước hoặc viết lại trực tiếp." : article.pipeline?.outline?.status !== "done" ? "Cần hoàn thành bước Dàn ý trước." : "Chọn mode viết bài và bắt đầu."}</p>
              <ErrorAlert stepKey="content" />
              {(article.pipeline?.outline?.status === "done" || isImported) && (
                <>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
                    <button className={`btn btn-sm ${contentGenMode === "basic" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentGenMode("basic")} style={{ minWidth: 140 }}>
                      ⚡ Basic Mode<br /><span style={{ fontSize: 10, opacity: 0.7 }}>1 prompt, ~30s</span>
                    </button>
                    <button className={`btn btn-sm ${contentGenMode === "quality" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentGenMode("quality")} style={{ minWidth: 140 }}>
                      🏆 Quality Mode<br /><span style={{ fontSize: 10, opacity: 0.7 }}>Section-by-section, ~90s</span>
                    </button>
                  </div>
                  <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }} onClick={() => runPipelineStep("content", () => api.generateContent(projectId, article.id, contentGenMode))}>✨ Tạo nội dung ({contentGenMode === "quality" ? "Quality" : "Basic"})</button>
                </>
              )}
            </div>
          </div>
        );
        return (
          <div><KwPlanInfo />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13, color: "var(--text-muted)" }}>
                <span>📄 {contentDataObj.wordCount?.toLocaleString() || article.originalWordCount?.toLocaleString() || "0"} từ</span>
                <span>⏱ ~{contentDataObj.readingTime || Math.ceil((article.originalWordCount || 0) / 200) || "0"} phút đọc</span>
                {isImported && <span className="badge badge-info" style={{ fontSize: 10 }}>📥 WP Import</span>}
                {contentDataObj.mode && <span className="badge badge-info" style={{ fontSize: 10 }}>{contentDataObj.mode === "quality" ? "🏆 Quality" : "⚡ Basic"}</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => runPipelineStep("content", () => api.generateContent(projectId, article.id, "basic"))} title="Tạo lại với Basic mode">⚡ Basic</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => runPipelineStep("content", () => api.generateContent(projectId, article.id, "quality"))} title="Tạo lại với Quality mode">🏆 Quality</button>
                </div>
                <button className={`btn btn-sm ${contentViewMode === "preview" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentViewMode("preview")}>👁️ Xem trước</button>
                <button className={`btn btn-sm ${contentViewMode === "sections" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentViewMode("sections")}>✂️ Từng section</button>
                <button className={`btn btn-sm ${contentViewMode === "edit" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentViewMode("edit")}>✏️ Chỉnh sửa</button>
                <button className={`btn btn-sm ${contentViewMode === "html" ? "btn-primary" : "btn-secondary"}`} onClick={() => setContentViewMode("html")}>{"</>"} HTML</button>
              </div>
            </div>
            {/* Quality score — nâng cấp với warning clickable */}
            {article.pipeline?.quality && (
              <div style={{ marginBottom: 16 }}>
                {/* Header bar */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                  background: article.pipeline.quality.passed ? "rgba(52,199,89,0.08)" : "rgba(255,150,30,0.08)",
                  borderRadius: showWarnings ? "8px 8px 0 0" : 8,
                  border: `1px solid ${article.pipeline.quality.passed ? "rgba(52,199,89,0.3)" : "rgba(255,150,30,0.3)"}`,
                  borderBottom: showWarnings ? "none" : undefined,
                  cursor: article.pipeline.quality.warnings?.length > 0 ? "pointer" : "default",
                }} onClick={() => article.pipeline.quality.warnings?.length > 0 && setShowWarnings(v => !v)}>
                  {/* Score badge */}
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0,
                    background: article.pipeline.quality.score >= 80 ? "#10b981" : article.pipeline.quality.score >= 60 ? "#f59e0b" : "#ef4444"
                  }}>{article.pipeline.quality.score}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>QC Score: {article.pipeline.quality.score}/100</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {article.pipeline.quality.issues?.length || 0} lỗi · {article.pipeline.quality.warnings?.length || 0} cảnh báo
                    </div>
                  </div>
                  {article.pipeline.quality.warnings?.length > 0 && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20,
                      background: "rgba(255,150,30,0.15)", border: "1px solid rgba(255,150,30,0.3)",
                      fontSize: 12, fontWeight: 600, color: "#f59e0b"
                    }}>
                      ⚠️ {article.pipeline.quality.warnings.length} cảnh báo
                      <span style={{ fontSize: 10, opacity: 0.8 }}>{showWarnings ? "▲" : "▼"}</span>
                    </div>
                  )}
                </div>

                {/* Expanded warnings panel */}
                {showWarnings && article.pipeline.quality.warnings?.length > 0 && (
                  <div style={{
                    border: "1px solid rgba(255,150,30,0.3)", borderTop: "1px solid rgba(255,150,30,0.1)",
                    borderRadius: "0 0 8px 8px", background: "rgba(255,150,30,0.04)"
                  }}>
                    <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,150,30,0.1)", fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>
                      💡 Click vào cảnh báo để chuyển sang chế độ sửa từng section
                    </div>
                    {article.pipeline.quality.warnings.map((w, i) => {
                      // Phân tích loại cảnh báo để điều hướng tương ứng
                      const isLongParagraph = /Đoạn.*quá dài|paragraph.*long/i.test(w);
                      const isTooLong = /bài quá dài|quá.*từ/i.test(w);
                      const isNoImage = /chưa có.*ảnh|ảnh minh hoạ|image/i.test(w);
                      const isSpam = /sáo rỗng|spam|filler/i.test(w);
                      const canFix = isLongParagraph || isTooLong || isSpam;
                      const fixTarget = isNoImage ? "sections" : "content";
                      const fixMode = isNoImage ? null : "sections";
                      return (
                        <div key={i}
                          style={{
                            display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px",
                            borderBottom: i < article.pipeline.quality.warnings.length - 1 ? "1px solid rgba(255,150,30,0.1)" : "none",
                            cursor: canFix || isNoImage ? "pointer" : "default",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={e => { if (canFix || isNoImage) e.currentTarget.style.background = "rgba(255,150,30,0.08)"; }}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          onClick={() => {
                            if (isNoImage) {
                              setActiveStep("sections");
                              setShowWarnings(false);
                            } else if (canFix) {
                              setActiveStep("content");
                              setContentViewMode("sections");
                              setShowWarnings(false);
                            }
                          }}
                        >
                          <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚠️</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{w}</div>
                          </div>
                          {(canFix || isNoImage) && (
                            <div style={{
                              fontSize: 11, padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap", flexShrink: 0,
                              background: isNoImage ? "rgba(99,102,241,0.15)" : "rgba(16,185,129,0.15)",
                              color: isNoImage ? "#818cf8" : "#10b981", fontWeight: 600,
                            }}>
                              {isNoImage ? "→ Tạo ảnh" : "→ Sửa section"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Action bar */}
                    <div style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
                      <button className="btn btn-sm" style={{
                        background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff",
                        border: "none", padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600
                      }} onClick={() => { setActiveStep("content"); setContentViewMode("sections"); setShowWarnings(false); }}>
                        ✂️ Sửa tất cả theo section
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={async () => {
                        try {
                          const res = await api.generateContent(projectId, article.id, "quality");
                          onBack();
                        } catch(e) { alert("Lỗi: " + e.message); }
                      }}>
                        🏆 Viết lại Quality
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {contentViewMode === "edit" && (<div className="card" style={{ padding: 16 }}><textarea defaultValue={contentHtml} style={{ width: "100%", minHeight: 500, background: "var(--bg-darker)", color: "var(--text-primary)", border: "1px solid var(--border-light)", borderRadius: 8, padding: 16, fontSize: 13, fontFamily: "Monaco, Consolas, monospace", resize: "vertical", outline: "none" }} onBlur={async (e) => { try { const newHtml = e.target.value; const wc = newHtml.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length; await api.updateArticle(projectId, article.id, { pipeline: { ...article.pipeline, content: { status: "done", data: { ...contentDataObj, html: newHtml, wordCount: wc, readingTime: Math.ceil(wc / 200) } } } }); } catch (err) { console.error(err); } }} /></div>)}
            {contentViewMode === "html" && (<div className="card" style={{ padding: 16 }}><pre style={{ background: "var(--bg-darker)", padding: 16, borderRadius: 8, fontSize: 12, overflow: "auto", maxHeight: 600, color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{contentHtml}</pre></div>)}
            {contentViewMode === "preview" && (<div className="card" style={{ padding: 24 }}><SafeHtml className="article-content-preview" style={{ fontSize: 15, lineHeight: 1.8, color: "var(--text-primary)" }} html={contentHtml} /></div>)}
            {/* ─── SECTION REWRITE MODE ─────────────────────────── */}
            {contentViewMode === "sections" && (() => {
              const sections = parseHtmlSections(contentHtml).map((sec) => ({
                ...sec,
                heading: sec.heading || "Giới thiệu",
                content: sec.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
              }));
              const appliedCount = Object.keys(sectionEdits).length;

              const handleRewriteSection = async (idx) => {
                setRewritingSection(idx);
                try {
                  const res = await api.post("/audit/rewrite-article", {
                    content: sections[idx].content,
                    mode: "section",
                    keyword: article.keyword || article.title,
                    customInstructions: sectionRewriteNotes[idx] || "",
                    heading: sections[idx].heading === "Giới thiệu" ? "" : sections[idx].heading,
                    originalHtml: sections[idx].html,
                  });
                  setSectionEdits((prev) => ({ ...prev, [idx]: res.rewritten }));
                } catch (e) { alert("Lỗi viết lại: " + e.message); }
                finally { setRewritingSection(null); }
              };

              const handleApplyAll = async () => {
                if (appliedCount === 0) return;
                let newHtml = contentHtml;
                const editedIndices = Object.keys(sectionEdits).map(Number).sort((a, b) => b - a);
                for (const idx of editedIndices) {
                  const sec = sections[idx];
                  if (sec?.html) newHtml = newHtml.replace(sec.html, sectionEdits[idx]);
                }
                try {
                  const wc = newHtml.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
                  await api.updateArticle(projectId, article.id, {
                    pipeline: { ...article.pipeline, content: { status: "done", data: { ...contentDataObj, html: newHtml, wordCount: wc, readingTime: Math.ceil(wc / 200) } } },
                  });
                  setSectionEdits({});
                  onBack();
                } catch (e) { alert("Lỗi lưu: " + e.message); }
              };

              return (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "8px 12px", background: "rgba(99,102,241,0.06)", borderRadius: 8, border: "1px solid rgba(99,102,241,0.15)" }}>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>💡 Click "Viết lại" để AI viết lại từng section. Sau đó bấm "Áp dụng" để lưu.</span>
                    {appliedCount > 0 && (
                      <button className="btn btn-primary btn-sm" onClick={handleApplyAll}>💾 Áp dụng {appliedCount} section đã sửa</button>
                    )}
                  </div>
                  {sections.map((sec, idx) => {
                    const isRewriting = rewritingSection === idx;
                    const hasEdit = sectionEdits[idx];
                    const wordCount = sec.content.split(/\s+/).filter(Boolean).length;
                    return (
                      <div key={idx} style={{
                        background: "var(--bg-card)", border: hasEdit ? "1px solid rgba(16,185,129,0.5)" : "1px solid var(--border)",
                        borderRadius: 12, marginBottom: 10, overflow: "hidden",
                        boxShadow: hasEdit ? "0 0 0 2px rgba(16,185,129,0.1)" : "none", transition: "border-color 0.25s",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: hasEdit ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.02)", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#818cf8", background: "rgba(99,102,241,0.12)", padding: "3px 9px", borderRadius: 6, letterSpacing: "0.06em", flexShrink: 0 }}>H2</span>
                          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, color: "var(--text)" }}>{sec.heading}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}>{wordCount} từ</span>
                          {hasEdit && <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "rgba(16,185,129,0.08)" }}>✓ Đã viết lại</span>}
                        </div>
                        <div style={{ padding: "10px 16px" }}>
                          {hasEdit ? (
                            <div>
                              <div style={{ fontSize: 11, color: "#10b981", fontWeight: 600, marginBottom: 6 }}>📝 Bản mới ({hasEdit.split(/\s+/).filter(Boolean).length} từ):</div>
                              <SafeHtml style={{ fontSize: 13, lineHeight: 1.65, color: "var(--text)", maxHeight: 120, overflow: "hidden", opacity: 0.85 }} html={hasEdit.substring(0, 400) + (hasEdit.length > 400 ? "..." : "")} />
                              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                <button className="btn btn-sm btn-secondary" onClick={() => handleRewriteSection(idx)} disabled={isRewriting}>🔄 Viết lại lại</button>
                                <button className="btn btn-sm btn-secondary" onClick={() => { const copy = { ...sectionEdits }; delete copy[idx]; setSectionEdits(copy); }}>↩️ Hoàn tác</button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.65, margin: "0 0 10px", maxHeight: 72, overflow: "hidden", opacity: 0.75 }}>
                                {sec.content.substring(0, 240)}{sec.content.length > 240 ? "..." : ""}
                              </p>
                              <textarea
                                rows={2}
                                value={sectionRewriteNotes[idx] || ""}
                                onChange={(e) => setSectionRewriteNotes((prev) => ({ ...prev, [idx]: e.target.value }))}
                                placeholder="Mô tả riêng cho section này, ví dụ: làm ngắn hơn, nhấn mạnh số liệu, giọng thân thiện..."
                                style={{ width: "100%", marginBottom: 10, fontSize: 12, resize: "vertical", minHeight: 60 }}
                              />
                              <button className="btn btn-sm" onClick={() => handleRewriteSection(idx)} disabled={isRewriting}
                                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", padding: "6px 16px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: isRewriting ? "wait" : "pointer" }}>
                                {isRewriting ? "⏳ Đang viết lại..." : "✨ Viết lại section này"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* TAB: Thumbnail */}
      {activeStep === "thumbnail" && (() => {
        const thumb = article.pipeline?.thumbnail; const thumbUrl = thumb?.url; const thumbStatus = thumb?.status || "pending"; const thumbPrompt = thumb?.prompt; const thumbError = thumb?.error;
        return (
          <div><KwPlanInfo />
            {thumbUrl && thumbStatus === "done" && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}><img src={thumbUrl} alt="Thumbnail" style={{ width: "100%", height: "auto", borderRadius: 8, display: "block" }} /></div>
                {thumbPrompt && (<div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, fontStyle: "italic" }}>📝 Prompt: {thumbPrompt.substring(0, 200)}{thumbPrompt.length > 200 ? "..." : ""}</div>)}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => runPipelineStep("thumbnail", () => api.generateThumbnail(projectId, article.id))}>🔄 Tạo lại</button>
                  <a href={thumbUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ flex: 1, textAlign: "center" }}>🔗 Mở ảnh gốc</a>
                </div>
                <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--bg-secondary)", borderRadius: 8, border: "1px solid var(--border-light)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>✏️ Hoặc nhập URL ảnh thủ công:</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="url" placeholder="https://example.com/image.jpg" defaultValue={thumbUrl} style={{ flex: 1, fontSize: 12, padding: "6px 10px" }} id="manual-thumb-url" onKeyDown={(e) => { if (e.key === "Enter") { const url = e.target.value.trim(); if (url) { api.updateArticle(projectId, article.id, { pipeline: { ...article.pipeline, thumbnail: { status: "done", url, prompt: "Manual URL" } } }).then(() => onBack()); } } }} />
                    <button className="btn btn-primary btn-sm" onClick={() => { const url = document.getElementById("manual-thumb-url")?.value?.trim(); if (url) { api.updateArticle(projectId, article.id, { pipeline: { ...article.pipeline, thumbnail: { status: "done", url, prompt: "Manual URL" } } }).then(() => onBack()); } }}>💾 Lưu</button>
                  </div>
                </div>
              </div>
            )}
            {thumbStatus === "generating" && (<div className="card" style={{ textAlign: "center", padding: "60px 40px" }}><span className="loader" style={{ marginBottom: 12, display: "inline-block" }} /><h3 style={{ margin: "12px 0 8px", fontWeight: 600 }}>Đang tạo thumbnail...</h3></div>)}
            {thumbStatus === "failed" && (<div className="card" style={{ textAlign: "center", padding: "40px" }}><div style={{ fontSize: 48, marginBottom: 12 }}>❌</div><h3 style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--accent-red)" }}>Tạo thumbnail thất bại</h3>{thumbError && (<p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{thumbError}</p>)}<div style={{ display: "flex", gap: 8, justifyContent: "center" }}><button className="btn btn-primary btn-sm" onClick={() => runPipelineStep("thumbnail", () => api.generateThumbnail(projectId, article.id))}>🔄 Thử lại</button><button className="btn btn-secondary btn-sm" onClick={() => { api.updateArticle(projectId, article.id, { pipeline: { ...article.pipeline, thumbnail: { status: "done", url: null, prompt: "Skipped" } } }).then(() => onBack()); }}>⏭️ Bỏ qua</button></div></div>)}
            {thumbStatus === "pending" && !thumbUrl && (
              <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>🖼️</div>
                <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có thumbnail</h3>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>AI sẽ tạo thumbnail từ keyword: <strong>{article.keyword || article.title}</strong></p>
                <ErrorAlert stepKey="thumbnail" />
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }} onClick={() => runPipelineStep("thumbnail", () => api.generateThumbnail(projectId, article.id))}>✨ Tạo thumbnail</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { api.updateArticle(projectId, article.id, { pipeline: { ...article.pipeline, thumbnail: { status: "done", url: null, prompt: "Skipped" } } }).then(() => onBack()); }}>⏭️ Bỏ qua</button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB: Ảnh sections */}
      {activeStep === "sections" && (() => {
        const sectionData = article.pipeline?.sections || {}; const sectionStatus = sectionData.status || "pending"; const sectionImages = sectionData.images || [];
        return (
          <div><KwPlanInfo />
            {sectionStatus === "done" && sectionImages.length > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>✅ {sectionImages.filter((i) => i.status === "done").length}/{sectionImages.length} ảnh đã tạo (smart selection)</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => runPipelineStep("sections", () => api.generateSectionImages(projectId, article.id))}>🔄 Tạo lại tất cả</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                  {sectionImages.map((img, idx) => (
                    <div key={idx} className="card" style={{ padding: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>{img.sectionHeading || `Section ${idx + 1}`}</div>
                      {img.status === "done" && img.url ? (<><img src={img.url} alt={img.sectionHeading} style={{ width: "100%", height: "auto", borderRadius: 6, display: "block", marginBottom: 8 }} />{img.prompt && (<div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>📝 {img.prompt.substring(0, 100)}{img.prompt.length > 100 ? "..." : ""}</div>)}</>) : (<div style={{ padding: "20px", background: "var(--bg-tertiary)", borderRadius: 6, textAlign: "center", fontSize: 12, color: "var(--accent-red)" }}>❌ Tạo ảnh thất bại{img.error && (<div style={{ marginTop: 4, fontSize: 10 }}>{img.error}</div>)}</div>)}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(sectionStatus === "pending" || sectionStatus === "generating") && (
              <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
                {sectionStatus === "generating" ? (
                  <><span className="loader" style={{ display: "inline-block", marginBottom: 12 }} /><h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Đang tạo ảnh sections...</h3><p style={{ fontSize: 13, color: "var(--text-muted)" }}>AI đang chọn 3-4 sections quan trọng nhất và tạo ảnh.</p></>
                ) : (
                  <>
                    <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>🖼️</div>
                    <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa có ảnh sections</h3>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>AI sẽ chọn 3-4 sections quan trọng nhất và tạo ảnh minh họa.</p>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                      <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }} disabled={!(article.pipeline?.outline?.status === "done")} onClick={() => runPipelineStep("sections", () => api.generateSectionImages(projectId, article.id))}>✨ Tạo ảnh sections</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => { api.updateArticle(projectId, article.id, { pipeline: { ...article.pipeline, sections: { status: "done", images: [], skipped: true } } }).then(() => onBack()); }}>⏭️ Bỏ qua</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB: Duyệt & Đăng — Full Approval Workflow */}
      {activeStep === "publish" && (() => {
        const contentDone = article.pipeline?.content?.status === "done" || article.pipeline?.content?.status === "imported";
        const approvalStatus = article.approvalStatus || "pending";
        const contentDataObj = article.pipeline?.content?.data || {};
        const thumbUrl = article.pipeline?.thumbnail?.url;
        const sectionImages = article.pipeline?.sections?.images || [];
        const articleStatus = article.status || "processing";

        if (!contentDone) return (
          <div className="card" style={{ textAlign: "center", padding: "60px 40px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>📋</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 600 }}>Chưa sẵn sàng để duyệt</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Cần hoàn thành bước Nội dung trước khi duyệt bài.</p>
          </div>
        );

        return (
          <div>
            {/* Status Banner */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "16px 20px", borderRadius: 12,
              background: articleStatus === "draft" ? "rgba(0,122,255,0.1)" : approvalStatus === "approved" ? "rgba(52,199,89,0.1)" : approvalStatus === "rejected" ? "rgba(255,59,48,0.1)" : approvalStatus === "revision" ? "rgba(255,159,10,0.1)" : "rgba(100,100,100,0.1)",
              border: `1px solid ${articleStatus === "draft" ? "rgba(0,122,255,0.3)" : approvalStatus === "approved" ? "rgba(52,199,89,0.3)" : approvalStatus === "rejected" ? "rgba(255,59,48,0.3)" : approvalStatus === "revision" ? "rgba(255,159,10,0.3)" : "rgba(100,100,100,0.3)"}` }}>
              <span style={{ fontSize: 28 }}>{articleStatus === "draft" ? "📋" : approvalStatus === "approved" ? "✅" : approvalStatus === "rejected" ? "❌" : approvalStatus === "revision" ? "✏️" : "⏳"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {articleStatus === "draft" ? "Bản nháp — Chờ duyệt trên web" : approvalStatus === "approved" ? "Đã duyệt — Sẵn sàng" : approvalStatus === "rejected" ? "Đã từ chối" : approvalStatus === "revision" ? "Yêu cầu chỉnh sửa" : "Chờ xử lý"}
                </div>
                {article.reviewNotes && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>📝 {article.reviewNotes}</div>}
                {article.reviewedAt && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Duyệt lúc: {new Date(article.reviewedAt).toLocaleString("vi-VN")}</div>}
              </div>
            </div>

            {/* Article Full Preview */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h4 style={{ margin: 0, fontSize: 16 }}>👁️ Xem trước bài viết</h4>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className={`btn btn-sm ${showFullContent ? "btn-primary" : "btn-secondary"}`} onClick={() => setShowFullContent(!showFullContent)}>
                    {showFullContent ? "📖 Thu gọn" : "📖 Xem toàn bộ"}
                  </button>
                </div>
              </div>

              {/* Thumbnail */}
              {thumbUrl && <div style={{ marginBottom: 16, borderRadius: 8, overflow: "hidden" }}><img src={thumbUrl} alt="Thumbnail" style={{ width: "100%", height: "auto", display: "block" }} /></div>}

              {/* Title + Meta */}
              <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--bg-tertiary)", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 18, color: "var(--accent-blue)", marginBottom: 4 }}>{seoTitle}</div>
                {metaDesc && <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{metaDesc}</div>}
                <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                  <span>📄 {contentDataObj.wordCount?.toLocaleString() || 0} từ</span>
                  <span>⏱ ~{contentDataObj.readingTime || 0} phút đọc</span>
                  {contentDataObj.mode && <span>{contentDataObj.mode === "quality" ? "🏆 Quality" : "⚡ Basic"}</span>}
                </div>
              </div>

              {/* Full Content — no truncation */}
              <div style={{ maxHeight: showFullContent ? "none" : 500, overflow: showFullContent ? "visible" : "hidden", position: "relative", padding: "16px", borderRadius: 8, border: "1px solid var(--border-light)" }}>
                <SafeHtml className="article-content-preview" style={{ fontSize: 15, lineHeight: 1.8, color: "var(--text-primary)" }} html={contentDataObj.html || ""} />
                {!showFullContent && (
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(transparent, var(--bg-card))", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowFullContent(true)}>📖 Xem toàn bộ nội dung</button>
                  </div>
                )}
              </div>
            </div>

            {/* Section Images Preview */}
            {sectionImages.filter(i => i.status === "done" && i.url).length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>🖼️ Ảnh sections ({sectionImages.filter(i => i.status === "done").length})</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                  {sectionImages.filter(i => i.status === "done" && i.url).map((img, idx) => (
                    <div key={idx}><img src={img.url} alt={img.sectionHeading} style={{ width: "100%", borderRadius: 6 }} /></div>
                  ))}
                </div>
              </div>
            )}

            {/* Quality Score */}
            {article.pipeline?.quality && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff",
                    background: article.pipeline.quality.score >= 80 ? "var(--accent-green)" : article.pipeline.quality.score >= 60 ? "var(--accent-orange)" : "var(--accent-red)" }}>
                    {article.pipeline.quality.score}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>Quality Score: {article.pipeline.quality.score}/100</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      H2: {article.pipeline.quality.h2Count} · Ảnh: {article.pipeline.quality.imgCount} · 
                      Lists: {article.pipeline.quality.listCount} · Strong: {article.pipeline.quality.strongCount}
                    </div>
                  </div>
                </div>
                {article.pipeline.quality.issues?.length > 0 && (
                  <div style={{ marginTop: 12 }}>{article.pipeline.quality.issues.map((issue, i) => <div key={i} style={{ fontSize: 12, color: "var(--accent-red)", padding: "2px 0" }}>❌ {issue}</div>)}</div>
                )}
              </div>
            )}

            {/* Review + Draft Actions */}
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>📋 Duyệt & Lưu nháp</h4>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13 }}>Ghi chú (tùy chọn)</label>
                <textarea rows={2} value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Ghi chú cho bài viết..." style={{ fontSize: 13 }} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary" style={{ flex: 1, minWidth: 140 }} onClick={async () => {
                  try { 
                    await api.approveArticle(projectId, article.id, { action: "approve", reviewNotes });
                    await api.updateArticle(projectId, article.id, { status: "draft" });
                    onBack(); 
                  } catch (e) { alert(e.message); }
                }}>
                  📋 Duyệt & Đăng nháp
                </button>
                <button className="btn btn-primary" style={{ flex: 1, minWidth: 140, background: "var(--accent-green)" }} onClick={async () => {
                  try { 
                    await api.approveArticle(projectId, article.id, { action: "approve", reviewNotes });
                    onBack(); 
                  } catch (e) { alert(e.message); }
                }}>
                  ✅ Duyệt bài
                </button>
                <button className="btn btn-secondary" style={{ flex: 1, minWidth: 120, borderColor: "var(--accent-orange)", color: "var(--accent-orange)" }} onClick={async () => { try { await api.approveArticle(projectId, article.id, { action: "revision", reviewNotes }); onBack(); } catch (e) { alert(e.message); } }}>
                  ✏️ Yêu cầu sửa
                </button>
                <button className="btn btn-secondary" style={{ flex: 1, minWidth: 120, borderColor: "var(--accent-red)", color: "var(--accent-red)" }} onClick={async () => { try { await api.approveArticle(projectId, article.id, { action: "reject", reviewNotes }); onBack(); } catch (e) { alert(e.message); } }}>
                  ❌ Từ chối
                </button>
              </div>
            </div>

            {/* WordPress Publish — Update or Create */}
            <div className="card" style={{ border: article.pipeline?.publish?.wpPostId ? "2px solid var(--accent-green)" : "1px solid var(--border-light)", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>🌐</span>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 14 }}>
                    {article.pipeline?.publish?.wpPostId ? "WordPress — Đã liên kết" : "WordPress — Chưa đăng"}
                  </h4>
                  {article.pipeline?.publish?.wpPostId && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      WP #{article.pipeline.publish.wpPostId} · {article.pipeline.publish.wpStatus === "publish" ? "Công khai" : "Bản nháp"}
                      {article.pipeline.publish.publishedAt && ` · ${new Date(article.pipeline.publish.publishedAt).toLocaleString("vi-VN")}`}
                    </div>
                  )}
                </div>
                {article.pipeline?.publish?.wpUrl && (
                  <a href={article.pipeline.publish.wpUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">🔗 Xem</a>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {article.pipeline?.publish?.wpPostId ? (
                  <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-blue)" }} onClick={async () => {
                    if (!confirm("Cập nhật nội dung bài viết lên WordPress?\nBài WP sẽ được UPDATE (không tạo mới).")) return;
                    try {
                      const res = await api.pushArticleToWp(projectId, article.id);
                      alert(`✅ Đã cập nhật WP #${res.wpPostId} thành công!`);
                      onBack();
                    } catch (e) { alert("❌ Lỗi: " + e.message); }
                  }}>🔄 Cập nhật lên WP</button>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={async () => {
                      try {
                        const res = await api.pushArticleToWp(projectId, article.id, { wpStatus: "draft" });
                        alert(`✅ Đã tạo bài nháp WP #${res.wpPostId}!`);
                        onBack();
                      } catch (e) {
                        if (e.status === 422 || e.qc || (e.message && e.message.includes("QC"))) {
                          const issues = e.issues || [];
                          const warnings = e.warnings || [];
                          const msg = [
                            "❌ Bài chưa đạt chuẩn QC — không thể đăng lên WordPress.",
                            issues.length > 0 ? "\nLỗi:\n" + issues.map(i => "  • " + i).join("\n") : "",
                            warnings.length > 0 ? "\nCảnh báo:\n" + warnings.slice(0, 3).map(w => "  • " + w).join("\n") : "",
                            "\n\u2192 Sửa nội dung hoặc dùng nút 'Bỏ qua QC' nếu chắc chắn.",
                          ].filter(Boolean).join("");
                          alert(msg);
                        } else { alert("❌ Lỗi: " + e.message); }
                      }
                    }}>📋 Đăng nháp lên WP</button>
                    <button className="btn btn-primary btn-sm" style={{ background: "var(--accent-green)" }} onClick={async () => {
                      if (!confirm("Đăng công khai bài viết lên WordPress?")) return;
                      try {
                        const res = await api.pushArticleToWp(projectId, article.id, { wpStatus: "publish" });
                        alert(`✅ Đã đăng công khai WP #${res.wpPostId}!`);
                        onBack();
                      } catch (e) {
                        if (e.status === 422 || e.qc || (e.message && e.message.includes("QC"))) {
                          const issues = e.issues || [];
                          const msg = [
                            "❌ Bài chưa đạt chuẩn QC.",
                            issues.length > 0 ? "\nLỗi:\n" + issues.map(i => "  • " + i).join("\n") : "",
                            "\n\u2192 Sửa rồi thử lại hoặc chọn 'Bỏ qua QC'.",
                          ].filter(Boolean).join("");
                          alert(msg);
                        } else { alert("❌ Lỗi: " + e.message); }
                      }
                    }}>🚀 Đăng công khai</button>
                    {/* Force publish — bỏ qua QC gate */}
                    {article.pipeline?.quality?.passed === false && (
                      <button className="btn btn-secondary btn-sm" style={{ borderColor: "var(--accent-orange)", color: "var(--accent-orange)", fontSize: 11 }}
                        onClick={async () => {
                          if (!confirm("⚠️ Bỏ qua kiểm tra QC và đăng nháp?\nBài này chưa đạt chuẩn chất lượng.")) return;
                          try {
                            const res = await api.pushArticleToWp(projectId, article.id, { wpStatus: "draft", forcePublish: true });
                            alert(`✅ Đã đăng nháp WP #${res.wpPostId} (bỏ qua QC).`);
                            onBack();
                          } catch (e) { alert("❌ " + e.message); }
                        }}>⚠️ Bỏ qua QC</button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
