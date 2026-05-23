/**
 * parseHtmlSections.js
 * Parse HTML article content thành danh sách sections theo H2 headings.
 * Dùng cho Section Rewrite feature (T13/F3).
 *
 * @param {string} html - HTML content của bài viết
 * @returns {Array<{index, heading, tag, contentSnippet, wordCount}>}
 */
export function parseHtmlSections(html) {
  if (!html) return [];

  // Split bởi <h2> tags — giữ lại heading trong mỗi phần
  const parts = html.split(/(?=<h2[\s>])/i);
  const sections = [];

  parts.forEach((part, i) => {
    if (!part.trim()) return;

    // Extract heading text từ <h2>...</h2>
    const headingMatch = part.match(/<h2[^>]*>(.*?)<\/h2>/i);
    // Với intro (không có h2): lấy vài chữ đầu của nội dung làm label
    const heading = headingMatch
      ? headingMatch[1].replace(/<[^>]*>/g, "").trim()
      : null; // null = intro, sẽ dùng snippet làm label trong UI

    // Strip HTML để đếm words
    const plainText = part.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;

    // Snippet đầu tiên (không tính heading)
    const afterHeading = headingMatch
      ? part.slice(headingMatch.index + headingMatch[0].length)
      : part;
    const snippet = afterHeading
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    sections.push({
      index: sections.length,
      heading,
      tag: headingMatch ? "h2" : "intro",
      html: part,          // Full HTML của section này
      contentSnippet: snippet,
      wordCount,
    });
  });

  return sections;
}

/**
 * Ghép lại HTML từ mảng sections sau khi đã rewrite một số sections.
 * @param {Array<{html: string}>} sections
 * @returns {string} Full HTML
 */
export function mergeSections(sections) {
  return sections.map(s => s.html).join("");
}

/**
 * Thay thế HTML của một section cụ thể trong mảng sections.
 * @param {Array} sections
 * @param {number} index
 * @param {string} newHtml
 * @returns {Array}
 */
export function replaceSectionHtml(sections, index, newHtml) {
  return sections.map((s, i) => (i === index ? { ...s, html: newHtml } : s));
}
