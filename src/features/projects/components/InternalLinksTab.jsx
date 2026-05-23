import { useState } from "react";
import { api } from "../../../api";

export default function InternalLinksTab({ projectId }) {
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [pushResult, setPushResult] = useState(null);
  const [maxLinks, setMaxLinks] = useState(3);

  const handleScan = async () => {
    setScanning(true);
    setApplyResult(null);
    setPushResult(null);
    try {
      const res = await api.scanInternalLinks(projectId);
      setResult(res);
    } catch (e) {
      setResult({ success: false, error: e.message });
    } finally {
      setScanning(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setPushResult(null);
    try {
      const res = await api.applyInternalLinks(projectId, { maxLinks });
      setApplyResult(res);
      // Re-scan after apply
      if (res.success) {
        const scanRes = await api.scanInternalLinks(projectId);
        setResult(scanRes);
      }
    } catch (e) {
      setApplyResult({ success: false, error: e.message });
    } finally {
      setApplying(false);
    }
  };

  const handlePushWp = async () => {
    if (!confirm("Đẩy nội dung đã gắn internal links lên WordPress?\nCác bài có wpPostId sẽ được UPDATE (không tạo mới).")) return;
    setPushing(true);
    try {
      const res = await api.pushInternalLinksToWp(projectId);
      setPushResult(res);
    } catch (e) {
      setPushResult({ success: false, error: e.message });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div style={{ marginTop: 20 }}>
      {/* Header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>🔗 Auto Internal Links — Ring Linking</h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0", lineHeight: 1.6 }}>
              Tự động gắn internal link dạng <strong>vòng tròn</strong>: Bài 1→2, 2→3, 3→4, ..., N→1.
              <br />
              Đảm bảo mỗi bài đều có ít nhất 1 link đi ra + 1 link trỏ vào. Thêm cross-links cùng cluster.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>
              Max links/bài
            </div>
            <select value={maxLinks} onChange={(e) => setMaxLinks(+e.target.value)} style={{ width: 55, fontSize: 13 }}>
              {[1, 2, 3, 5, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={handleScan} disabled={scanning || applying || pushing}>
            {scanning ? "🔄 Đang quét..." : "🔍 Quét gợi ý"}
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleApply} disabled={applying || scanning || pushing} style={{ background: "var(--accent-green)" }}>
            {applying ? "⏳ Đang gắn vòng..." : "🔗 Auto Ring Link"}
          </button>
          {applyResult?.success && (
            <button className="btn btn-primary btn-sm" onClick={handlePushWp} disabled={pushing || applying || scanning} style={{ background: "var(--accent-blue)" }}>
              {pushing ? "⏳ Đang push..." : "🚀 Push lên WP"}
            </button>
          )}
        </div>
      </div>

      {/* Push WP Result */}
      {pushResult && (
        <div className="card" style={{ marginBottom: 16, border: pushResult.success ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,59,48,0.3)" }}>
          {pushResult.success ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 28 }}>🚀</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    Đã push {pushResult.pushed} bài lên WordPress
                  </div>
                  {pushResult.errors > 0 && (
                    <div style={{ fontSize: 12, color: "var(--accent-red)" }}>
                      ⚠️ {pushResult.errors} bài gặp lỗi
                    </div>
                  )}
                </div>
              </div>
              {pushResult.details?.map((d, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: i < pushResult.details.length - 1 ? "1px solid var(--border-light)" : "none" }}>
                  <span style={{ fontWeight: 500 }}>{d.title}</span>
                  <span className="badge badge-success" style={{ fontSize: 10 }}>✅ +{d.linksAdded} links → WP #{d.wpPostId}</span>
                </div>
              ))}
              {pushResult.errorDetails?.map((d, i) => (
                <div key={`err-${i}`} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, color: "var(--accent-red)" }}>
                  <span>{d.title}</span>
                  <span>❌ {d.error?.substring(0, 80)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{pushResult.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Apply Result — Ring Chain Visualization */}
      {applyResult && (
        <div className="card" style={{ marginBottom: 16, border: applyResult.success ? "1px solid rgba(52,199,89,0.3)" : "1px solid rgba(255,59,48,0.3)" }}>
          {applyResult.success ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 28 }}>🔗</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    Ring Link hoàn tất — {applyResult.totalLinksAdded} links
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Vòng {applyResult.ringSize} bài · {applyResult.articlesModified} bài được cập nhật
                  </div>
                </div>
              </div>

              {/* Ring Chain Diagram */}
              {applyResult.chain?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-secondary)" }}>Chuỗi liên kết:</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {applyResult.chain.map((link, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                        background: link.type === "ring" ? "rgba(0,122,255,0.06)" : "rgba(52,199,89,0.06)",
                        borderRadius: 6, fontSize: 12,
                        borderLeft: `3px solid ${link.type === "ring" ? "var(--accent-blue)" : "var(--accent-green)"}`,
                      }}>
                        <span title={link.type === "ring" ? "Ring link" : "Cluster link"}>
                          {link.type === "ring" ? "🔗" : "🔀"}
                        </span>
                        <span style={{ fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {link.from}
                        </span>
                        <span style={{ color: "var(--accent-green)", fontWeight: 700 }}>→</span>
                        <span style={{ color: "var(--accent-blue)", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {link.to}
                        </span>
                        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontStyle: "italic" }}>
                          "{link.anchor}"
                        </span>
                        {link.fallback && (
                          <span className="badge badge-secondary" style={{ fontSize: 9, padding: "1px 4px" }}>fallback</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Per-article summary */}
              {applyResult.details?.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: 12 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-secondary)" }}>Chi tiết mỗi bài:</h4>
                  {applyResult.details.map((d, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: i < applyResult.details.length - 1 ? "1px solid var(--border-light)" : "none" }}>
                      <span style={{ fontWeight: 500 }}>{d.title}</span>
                      <span className="badge badge-success" style={{ fontSize: 10 }}>+{d.linksAdded} links</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{applyResult.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Scan Results */}
      {result ? (
        result.success ? (
          <div className="card">
            <div style={{ marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 14 }}>Gợi ý liên kết ({result.count} cặp)</h4>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
                Các bài viết có thể liên kết với nhau. Bấm "Auto Ring Link" để gắn tự động.
              </p>
            </div>
            {result.suggestions?.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border-light)", fontSize: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.from.title}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.from.keyword}</div>
                </div>
                <span style={{ color: "var(--accent-green)", fontSize: 14, flexShrink: 0 }}>→</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "var(--accent-blue)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.to.title}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Anchor: "{s.anchor}"</div>
                </div>
                <span className={`badge ${s.status === "published" ? "badge-success" : "badge-info"}`} style={{ fontSize: 9, flexShrink: 0 }}>
                  {s.status === "published" ? "Live" : "Draft"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>🔗</div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>{result.error}</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Tạo thêm bài viết (generate content) rồi quay lại đây.
            </p>
          </div>
        )
      ) : (
        <div className="card" style={{ textAlign: "center", padding: "50px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>🔗</div>
          <h4 style={{ margin: "0 0 8px", fontWeight: 600 }}>Ring Internal Links</h4>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4, maxWidth: 400, margin: "0 auto 8px" }}>
            Cần ít nhất <strong>2 bài viết có nội dung</strong> (đã generate content).
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 400, margin: "0 auto" }}>
            Hệ thống sẽ tự tạo chuỗi vòng: bài 1 link bài 2, bài 2 link bài 3, ..., bài cuối link bài 1.
            Mỗi bài đảm bảo có ít nhất 1 link đi ra và 1 link trỏ vào.
          </p>
        </div>
      )}
    </div>
  );
}
