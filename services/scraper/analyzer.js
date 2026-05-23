const chalk = require("chalk");

/**
 * Analyzer Module - Phân tích nội dung đã cào
 */
class Analyzer {
  /**
   * Phân tích dữ liệu đã cào
   * @param {Object} crawledData - Dữ liệu từ Crawler
   * @returns {Object} Kết quả phân tích
   */
  analyze(crawledData) {
    console.log(chalk.blue("\n📊 Đang phân tích nội dung...\n"));

    const analysis = {
      url: crawledData.url,
      title: crawledData.title,
      metaDescription: crawledData.metaDescription,

      // Phân tích cấu trúc heading
      headingStructure: this._analyzeHeadings(crawledData.headings),

      // Trích xuất key points
      keyPoints: this._extractKeyPoints(
        crawledData.content,
        crawledData.headings,
      ),

      // Phân tích keyword density
      keywordDensity: this._analyzeKeywordDensity(
        crawledData.content,
        crawledData.title,
      ),

      // Gợi ý related keywords
      relatedKeywords: this._findRelatedKeywords(crawledData.content),

      // Stats
      stats: crawledData.stats,

      // Đánh giá chất lượng
      qualityScore: this._calculateQualityScore(crawledData),
    };

    this._printAnalysis(analysis);
    return analysis;
  }

  /**
   * Phân tích cấu trúc heading
   */
  _analyzeHeadings(headings) {
    const structure = {
      h1: [],
      h2: [],
      h3: [],
      outline: [],
    };

    headings.forEach((h) => {
      structure[h.tag] = structure[h.tag] || [];
      structure[h.tag].push(h.text);

      const indent = h.tag === "h1" ? "" : h.tag === "h2" ? "  " : "    ";
      structure.outline.push(`${indent}${h.tag.toUpperCase()}: ${h.text}`);
    });

    return structure;
  }

  /**
   * Trích xuất key points từ nội dung
   */
  _extractKeyPoints(content, headings) {
    const points = [];

    // Lấy câu đầu tiên sau mỗi heading (thường là key point)
    const paragraphs = content.split("\n\n");
    const keyParagraphs = paragraphs.filter(
      (p) => p.length > 50 && p.length < 500,
    );

    // Lấy tối đa 15 key points
    const step = Math.max(1, Math.floor(keyParagraphs.length / 15));
    for (let i = 0; i < keyParagraphs.length && points.length < 15; i += step) {
      const sentence = keyParagraphs[i].split(/[.!?]\s/)[0];
      if (sentence && sentence.length > 30) {
        points.push(sentence.trim().substring(0, 200));
      }
    }

    return points;
  }

  /**
   * Phân tích keyword density
   */
  _analyzeKeywordDensity(content, title) {
    const words = content.toLowerCase().split(/\s+/);
    const totalWords = words.length;

    // Đếm tần suất từ (lọc stop words tiếng Việt)
    const stopWords = new Set([
      "và",
      "hoặc",
      "nhưng",
      "mà",
      "thì",
      "là",
      "của",
      "cho",
      "trong",
      "với",
      "từ",
      "đến",
      "khi",
      "nếu",
      "vì",
      "do",
      "bởi",
      "để",
      "một",
      "các",
      "những",
      "này",
      "đó",
      "có",
      "không",
      "được",
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "as",
      "that",
      "this",
      "it",
      "and",
      "or",
      "but",
      "if",
      "so",
      "be",
      "can",
      "will",
      "has",
      "have",
      "had",
      "do",
      "does",
      "did",
      "not",
      "you",
      "your",
      "we",
      "our",
      "they",
      "their",
      "bạn",
      "chúng",
      "tôi",
      "mình",
      "cũng",
      "rất",
      "nên",
      "bị",
      "lại",
      "đã",
      "sẽ",
      "hay",
      "hơn",
      "nhất",
      "ở",
      "về",
      "theo",
      "ra",
      "lên",
      "vào",
      "đi",
      "còn",
    ]);

    const wordFreq = {};
    words.forEach((word) => {
      if (word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word)) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });

