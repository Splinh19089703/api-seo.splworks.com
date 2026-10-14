const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk");

/**
 * Prompt Generator Module - Tạo prompt rewrite từ dữ liệu đã phân tích
 */
class PromptGenerator {
  /**
   * Tạo prompt rewrite từ một bài viết đã phân tích
   * @param {Object} analysis - Kết quả từ Analyzer
   * @param {Object} options - Tùy chọn
   * @returns {string} Prompt text
   */
  generateRewritePrompt(analysis, options = {}) {
    const {
      keyword = "",
      secondaryKeywords = [],
      articleType = "tutorial", // tutorial, review, comparison, listicle
      minWords = 2000,
    } = options;

    const mainKeyword = keyword || this._guessKeyword(analysis);

    let prompt = `Bạn là một chuyên gia WordPress với 10 năm kinh nghiệm, viết blog tiếng Việt chuyên nghiệp.

📌 NHIỆM VỤ: Viết bài viết HOÀN TOÀN MỚI dựa trên outline và thông tin nghiên cứu bên dưới.
⚠️ QUAN TRỌNG: KHÔNG copy bất kỳ câu nào. Viết 100% câu chữ mới, cấu trúc mới.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 KEYWORD CHÍNH: ${mainKeyword}
${secondaryKeywords.length > 0 ? `🔗 KEYWORD PHỤ: ${secondaryKeywords.join(", ")}` : ""}
📝 LOẠI BÀI: ${this._getArticleTypeName(articleType)}
📏 ĐỘ DÀI TỐI THIỂU: ${minWords} từ

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 OUTLINE ĐỀ XUẤT (hãy thay đổi thứ tự và thêm mục mới):
`;

    // Thêm heading outline
    if (analysis.headingStructure) {
      analysis.headingStructure.outline.forEach((h) => {
        prompt += `${h}\n`;
      });
    }

    prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 KEY POINTS CẦN COVER (viết lại bằng cách diễn đạt riêng):
`;

    // Thêm key points
    if (analysis.keyPoints) {
      analysis.keyPoints.forEach((point, i) => {
        prompt += `${i + 1}. ${point}\n`;
      });
    }

    prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 KEYWORDS LIÊN QUAN (dùng tự nhiên trong bài):
`;

    // Thêm related keywords
    if (analysis.relatedKeywords) {
      analysis.relatedKeywords.slice(0, 10).forEach((k) => {
        prompt += `- "${k.phrase}" (${k.count}x)\n`;
      });
    }

    prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ YÊU CẦU BẮT BUỘC:
1. Viết Title Tag (tối đa 60 ký tự, chứa keyword chính)
2. Viết Meta Description (tối đa 160 ký tự, hấp dẫn, có CTA)
3. Keyword chính xuất hiện trong 100 từ đầu
4. Cấu trúc: H2 → H3, logic rõ ràng
5. Thêm ít nhất 3 điểm MỚI không có trong outline trên
6. Thêm kinh nghiệm cá nhân / ý kiến riêng
7. Đặt [IMG: mô tả ảnh] nơi nên chèn ảnh minh họa
8. Cuối bài: Kết luận + CTA
9. Cuối bài: FAQ 5 câu (format Q&A)
10. Gợi ý 3 bài nên internal link đến

🎭 TONE: Cố vấn giải pháp chiến lược cấp cao chuẩn doanh nghiệp B2B, chuyên sâu, khách quan, đáng tin cậy. TUYỆT ĐỐI KHÔNG dùng tiếng lóng, khẩu ngữ suồng sã, từ ngữ đường phố hay văn nói đời thường (như "ngậm ngùi", "mất trắng", "thợ code", "không ai nghe máy", "bàn thờ", "cắt cổ", "dỏm", "chém giá", "chậm như rùa", "giữ con tấm", "rẻ giật mình", "slide ảnh bay lượn"...). Dùng từ ngữ doanh nghiệp trang trọng, lập luận sắc bén bằng số liệu và giải pháp kỹ thuật.
Viết câu rõ ràng, mạch lạc, dễ scan. Dùng bullet points và bảng khi phù hợp.
`;

    return prompt;
  }

  /**
   * Tạo prompt Skyscraper từ nhiều bài đã phân tích
   * @param {Object} bulkAnalysis - Kết quả từ Analyzer.analyzeBulk()
   * @param {Object} options - Tùy chọn
   * @returns {string} Prompt text
   */
  generateSkyscraperPrompt(bulkAnalysis, options = {}) {
    const { keyword = "", minWords = 3000 } = options;

    let prompt = `Bạn là chuyên gia WordPress #1 Việt Nam. Viết bài VƯỢT TRỘI tất cả ${bulkAnalysis.totalArticles} bài top Google.

📌 NHIỆM VỤ: Viết bài TỐT NHẤT trên internet về topic này
⚠️ 100% nội dung mới, cấu trúc mới, góc nhìn mới

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 KEYWORD: ${keyword}
📏 ĐỘ DÀI: ${minWords}+ từ
📊 ĐÃ PHÂN TÍCH: ${bulkAnalysis.totalArticles} bài | TB ${bulkAnalysis.avgWordCount} từ | Điểm TB ${bulkAnalysis.avgQualityScore}/100

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📰 CÁC BÀI ĐÃ NGHIÊN CỨU:
`;

    bulkAnalysis.articles.forEach((a, i) => {
      prompt += `${i + 1}. "${a.title}" (${a.wordCount} từ, điểm: ${a.qualityScore})\n`;
    });

    prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 HEADINGS PHỔ BIẾN (cover tất cả + thêm mục mới):
`;

    bulkAnalysis.commonHeadings.forEach((h) => {
      prompt += `- "${h.heading}" (${h.usedBy}/${bulkAnalysis.totalArticles} bài dùng)\n`;
    });

    prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 TỔNG HỢP KEY POINTS TỪ TẤT CẢ BÀI:
`;

    bulkAnalysis.combinedKeyPoints.forEach((p, i) => {
      prompt += `${i + 1}. ${p}\n`;
    });

    prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏆 CHIẾN LƯỢC SKYSCRAPER — BÀI CỦA BẠN PHẢI:
1. Cover TẤT CẢ key points trên
2. Thêm ít nhất 5 điểm mới KHÔNG bài nào có
3. Chi tiết hơn, nhiều ví dụ thực tế hơn
4. Cập nhật nhất (2026)
5. Cấu trúc dễ đọc nhất (heading, bảng, bullet points)
6. Step-by-step khi cần, có ảnh placeholder [IMG: mô tả]
7. FAQ 7 câu ở cuối
8. Title Tag + Meta Description chuẩn SEO
9. Gợi ý 5 internal links

🎭 TONE: Cố vấn công nghệ chiến lược cấp cao, văn phong doanh nghiệp B2B chuẩn mực, đáng tin cậy và có kinh nghiệm thực chiến sâu sắc. TUYỆT ĐỐI KHÔNG dùng tiếng lóng, khẩu ngữ suồng sã, từ ngữ đường phố hay văn nói đời thường (như "ngậm ngùi", "mất trắng", "thợ code", "không ai nghe máy", "bàn thờ", "cắt cổ", "dỏm", "chém giá", "chậm như rùa", "giữ con tấm", "rẻ giật mình", "slide ảnh bay lượn"...). Dùng từ ngữ trang nhã, chính xác, lập luận bằng giải pháp kỹ thuật và số liệu chuẩn xác.
`;

    return prompt;
  }

