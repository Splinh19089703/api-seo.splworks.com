/**
 * Content Validator Service
 * Kiểm tra chất lượng bài viết trước khi đăng
 * Port từ travel-blogging-skill/validators.py, mở rộng cho mọi niche
 */

/**
 * Validate HTML content quality
 * @param {string} htmlContent - HTML content to validate
 * @param {string} title - Article title
 * @param {string} contentAngle - Content type/angle (guide, list, review, etc.)
 * @param {object} options - Additional options
 * @returns {object} { passed, score, wordCount, h2Count, imgCount, internalLinks, issues, warnings }
 */
function validateArticle(htmlContent, title, contentAngle = "guide", options = {}) {
  const issues = [];   // Lỗi nghiêm trọng — phải fix
  const warnings = []; // Cảnh báo — nên fix
  let score = 100;

  // Clean HTML tags for word counting
  const cleanText = htmlContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const keyword = options.keyword || ""; // keyword chính để kiểm tra on-page

  // ============================================================
  // 0. KIỂM TRA PLACEHOLDER LỜI (P0.3 — luôn là issue nghiêm trọng)
  // ============================================================
  const errorPlaceholders = [
    /\[Lỗi tạo nội dung/i,
    /\[Lỗi tạo/i,
    /Nội dung đang được cập nhật/i,
    /\[INTERNAL_LINK[^\]]*\]/i,   // Placeholder chưa resolve
    /\[IMG[^\]]*\]/i,
    /\[TODO[^\]]*\]/i,
  ];
  const foundPlaceholders = errorPlaceholders.filter(rx => rx.test(htmlContent));
  if (foundPlaceholders.length > 0) {
    issues.push(`Bài chứa ${foundPlaceholders.length} placeholder lỗi chưa được xử lý (ví dụ: [Lỗi tạo nội dung], [INTERNAL_LINK...])`);
    score -= 25;
  }

  // ============================================================
  // 1. KIỂM TRA ĐỘ DÀI
  // ============================================================
  const wordLimits = {
    basic:      [1200, 2000],
    advanced:   [2000, 4000],
    guide:      [1500, 3500],
    list:       [1500, 3000],
    comparison: [1500, 3000],
    review:     [1200, 2500],
    definition: [800,  1500],
    casestudy:  [1500, 3000],
    warning:    [1000, 2000],
    cost:       [1200, 2500],
  };
  const [minWords, maxWords] = wordLimits[contentAngle] || [1200, 3000];

  if (wordCount < minWords) {
    issues.push(`Bài quá ngắn: ${wordCount} chữ (tối thiểu ${minWords})`);
    score -= 20;
  } else if (wordCount > maxWords * 1.3) {
    warnings.push(`Bài quá dài: ${wordCount} chữ (khuyến nghị tối đa ${maxWords})`);
    score -= 5;
  }

  // ============================================================
  // 2. KIỂM TRA CẤU TRÚC HEADING
  // ============================================================
  const h2Count = (htmlContent.match(/<h2[\s>]/gi) || []).length;
  const h3Count = (htmlContent.match(/<h3[\s>]/gi) || []).length;

  if (h2Count < 3) {
    issues.push(`Thiếu heading H2: chỉ có ${h2Count} (cần ít nhất 3)`);
    score -= 15;
  } else if (h2Count < 5 && wordCount > 2000) {
    warnings.push(`Ít heading H2: ${h2Count} cho bài ${wordCount} chữ (nên có 5+)`);
    score -= 5;
  }

  // Check for H1 in content (should only be in title)
  const h1Count = (htmlContent.match(/<h1[\s>]/gi) || []).length;
  if (h1Count > 0) {
    warnings.push(`Có ${h1Count} thẻ H1 trong bài — H1 chỉ nên dùng cho title`);
    score -= 5;
  }

  // ============================================================
  // 3. KIỂM TRA KEYWORD TRONG BI (P1.1)
  // ============================================================
  if (keyword && keyword.length > 2) {
    const kwLower = keyword.toLowerCase();
    // Keyword trong title
    if (title && !title.toLowerCase().includes(kwLower)) {
      warnings.push(`Keyword "${keyword}" chưa xuất hiện trong tiêu đề bài`);
      score -= 5;
    }
    // Keyword trong 100 từ đầu
    const first100 = cleanText.split(/\s+/).slice(0, 100).join(" ").toLowerCase();
    if (!first100.includes(kwLower)) {
      warnings.push(`Keyword "${keyword}" chưa xuất hiện trong 100 từ đầu — ảnh hưởng SEO on-page`);
      score -= 8;
    }
  }

  // ============================================================
  // 4. KIỂM TRA TỪ CẤM / SÁO RỖNG
  // ============================================================
  const bannedWords = [
    // Từ sáo rỗng tiếng Việt (general)
    "thiên đường", "tuyệt vời không thể tả", "không thể bỏ qua",
    "check-in sống ảo", "cực kỳ ấn tượng", "vô cùng thú vị",
    "trải nghiệm đáng nhớ", "không thể quên", "must-have",
    "đừng bỏ lỡ", "đẳng cấp", "vô cùng ấn tượng",
    "đẹp đến mê hồn", "hút hồn", "tuyệt vời",
    // Spam marketing
    "click ngay", "mua ngay hôm nay", "giảm giá sốc",
    "siêu rẻ", "FREE 100%", "đảm bảo 100%",
  ];

  const foundBanned = [];
  const textLower = cleanText.toLowerCase();
  for (const word of bannedWords) {
    if (textLower.includes(word.toLowerCase())) {
      foundBanned.push(word);
    }
  }

  if (foundBanned.length > 0) {
    warnings.push(`Có từ sáo rỗng/spam: ${foundBanned.join(", ")}`);
    score -= Math.min(foundBanned.length * 3, 15);
  }

  // ============================================================
  // 4. KIỂM TRA ẢNH
  // ============================================================
  const imgCount = (htmlContent.match(/<img[\s>]/gi) || []).length;
  const imgsWithoutAlt = (htmlContent.match(/<img(?![^>]*alt=)[^>]*>/gi) || []).length;

  if (imgCount < 1 && wordCount > 1000) {
    warnings.push("Chưa có ảnh nào trong bài — nên có ít nhất 1 ảnh minh họa");
    score -= 10;
  }

  if (imgsWithoutAlt > 0) {
    warnings.push(`${imgsWithoutAlt} ảnh thiếu alt text — ảnh hưởng SEO`);
    score -= 5;
  }

  // ============================================================
  // 5. KIỂM TRA SEO CƠ BẢN + INTRO TRƯỚC H2 (P1.1)
  // ============================================================
  // Title length
  if (title.length < 30) {
    warnings.push(`Tiêu đề quá ngắn: ${title.length} ký tự (khuyến nghị 30-65)`);
    score -= 5;
  } else if (title.length > 65) {
    warnings.push(`Tiêu đề quá dài: ${title.length} ký tự (khuyến nghị tối đa 65)`);
    score -= 3;
  }

  // Kiểm tra có phần intro trước H2 đầu tiên không
  const h2FirstIdx = htmlContent.search(/<h2[\s>]/i);
  const beforeH2 = h2FirstIdx > 0 ? htmlContent.substring(0, h2FirstIdx) : "";
  const introParas = (beforeH2.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []);
  const introTextLength = introParas.map(p => p.replace(/<[^>]+>/g, "").trim()).join(" ").length;

  if (h2FirstIdx > 0 && introParas.length === 0) {
    issues.push("Thiếu phần mở bài trước H2 đầu tiên — intro là nơi chứa keyword và hook người đọc");
    score -= 15;
  } else if (introTextLength < 100 && introParas.length > 0) {
    warnings.push("Phần mở bài quá ngắn (<100 ký tự) — nên có ít nhất 150 ký tự để hook người đọc");
    score -= 5;
  }

  // ============================================================
  // 6. KIỂM TRA ĐỊNH DẠNG — Đoạn quá dài
  // ============================================================
  const paragraphs = htmlContent.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  const longParas = [];
  paragraphs.forEach((para, i) => {
    const paraText = para.replace(/<[^>]+>/g, "");
    const paraWords = paraText.split(/\s+/).filter(Boolean).length;
    if (paraWords > 100) {
      longParas.push(i + 1);
    }
  });

  if (longParas.length > 0) {
    const displayParas = longParas.slice(0, 3).join(", ");
    warnings.push(`Đoạn ${displayParas} quá dài (>100 từ) — nên chia nhỏ cho dễ đọc mobile`);
    score -= 3;
  }

  // ============================================================
  // 7. KIỂM TRA INTERNAL LINKS
  // ============================================================
  const hrefMatches = htmlContent.match(/href=["'][^"']*["']/gi) || [];
  // Chỉ đếm href thật (không đếm placeholder [INTERNAL_LINK] đã bị bắt ở trên)
  const internalLinkCount = hrefMatches.filter((h) => {
    const href = (h.match(/href=["']([^"']+)["']/i) || [])[1] || "";
    return href.startsWith("/") || href.startsWith("#") || !/^https?:\/\//i.test(href);
  }).length;
  // Placeholder chưa resolve (đã được detect ở section 0, chỉ count để report)
  const remainingPlaceholders = (htmlContent.match(/\[INTERNAL_LINK[^\]]*\]/gi) || []).length;
  const totalInternalLinks = internalLinkCount; // Không cộng placeholder vào

  if (totalInternalLinks < 1 && wordCount > 1000) {
    warnings.push("Thiếu internal link thật — nên thêm ít nhất 1-2 link liên quan");
    score -= 5;
  }

  // ============================================================
  // 8. KIỂM TRA DANH SÁCH & FORMATTING
  // ============================================================
  const listCount = (htmlContent.match(/<(ul|ol)[\s>]/gi) || []).length;
  const strongCount = (htmlContent.match(/<strong[\s>]/gi) || []).length;
  const blockquoteCount = (htmlContent.match(/<blockquote[\s>]/gi) || []).length;

  if (listCount < 1 && wordCount > 1500) {
    warnings.push("Chưa có danh sách <ul>/<ol> — nên dùng list để dễ scan");
    score -= 3;
  }

  if (strongCount < 3 && wordCount > 1000) {
    warnings.push("Ít thẻ <strong> — nên bold các thông tin quan trọng");
    score -= 2;
  }

  // ============================================================
  // KẾT QUẢ
  // ============================================================
  score = Math.max(0, Math.min(100, score));
  // P1.1: Nâng ngưỡng pass lên 75 (từ 60)
  const passed = issues.length === 0 && score >= 75;

  return {
    passed,
    score,
    wordCount,
    h2Count,
    h3Count,
    imgCount,
    internalLinks: totalInternalLinks,
    listCount,
    strongCount,
    blockquoteCount,
    issues,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Format validation result as text report
 */
function formatReport(result) {
  const lines = [];
  lines.push("══════════════════════════════════════════");
  lines.push("  KIỂM TRA CHẤT LƯỢNG BÀI VIẾT");
  lines.push("══════════════════════════════════════════");
  lines.push(`  Điểm số    : ${result.score}/100`);
  lines.push(`  Kết quả    : ${result.passed ? "✅ ĐẠT" : "❌ CHƯA ĐẠT"}`);
  lines.push(`  Số chữ     : ${result.wordCount}`);
  lines.push(`  Heading H2 : ${result.h2Count}`);
  lines.push(`  Ảnh        : ${result.imgCount}`);
  lines.push(`  Links      : ${result.internalLinks}`);

  if (result.issues.length > 0) {
    lines.push("\n  ❌ LỖI CẦN FIX:");
    result.issues.forEach(issue => lines.push(`     • ${issue}`));
  }

  if (result.warnings.length > 0) {
    lines.push("\n  ⚠️  CẢNH BÁO:");
    result.warnings.forEach(warning => lines.push(`     • ${warning}`));
  }

  lines.push("══════════════════════════════════════════");
  return lines.join("\n");
}

module.exports = { validateArticle, formatReport };
