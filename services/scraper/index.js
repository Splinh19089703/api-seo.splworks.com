#!/usr/bin/env node

const { program } = require("commander");
const chalk = require("chalk");
const fs = require("fs-extra");
const path = require("path");

const Crawler = require("./crawler");
const Analyzer = require("./analyzer");
const PromptGenerator = require("./prompt-generator");
const BulkCrawler = require("./bulk-crawler");
const SiteCrawler = require("./site-crawler");

const crawler = new Crawler();
const analyzer = new Analyzer();
const promptGen = new PromptGenerator();
const bulkCrawler = new BulkCrawler();
const siteCrawler = new SiteCrawler();

// Banner
console.log(
  chalk.cyan.bold(`
╔═══════════════════════════════════════════════╗
║   🕷️  Niche Content Scraper & Rewriter v2.0  ║
║   Cào bài viết → Phân tích → Tạo prompt AI   ║
╚═══════════════════════════════════════════════╝
`),
);

program
  .name("niche-scraper")
  .description("Tool cào bài viết, phân tích, và tạo prompt rewrite cho AI")
  .version("2.0.0");

// ===== COMMAND: crawl =====
program
  .command("crawl <url>")
  .description("Cào nội dung từ một URL bài viết")
  .option("-o, --output <dir>", "Thư mục lưu output", "./output")
  .option("--no-save", "Không lưu file, chỉ hiển thị")
  .action(async (url, options) => {
    try {
      const data = await crawler.crawl(url);
      if (!data) return;

      // Phân tích
      const analysis = analyzer.analyze(data);

      // Lưu
      if (options.save !== false) {
        const crawlPath = await crawler.save(data, options.output);

        // Lưu analysis
        const analysisDir = path.join(options.output, "analysis");
        await fs.ensureDir(analysisDir);
        const analysisPath = path.join(analysisDir, path.basename(crawlPath));
        await fs.writeJson(analysisPath, analysis, { spaces: 2 });
        console.log(chalk.green(`📊 Đã lưu analysis: ${analysisPath}`));
      }
    } catch (error) {
      console.error(chalk.red(`\n❌ Lỗi: ${error.message}`));
    }
  });