    // Sắp xếp theo tần suất
    const sorted = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({
        word,
        count,
        density: ((count / totalWords) * 100).toFixed(2) + "%",
      }));

    return {
      totalWords,
      topKeywords: sorted,
    };
  }

  /**
   * Tìm related keywords (2-gram, 3-gram)
   */
  _findRelatedKeywords(content) {
    const words = content.toLowerCase().split(/\s+/);
    const ngramFreq = {};

    // 2-grams
    for (let i = 0; i < words.length - 1; i++) {
      const ngram = `${words[i]} ${words[i + 1]}`;
      if (ngram.length > 5) {
        ngramFreq[ngram] = (ngramFreq[ngram] || 0) + 1;
      }
    }

    // 3-grams
    for (let i = 0; i < words.length - 2; i++) {
      const ngram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (ngram.length > 8) {
        ngramFreq[ngram] = (ngramFreq[ngram] || 0) + 1;
      }
    }

    return Object.entries(ngramFreq)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([phrase, count]) => ({ phrase, count }));
  }

  /**
   * Tính điểm chất lượng bài viết
   */
  _calculateQualityScore(data) {
    let score = 0;
    const details = [];

    // Độ dài
    if (data.stats.wordCount >= 2000) {
      score += 25;
      details.push("✅ Bài viết đủ dài (>2000 từ)");
    } else if (data.stats.wordCount >= 1000) {
      score += 15;
      details.push("⚠️ Bài trung bình (1000-2000 từ)");
    } else {
      score += 5;
      details.push("❌ Bài ngắn (<1000 từ)");
    }

    // Headings
    if (data.stats.headingCount >= 5) {
      score += 20;
      details.push("✅ Nhiều heading, cấu trúc tốt");
    } else if (data.stats.headingCount >= 3) {
      score += 10;
      details.push("⚠️ Heading vừa phải");
    } else {
      score += 5;
      details.push("❌ Ít heading");
    }

    // Ảnh
    if (data.stats.imageCount >= 3) {
      score += 20;
      details.push("✅ Nhiều ảnh minh họa");
    } else if (data.stats.imageCount >= 1) {
      score += 10;
      details.push("⚠️ Ít ảnh");
    } else {
      score += 0;
      details.push("❌ Không có ảnh");
    }

    // Meta description
    if (data.metaDescription && data.metaDescription.length > 50) {
      score += 15;
      details.push("✅ Có meta description");
    } else {
      score += 0;
      details.push("❌ Thiếu meta description");
    }

    // Links
    if (data.links && data.links.internal.length >= 3) {
      score += 10;
      details.push("✅ Internal linking tốt");
    } else {
      score += 5;
      details.push("⚠️ Ít internal link");
    }

    // External links
    if (data.links && data.links.external.length >= 1) {
      score += 10;
      details.push("✅ Có external link (tăng uy tín)");
    } else {
      score += 5;
      details.push("⚠️ Không có external link");
    }

    return { score, maxScore: 100, details };
  }

  /**
   * In kết quả phân tích
   */
  _printAnalysis(analysis) {
    console.log(chalk.yellow("═══════════════════════════════════"));
    console.log(chalk.yellow.bold("  📊 KẾT QUẢ PHÂN TÍCH"));
    console.log(chalk.yellow("═══════════════════════════════════"));

    // Quality Score
    const scoreColor =
      analysis.qualityScore.score >= 70
        ? "green"
        : analysis.qualityScore.score >= 40
          ? "yellow"
          : "red";
    console.log(
      chalk[scoreColor](
        `\n⭐ Điểm chất lượng: ${analysis.qualityScore.score}/100`,
      ),
    );
    analysis.qualityScore.details.forEach((d) =>
      console.log(chalk.gray(`   ${d}`)),
    );

    // Heading Outline
    console.log(chalk.cyan("\n📋 Cấu trúc Heading:"));
    analysis.headingStructure.outline.forEach((h) =>
      console.log(chalk.gray(`   ${h}`)),
    );

    // Key Points
    console.log(chalk.cyan(`\n🔑 Key Points (${analysis.keyPoints.length}):`));
    analysis.keyPoints.forEach((p, i) =>
      console.log(chalk.gray(`   ${i + 1}. ${p}`)),
    );

    // Top Keywords
    console.log(chalk.cyan("\n🔤 Top Keywords:"));
    analysis.keywordDensity.topKeywords
      .slice(0, 10)
      .forEach((k) =>
        console.log(chalk.gray(`   ${k.word}: ${k.count}x (${k.density})`)),
      );

    // Related Keywords
    if (analysis.relatedKeywords.length > 0) {
      console.log(chalk.cyan("\n🔗 Related Keywords (2-3 grams):"));
      analysis.relatedKeywords
        .slice(0, 10)
        .forEach((k) =>
          console.log(chalk.gray(`   "${k.phrase}": ${k.count}x`)),
        );
    }

    console.log(chalk.yellow("\n═══════════════════════════════════\n"));
  }

  /**
   * Phân tích và tổng hợp nhiều bài viết
   * @param {Array} crawledDataList - Mảng dữ liệu đã cào
   * @returns {Object} Tổng hợp phân tích
   */
  analyzeBulk(crawledDataList) {
    console.log(
      chalk.blue(`\n📊 Đang phân tích ${crawledDataList.length} bài viết...\n`),
    );

    const analyses = crawledDataList.map((data) => this.analyze(data));

    // Tổng hợp key points từ tất cả bài
    const allKeyPoints = new Set();
    analyses.forEach((a) => a.keyPoints.forEach((p) => allKeyPoints.add(p)));

    // Tổng hợp headings phổ biến
    const headingFreq = {};
    analyses.forEach((a) => {
      a.headingStructure.h2.forEach((h) => {
        const key = h.toLowerCase().trim();
        headingFreq[key] = (headingFreq[key] || 0) + 1;
      });
    });

    // Tổng hợp keywords
    const allKeywords = {};
    analyses.forEach((a) => {
      a.keywordDensity.topKeywords.forEach((k) => {
        allKeywords[k.word] = (allKeywords[k.word] || 0) + k.count;
      });
    });

    const summary = {
      totalArticles: crawledDataList.length,
      avgWordCount: Math.round(
        analyses.reduce((sum, a) => sum + a.stats.wordCount, 0) /
          analyses.length,
      ),
      avgQualityScore: Math.round(
        analyses.reduce((sum, a) => sum + a.qualityScore.score, 0) /
          analyses.length,
      ),

      // Tổng hợp key points (unique, max 20)
      combinedKeyPoints: [...allKeyPoints].slice(0, 20),

      // Heading phổ biến nhất
      commonHeadings: Object.entries(headingFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([heading, count]) => ({ heading, usedBy: count })),

      // Keywords phổ biến nhất
      topKeywordsOverall: Object.entries(allKeywords)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word, count]) => ({ word, totalCount: count })),

      articles: analyses.map((a) => ({
        title: a.title,
        url: a.url,
        wordCount: a.stats.wordCount,
        qualityScore: a.qualityScore.score,
      })),
    };

    // Print summary
    console.log(chalk.magenta.bold("\n🏆 TỔNG HỢP PHÂN TÍCH"));
    console.log(chalk.magenta("═══════════════════════"));
    console.log(chalk.gray(`   📰 Số bài: ${summary.totalArticles}`));
    console.log(chalk.gray(`   📝 Độ dài TB: ${summary.avgWordCount} từ`));
    console.log(chalk.gray(`   ⭐ Điểm TB: ${summary.avgQualityScore}/100`));

    console.log(chalk.cyan("\n📋 Heading phổ biến:"));
    summary.commonHeadings.forEach((h) =>
      console.log(
        chalk.gray(
          `   "${h.heading}" → dùng bởi ${h.usedBy}/${summary.totalArticles} bài`,
        ),
      ),
    );

    return summary;
  }
}

module.exports = Analyzer;
