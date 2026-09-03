import DOMPurify from "dompurify";

/**
 * Wrapper an toàn cho dangerouslySetInnerHTML.
 * Sanitize mọi HTML trước khi render — chống stored XSS
 * (bài viết AI, tiêu đề WP post, draft của user khác...).
 *
 * Cho phép giữ các thẻ/phần tử SEO phổ biến trong nội dung bài viết.
 */
export default function SafeHtml({ html, className, style, as: Tag = "div", sanitizeConfig }) {
  const clean = DOMPurify.sanitize(html || "", {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "loading"],
    ...sanitizeConfig,
  });
  return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: clean }} />;
}