// ===== COMMAND: site (MỚI) =====
program
  .command("site <domain-or-url>")
  .description(
    "Cào bài viết từ domain hoặc URL danh mục (tự tìm sitemap/category/RSS)",
  )
  .option("-n, --max <number>", "Số bài cào tối đa", "5")
  .option("-d, --discover <number>", "Số URL tìm tối đa", "20")
  .option("-o, --output <dir>", "Thư mục lưu output", "./output")
  .option("-k, --keyword <keyword>", "Keyword chính (dùng cho prompt)")
  .option("--prompt", "Tự động tạo prompt Skyscraper sau khi cào")
  .option("--list-only", "Chỉ liệt kê URLs, không cào nội dung")
  .action(async (input, options) => {
    try {
      const maxCrawl = parseInt(options.max);
      const maxDiscover = parseInt(options.discover);

      if (options.listOnly) {
        // Chỉ liệt kê URLs
        await siteCrawler.discoverUrls(input, { maxUrls: maxDiscover });
        return;
      }

      const results = await siteCrawler.crawlSite(input, {
        maxUrls: maxDiscover,
        maxCrawl: maxCrawl,
      });

      if (results.length === 0) {
        console.log(chalk.yellow("⚠️ Không cào được bài nào."));
        return;
      }

      // Tạo thư mục output theo domain
      const domainSlug = slugify(
        input.replace(/https?:\/\//, "").split("/")[0],
      );
      const siteDir = path.join(options.output, "sites", domainSlug);
      await fs.ensureDir(siteDir);

      // Lưu từng bài
      for (const data of results) {
        await crawler.save(data, siteDir);
      }

      // Phân tích tổng hợp
      const bulkAnalysis = analyzer.analyzeBulk(results);
      const analysisPath = path.join(siteDir, "_site-analysis.json");
      await fs.writeJson(analysisPath, bulkAnalysis, { spaces: 2 });
      console.log(chalk.green(`📊 Đã lưu tổng hợp: ${analysisPath}`));

      // Tạo prompt nếu có flag
      if (options.prompt) {
        const keyword =
          options.keyword || input.replace(/https?:\/\//, "").split("/")[0];
        const prompt = promptGen.generateSkyscraperPrompt(bulkAnalysis, {
          keyword,
        });
        await promptGen.savePrompt(
          prompt,
          `site-${domainSlug}`,
          path.join(options.output, "prompts"),
        );
      }

      // Hiện hướng dẫn tiếp theo
      console.log(chalk.cyan("\n━━━━━ BƯỚC TIẾP THEO ━━━━━"));
      console.log(chalk.gray(`  1. Tạo prompt rewrite cho từng bài:`));
      console.log(
        chalk.white(
          `     node src/index.js rewrite "${siteDir}/<file>.json" -k "<keyword>"`,
        ),
      );
      if (!options.prompt) {
        console.log(chalk.gray(`  2. Hoặc tạo prompt Skyscraper tổng hợp:`));
        console.log(
          chalk.white(
            `     node src/index.js rewrite "${analysisPath}" -k "<keyword>"`,
          ),
        );
      }
      console.log("");
    } catch (error) {
      console.error(chalk.red(`\n❌ Lỗi: ${error.message}`));
    }
  });

// ===== COMMAND: bulk =====
program
  .command("bulk <keyword>")
  .description(
    "Cào hàng loạt bài viết theo keyword (tìm trên Google/DuckDuckGo)",
  )
  .option("-n, --max <number>", "Số bài tối đa", "5")
  .option("-o, --output <dir>", "Thư mục lưu output", "./output")
  .option("--prompt", "Tự động tạo prompt Skyscraper sau khi cào")
  .action(async (keyword, options) => {
    try {
      const maxResults = parseInt(options.max);
      const results = await bulkCrawler.crawlByKeyword(keyword, maxResults);

      if (results.length === 0) {
        console.log(chalk.yellow("⚠️ Không cào được bài nào từ tìm kiếm."));
        console.log(
          chalk.cyan("\n💡 Thử dùng lệnh 'site' để cào trực tiếp từ domain:"),
        );
        console.log(chalk.white(`   node src/index.js site "domain.com"`));
        console.log(
          chalk.white(
            `   node src/index.js site "domain.com/category/ten-danh-muc/"`,
          ),
        );
        return;
      }

      // Lưu kết quả cào
      const bulkDir = path.join(options.output, "bulk", slugify(keyword));
      await fs.ensureDir(bulkDir);

      for (const data of results) {
        await crawler.save(data, bulkDir);
      }

      // Phân tích tổng hợp
      const bulkAnalysis = analyzer.analyzeBulk(results);

      // Lưu analysis
      const analysisPath = path.join(bulkDir, "_bulk-analysis.json");
      await fs.writeJson(analysisPath, bulkAnalysis, { spaces: 2 });
      console.log(chalk.green(`📊 Đã lưu tổng hợp: ${analysisPath}`));

      // Tạo prompt nếu có flag --prompt
      if (options.prompt) {
        const prompt = promptGen.generateSkyscraperPrompt(bulkAnalysis, {
          keyword,
        });
        await promptGen.savePrompt(
          prompt,
          `skyscraper-${slugify(keyword)}`,
          path.join(options.output, "prompts"),
        );
      }
    } catch (error) {
      console.error(chalk.red(`\n❌ Lỗi: ${error.message}`));
    }
  });

// ===== COMMAND: rewrite =====
program
  .command("rewrite <file>")
  .description("Tạo prompt rewrite từ file JSON đã cào")
  .option("-k, --keyword <keyword>", "Keyword chính")
  .option(
    "-t, --type <type>",
    "Loại bài: tutorial, review, comparison, listicle",
    "tutorial",
  )
  .option("-o, --output <dir>", "Thư mục lưu prompt", "./output/prompts")
  .action(async (file, options) => {
    try {
      if (!(await fs.pathExists(file))) {
        console.error(chalk.red(`❌ File không tồn tại: ${file}`));
        return;
      }

      const data = await fs.readJson(file);

      // Phân tích nếu chưa có
      const analysis = data.keyPoints ? data : analyzer.analyze(data);

      // Tạo prompt
      const prompt = promptGen.generateRewritePrompt(analysis, {
        keyword: options.keyword || "",
        articleType: options.type,
      });

      // Hiển thị prompt
      console.log(chalk.cyan("\n" + "═".repeat(50)));
      console.log(chalk.cyan.bold("  📝 PROMPT ĐÃ TẠO"));
      console.log(chalk.cyan("═".repeat(50)));
      console.log(prompt);

      // Lưu prompt
      const name = path.basename(file, ".json");
      await promptGen.savePrompt(prompt, `rewrite-${name}`, options.output);
    } catch (error) {
      console.error(chalk.red(`\n❌ Lỗi: ${error.message}`));
    }
  });

// ===== COMMAND: urls =====
program
  .command("urls <file>")
  .description("Cào hàng loạt từ file danh sách URLs (mỗi URL 1 dòng)")
  .option("-o, --output <dir>", "Thư mục lưu output", "./output")
  .option("--prompt", "Tự động tạo prompt Skyscraper")
  .option("-k, --keyword <keyword>", "Keyword chính (dùng cho prompt)")
  .action(async (file, options) => {
    try {
      const results = await bulkCrawler.crawlFromFile(file);

      if (results.length === 0) {
        console.log(chalk.yellow("⚠️ Không cào được bài nào."));
        return;
      }

      // Lưu
      const dir = path.join(options.output, "from-urls");
      await fs.ensureDir(dir);
      for (const data of results) {
        await crawler.save(data, dir);
      }

      // Phân tích tổng hợp
      const bulkAnalysis = analyzer.analyzeBulk(results);
      const analysisPath = path.join(dir, "_bulk-analysis.json");
      await fs.writeJson(analysisPath, bulkAnalysis, { spaces: 2 });

      // Tạo prompt nếu có flag
      if (options.prompt && options.keyword) {
        const prompt = promptGen.generateSkyscraperPrompt(bulkAnalysis, {
          keyword: options.keyword,
        });
        await promptGen.savePrompt(
          prompt,
          `skyscraper-urls`,
          path.join(options.output, "prompts"),
        );
      }
    } catch (error) {
      console.error(chalk.red(`\n❌ Lỗi: ${error.message}`));
    }
  });

// Helper
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a")
    .replace(/[èéẹẻẽêềếệểễ]/g, "e")
    .replace(/[ìíịỉĩ]/g, "i")
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, "o")
    .replace(/[ùúụủũưừứựửữ]/g, "u")
    .replace(/[ỳýỵỷỹ]/g, "y")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

program.parse();
