import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";

export default function AuditDetail() {
  const { id } = useParams();
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [issueFilter, setIssueFilter] = useState("all");
  const [expandedIssues, setExpandedIssues] = useState(new Set());
  const [selectedUrl, setSelectedUrl] = useState(null); // URL detail popup
  const [urlDetailTab, setUrlDetailTab] = useState("info");
  const [aiAnalysis, setAiAnalysis] = useState(null); // AI fix results
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMeta, setAiMeta] = useState(null); // Meta rewrite results
  const [aiMetaLoading, setAiMetaLoading] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .getAudit(id)
        .then(setAudit)
        .catch(console.error)
        .finally(() => setLoading(false));
    load();
    // Poll if still running
    const interval = setInterval(() => {
      api.getAudit(id).then((data) => {
        setAudit(data);
        if (data.status !== "running") clearInterval(interval);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [id]);

  if (loading)
    return (
      <div className="loading-overlay">
        <span className="loader" /> Đang tải...
      </div>
    );
  if (!audit)
    return (
      <div className="empty-state">
        <p>Không tìm thấy audit</p>
      </div>
    );

  const score = audit.score || 0;
  const scoreColor =
    score >= 80
      ? "var(--accent-green)"
      : score >= 50
        ? "var(--accent-orange)"
        : "var(--accent-red)";
  const circumference = 2 * Math.PI * 50;
  const dashOffset = circumference - (score / 100) * circumference;

  const filteredIssues = (audit.issuesSummary || []).filter((issue) => {
    if (issueFilter === "all") return true;
    if (issueFilter === "critical") return issue.severity === "critical";
    if (issueFilter === "warning") return issue.severity === "warning";
    if (issueFilter === "info") return issue.severity === "info";
    return issue.category === issueFilter;
  });

  const tabs = [
    { id: "overview", label: "Tổng quan" },
    { id: "pages", label: "Trang", count: audit.totalPages },
    { id: "issues", label: "Vấn đề", count: (audit.issues || []).length },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Link to="/audit" style={{ fontSize: 20, textDecoration: "none" }}>
          ←
        </Link>
        <div>
          <h1 style={{ fontSize: 18 }}>{audit.domain}</h1>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {audit.status === "completed"
              ? "✅ Hoàn thành"
              : audit.status === "running"
                ? "⏳ Đang crawl..."
                : "❌ Thất bại"}
            {" · "}
            {new Date(audit.createdAt).toLocaleString("vi-VN")}
            {" · "}
            {audit.duration}s{" · "}
            {audit.totalPages} trang
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="tab-badge">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div>
          <div
            style={{
              display: "flex",
              gap: 40,
              marginBottom: 32,
              alignItems: "flex-start",
            }}
          >
            <div className="score-donut">
              <svg viewBox="0 0 120 120">
                <circle className="score-bg" cx="60" cy="60" r="50" />
                <circle
                  className="score-fill"
                  cx="60"
                  cy="60"
                  r="50"
                  style={{
                    stroke: scoreColor,
                    strokeDasharray: circumference,
                    strokeDashoffset: dashOffset,
                  }}
                />
              </svg>
              <div className="score-text">
                <span className="score-value" style={{ color: scoreColor }}>
                  {score}
                </span>
                <span className="score-label">SEO Score</span>
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                Phân bổ theo hạng mục
              </h3>
              {Object.entries(audit.categories || {}).map(([key, count]) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "4px 0",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  <span>
                    {{
                      "on-page": "📝 On-Page SEO",
                      technical: "⚙️ Technical SEO",
                      links: "🔗 Liên kết nội bộ",
                      content: "📄 Chất lượng nội dung",
                      speed: "⚡ Tốc độ trang",
                      schema: "📐 Schema / Structured Data",
                      keyword: "🔑 Tối ưu Keyword",
                    }[key] || key}
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        count > 0 ? "var(--accent-red)" : "var(--accent-green)",
                    }}
                  >
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="stat-cards">
            <div className="stat-card">
              <div className="stat-label">Trang đã crawl</div>
              <div className="stat-value">{audit.totalPages}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Nghiêm trọng</div>
              <div className="stat-value red">{audit.stats?.critical || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Cảnh báo</div>
              <div className="stat-value orange">
                {audit.stats?.warning || 0}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Thông tin</div>
              <div className="stat-value blue">{audit.stats?.info || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Đạt</div>
              <div className="stat-value green">{audit.stats?.passed || 0}</div>
            </div>
          </div>
          <div className="stat-cards" style={{ marginTop: 12 }}>
            <div className="stat-card">
              <div className="stat-label">Thời gian phản hồi TB</div>
              <div className="stat-value">
                {audit.stats?.avgResponseTime || 0}
                <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                  ms
                </span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Trang lỗi (4xx/5xx)</div>
              <div className="stat-value red">
                {audit.stats?.errors4xx || 0}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Trang mồ côi (orphan)</div>
              <div className="stat-value orange">
                {audit.stats?.orphanPages || 0}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Có Schema</div>
              <div className="stat-value green">
                {audit.stats?.hasSchema || 0}
                <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
                  /{audit.totalPages}
                </span>
              </div>
            </div>
          </div>

          {/* Top pages needing improvement */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              Top 10 trang cần cải thiện nhất
            </h3>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>URL</th>
                    <th>Score</th>
                    <th>Từ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(audit.pages || [])]
                    .sort((a, b) => (a.score || 0) - (b.score || 0))
                    .slice(0, 10)
                    .map((page, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td
                          style={{
                            maxWidth: 400,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <div style={{ fontSize: 13 }}>
                            {(page.url || "").replace(audit.domain, "") || "/"}
                          </div>
                          <div
                            style={{ fontSize: 11, color: "var(--text-muted)" }}
                          >
                            {page.title || "No title"}
                          </div>
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 600,
                              color:
                                page.score >= 50
                                  ? "var(--accent-green)"
                                  : "var(--accent-red)",
                            }}
                          >
                            {page.score}
                          </span>
                        </td>
                        <td>{page.wordCount}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PAGES TAB */}
      {activeTab === "pages" && (
        <div>
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input type="text" placeholder="Tìm URL, title, keyword..." />
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Score</th>
                  <th>HTTP</th>
                  <th>Từ</th>
                  <th>IN</th>
                  <th>OUT</th>
                </tr>
              </thead>
              <tbody>
                {(audit.pages || []).map((page, i) => (
                  <tr key={i}>
                    <td
                      style={{
                        maxWidth: 350,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <div
                        style={{ fontSize: 13, color: "var(--accent-blue)" }}
                      >
                        {(page.url || "").replace(/https?:\/\/[^/]+/, "") ||
                          "/"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {page.title}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 600,
                          color:
                            page.score >= 50
                              ? "var(--accent-green)"
                              : "var(--accent-red)",
                        }}
                      >
                        {page.score}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${page.httpStatus === 200 ? "badge-success" : "badge-critical"}`}
                      >
                        {page.httpStatus}
                      </span>
                    </td>
                    <td>{page.wordCount}</td>
                    <td>{page.internalLinks || 0}</td>
                    <td>{page.externalLinks || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ISSUES TAB */}
      {activeTab === "issues" && (
        <div>
          <div className="filters">
            <button
              className={`filter-btn ${issueFilter === "all" ? "active" : ""}`}
              onClick={() => setIssueFilter("all")}
            >
              Tất cả {(audit.issues || []).length}
            </button>
            <button
              className={`filter-btn ${issueFilter === "critical" ? "active" : ""}`}
              onClick={() => setIssueFilter("critical")}
              style={{
                color:
                  issueFilter === "critical" ? "white" : "var(--accent-red)",
              }}
            >
              ● Nghiêm trọng ({audit.stats?.critical || 0})
            </button>
            <button
              className={`filter-btn ${issueFilter === "warning" ? "active" : ""}`}
              onClick={() => setIssueFilter("warning")}
              style={{
                color:
                  issueFilter === "warning" ? "white" : "var(--accent-orange)",
              }}
            >
              ● Cảnh báo ({audit.stats?.warning || 0})
            </button>
            <button
              className={`filter-btn ${issueFilter === "info" ? "active" : ""}`}
              onClick={() => setIssueFilter("info")}
              style={{
                color: issueFilter === "info" ? "white" : "var(--accent-blue)",
              }}
            >
              ● Thông tin ({audit.stats?.info || 0})
            </button>
          </div>
          <div className="filters" style={{ marginTop: 4 }}>
            {[
              { key: "on-page", icon: "📝", label: "On-Page SEO" },
              { key: "technical", icon: "⚙️", label: "Technical SEO" },
              { key: "links", icon: "🔗", label: "Liên kết nội bộ" },
              { key: "content", icon: "📄", label: "Chất lượng nội dung" },
              { key: "speed", icon: "⚡", label: "Tốc độ trang" },
              { key: "schema", icon: "📐", label: "Schema / Structured Data" },
              { key: "keyword", icon: "🔑", label: "Tối ưu Keyword" },
            ].map((cat) => (
              <button
                key={cat.key}
                className={`filter-btn ${issueFilter === cat.key ? "active" : ""}`}
                onClick={() =>
                  setIssueFilter(issueFilter === cat.key ? "all" : cat.key)
                }
              >
                {cat.icon} {cat.label} ({(audit.categories || {})[cat.key] || 0}
                )
              </button>
            ))}
          </div>
          <div
            style={{
              textAlign: "right",
              fontSize: 12,
              color: "var(--text-muted)",
              marginBottom: 8,
            }}
          >
            {filteredIssues.reduce((s, i) => s + (i.count || 0), 0)} vấn đề
          </div>

          <div>
            {filteredIssues.map((issue, i) => {
              const isExpanded = expandedIssues.has(i);
              const toggleExpand = () => {
                setExpandedIssues((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                });
              };
              // Use URLs already grouped by issue type from issuesSummary
              const uniqueUrls = [
                ...new Set((issue.urls || []).filter(Boolean)),
              ];

              return (
                <div
                  key={i}
                  className="card"
                  style={{ marginBottom: 8, padding: 0, overflow: "hidden" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: 14,
                      cursor: "pointer",
                    }}
                    onClick={toggleExpand}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        color: "var(--text-muted)",
                        transition: "transform 0.2s",
                        transform: isExpanded
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                      }}
                    >
                      ▶
                    </span>
                    <span
                      className={`badge badge-${issue.severity === "critical" ? "critical" : issue.severity === "warning" ? "warning" : "info"}`}
                    >
                      {issue.severity === "critical"
                        ? "Nghiêm trọng"
                        : issue.severity === "warning"
                          ? "Cảnh báo"
                          : "Thông tin"}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        fontFamily: "monospace",
                      }}
                    >
                      {issue.type}
                    </span>
                    <span style={{ fontSize: 13, flex: 1 }}>
                      {issue.message}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {issue.count} trang
                    </span>
                  </div>

                  {isExpanded && (
                    <div
                      style={{
                        borderTop: "1px solid var(--border-color)",
                        background: "var(--bg-tertiary)",
                      }}
                    >
                      {issue.fix && (
                        <div
                          style={{
                            padding: "8px 14px",
                            fontSize: 12,
                            color: "var(--accent-blue)",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          ℹ️ <strong>Cách sửa:</strong> {issue.fix}
                        </div>
                      )}
                      {uniqueUrls.length > 0 ? (
                        uniqueUrls.map((url, j) => {
                          const path =
                            (url || "").replace(/https?:\/\/[^/]+/, "") || "/";
                          return (
                            <div
                              key={j}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "8px 14px",
                                borderTop:
                                  j > 0
                                    ? "1px solid var(--border-light)"
                                    : "none",
                                fontSize: 13,
                                cursor: "pointer",
                              }}
                              onClick={() => {
                                setSelectedUrl(url);
                                setUrlDetailTab("info");
                              }}
                            >
                              <span
                                style={{
                                  color: "var(--text-secondary)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  flex: 1,
                                }}
                              >
                                {path}
                              </span>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-muted)",
                                  whiteSpace: "nowrap",
                                  marginLeft: 16,
                                }}
                              >
                                {url.length > 50
                                  ? url.substring(0, 50) + "..."
                                  : url}
                              </span>
                              <span
                                style={{
                                  marginLeft: 8,
                                  cursor: "pointer",
                                  color: "var(--text-muted)",
                                }}
                              >
                                ›
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div
                          style={{
                            padding: "12px 14px",
                            fontSize: 13,
                            color: "var(--text-muted)",
                            textAlign: "center",
                          }}
                        >
                          Không có URL cụ thể
                        </div>
                      )}
                      {uniqueUrls.length > 10 && (
                        <div
                          style={{
                            padding: "8px 14px",
                            textAlign: "right",
                            fontSize: 12,
                            color: "var(--text-muted)",
                          }}
                        >
                          Mở hết · Đóng hết
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* URL DETAIL SLIDE-OVER */}
      {selectedUrl &&
        (() => {
          const page = (audit.pages || []).find((p) => p.url === selectedUrl);
          if (!page) return null;
          const pageIssues = (audit.issues || []).filter(
            (i) => i.url === selectedUrl,
          );
          const criticalIssues = pageIssues.filter(
            (i) => i.severity === "critical",
          );
          const warningIssues = pageIssues.filter(
            (i) => i.severity === "warning",
          );
          const infoIssues = pageIssues.filter((i) => i.severity === "info");
          const urlPath =
            (page.url || "").replace(/https?:\/\/[^/]+/, "") || "/";
          const sc = page.score || 0;
          const scColor =
            sc >= 80
              ? "var(--accent-green)"
              : sc >= 50
                ? "var(--accent-orange)"
                : "var(--accent-red)";

          // AI Fix suggestions based on issues
          const aiFixes = pageIssues.map((issue) => {
            const priorityMap = {
              critical: "Ưu tiên cao",
              warning: "Trung bình",
              info: "Thấp",
            };
            const fixMap = {
              TITLE_MISSING: {
                fix: "Thêm thẻ <title> mô tả ngắn gọn (30-60 ký tự), chứa từ khóa chính.",
                current: "Thiếu Title",
              },
              TITLE_TOO_LONG: {
                fix: `Tiêu đề hiện tại quá dài (${page.title?.length || 0} ký tự), vượt mức khuyến nghị 30-60 ký tự. Tiêu đề mới ngắn gọn, chứa từ khóa chính và địa điểm, tránh bị cắt xén trên kết quả tìm kiếm.`,
                current: page.title,
              },
              TITLE_TOO_SHORT: {
                fix: "Tiêu đề quá ngắn. Bổ sung từ khóa và mô tả hấp dẫn (30-60 ký tự).",
                current: page.title,
              },
              META_DESC_MISSING: {
                fix: "Thêm meta description hấp dẫn (120-160 ký tự) chứa từ khóa chính.",
                current: "Thiếu Meta Description",
              },
              META_DESC_TOO_LONG: {
                fix: `Meta description quá dài (${page.metaDescription?.length || 0} ký tự). Rút gọn xuống 120-160 ký tự.`,
                current: page.metaDescription,
              },
              MISSING_H1: {
                fix: "Thêm thẻ H1 duy nhất cho trang, chứa từ khóa chính.",
                current: "Thiếu H1",
              },
              CANONICAL_MISMATCH: {
                fix: `Thiết lập thẻ <link rel="canonical" href="${page.url}" /> trong phần <head> của trang.`,
                current: "Không xác định rõ trong dữ liệu",
              },
              PRODUCT_NO_SCHEMA: {
                fix: `Thêm cấu trúc dữ liệu Schema Product cho các sản phẩm cụ thể được nhắc đến trong bài, bao gồm tên, hình ảnh, và mô tả.`,
                current: "Thiếu Schema Product",
              },
              NO_ARTICLE_SCHEMA: {
                fix: "Triển khai Schema Article hoặc NewsArticle cho trang này, bao gồm các thuộc tính: headline, datePublished, author, và image.",
                current: "Thiếu Schema Article",
              },
              LOW_TEXT_HTML_RATIO: {
                fix: `Giảm mã HTML thừa: loại bỏ inline CSS/JS, plugin không dùng, minify HTML. Tỷ lệ text/HTML lý tưởng: 25-70%.`,
                current: `ratio: ${page.textHtmlRatio}, htmlSize: ${page.htmlSize}`,
              },
              HEADING_SKIP_LEVEL: {
                fix: "Sắp xếp lại cây heading theo thứ tự: H1 → H2 → H3, không nhảy cấp.",
                current: "Heading nhảy cấp",
              },
              LARGE_HTML: {
                fix: `Giảm DOM size: loại bỏ div wrapper thừa, lazy load component, virtual scroll cho danh sách dài.`,
                current: `sizeKB: ${Math.round((page.htmlSize || 0) / 1024)}`,
              },
              MIXED_CONTENT_RESOURCES: {
                fix: "Chuyển tất cả resource sang HTTPS. Kiểm tra lại các thẻ img, script, link.",
                current: "Trang HTTPS tải resource qua HTTP",
              },
              NO_EXTERNAL_LINKS: {
                fix: "Thêm 1-3 external links đến các nguồn uy tín liên quan.",
                current: "0 external links",
              },
              DUPLICATE_CONTENT: {
                fix: "Kiểm tra và loại bỏ nội dung trùng lặp, sử dụng canonical tag.",
                current: "Nội dung trùng lặp",
              },
            };
            const fixData = fixMap[issue.type] || {
              fix: issue.fix || issue.message,
              current: "",
            };
            return {
              ...issue,
              priority: priorityMap[issue.severity] || "Trung bình",
              fixSuggestion: fixData.fix,
              currentValue: fixData.current,
            };
          });

          return (
            <>
              {/* Overlay */}
              <div
                onClick={() => setSelectedUrl(null)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.5)",
                  zIndex: 1000,
                }}
              />
              {/* Slide-over panel */}
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  right: 0,
                  width: 680,
                  height: "100vh",
                  background: "var(--bg-secondary)",
                  borderLeft: "1px solid var(--border-color)",
                  zIndex: 1001,
                  overflow: "auto",
                  boxShadow: "-4px 0 20px rgba(0,0,0,0.3)",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid var(--border-color)",
                    position: "sticky",
                    top: 0,
                    background: "var(--bg-secondary)",
                    zIndex: 2,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        border: `3px solid ${scColor}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 700,
                        color: scColor,
                      }}
                    >
                      {sc}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {urlPath}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {page.url}
                      </div>
                    </div>
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 16,
                        textDecoration: "none",
                      }}
                    >
                      ↗
                    </a>
                    <button
                      onClick={() => setSelectedUrl(null)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        fontSize: 20,
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      marginBottom: 12,
                    }}
                  >
                    <span className="badge badge-success">
                      HTTP {page.httpStatus}
                    </span>
                    <span style={{ marginLeft: 8 }}>{page.wordCount} từ</span>
                    <span style={{ marginLeft: 8 }}>{page.responseTime}ms</span>
                    <span style={{ marginLeft: 8 }}>
                      {pageIssues.length} vấn đề
                    </span>
                  </div>
                  {/* Sub-tabs */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {[
                      { id: "info", label: "Thông tin" },
                      { id: "issues", label: `Vấn đề (${pageIssues.length})` },
                      { id: "aifix", label: "AI Fix" },
                    ].map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setUrlDetailTab(t.id)}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 6,
                          border: "none",
                          fontSize: 13,
                          cursor: "pointer",
                          fontWeight: urlDetailTab === t.id ? 600 : 400,
                          background:
                            urlDetailTab === t.id
                              ? "var(--accent-blue)"
                              : "var(--bg-tertiary)",
                          color:
                            urlDetailTab === t.id
                              ? "white"
                              : "var(--text-secondary)",
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab Content */}
                <div style={{ padding: 20 }}>
                  {/* THÔNG TIN TAB */}
                  {urlDetailTab === "info" && (
                    <div>
                      {/* ON-PAGE SEO */}
                      <div
                        className="card"
                        style={{ padding: 16, marginBottom: 12 }}
                      >
                        <h4
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginBottom: 12,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          ON-PAGE SEO
                        </h4>
                        <div style={{ marginBottom: 10 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 11,
                              color: "var(--text-muted)",
                              marginBottom: 2,
                            }}
                          >
                            <span>TITLE</span>
                            <span
                              style={{
                                color:
                                  (page.title?.length || 0) > 60
                                    ? "var(--accent-red)"
                                    : "var(--accent-green)",
                              }}
                            >
                              {page.title?.length || 0}/60{" "}
                              {(page.title?.length || 0) > 60 ? "Quá dài" : ""}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              color: "var(--text-primary)",
                            }}
                          >
                            {page.title || "Không có"}
                          </div>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 11,
                              color: "var(--text-muted)",
                              marginBottom: 2,
                            }}
                          >
                            <span>META DESCRIPTION</span>
                            <span
                              style={{
                                color:
                                  (page.metaDescription?.length || 0) > 160
                                    ? "var(--accent-red)"
                                    : "var(--accent-green)",
                              }}
                            >
                              {page.metaDescription?.length || 0}/160
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                          >
                            {page.metaDescription || "Không có"}
                          </div>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              marginBottom: 2,
                            }}
                          >
                            H1
                          </div>
                          <div style={{ fontSize: 13 }}>
                            {page.h1 || "Không có"}
                          </div>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              marginBottom: 2,
                            }}
                          >
                            CANONICAL
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--accent-blue)",
                              wordBreak: "break-all",
                            }}
                          >
                            {page.canonical || "Không có"}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              marginBottom: 2,
                            }}
                          >
                            ROBOTS
                          </div>
                          <div style={{ fontSize: 12 }}>
                            {page.robots || "Không có"}
                          </div>
                        </div>
                      </div>

                      {/* KEYWORD CHÍNH */}
                      <div
                        className="card"
                        style={{ padding: 16, marginBottom: 12 }}
                      >
                        <h4
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginBottom: 8,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          KEYWORD CHÍNH
                        </h4>
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--text-muted)",
                            fontStyle: "italic",
                          }}
                        >
                          Chưa có keyword
                        </div>
                      </div>

                      {/* LIÊN KẾT */}
                      <div
                        className="card"
                        style={{ padding: 16, marginBottom: 12 }}
                      >
                        <h4
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginBottom: 12,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          LIÊN KẾT
                        </h4>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              textAlign: "center",
                              padding: 12,
                              background: "var(--bg-tertiary)",
                              borderRadius: 8,
                            }}
                          >
                            <div style={{ fontSize: 22, fontWeight: 700 }}>
                              {page.internalLinks || 0}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                              }}
                            >
                              Internal links (ra)
                            </div>
                          </div>
                          <div
                            style={{
                              textAlign: "center",
                              padding: 12,
                              background: "var(--bg-tertiary)",
                              borderRadius: 8,
                            }}
                          >
                            <div style={{ fontSize: 22, fontWeight: 700 }}>
                              {page.externalLinks || 0}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                              }}
                            >
                              External links
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* HÌNH ẢNH */}
                      <div
                        className="card"
                        style={{ padding: 16, marginBottom: 12 }}
                      >
                        <h4
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginBottom: 12,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          HÌNH ẢNH
                        </h4>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              textAlign: "center",
                              padding: 12,
                              background: "var(--bg-tertiary)",
                              borderRadius: 8,
                            }}
                          >
                            <div style={{ fontSize: 22, fontWeight: 700 }}>
                              {page.totalImages || (page.images || []).length}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                              }}
                            >
                              Tổng ảnh
                            </div>
                          </div>
                          <div
                            style={{
                              textAlign: "center",
                              padding: 12,
                              background: "var(--bg-tertiary)",
                              borderRadius: 8,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 22,
                                fontWeight: 700,
                                color:
                                  (page.imagesWithoutAlt || 0) > 0
                                    ? "var(--accent-red)"
                                    : "var(--accent-green)",
                              }}
                            >
                              {page.imagesWithoutAlt || 0}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                              }}
                            >
                              Thiếu alt
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* SCHEMA */}
                      <div
                        className="card"
                        style={{ padding: 16, marginBottom: 12 }}
                      >
                        <h4
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginBottom: 8,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          SCHEMA / STRUCTURED DATA
                        </h4>
                        {page.hasSchema ? (
                          <div
                            style={{
                              fontSize: 13,
                              color: "var(--accent-green)",
                            }}
                          >
                            ✅ Có Schema{" "}
                            {(page.schemaTypes || []).length > 0 &&
                              `(${page.schemaTypes.join(", ")})`}
                          </div>
                        ) : (
                          <div
                            style={{ fontSize: 13, color: "var(--accent-red)" }}
                          >
                            ❌ Không có Schema
                          </div>
                        )}
                      </div>

                      {/* CÂY HEADING */}
                      <div
                        className="card"
                        style={{ padding: 16, marginBottom: 12 }}
                      >
                        <h4
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginBottom: 12,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          CÂY HEADING
                        </h4>
                        {(page.headings || []).map((h, i) => {
                          const level = parseInt(
                            h.tag?.replace("h", "") || "2",
                          );
                          const colors = {
                            1: "#ef4444",
                            2: "#f59e0b",
                            3: "#6366f1",
                            4: "#8b5cf6",
                            5: "#a78bfa",
                            6: "#c4b5fd",
                          };
                          return (
                            <div
                              key={i}
                              style={{
                                paddingLeft: (level - 1) * 16,
                                marginBottom: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: "1px 5px",
                                  borderRadius: 3,
                                  background: colors[level] || "#888",
                                  color: "white",
                                  fontWeight: 700,
                                }}
                              >
                                {h.tag?.toUpperCase()}
                              </span>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {h.text?.substring(0, 80)}
                                {h.text?.length > 80 ? "..." : ""}
                              </span>
                            </div>
                          );
                        })}
                        {(page.headings || []).length === 0 && (
                          <div
                            style={{ fontSize: 13, color: "var(--text-muted)" }}
                          >
                            Không có heading
                          </div>
                        )}
                      </div>

                      {/* OPEN GRAPH */}
                      <div
                        className="card"
                        style={{ padding: 16, marginBottom: 12 }}
                      >
                        <h4
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginBottom: 12,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          OPEN GRAPH
                        </h4>
                        <div style={{ marginBottom: 6 }}>
                          <span
                            style={{ fontSize: 11, color: "var(--text-muted)" }}
                          >
                            OG TITLE
                          </span>
                          <div style={{ fontSize: 12 }}>
                            {page.ogTitle || "Không có"}
                          </div>
                        </div>
                        <div style={{ marginBottom: 6 }}>
                          <span
                            style={{ fontSize: 11, color: "var(--text-muted)" }}
                          >
                            OG DESC
                          </span>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                          >
                            {page.ogDesc || "Không có"}
                          </div>
                        </div>
                        <div>
                          <span
                            style={{ fontSize: 11, color: "var(--text-muted)" }}
                          >
                            OG IMAGE
                          </span>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--accent-blue)",
                              wordBreak: "break-all",
                            }}
                          >
                            {page.ogImage || "Không có"}
                          </div>
                        </div>
                      </div>

                      {/* TECHNICAL */}
                      <div className="card" style={{ padding: 16 }}>
                        <h4
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginBottom: 12,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          TECHNICAL
                        </h4>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 8,
                            fontSize: 12,
                          }}
                        >
                          <div>
                            <span style={{ color: "var(--text-muted)" }}>
                              Content-Type:
                            </span>
                            <br />
                            text/html; charset=UTF-8
                          </div>
                          <div>
                            <span style={{ color: "var(--text-muted)" }}>
                              Charset:
                            </span>
                            <br />
                            UTF-8
                          </div>
                          <div>
                            <span style={{ color: "var(--text-muted)" }}>
                              Viewport:
                            </span>
                            <br />
                            Có
                          </div>
                          <div>
                            <span style={{ color: "var(--text-muted)" }}>
                              Headings:
                            </span>
                            <br />
                            {(page.headings || []).length} headings
                          </div>
                          <div>
                            <span style={{ color: "var(--text-muted)" }}>
                              HTML Size:
                            </span>
                            <br />
                            {Math.round((page.htmlSize || 0) / 1024)} KB
                          </div>
                          <div>
                            <span style={{ color: "var(--text-muted)" }}>
                              Text/HTML:
                            </span>
                            <br />
                            {page.textHtmlRatio}%
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* VẤN ĐỀ TAB */}
                  {urlDetailTab === "issues" && (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 16,
                        }}
                      >
                        <h4 style={{ fontSize: 14 }}>
                          Vấn đề ({pageIssues.length})
                        </h4>
                      </div>
                      {criticalIssues.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                              fontWeight: 600,
                              marginBottom: 8,
                              textTransform: "uppercase",
                            }}
                          >
                            NGHIÊM TRỌNG ({criticalIssues.length})
                          </div>
                          {criticalIssues.map((iss, i) => (
                            <div
                              key={i}
                              className="card"
                              style={{ padding: 12, marginBottom: 6 }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 4,
                                }}
                              >
                                <span className="badge badge-critical">
                                  Nghiêm trọng
                                </span>
                                <span style={{ fontSize: 13 }}>
                                  {iss.message}
                                </span>
                              </div>
                              {iss.fix && (
                                <div
                                  style={{
                                    fontSize: 12,
                                    padding: "6px 10px",
                                    background: "rgba(16,185,129,0.1)",
                                    borderRadius: 6,
                                    color: "var(--accent-green)",
                                    marginTop: 4,
                                  }}
                                >
                                  ℹ️ {iss.fix}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {warningIssues.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                              fontWeight: 600,
                              marginBottom: 8,
                              textTransform: "uppercase",
                            }}
                          >
                            CẢNH BÁO ({warningIssues.length})
                          </div>
                          {warningIssues.map((iss, i) => (
                            <div
                              key={i}
                              className="card"
                              style={{ padding: 12, marginBottom: 6 }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 4,
                                }}
                              >
                                <span className="badge badge-warning">
                                  Cảnh báo
                                </span>
                                <span style={{ fontSize: 13 }}>
                                  {iss.message}
                                </span>
                              </div>
                              {iss.fix && (
                                <div
                                  style={{
                                    fontSize: 12,
                                    padding: "6px 10px",
                                    background: "rgba(245,158,11,0.1)",
                                    borderRadius: 6,
                                    color: "var(--accent-orange)",
                                    marginTop: 4,
                                  }}
                                >
                                  ℹ️ {iss.fix}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {infoIssues.length > 0 && (
                        <div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                              fontWeight: 600,
                              marginBottom: 8,
                              textTransform: "uppercase",
                            }}
                          >
                            THÔNG TIN ({infoIssues.length})
                          </div>
                          {infoIssues.map((iss, i) => (
                            <div
                              key={i}
                              className="card"
                              style={{ padding: 12, marginBottom: 6 }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <span className="badge badge-info">
                                  Thông tin
                                </span>
                                <span style={{ fontSize: 13 }}>
                                  {iss.message}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {pageIssues.length === 0 && (
                        <div
                          style={{
                            textAlign: "center",
                            padding: 40,
                            color: "var(--text-muted)",
                          }}
                        >
                          ✅ Không có vấn đề nào
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI FIX TAB */}
                  {urlDetailTab === "aifix" && (
                    <div>
                      {/* AI Analysis Section */}
                      <div
                        style={{
                          textAlign: "center",
                          padding: "24px 0",
                          marginBottom: 16,
                        }}
                      >
                        {!aiAnalysis && !aiLoading && (
                          <>
                            <div style={{ fontSize: 40, marginBottom: 12 }}>
                              🖥️
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                color: "var(--text-muted)",
                                marginBottom: 16,
                              }}
                            >
                              Chưa có đề xuất AI cho trang này.
                            </div>
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 14, padding: "10px 24px" }}
                              onClick={async () => {
                                setAiLoading(true);
                                try {
                                  const result = await api.aiAnalyzePage(
                                    id,
                                    selectedUrl,
                                  );
                                  setAiAnalysis(result.fixes || []);
                                } catch (e) {
                                  alert("Lỗi AI: " + e.message);
                                }
                                setAiLoading(false);
                              }}
                            >
                              ✨ Yêu cầu AI phân tích
                            </button>
                          </>
                        )}
                        {aiLoading && (
                          <div>
                            <span
                              className="loader"
                              style={{ marginRight: 8 }}
                            />
                            <span
                              style={{
                                fontSize: 13,
                                color: "var(--accent-blue)",
                              }}
                            >
                              Đang phân tích bằng AI...
                            </span>
                          </div>
                        )}
                      </div>

                      {/* AI Fix Results */}
                      {aiAnalysis && aiAnalysis.length > 0 && (
                        <div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 12,
                            }}
                          >
                            <h4 style={{ fontSize: 14 }}>
                              AI Đề xuất ({aiAnalysis.length})
                            </h4>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setAiAnalysis(null);
                                setAiLoading(false);
                              }}
                            >
                              🔄 Phân tích lại
                            </button>
                          </div>
                          {aiAnalysis.map((fix, i) => {
                            const prColor =
                              fix.priority === "high"
                                ? "var(--accent-red)"
                                : fix.priority === "medium"
                                  ? "var(--accent-orange)"
                                  : "var(--accent-blue)";
                            const prLabel =
                              fix.priority === "high"
                                ? "Ưu tiên cao"
                                : fix.priority === "medium"
                                  ? "Trung bình"
                                  : "Thấp";
                            return (
                              <div
                                key={i}
                                className="card"
                                style={{ padding: 16, marginBottom: 10 }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    marginBottom: 8,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontFamily: "monospace",
                                      color: "var(--text-muted)",
                                    }}
                                  >
                                    {fix.type}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      padding: "2px 8px",
                                      borderRadius: 10,
                                      border: `1px solid ${prColor}`,
                                      color: prColor,
                                    }}
                                  >
                                    {prLabel}
                                  </span>
                                </div>
                                {fix.title && (
                                  <div
                                    style={{
                                      fontSize: 14,
                                      fontWeight: 600,
                                      marginBottom: 6,
                                    }}
                                  >
                                    {fix.title}
                                  </div>
                                )}
                                {fix.description && (
                                  <div
                                    style={{
                                      fontSize: 13,
                                      color: "var(--text-secondary)",
                                      lineHeight: 1.6,
                                      marginBottom: 8,
                                    }}
                                  >
                                    {fix.description}
                                  </div>
                                )}
                                <div
                                  style={{
                                    fontSize: 13,
                                    lineHeight: 1.6,
                                    padding: "8px 12px",
                                    background: "rgba(16,185,129,0.1)",
                                    borderRadius: 6,
                                    borderLeft: "3px solid var(--accent-green)",
                                  }}
                                >
                                  💡 <strong>Cách sửa:</strong> {fix.fix}
                                </div>
                                {fix.example && (
                                  <div
                                    style={{
                                      marginTop: 8,
                                      padding: "8px 12px",
                                      background: "var(--bg-tertiary)",
                                      borderRadius: 6,
                                      fontSize: 12,
                                      fontFamily: "monospace",
                                      whiteSpace: "pre-wrap",
                                      color: "var(--text-secondary)",
                                    }}
                                  >
                                    {fix.example}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {aiAnalysis && aiAnalysis.length === 0 && (
                        <div
                          style={{
                            textAlign: "center",
                            padding: 20,
                            color: "var(--text-muted)",
                          }}
                        >
                          ✅ AI không phát hiện vấn đề cần sửa
                        </div>
                      )}

                      {/* Divider */}
                      <div
                        style={{
                          borderTop: "1px solid var(--border-color)",
                          margin: "20px 0",
                        }}
                      />

                      {/* Meta Rewrite */}
                      <div
                        className="card"
                        style={{ padding: 16, marginBottom: 12 }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 12,
                          }}
                        >
                          <h4 style={{ fontSize: 13, fontWeight: 700 }}>
                            📝 Meta Rewrite
                          </h4>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={aiMetaLoading}
                            onClick={async () => {
                              setAiMetaLoading(true);
                              try {
                                const result = await api.aiMetaRewrite(
                                  id,
                                  selectedUrl,
                                );
                                setAiMeta(result);
                              } catch (e) {
                                alert("Lỗi: " + e.message);
                              }
                              setAiMetaLoading(false);
                            }}
                          >
                            {aiMetaLoading ? "⏳ Đang tạo..." : "✨ Tạo Meta"}
                          </button>
                        </div>
                        {!aiMeta && !aiMetaLoading && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                              fontStyle: "italic",
                            }}
                          >
                            Chưa có Meta Rewrite. Nhấn nút "Tạo Meta" để AI tối
                            ưu title/description.
                          </div>
                        )}
                        {aiMeta && (
                          <div>
                            <div style={{ marginBottom: 12 }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-muted)",
                                  marginBottom: 4,
                                }}
                              >
                                TITLE ĐỀ XUẤT{" "}
                                <span style={{ color: "var(--accent-green)" }}>
                                  (
                                  {aiMeta.titleLength ||
                                    aiMeta.title?.length ||
                                    0}{" "}
                                  ký tự)
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: 13,
                                  padding: "8px 12px",
                                  background: "rgba(16,185,129,0.08)",
                                  borderRadius: 6,
                                  borderLeft: "3px solid var(--accent-green)",
                                }}
                              >
                                {aiMeta.title}
                              </div>
                            </div>
                            <div style={{ marginBottom: 12 }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-muted)",
                                  marginBottom: 4,
                                }}
                              >
                                META DESCRIPTION ĐỀ XUẤT{" "}
                                <span style={{ color: "var(--accent-green)" }}>
                                  (
                                  {aiMeta.metaLength ||
                                    aiMeta.metaDescription?.length ||
                                    0}{" "}
                                  ký tự)
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  padding: "8px 12px",
                                  background: "rgba(16,185,129,0.08)",
                                  borderRadius: 6,
                                  borderLeft: "3px solid var(--accent-green)",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {aiMeta.metaDescription}
                              </div>
                            </div>
                            {aiMeta.keywords && aiMeta.keywords.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "var(--text-muted)",
                                    marginBottom: 4,
                                  }}
                                >
                                  KEYWORDS
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 4,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  {aiMeta.keywords.map((kw, j) => (
                                    <span
                                      key={j}
                                      style={{
                                        fontSize: 11,
                                        padding: "2px 8px",
                                        background: "var(--bg-tertiary)",
                                        borderRadius: 10,
                                        color: "var(--accent-blue)",
                                      }}
                                    >
                                      {kw}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {aiMeta.reasoning && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-muted)",
                                  marginTop: 8,
                                  fontStyle: "italic",
                                }}
                              >
                                💬 {aiMeta.reasoning}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          );
        })()}
    </div>
  );
}