  /**
   * Lưu prompt ra file
   */
  async savePrompt(prompt, name, outputDir = "./output/prompts") {
    await fs.ensureDir(outputDir);
    const filename = `${name}-${Date.now()}.md`;
    const filepath = path.join(outputDir, filename);

    const content = `# 🤖 AI Rewrite Prompt\n\n> Tạo lúc: ${new Date().toLocaleString("vi-VN")}\n> Copy prompt bên dưới → paste vào ChatGPT/Claude\n\n---\n\n${prompt}`;

    await fs.writeFile(filepath, content, "utf-8");
    console.log(chalk.green(`\n📝 Đã lưu prompt: ${filepath}`));
    return filepath;
  }

  _getArticleTypeName(type) {
    const types = {
      tutorial: "Bài hướng dẫn (Tutorial)",
      review: "Bài review sản phẩm",
      comparison: "Bài so sánh (A vs B)",
      listicle: "Bài tổng hợp (Top N)",
    };
    return types[type] || type;
  }

  _guessKeyword(analysis) {
    if (
      analysis.keywordDensity &&
      analysis.keywordDensity.topKeywords.length > 0
    ) {
      return analysis.keywordDensity.topKeywords[0].word;
    }
    return analysis.title || "wordpress";
  }
}

module.exports = PromptGenerator;
