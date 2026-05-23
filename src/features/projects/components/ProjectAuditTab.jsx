import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api";
import WpPostsBrowser from "./WpPostsBrowser";
import { useTaskQueue, TaskQueueWidget } from "../../../context/TaskQueueContext";

// ─── Diff View Helper ────────────────────────────────────────────────────────
function diffTexts(original, rewritten) {
  // Simple line-level diff
  const origLines = original.split("\n");
  const newLines = rewritten.split("\n");
  const maxLen = Math.max(origLines.length, newLines.length);
  return { origLines, newLines, maxLen };
}

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({ section, index, keyword, siteId, wpPostId, onSectionApply }) {
  const [rewriting, setRewriting] = useState(false);
  const [rewritten, setRewritten] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [applied, setApplied] = useState(false);

  const handleRewrite = async () => {
    setRewriting(true);
    try {
      const res = await api.post("/audit/rewrite-article", { content: section.content, mode: "section", keyword });
      setRewritten(res.rewritten);
      setShowDiff(true);
    } catch (e) {
      alert("Lỗi rewrite: " + e.message);
    } finally {
      setRewriting(false);
    }
  };

  const handleApply = () => {
    onSectionApply(index, rewritten);
    setApplied(true);
  };

  return (
    <div style={{
      background: "var(--bg-card)",
      border: applied ? "1px solid rgba(16,185,129,0.5)" : "1px solid var(--border)",
      borderRadius: 14,
      marginBottom: 12,
      overflow: "hidden",
      transition: "border-color 0.25s, box-shadow 0.25s",
      boxShadow: applied ? "0 0 0 2px rgba(16,185,129,0.1)" : "none",
    }}
    onMouseEnter={e => { if (!applied) e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; }}
    onMouseLeave={e => { if (!applied) e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {/* Section header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 16px",
        background: applied ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.02)",
        borderBottom: "1px solid var(--border)",
      }}>
        <span style={{
          fontSize: 10, fontWeight: 800, color: "#818cf8",
          background: "rgba(99,102,241,0.12)", padding: "3px 9px", borderRadius: 6,
          letterSpacing: "0.06em", flexShrink: 0,
        }}>H2</span>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1, color: "var(--text)" }}>{section.heading}</span>
        <span style={{
          fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap",
          padding: "2px 8px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
        }}>
          {section.content.split(/\s+/).filter(Boolean).length} từ
        </span>
        {applied && <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "rgba(16,185,129,0.08)" }}>✓ Đã áp dụng</span>}
      </div>

      {/* Content preview */}
      {!showDiff && (
        <div style={{ padding: "12px 16px" }}>
          <p style={{
            fontSize: 13.5, color: "var(--text)", lineHeight: 1.65, margin: "0 0 10px",
            maxHeight: 72, overflow: "hidden", opacity: 0.75,
          }}>
            {section.content.substring(0, 240)}{section.content.length > 240 ? "..." : ""}
          </p>
          <button
            className="btn btn-sm"
            onClick={handleRewrite}
            disabled={rewriting}
            style={{
              background: rewriting ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
              color: '#fff', fontWeight: 600, border: 'none',
              boxShadow: rewriting ? 'none' : '0 2px 8px rgba(139,92,246,0.3)',
              opacity: rewriting ? 0.7 : 1,
            }}
          >
            {rewriting ? "⏳ Đang viết lại..." : "✨ Viết lại section này"}
          </button>
        </div>
      )}

      {/* Diff view — B2: Enhanced with line-level highlights + stats */}
      {showDiff && rewritten && (() => {
        const origWords = section.content.split(/\s+/).filter(Boolean).length;
        const newWords = rewritten.split(/\s+/).filter(Boolean).length;
        const wordDiff = newWords - origWords;
        const pctChange = origWords > 0 ? Math.round(Math.abs(wordDiff) / origWords * 100) : 0;
        return (
          <div style={{ padding: "14px 16px" }}>
            {/* Stats bar */}
            <div style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: 11 }}>
              <span style={{ color: "var(--text-muted)" }}>Gốc: {origWords} từ</span>
              <span style={{ color: "#10b981" }}>Mới: {newWords} từ</span>
              <span style={{
                padding: "1px 6px", borderRadius: 3,
                background: wordDiff >= 0 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                color: wordDiff >= 0 ? "#10b981" : "#ef4444", fontWeight: 600,
              }}>
                {wordDiff >= 0 ? "+" : ""}{wordDiff} ({pctChange}%)
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Original */}
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                  marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em"
                }}>🔴 Bản gốc</div>
                <div style={{
                  background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "var(--text)",
                  lineHeight: 1.65, maxHeight: 260, overflowY: "auto", opacity: 0.8,
                }}>
                  {section.content}
                </div>
              </div>
              {/* Rewritten */}
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "#10b981",
                  marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em"
                }}>🟢 Bản viết lại</div>
                <div style={{
                  background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.25)",
                  borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "var(--text)",
                  lineHeight: 1.65, maxHeight: 260, overflowY: "auto",
                }}>
                  {rewritten}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-sm" style={{ background: "#10b981", color: "#fff", fontWeight: 600 }}
                onClick={handleApply} disabled={applied}>
                {applied ? "✓ Đã áp dụng" : "✅ Áp dụng"}
              </button>
              <button className="btn btn-sm btn-secondary" onClick={handleRewrite} disabled={rewriting}>
                🔄 Viết lại lần nữa
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowDiff(false)}>✕ Đóng</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Article Rewriter Panel ───────────────────────────────────────────────────
function ArticleRewriterPanel({ article, siteId, projectId, onClose }) {
  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState("professional");
  const [rewriteMode, setRewriteMode] = useState("section"); // 'full' | 'section'
  const [rewriting, setRewriting] = useState(false);
  const [fullRewritten, setFullRewritten] = useState(null);
  const [sectionEdits, setSectionEdits] = useState({}); // index -> rewritten content
  const [pushing, setPushing] = useState(false);
  const [pushDone, setPushDone] = useState(null);
  const [pushConfirm, setPushConfirm] = useState(false);

  const handleSectionApply = (index, text) => {
    setSectionEdits((prev) => ({ ...prev, [index]: text }));
  };

  const handleFullRewrite = async () => {
    setRewriting(true);
    try {
      const res = await api.post("/audit/rewrite-article", { content: article.content, mode: "full", keyword, tone });
      setFullRewritten(res.rewritten);
    } catch (e) {
      alert("Lỗi: " + e.message);
    } finally {
      setRewriting(false);
    }
  };

  // Build final content: merge section edits into original HTML
  const buildFinalContent = () => {
    if (fullRewritten) return fullRewritten;
    if (Object.keys(sectionEdits).length === 0) return article.content;
    // Replace edited sections in original HTML
    let html = article.content || "";
    const sections = article.sections || [];
    // Process in reverse order to preserve positions
    const editedIndices = Object.keys(sectionEdits).map(Number).sort((a, b) => b - a);
    for (const idx of editedIndices) {
      const section = sections[idx];
      if (section?.html) {
        html = html.replace(section.html, `<h2>${section.heading}</h2>\n${sectionEdits[idx]}`);
      }
    }
    return html;
  };

  const handlePushToWP = async () => {
    if (!article.wpPostId || !siteId) {
      alert("Bài viết này không có wpPostId hoặc siteId để push lên WP. Chỉ hoạt động với bài fetch qua WP REST API.");
      return;
    }
    const content = buildFinalContent();

    setPushing(true);
    setPushConfirm(false);
    try {
      const res = await api.post("/audit/update-article", { siteId, wpPostId: article.wpPostId, content });
      setPushDone(res.link || "Thành công!");

      // D1: Save to rewrite history
      try {
        const wordsBefore = article.wordCount || 0;
        const wordsAfter = content.split(/\s+/).filter(Boolean).length;
        const changePct = wordsBefore > 0 ? Math.round(Math.abs(wordsAfter - wordsBefore) / wordsBefore * 100 * 10) / 10 : 0;
        await api.post("/audit/rewrite-history", {
          projectId,
          wpPostId: article.wpPostId,
          wpPostTitle: article.title || "",
          wpPostUrl: article.url || "",
          originalContent: article.content || "",
          rewrittenContent: content,
          rewriteMode: fullRewritten ? "full" : "section",
          sectionsChanged: Object.keys(sectionEdits).map(Number),
          keyword,
          tone,
          wordCountBefore: wordsBefore,
          wordCountAfter: wordsAfter,
          changePercentage: changePct,
          usedProvider: "",
        });
      } catch (histErr) {
        console.warn("[RewriteHistory] Lưu lịch sử thất bại:", histErr.message);
      }
    } catch (e) {
      alert("Lỗi push WP: " + e.message);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.65)",
      backdropFilter: "blur(4px)",
      WebkitBackdropFilter: "blur(4px)",
      zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      animation: "fadeIn 0.2s ease-out",
    }}>
      {/* B4: Entrance animation */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(24px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
      <div style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        width: "100%", maxWidth: 1120, maxHeight: "90vh",
        overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 32px 80px rgba(0,0,0,0.4)",
        animation: "slideUp 0.3s ease-out",
      }}>
        {/* Header — 2-row clean layout */}
        <div style={{
          padding: "16px 22px 14px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          background: "var(--bg-card)",
        }}>
          {/* Row 1: Title + stats + mode toggle + close */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>✍️</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: "var(--text)", flexShrink: 0 }}>Article Rewriter</span>
            <div style={{ flex: 1 }} />
            {/* Stats chips */}
            <span style={{
              padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: "rgba(99,102,241,0.1)", color: "#818cf8", flexShrink: 0,
            }}>📝 {article.wordCount || 0} từ</span>
            <span style={{
              padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: "rgba(16,185,129,0.1)", color: "#10b981", flexShrink: 0,
            }}>📑 {article.sections?.length || 0} sections</span>
            {/* Mode toggle */}
            <div style={{
              display: "inline-flex", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--bg)",
              flexShrink: 0, marginLeft: 4,
            }}>
              <button
                onClick={() => setRewriteMode("section")}
                style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                  borderRadius: "9px 0 0 9px",
                  background: rewriteMode === "section"
                    ? "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
                    : "rgba(255,255,255,0.06)",
                  color: rewriteMode === "section" ? "#fff" : "var(--text-secondary)",
                  transition: "all 0.2s ease", whiteSpace: "nowrap",
                  boxShadow: rewriteMode === "section" ? "0 2px 8px rgba(99,102,241,0.3)" : "none",
                }}
              >✂️ Từng section</button>
              <button
                onClick={() => setRewriteMode("full")}
                style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                  borderRadius: "0 9px 9px 0",
                  background: rewriteMode === "full"
                    ? "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
                    : "rgba(255,255,255,0.06)",
                  color: rewriteMode === "full" ? "#fff" : "var(--text-secondary)",
                  transition: "all 0.2s ease", whiteSpace: "nowrap",
                  boxShadow: rewriteMode === "full" ? "0 2px 8px rgba(59,130,246,0.3)" : "none",
                }}
              >📄 Toàn bài</button>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={onClose}
              style={{
                width: 34, height: 34, borderRadius: "50%", padding: 0, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, fontWeight: 400,
              }}
            >✕</button>
          </div>

          {/* Article title */}
          <div style={{
            fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginBottom: 10,
          }} title={article.title}>
            {article.title}
          </div>

          {/* Row 2: Keyword + Tone only */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, opacity: 0.5 }}>🔑</span>
              <input
                placeholder="Từ khóa mục tiêu..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={{
                  width: "100%", padding: "7px 12px 7px 30px", borderRadius: 9,
                  border: "1px solid var(--border)",
                  background: "var(--bg)", color: "var(--text)",
                  fontSize: 13,
                }}
              />
            </div>
            <select value={tone} onChange={(e) => setTone(e.target.value)}
              style={{
                padding: "7px 11px", borderRadius: 9,
                border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)",
                fontSize: 13,
              }}>
              <option value="professional">🎯 Chuyên nghiệp</option>
              <option value="friendly">😊 Thân thiện</option>
              <option value="academic">🎓 Học thuật</option>
              <option value="persuasive">💪 Thuyết phục</option>
            </select>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>

          {/* Full rewrite mode */}
          {rewriteMode === "full" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button className="btn btn-primary" onClick={handleFullRewrite} disabled={rewriting}>
                  {rewriting ? "⏳ Đang viết lại toàn bài..." : "✨ Viết lại toàn bài"}
                </button>
              </div>
              {fullRewritten && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                      marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Bản gốc</div>
                    <div style={{
                      background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)",
                      borderRadius: 10, padding: "14px 16px", fontSize: 13.5, lineHeight: 1.72,
                      maxHeight: 500, overflowY: "auto", color: "var(--text)", opacity: 0.8,
                    }}>
                      {article.content?.replace(/<[^>]+>/g, "") || ""}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981",
                      marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Bản viết lại</div>
                    <div style={{
                      background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.25)",
                      borderRadius: 10, padding: "14px 16px", fontSize: 13.5, lineHeight: 1.72,
                      maxHeight: 500, overflowY: "auto", color: "var(--text)",
                    }}>
                      {fullRewritten}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section-by-section mode */}
          {rewriteMode === "section" && (
            <div>
              <div style={{
                fontSize: 13, color: "var(--text-muted)", marginBottom: 16,
                padding: "10px 14px", background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border)", borderRadius: 8,
              }}>
                💡 Click <strong style={{ color: "var(--text)" }}>"Viết lại section này"</strong> để xem bản so sánh và áp dụng từng phần.
              </div>
              {(article.sections || []).length === 0 && (
                <div style={{
                  color: "var(--text-muted)", padding: "32px 20px", textAlign: "center",
                  background: "var(--bg-card)", borderRadius: 10, border: "1px solid var(--border)",
                }}>
                  Không tìm thấy section H2 trong bài viết này.
                </div>
              )}
              {(article.sections || []).map((section, i) => (
                <SectionCard
                  key={i}
                  section={{ ...section, content: sectionEdits[i] ?? section.content }}
                  index={i}
                  keyword={keyword}
                  siteId={siteId}
                  wpPostId={article.wpPostId}
                  onSectionApply={handleSectionApply}
                />
              ))}
            </div>
          )}
        </div>

        {/* B3: Push Confirm Modal with preview */}
        {pushConfirm && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100,
            display: "flex", alignItems: "center", justifyContent: "center",
          }} onClick={() => setPushConfirm(false)}>
            <div style={{
              background: "var(--bg-card)", borderRadius: 16, padding: 28, width: 520,
              maxHeight: "80vh", overflow: "auto", border: "1px solid var(--border)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            }} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: "0 0 16px", fontSize: 17 }}>🚀 Xác nhận Push lên WordPress</h3>

              <div style={{
                background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 10, padding: "12px 16px", marginBottom: 16,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#f59e0b", marginBottom: 6 }}>⚠️ Lưu ý</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Nội dung sẽ ghi đè bài viết <strong>"{article.title}"</strong> trên WordPress.
                  Thao tác này không thể hoàn tác.
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <div style={{
                  flex: 1, padding: "10px 14px", borderRadius: 8,
                  background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Bản gốc</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{article.wordCount || "—"}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>từ</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 20, color: "var(--text-muted)" }}>→</div>
                <div style={{
                  flex: 1, padding: "10px 14px", borderRadius: 8,
                  background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 11, color: "#10b981", marginBottom: 4 }}>Bản mới</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#10b981" }}>
                    {buildFinalContent().split(/\s+/).filter(Boolean).length}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>từ</div>
                </div>
              </div>

              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                {fullRewritten
                  ? "📝 Toàn bài đã được viết lại"
                  : `✂️ ${Object.keys(sectionEdits).length} sections đã chỉnh sửa`}
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-secondary" onClick={() => setPushConfirm(false)}>Hủy</button>
                <button className="btn btn-primary" onClick={handlePushToWP} disabled={pushing}
                  style={{ background: "#ef4444" }}>
                  {pushing ? "⏳ Đang push..." : "🚀 Xác nhận ghi đè"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 22px",
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
          background: "var(--bg-card)",
        }}>
          {pushDone ? (
            <span style={{ color: "#10b981", fontSize: 13.5, fontWeight: 600 }}>
              ✅ Đã push lên WP:&nbsp;
              <a href={pushDone} target="_blank" rel="noreferrer" style={{ color: "#10b981" }}>{pushDone}</a>
            </span>
          ) : (
            <>
              <button
                className="btn btn-primary"
                onClick={() => setPushConfirm(true)}
                disabled={pushing || (!fullRewritten && Object.keys(sectionEdits).length === 0)}
              >
                🚀 Push lên WordPress
              </button>
              {article.source !== "wp-api" && (
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  ⚠️ Push chỉ khả dụng khi fetch qua WP REST API
                </span>
              )}
            </>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {Object.keys(sectionEdits).length > 0 && (
              <span style={{ color: "#10b981", fontWeight: 600, marginRight: 8 }}>
                ✓ {Object.keys(sectionEdits).length} sections đã chỉnh
              </span>
            )}
            {fullRewritten && <span style={{ color: "#10b981", fontWeight: 600 }}>Toàn bài đã viết lại</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main: ProjectAuditTab ────────────────────────────────────────────────────

export default function ProjectAuditTab({ projectId, project }) {
  const navigate = useNavigate();
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState("");

  // Article fetcher state
  const [articleUrl, setArticleUrl] = useState("");
  const [fetchingSite, setFetchingSite] = useState("");
  const [wpSites, setWpSites] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [fetchedArticle, setFetchedArticle] = useState(null);
  const [showRewriter, setShowRewriter] = useState(false);

  // F4: Global Task Queue — replaces local rewriteQueue
  const taskQueue = useTaskQueue();
  const projectTasks = taskQueue.getTasksByProject(projectId);

  // F2: Multi-select for batch rewrite
  const [selectedPosts, setSelectedPosts] = useState(new Set());

  // Build rewriteQueue-compatible object from global tasks (for WpPostsBrowser)
  const rewriteQueue = {};
  projectTasks.forEach(t => {
    if (t.wpPostId) {
      rewriteQueue[t.wpPostId] = {
        status: t.status === "running" ? "rewriting" : t.status,
        article: t.article,
        result: t.result,
        error: t.error,
        title: t.title,
        progress: t.progress || 0,
      };
    }
  });

  // Detect connected WP site from project config
  const projectWpSiteId = project?.config?.publishing?.wpSiteId || "";
  const projectWpSiteName = project?.config?.publishing?.wordpress?.url || "";
  const rewriterRef = useRef(null);

  // B4: Auto-scroll to rewriter section when opening
  useEffect(() => {
    if (showRewriter && rewriterRef.current) {
      rewriterRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [showRewriter]);

  const loadAudits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/audit/by-project/${projectId}`);
      setAudits(res.audits || []);
      setDomain(res.domain || "");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadAudits();
    api.getWpSites().then((s) => setWpSites(s || [])).catch(() => {});
  }, [loadAudits]);

  const handleFetchArticle = async () => {
    if (!articleUrl.trim()) return;
    setFetching(true);
    setFetchedArticle(null);
    try {
      const res = await api.post("/audit/fetch-article", { url: articleUrl, siteId: fetchingSite || undefined });
      setFetchedArticle(res);
    } catch (e) {
      alert("Lỗi fetch: " + e.message);
    } finally {
      setFetching(false);
    }
  };

  const scoreColor = (score) => {
    if (score >= 80) return "#10b981";
    if (score >= 60) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div style={{ padding: "20px 0" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>🔍 SEO Audit</h3>
          {domain && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              Domain: <code style={{ color: "var(--accent)" }}>{domain}</code>
            </div>
          )}
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => navigate(`/audit?domain=${encodeURIComponent(project?.domain || "")}`)}
        >
          + Audit domain này
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate("/audit")}>
          Xem tất cả audits
        </button>
      </div>

      {/* ── Audit history ── */}
      {loading ? (
        <div style={{ padding: 20, color: "var(--text-muted)", textAlign: "center" }}>Đang tải...</div>
      ) : audits.length === 0 ? (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, padding: "32px 20px", textAlign: "center",
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Chưa có audit nào cho domain này</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            {domain ? `Chưa tìm thấy audit cho: ${domain}` : "Dự án chưa có domain"}
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => navigate(`/audit?domain=${encodeURIComponent(project?.domain || "")}`)}
          >
            Chạy audit đầu tiên
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {audits.map((a) => (
            <div
              key={a.id}
              style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 10, padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 12,
                cursor: "pointer", transition: "border-color 0.2s",
              }}
              onClick={() => navigate(`/audit/${a.id}`)}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--accent)"}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
            >
              {/* Score badge */}
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: `conic-gradient(${scoreColor(a.score || 0)} ${(a.score || 0) * 3.6}deg, rgba(255,255,255,0.05) 0)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "var(--surface)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: 12, color: scoreColor(a.score || 0),
                }}>
                  {a.score || "—"}
                </div>
              </div>
              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{a.domain}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {a.totalPages} trang · {new Date(a.createdAt).toLocaleDateString("vi-VN")}
                </div>
              </div>
              {/* Status */}
              <div style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 999,
                background: a.status === "done" ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
                color: a.status === "done" ? "#10b981" : "#f59e0b",
                fontWeight: 600,
              }}>
                {a.status === "done" ? "✓ Xong" : a.status}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Xem chi tiết →</div>
            </div>
          ))}
        </div>
      )}

      {/* F4: Project-scoped Task Queue Widget */}
      <TaskQueueWidget projectId={projectId} />

      {/* ── WP Posts Browser (khi có WP sites) ── */}
      {(projectWpSiteId || wpSites.length > 0) && (
        <WpPostsBrowser
          siteId={projectWpSiteId || (wpSites[0]?.id || "")}
          siteName={projectWpSiteName}
          projectId={projectId}
          projectDomain={project?.domain || ""}
          wpSites={wpSites}
          rewriteQueue={rewriteQueue}
          selectedPosts={selectedPosts}
          setSelectedPosts={setSelectedPosts}
          onSelectPost={(article) => {
            setFetchedArticle(article);
            setFetchingSite(projectWpSiteId);
            setShowRewriter(true);
          }}
          onBatchRewrite={(postIds, opts = {}) => {
            const siteId = projectWpSiteId || (wpSites[0]?.id || "");
            taskQueue.startBatchRewrite(
              postIds, siteId, projectId, project?.name || "",
              opts
            );
            setSelectedPosts(new Set());
          }}
          onBackgroundRewrite={(postId, article) => {
            const siteId = projectWpSiteId || (wpSites[0]?.id || "");
            taskQueue.startRewriteTask({
              wpPostId: postId, siteId, article,
              projectId, projectName: project?.name || "",
              navigateTo: `/projects/${projectId}`,
            });
          }}
        />
      )}

      {/* ── Article Rewriter — Nhập URL thủ công ── */}
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 14, overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--border)",
          background: "rgba(212,160,23,0.04)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>✍️ Article Rewriter</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              Nhập URL bài viết → Fetch → AI viết lại và push lên WordPress
            </div>
          </div>
          {/* Toggle single/multi mode */}
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setArticleUrl(prev => prev.includes("\n") ? prev.split("\n")[0] : prev)}
            style={{ fontSize: 11, padding: "4px 10px" }}
            title="Nhập 1 URL hoặc nhiều URL (mỗi dòng 1 URL)"
          >
            📋 Nhiều URL
          </button>
        </div>

        <div style={{ padding: "16px 18px" }}>
          {/* URL Input — single line */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                id="article-url-input"
                type="url"
                placeholder="https://example.com/bai-viet-can-viet-lai/"
                value={articleUrl.split("\n")[0] || ""}
                onChange={(e) => setArticleUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFetchArticle()}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--bg)",
                  color: "var(--text)", fontSize: 13,
                }}
              />
            </div>
            {wpSites.length > 0 && (
              <select
                value={fetchingSite}
                onChange={(e) => setFetchingSite(e.target.value)}
                style={{
                  padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--bg)", color: "var(--text)", fontSize: 12, minWidth: 140,
                }}
              >
                <option value="">Scrape (không auth)</option>
                {wpSites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || s.siteUrl || s.url}</option>
                ))}
              </select>
            )}
            <button
              className="btn btn-primary"
              onClick={handleFetchArticle}
              disabled={fetching || !articleUrl.trim()}
              style={{ flexShrink: 0 }}
            >
              {fetching ? "⏳ Đang fetch..." : "📥 Fetch bài viết"}
            </button>
          </div>

          {/* Fetched article preview */}
          {fetchedArticle && (
            <div style={{
              background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)",
              borderRadius: 10, padding: "14px 16px",
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  {fetchedArticle.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 12 }}>
                  <span>📝 {fetchedArticle.wordCount} từ</span>
                  <span>📑 {fetchedArticle.sections?.length || 0} sections H2</span>
                  <span style={{ color: fetchedArticle.source === "wp-api" ? "#10b981" : "#f59e0b" }}>
                    {fetchedArticle.source === "wp-api" ? "✓ WP REST API" : "⚠ Scrape"}
                  </span>
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => setShowRewriter(true)}
              >
                ✨ Mở Rewriter
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Article Rewriter Modal ── */}
      {showRewriter && fetchedArticle && (
        <ArticleRewriterPanel
          article={fetchedArticle}
          siteId={fetchingSite}
          projectId={projectId}
          onClose={() => setShowRewriter(false)}
        />
      )}
    </div>
  );
}
