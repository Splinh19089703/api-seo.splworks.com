const axios = require("axios");
const imageStore = require('./image-store');
const crypto = require('crypto');
const storage = require('./storage');

class AiService {
  constructor() {
    this.providers = {};
    this.cooldowns = {};
    this.lastUsedKeyIndexes = {};

    // Tự động dọn dẹp cache hết hạn sau mỗi 10 phút
    setInterval(async () => {
      try {
        const expiredCount = await storage.clearExpiredCache();
        if (expiredCount > 0) {
          console.log(`[AI-Cache] Tự động dọn dẹp ${expiredCount} cache đã hết hạn.`);
        }
      } catch (err) {
        console.error("[AI-Cache] Lỗi tự động dọn dẹp cache:", err.message);
      }
    }, 10 * 60 * 1000);
  }

  /**
   * Build a date/time context block to prepend to all prompts.
   * This ensures AI always uses the current year (2026) in generated content,
   * instead of defaulting to its training cutoff year (2024).
   */
  _buildDateContext() {
    const now = new Date();
    const dateStr = now.toLocaleDateString("vi-VN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    return `[BỐI CẢNH THỜI GIAN - BẮT BUỘC TUÂN THỦ]
• Hôm nay: ${dateStr}
• Năm hiện tại: ${year} | Tháng hiện tại: ${month}/${year}
• MỌI số liệu, thống kê, xu hướng, công cụ → phải thuộc năm ${year} hoặc gần nhất
• TUYỆT ĐỐI không viết "năm 2024" hay năm cũ hơn trừ khi đề cập sự kiện lịch sử
• Các con số thị trường, tỉ lệ, báo cáo → phải cập nhật đến ${year}
[/BỐI CẢNH]\n\n`;
  }

  /**
   * Build a corporate tone & language standard context block to prepend to prompts.
   * Enforces professional enterprise tone and strictly forbids street slang / colloquialisms.
   */
  _buildCorporateToneContext(prompt = "", options = {}) {
    if (options.skipTone) return "";
    // If prompt is purely an English instruction to generate image prompt, tone rule isn't needed
    if (/image prompt/i.test(prompt.substring(0, 100))) {
      return "";
    }

    return `[QUY CHUẨN VĂN PHONG DOANH NGHIỆP B2B - BẮT BUỘC TUÂN THỦ]
• TƯ THẾ & VĂN PHONG:
  - Cố vấn giải pháp công nghệ & chiến lược số cấp cao (Enterprise Consulting).
  - Ngôn từ chuẩn mực, trang trọng, khách quan, điềm tĩnh, lập luận dựa trên số liệu kỹ thuật, tiêu chuẩn ngành và giải pháp thực tế.
  - TUYỆT ĐỐI KHÔNG dùng văn phong kể chuyện đời thường, khẩu ngữ dân dã, giật tít câu view mạng xã hội hay lối viết cảm tính.

• ❌ DANH SÁCH TỪ NGỮ ĐỜI THƯỜNG / KHẨU NGỮ BỊ CẤM TUYỆT ĐỐI:
  - Cấm tiếng lóng / đường phố: "tốc độ bàn thờ", "cắt cổ", "chém giá", "dỏm", "ngậm đắng nuốt cay", "chậm như rùa", "giữ con tấm", "nói bừa", "bốc phét", "vớ vẩn", "toát mồ hôi hột", "rẻ giật mình"...
  - Cấm văn nói / cảm tính: "ngậm ngùi", "mất trắng", "thợ code", "không ai nghe máy", "chữ nhảy lộn xộn", "vỡ khung", "đỏ rực", "slide ảnh bay lượn", "cài cắm mã độc ngầm", "kê giá phát sinh", "bóc tách chi phí", "móc hầu bao", "tiền mất tật mang", "được ăn cả ngã về không", "ôm hận", "đau đầu"...
  - Cấm từ ngữ quảng cáo sáo rỗng: "cỗ máy kiếm tiền tự động", "thần dược", "bứt phá thần tốc vô đối"...

• ✅ QUY TẮC THAY THẾ CHUẨN MỰC DOANH NGHIỆP:
  - "ngậm ngùi", "mất trắng" → "buộc phải chi trả các khoản phát sinh ngoài kế hoạch", "đối mặt nguy cơ gián đoạn hoạt động và mất mát dữ liệu"
  - "thợ code giá rẻ" → "các đơn vị cung cấp dịch vụ giá rẻ kém chất lượng", "đội ngũ kỹ thuật thiếu kinh nghiệm"
  - "không ai nghe máy" → "thiếu cam kết chất lượng dịch vụ (SLA) và không có quy trình hỗ trợ kỹ thuật sau bàn giao"
  - "rẻ giật mình" → "mức giá thấp bất thường so với tiêu chuẩn ngành"
  - "chữ nhảy lộn xộn", "vỡ khung" → "sai lệch bố cục Responsive trên các thiết bị di động"
  - "đỏ rực" → "chỉ số hiệu năng kiểm thử không đạt tiêu chuẩn kỹ thuật của Google"
  - "slide ảnh bay lượn" → "lạm dụng các hiệu ứng hoạt họa (animation) phức tạp"
  - "cài cắm mã độc ngầm" → "tiềm ẩn nguy cơ tồn tại mã độc và lỗ hổng bảo mật nghiêm trọng"
  - "kê giá phát sinh" → "tính thêm phụ phí dịch vụ ngoài hợp đồng ban đầu"
  - "tốc độ bàn thờ" → "tốc độ vượt trội", "tối ưu hóa thời gian phản hồi"
  - "cắt cổ", "chém giá" → "chi phí quá cao", "chi phí đắt đỏ ngoài dự toán"
  - "dỏm" → "kém chất lượng", "không đạt tiêu chuẩn"
  - "chậm như rùa" → "tốc độ tải trang chậm", "độ trễ cao", "hiệu năng kém"
  - "giữ con tấm" → "giữ mã nguồn", "khóa quyền truy cập hệ thống"

• TIẾNG VIỆT: Luôn dùng tiếng Việt chuẩn mực ngữ pháp, đầy đủ dấu, cấu trúc câu rõ ràng, mạch lạc, dễ scan.
[/QUY CHUẨN VĂN PHONG]\n\n`;
  }

  /**
   * Anti-AI footprint rules, adapted from Wikipedia:Signs of AI writing.
   * Full rulebook: ROADMAP/projects/webtong/ANTI_AI_WRITING_RULES.md
   */
  _buildAntiAiFootprintContext(prompt = "", options = {}) {
    if (options.skipTone || options.skipAntiAi) return "";
    if (/image prompt/i.test(prompt.substring(0, 100))) {
      return "";
    }

    return `[QUY TẮC CHỐNG DẤU VẾT AI - ÁP DỤNG KHI VIẾT VĂN BẢN CHO NGƯỜI ĐỌC]
• CỤ THỂ THAY VÌ KHOA TRƯƠNG: thay tính từ bằng số đo, tên công nghệ, thời gian, chi phí. Nếu bỏ tính từ mà câu không còn thông tin thì xóa câu.
• KHÔNG BỊA: số liệu, nghiên cứu, bằng sáng chế, chuyên gia, giải thưởng. Không có nguồn trong dữ liệu đầu vào thì không viết con số. Không dùng "theo các chuyên gia", "nhiều nghiên cứu cho thấy".
• HẠN CHẾ TỐI ĐA (mỗi cụm ≤ 1 lần/bài): "trong bối cảnh", "thời đại số", "đóng vai trò quan trọng/then chốt", "là minh chứng", "đánh dấu bước ngoặt", "toàn diện", "vượt trội", "đột phá", "mạnh mẽ", "nâng tầm", "hành trình", "chìa khóa", "bí quyết", "khám phá", "sở hữu", "mang đến trải nghiệm", "Ngoài ra,", "Bên cạnh đó,", "Hơn nữa,", "Điều quan trọng cần lưu ý", "Hãy cùng tìm hiểu".
• CẤU TRÚC CẤM LẠM DỤNG: "không chỉ... mà còn...", "không phải X mà là Y" (≤ 1 lần/bài); đuôi câu "qua đó/từ đó/góp phần nâng cao..." (≤ 1 lần/đoạn); bộ ba tính từ "nhanh, hiệu quả và tiết kiệm"; khối "Mặc dù... vẫn đối mặt thách thức... hứa hẹn"; đoạn kết "Tóm lại/Nhìn chung" lặp ý.
• NGÔN NGỮ TỰ NHIÊN: dùng "là", "có", "dùng" thay vì "đóng vai trò là", "sở hữu", "vận dụng". Gọi một đối tượng bằng một tên, không xoay vòng từ đồng nghĩa. Trộn câu ngắn (3-6 từ) với câu dài. Mở bài bằng tình huống hoặc câu trả lời trực tiếp, không mở bằng định nghĩa.
• TRÌNH BÀY: heading viết hoa kiểu câu (chỉ viết hoa chữ đầu và tên riêng, VD "Cách tối ưu tốc độ WordPress"); không emoji trong heading/gạch đầu dòng; in đậm ≤ 1 cụm/đoạn; ≤ 2 khối danh sách dạng "**Tiêu đề:** mô tả", ý viết được thành đoạn văn thì viết đoạn văn; gạch dài "—" ≤ 3/bài; bảng chỉ dùng khi có số liệu so sánh thật; không khung ASCII; không chèn "---" giữa mọi phần.
• KHÔNG XUẤT VĂN BẢN CHATBOT: không "Dưới đây là...", "Hy vọng bài viết hữu ích", "Nếu bạn cần thêm...", không chỗ trống mẫu [Tên công ty], không câu rào đón "thông tin chưa được công bố rộng rãi".
• ƯU TIÊN ĐƯA VÀO: dữ liệu thật từ đầu vào (số liệu nội bộ, case study, cấu hình, lỗi đã gặp), nhận định có điều kiện và có chủ kiến ("Nếu site dưới 20 trang thì...").
• VỀ VĂN PHONG DOANH NGHIỆP: "trang trọng" nghĩa là chính xác và có căn cứ, không phải dùng nhiều tính từ lớn. Khi quy tắc thay thế ở trên gợi ý tính từ (VD "tốc độ vượt trội"), ưu tiên thay bằng số đo cụ thể nếu có.
[/QUY TẮC CHỐNG DẤU VẾT AI]\n\n`;
  }

  _generateCacheKey(provider, model, prompt, options = {}) {
    const data = JSON.stringify({
      provider,
      model,
      prompt,
      stream: !!options.stream,
    });
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  _isCooldown(key) {
    const cooldownUntil = this.cooldowns[key.id];
    if (!cooldownUntil) return false;
    if (Date.now() > cooldownUntil) {
      delete this.cooldowns[key.id];
      return false;
    }
    return true;
  }

  _selectKeyRoundRobin(keys, provider, type = 'text') {
    const activeKeys = keys.filter(k => k.active !== false);
    if (activeKeys.length === 0) return null;

    let availableKeys = activeKeys.filter(k => !this._isCooldown(k));
    if (availableKeys.length === 0) {
      console.warn(`[AI] Tất cả API keys cho ${provider} (${type}) đều bị cooldown. Tạm thời dùng lại tất cả.`);
      availableKeys = activeKeys;
    }

    const minPriority = Math.min(...availableKeys.map(k => k.priority || 10));
    const bestKeys = availableKeys.filter(k => (k.priority || 10) === minPriority);

    if (bestKeys.length === 0) return null;

    const groupKey = `${provider}_${type}_priority_${minPriority}`;
    if (this.lastUsedKeyIndexes[groupKey] === undefined) {
      this.lastUsedKeyIndexes[groupKey] = 0;
    } else {
      this.lastUsedKeyIndexes[groupKey] = (this.lastUsedKeyIndexes[groupKey] + 1) % bestKeys.length;
    }

    const selectedIndex = this.lastUsedKeyIndexes[groupKey] % bestKeys.length;
    const selectedKey = bestKeys[selectedIndex];

    console.log(`[AI] Xoay tua chọn key cho ${provider} (${type}): ID=${selectedKey.id}, Priority=${minPriority}, Index=${selectedIndex}/${bestKeys.length}`);
    return selectedKey;
  }

  async _handleKeyError(key, error, provider) {
    if (!key) return;
    const status = error.response?.status;
    const isRateLimit = status === 429 || status === 503;
    const isAuthError = status === 401 || status === 403;

    if (isRateLimit) {
      console.warn(`[AI] ⚠️ Key ID=${key.id} gặp lỗi Rate Limit (${status}) từ ${provider}. Cooldown 1 phút.`);
      this.cooldowns[key.id] = Date.now() + 60 * 1000;
    } else if (isAuthError) {
      console.warn(`[AI] ❌ Key ID=${key.id} gặp lỗi Auth/Quota (${status}) từ ${provider}. Cooldown 30 phút và tạm tắt.`);
      this.cooldowns[key.id] = Date.now() + 30 * 60 * 1000;
      try {
        await storage.update("api-keys", key.id, { active: false });
        console.log(`[AI] Đã cập nhật key ID=${key.id} thành active: false trong DB.`);
      } catch (dbErr) {
        console.error(`[AI] Lỗi cập nhật key trong DB:`, dbErr.message);
      }
    } else {
      console.warn(`[AI] ⚠️ Key ID=${key.id} gặp lỗi khác (${status || error.message}) từ ${provider}. Cooldown 10 giây.`);
      this.cooldowns[key.id] = Date.now() + 10 * 1000;
    }
  }

  /**
   * Call AI with the appropriate provider based on settings.
   * Automatically prepends current date context to every prompt.
   */
  async generate(prompt, settings, options = {}) {
    const apiKeys = options.apiKeys || [];
    const stream = options.stream || false;

    // Lấy cài đặt cache
    const enableCache = settings.aiProvider?.enableCache !== false;
    const cacheTtl = settings.aiProvider?.cacheTtl || 86400; // mặc định 24h

    // Inject current date context, corporate tone standards and anti-AI footprint rules
    const enrichedPrompt =
      this._buildDateContext() +
      this._buildCorporateToneContext(prompt, options) +
      this._buildAntiAiFootprintContext(prompt, options) +
      prompt;

    // Smart Routing: use textRouting chain (A2)
    const providers = this._getTextProviderChain(settings, apiKeys);

    for (const provider of providers) {
      const keys = apiKeys.filter((k) => k.provider === provider && k.active);
      if (keys.length === 0) continue;

      const config = settings.aiProvider[provider];
      const model = config?.textModel || this._getDefaultTextModel(provider);

      // 1. Kiểm tra Cache (nếu bật cache và không stream)
      let cacheKey = null;
      if (enableCache && !stream) {
        cacheKey = this._generateCacheKey(provider, model, enrichedPrompt, options);
        try {
          const cachedRecord = await storage.getById("response-cache", cacheKey);
          if (cachedRecord && cachedRecord.expiresAt) {
            const expiresAt = new Date(cachedRecord.expiresAt);
            if (expiresAt > new Date()) {
              console.log(`[AI-Cache] ⚡ Cache HIT cho ${provider} (${model})`);
              this.lastUsedProvider = provider;
              this.lastUsedModel = model;
              if (options && typeof options === "object") {
                options.usedProvider = provider;
                options.usedModel = model;
              }
              return cachedRecord.response;
            }
          }
        } catch (cacheErr) {
          console.error("[AI-Cache] Lỗi đọc cache:", cacheErr.message);
        }
      }

      // Retry up to 3 times on rate limit (429) or other recoverable errors
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const key = this._selectKeyRoundRobin(keys, provider, 'text');
        if (!key) {
          console.warn(`[AI] Không tìm thấy API key khả dụng cho ${provider}`);
          break; // Thử provider tiếp theo
        }

        try {
          const result = await this._callProvider(
            provider,
            key.apiKey,
            enrichedPrompt,
            config,
            stream,
            options.res,
          );

          // Track last used provider+model for UI display (A4) + request-scoped options (BUG-13)
          this.lastUsedProvider = provider;
          this.lastUsedModel = model;
          if (options && typeof options === "object") {
            options.usedProvider = provider;
            options.usedModel = model;
          }
          if (key._isSharedPool && (key._forUserId || options?.userId)) {
            const { consumeCredits } = require("../middleware/ai-credit-tracker");
            consumeCredits(key._forUserId || options.userId, "text").catch(() => {});
          }
          console.log(`[AI] ✅ Text generated via ${provider} (${model})`);

          // 2. Lưu kết quả vào Cache nếu thành công
          if (enableCache && !stream && cacheKey && result) {
            try {
              const expiresAt = new Date(Date.now() + cacheTtl * 1000).toISOString();
              await storage.create("response-cache", {
                id: cacheKey,
                provider,
                model,
                prompt: enrichedPrompt,
                response: result,
                expiresAt,
              });
              console.log(`[AI-Cache] 💾 Đã lưu cache mới cho ${provider} (${model}), hết hạn sau ${cacheTtl} giây.`);
            } catch (cacheSaveErr) {
              console.error("[AI-Cache] Lỗi lưu cache:", cacheSaveErr.message);
            }
          }

          return result;
        } catch (error) {
          const status = error.response?.status;
          const isRateLimit = status === 429 || status === 503;

          // Sử dụng helper xử lý lỗi & cooldown đồng bộ
          await this._handleKeyError(key, error, provider);

          if (isRateLimit && attempt < maxRetries) {
            const delay = attempt * 2; // Giảm xuống 2s, 4s vì chúng ta có cơ chế xoay tua chọn key mới ở loop sau
            console.warn(
              `[AI] ${provider} gặp lỗi (${status}), thử lại lần ${attempt}/${maxRetries} sau ${delay}s...`,
            );
            await new Promise((r) => setTimeout(r, delay * 1000));
            continue;
          }

          console.error(`[AI] ${provider} thất bại trên key ID=${key.id}:`, error.message);
          // Fallback sang provider tiếp theo trong chain
          if (providers.length > 1) {
            console.warn(`[AI] ⚠️ ${provider} thất bại → Chuyển sang provider tiếp theo trong chuỗi...`);
            break; // Thoát ra để thử provider tiếp theo
          }
          throw error;
        }
      }
    }
    throw new Error("Không có AI provider nào khả dụng hoặc tất cả đều lỗi. Vui lòng kiểm tra lại cấu hình và API keys.");
  }

  /**
   * Get default text model for a provider
   */
  _getDefaultTextModel(provider) {
    const defaults = {
      gemini: "gemini-2.5-flash",
      openai: "gpt-4o-mini",
      openrouter: "google/gemini-2.5-flash-preview:free",
      omnirouter: "spl",
      ninerouter: "spl",
    };
    return defaults[provider] || "unknown";
  }

  /**
   * Smart Text Provider Chain (A2)
   * Determines provider order based on textRouting setting.
   * "auto-free" → prioritize free tiers (OmniRouter -> Gemini -> OpenRouter -> OpenAI)
   */
  _getTextProviderChain(settings, apiKeys) {
    const routing = settings.aiProvider?.textRouting;
    
    // "auto-free": prioritize free/high-priority router tiers for text generation
    if (routing === "auto-free" || !routing) {
      const chain = [];
      // 1. OmniRouter / 9Router (Highest quality/priority combo)
      if (apiKeys.some(k => (k.provider === "omnirouter" || k.provider === "ninerouter") && k.active)) chain.push("omnirouter");
      // 2. Gemini free
      if (apiKeys.some(k => k.provider === "gemini" && k.active)) chain.push("gemini");
      // 3. OpenRouter
      if (apiKeys.some(k => k.provider === "openrouter" && k.active)) chain.push("openrouter");
      // 4. OpenAI
      if (apiKeys.some(k => k.provider === "openai" && k.active)) chain.push("openai");
      if (chain.length > 0) return chain;
    }

    // Single provider mode
    if (["gemini", "openai", "openrouter", "omnirouter", "ninerouter"].includes(routing)) {
      return [routing];
    }

    // Legacy "fallback" mode (backward compat — A5)
    return this._getLegacyProviderOrder(
      settings.aiProvider?.mode,
      settings.aiProvider?.fallbackOrder
    );
  }

  /**
   * Smart Image Provider Chain (A2)
   * Determines provider order based on imageRouting setting.
   * "auto-best" → prioritize quality (Gemini Imagen → OpenAI → OpenRouter)
   */
  _getImageProviderChain(settings, apiKeys) {
    const routing = settings?.aiProvider?.imageRouting;

    if (routing === "google-search") {
      return ["google-search"];
    }

    if (routing === "auto-best") {
      const chain = [];
      if (apiKeys.some(k => k.provider === "gemini" && k.active)) chain.push("gemini");
      if (apiKeys.some(k => k.provider === "openai" && k.active)) chain.push("openai");
      if (apiKeys.some(k => k.provider === "openrouter" && k.active)) chain.push("openrouter");
      if (chain.length > 0) return chain;
    }

    if (["gemini", "openai", "openrouter"].includes(routing)) {
      return [routing];
    }

    // Default: try all in quality order
    return ["gemini", "openai", "openrouter"];
  }

  /**
   * Clean Vietnamese/English search query for Google/Bing/Openverse Images search
   */
  _cleanImageSearchQuery(rawQuery) {
    if (!rawQuery) return "";
    return String(rawQuery)
      .replace(/<[^>]*>/g, " ")
      .replace(/\(\s*[\d.,]+\s*\)/g, " ")
      .replace(/\[\s*[\d.,]+\s*\]/g, " ")
      .replace(/^[\s\-–—•*:+]+/, "")
      .replace(/^(?:phần|chương|bước|mục|top)\s*\d+[:.\s-]*/i, "")
      .replace(/^(?:[IVXLC]+|\d+(?:\.\d+)*)[:.)\s-]+/i, "")
      .replace(/["'“”‘’`#*~_[\](){}]/g, " ")
      .replace(/\b(?:là gì|như thế nào|tại sao|vì sao|hướng dẫn chi tiết|toàn tập|từ a đến z|từ a-z|mới nhất|chi tiết nhất|phổ biến|thường gặp|thường mắc|cần biết|hiệu quả)\b/gi, " ")
      .replace(/\b(?:professional|photo|illustration|representing|modern|clean|style|bright|studio|lighting|detailed|no text|no watermark|high quality|3d render|blog|section|thumbnail|cinematic|soft|natural|light|warm|golden|hour|dramatic|contrast|close-up|macro|minimalist|view)\b/gi, " ")
      .replace(/^[\s\-–—•*:+]+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 100);
  }

  /**
   * Extract concise 4-5 word English visual query from AI image prompt or Vietnamese topic for CC0/Royalty-Free stock search
   */
  _extractEnglishVisualKeywords(prompt, extraContext = "") {
    const combined = `${prompt || ""} ${extraContext || ""}`;
    if (!combined.trim()) return "";

    const stopWords = new Set([
      "a", "an", "the", "of", "in", "on", "at", "to", "for", "with", "by", "from", "and", "or",
      "is", "are", "was", "were", "be", "been", "being", "that", "this", "these", "those",
      "professional", "photo", "photograph", "illustration", "image", "picture", "representing",
      "modern", "clean", "style", "bright", "studio", "lighting", "detailed", "text", "watermark",
      "watermarks", "high", "quality", "render", "blog", "section", "thumbnail", "cinematic",
      "soft", "natural", "light", "warm", "golden", "hour", "dramatic", "contrast", "close",
      "up", "macro", "minimalist", "view", "showing", "featuring", "background", "concept",
      "no", "without", "faces", "human", "logos", "logo", "sleek", "fresh", "vibrant"
    ]);

    // Only keep pure ASCII words that are not fragments of accented Vietnamese words
    const asciiWords = String(prompt || "")
      .replace(/[",.;:!?()[\]{}/\\|-]/g, " ")
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => /^[a-zA-Z]{3,}$/.test(w) && !stopWords.has(w.toLowerCase()));

    // Map Vietnamese topics/headings to concrete English visual keywords for Openverse/Wikimedia CC0 search
    const lower = combined.toLowerCase();
    const mappedVisuals = [];
    const topicRules = [
      { re: /thiết kế web|lập trình web|website|trang web|giao diện|landing page|wordpress/i, kw: "web design laptop workspace" },
      { re: /\bseo\b|từ khóa|lên top|search console|backlink|traffic|thứ hạng/i, kw: "seo analytics dashboard laptop" },
      { re: /chi phí|báo giá|bảng giá|ngân sách|đầu tư|tiết kiệm|giá rẻ/i, kw: "business finance planning laptop" },
      { re: /tốc độ|hiệu năng|tối ưu|bảo mật|hosting|server|máy chủ|tên miền|domain/i, kw: "server technology code monitor" },
      { re: /thương mại điện tử|bán hàng|giỏ hàng|thanh toán|cửa hàng|shop online/i, kw: "ecommerce online shopping laptop" },
      { re: /marketing|quảng cáo|thương hiệu|chiến lược|khách hàng|chuyển đổi/i, kw: "digital marketing analytics office" },
      { re: /doanh nghiệp|công ty|đối tác|quy trình|tư vấn|dịch vụ|chuyên nghiệp/i, kw: "modern business office team" },
      { re: /du lịch|khách sạn|resort|homestay|lữ hành|tour/i, kw: "travel resort hotel architecture" },
      { re: /hội an/i, kw: "Hoi An Vietnam lantern architecture" },
      { re: /đà nẵng/i, kw: "Da Nang Vietnam city bridge" },
      { re: /nhà hàng|ẩm thực|quán ăn|cafe|cà phê|món ăn/i, kw: "modern restaurant food cafe" },
      { re: /bất động sản|nhà đất|căn hộ|chung cư|biệt thự/i, kw: "modern real estate building architecture" },
      { re: /nội thất|kiến trúc|xây dựng|thi công|nhà ở/i, kw: "modern interior design architecture" },
      { re: /nha khoa|y tế|phòng khám|bệnh viện|sức khỏe|bác sĩ/i, kw: "modern medical clinic healthcare" },
      { re: /thẩm mỹ|spa|làm đẹp|mỹ phẩm|chăm sóc da/i, kw: "beauty spa skincare wellness" },
      { re: /giáo dục|đào tạo|khóa học|học viện|sinh viên/i, kw: "education learning classroom laptop" },
      { re: /phần mềm|\bai\b|trí tuệ nhân tạo|công nghệ|chuyển đổi số|ứng dụng|mobile app/i, kw: "software technology coding workspace" },
    ];

    for (const rule of topicRules) {
      if (rule.re.test(lower)) {
        mappedVisuals.push(rule.kw);
      }
    }

    if (asciiWords.length >= 2) {
      return [...asciiWords.slice(0, 4), ...(mappedVisuals[0] ? mappedVisuals[0].split(" ").slice(0, 2) : [])].slice(0, 5).join(" ");
    }
    if (mappedVisuals.length > 0) {
      // Combine up to 2 matched rules so different H2 sections get distinct visual queries
      const words = [...new Set(mappedVisuals.slice(0, 2).join(" ").split(/\s+/))];
      return words.slice(0, 5).join(" ");
    }
    return asciiWords.slice(0, 5).join(" ") || "modern business technology laptop workspace";
  }

  /**
   * Check whether a candidate URL is suitable & copyright-safe
   * Filters out watermarked stock sites, competitor blog uploads with logos, icons/SVGs, and already-used URLs
   */
  _isAcceptableImageCandidate(url, excludeUrls = null, options = {}) {
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
    if (excludeUrls) {
      if (excludeUrls instanceof Set && excludeUrls.has(url)) return false;
      if (Array.isArray(excludeUrls) && excludeUrls.includes(url)) return false;
    }
    const lower = url.toLowerCase();
    if (/\.(svg|gif|ico)(\?|$)/i.test(lower)) return false;
    if (/(?:logo|icon|avatar|sprite|badge|banner-ad|placeholder|loading|favicon|emoji|watermark|copyright)/i.test(lower)) return false;

    const blockedDomains = [
      "shutterstock.com", "istockphoto.com", "gettyimages.com", "alamy.com",
      "123rf.com", "depositphotos.com", "dreamstime.com", "bigstockphoto.com",
      "vecteezy.com", "pngtree.com", "lovepik.com", "pikbest.com", "freepik.com",
      "canstockphoto.com", "envato.com", "graphicriver.net", "ftcdn.net",
      "lookaside.fbsbx.com", "tiktokcdn.com", "pinterest.com", "pinimg.com"
    ];
    if (blockedDomains.some(d => lower.includes(d))) return false;

    // Avoid competitor Vietnamese blog wp-content uploads (often contain competitor brand logos/watermarks)
    if (options.strictCopyright !== false) {
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (host.endsWith(".vn") && lower.includes("/wp-content/uploads/")) {
          return false;
        }
      } catch {}
    }

    return true;
  }

  /**
   * Search copyright-free (CC0 / Public Domain / Creative Commons Commercial / Royalty-Free) topic images
   * Sources: Openverse Commercial CC -> Wikimedia Commons -> Unsplash/Pexels/Pixabay -> Bing CC -> Google CC
   * @param {string} query - Topic / keyword / heading query
   * @param {object} options - { apiKeys, excludeUrls, limit, strictCopyright }
   * @returns {Promise<Array<{url: string, thumbUrl: string, title: string, source: string, license: string, width: number, height: number}>>}
   */
  async searchRealImages(query, options = {}) {
    const cleanQuery = this._cleanImageSearchQuery(query);
    if (!cleanQuery) return [];

    const apiKeys = options.apiKeys || [];
    const excludeUrls = options.excludeUrls || null;
    const limit = options.limit || 20;
    const minResults = options.minResults || Math.min(limit, 10);
    const strictCopyright = options.strictCopyright !== false;
    const results = [];
    const seenUrls = new Set();

    const addCandidate = (item) => {
      if (!item || !item.url) return;
      const normalizedUrl = item.url.trim();
      if (seenUrls.has(normalizedUrl)) return;
      if (!this._isAcceptableImageCandidate(normalizedUrl, excludeUrls, { strictCopyright })) return;
      seenUrls.add(normalizedUrl);
      results.push({
        url: normalizedUrl,
        thumbUrl: item.thumbUrl || normalizedUrl,
        title: item.title || cleanQuery,
        source: item.source || "CC0 / Free License",
        license: item.license || "CC / Free Commercial",
        width: item.width || 800,
        height: item.height || 500,
      });
    };

    const browserHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    };

    // 1. Openverse API (WordPress.org official Creative Commons / CC0 commercial-safe repository — NO key required)
    try {
      const ovUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(cleanQuery)}&license_type=commercial&page_size=12`;
      const resp = await axios.get(ovUrl, { timeout: 8000, headers: { "User-Agent": "SPLSEO/2.0 (https://seo.splworks.com)" } });
      for (const item of resp.data?.results || []) {
        if (item?.url) {
          addCandidate({
            url: item.url,
            thumbUrl: item.thumbnail || item.url,
            title: item.title || cleanQuery,
            source: `Openverse (${(item.license || "CC0").toUpperCase()})`,
            license: (item.license || "cc0").toUpperCase(),
            width: item.width || 1200,
            height: item.height || 630,
          });
        }
      }
    } catch (e) {
      console.warn("[AI-ImageSearch] Openverse error:", e.message);
    }

    // 2. Stock APIs (Unsplash / Pexels / Pixabay — 100% Royalty-Free Commercial) if keys are available
    const unsplashKey = apiKeys.find(k => k.provider === "unsplash" && k.active);
    if (unsplashKey && results.length < limit) {
      try {
        const resp = await axios.get("https://api.unsplash.com/search/photos", {
          params: { query: cleanQuery, per_page: 8, orientation: "landscape", client_id: unsplashKey.apiKey },
          timeout: 8000,
        });
        for (const item of resp.data?.results || []) {
          if (item?.urls?.regular) {
            addCandidate({
              url: item.urls.regular,
              thumbUrl: item.urls.small || item.urls.regular,
              title: item.description || item.alt_description || cleanQuery,
              source: "Unsplash (Free License)",
              license: "Unsplash Free",
              width: item.width || 1200,
              height: item.height || 630,
            });
          }
        }
      } catch {}
    }

    const pexelsKey = apiKeys.find(k => k.provider === "pexels" && k.active);
    if (pexelsKey && results.length < limit) {
      try {
        const resp = await axios.get("https://api.pexels.com/v1/search", {
          headers: { Authorization: pexelsKey.apiKey },
          params: { query: cleanQuery, per_page: 8, orientation: "landscape" },
          timeout: 8000,
        });
        for (const item of resp.data?.photos || []) {
          if (item?.src?.large) {
            addCandidate({
              url: item.src.large,
              thumbUrl: item.src.medium || item.src.large,
              title: item.alt || cleanQuery,
              source: "Pexels (Free License)",
              license: "Pexels Free",
              width: item.width || 1200,
              height: item.height || 630,
            });
          }
        }
      } catch {}
    }

    const pixabayKey = apiKeys.find(k => k.provider === "pixabay" && k.active);
    if (pixabayKey && results.length < limit) {
      try {
        const resp = await axios.get("https://pixabay.com/api/", {
          params: { key: pixabayKey.apiKey, q: cleanQuery, per_page: 8, image_type: "photo", orientation: "horizontal", safesearch: "true" },
          timeout: 8000,
        });
        for (const item of resp.data?.hits || []) {
          if (item?.largeImageURL) {
            addCandidate({
              url: item.largeImageURL,
              thumbUrl: item.webformatURL || item.largeImageURL,
              title: item.tags || cleanQuery,
              source: "Pixabay (Free License)",
              license: "Pixabay Free",
              width: item.imageWidth || 1200,
              height: item.imageHeight || 630,
            });
          }
        }
      } catch {}
    }

    // 3. Wikimedia Commons API (Public Domain & Creative Commons — NO key required)
    if (results.length < minResults) {
      try {
        const wmUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${cleanQuery}`)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|dimensions|mime&iiurlwidth=1200&format=json`;
        const resp = await axios.get(wmUrl, { timeout: 8000, headers: { "User-Agent": "SPLSEO/2.0 (https://seo.splworks.com)" } });
        const pages = Object.values(resp.data?.query?.pages || {});
        for (const p of pages) {
          const info = p?.imageinfo?.[0];
          if (!info) continue;
          const imgUrl = info.thumburl || info.url;
          if (!imgUrl || (info.width && info.width < 400)) continue;
          addCandidate({
            url: imgUrl,
            thumbUrl: info.thumburl || imgUrl,
            title: (p.title || "").replace(/^File:/i, "").replace(/\.[^.]+$/, ""),
            source: "Wikimedia Commons (CC)",
            license: "Creative Commons",
            width: info.thumbwidth || info.width || 1200,
            height: info.thumbheight || info.height || 630,
          });
        }
      } catch (e) {
        console.warn("[AI-ImageSearch] Wikimedia error:", e.message);
      }
    }

    // 4. Bing Images Async Search with Creative Commons / Free Commercial License filter (+filterui:license-L2_L3_L4)
    if (results.length < minResults) {
      const bingUrls = [
        `https://www.bing.com/images/async?q=${encodeURIComponent(cleanQuery)}&first=0&count=20&adlt=strict&mkt=vi-VN&qft=+filterui:license-L2_L3_L4+filterui:photo-photo`,
        `https://www.bing.com/images/async?q=${encodeURIComponent(cleanQuery)}&first=0&count=20&adlt=strict&mkt=vi-VN&qft=+filterui:photo-photo`,
      ];
      for (const bingUrl of bingUrls) {
        if (results.length >= limit) break;
        const isCcFiltered = bingUrl.includes("license-L2_L3_L4");
        try {
          const resp = await axios.get(bingUrl, { headers: browserHeaders, timeout: 9000 });
          const html = String(resp.data || "");
          const mRegex = /\bm="([^"]+)"/g;
          let match;
          while ((match = mRegex.exec(html)) !== null) {
            try {
              const decoded = match[1]
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, "&")
                .replace(/&#39;/g, "'")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">");
              const meta = JSON.parse(decoded);
              if (meta?.murl) {
                let domain = "Bing CC";
                try { domain = new URL(meta.murl).hostname.replace(/^www\./, ""); } catch {}
                addCandidate({
                  url: meta.murl,
                  thumbUrl: meta.turl || meta.murl,
                  title: meta.t || cleanQuery,
                  source: isCcFiltered ? `${domain} (CC Free)` : domain,
                  license: isCcFiltered ? "Creative Commons" : "Web Editorial",
                  width: 800,
                  height: 500,
                });
              }
            } catch {}
            if (results.length >= limit) break;
          }
        } catch (e) {
          console.warn("[AI-ImageSearch] Bing Async error:", e.message);
        }
        if (results.length >= minResults) break;
      }
    }

    // 5. Google Images Direct Search with Creative Commons filter (tbs=il:cl)
    if (results.length < minResults) {
      const googleUrls = [
        `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&tbm=isch&tbs=il:cl&hl=vi&gl=vn&safe=active`,
        `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}&tbm=isch&hl=vi&gl=vn&safe=active`,
      ];
      for (const googleUrl of googleUrls) {
        if (results.length >= limit) break;
        const isCcFiltered = googleUrl.includes("tbs=il:cl");
        try {
          const resp = await axios.get(googleUrl, { headers: browserHeaders, timeout: 9000 });
          const html = String(resp.data || "")
            .replace(/\\u003d/g, "=")
            .replace(/\\u0026/g, "&")
            .replace(/\\u003f/g, "?")
            .replace(/\\\//g, "/");

          const regex = /\["(https?:\/\/[^"\s\\]+)",\s*(\d{3,4}),\s*(\d{3,4})\]/g;
          let match;
          while ((match = regex.exec(html)) !== null) {
            const imgUrl = match[1];
            const h = parseInt(match[2], 10);
            const w = parseInt(match[3], 10);
            if (w < 400 || h < 250) continue;
            if (/gstatic\.com|google\.com|ggpht\.com|googleusercontent\.com\/a\//i.test(imgUrl)) continue;
            let domain = "Google CC";
            try { domain = new URL(imgUrl).hostname.replace(/^www\./, ""); } catch {}
            addCandidate({
              url: imgUrl,
              thumbUrl: imgUrl,
              title: cleanQuery,
              source: isCcFiltered ? `${domain} (CC Free)` : domain,
              license: isCcFiltered ? "Creative Commons" : "Web Editorial",
              width: w,
              height: h,
            });
            if (results.length >= limit) break;
          }
        } catch (e) {
          console.warn("[AI-ImageSearch] Google Direct error:", e.message);
        }
        if (results.length >= 6) break;
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Download an external image URL, validate it is a real image (>= 8KB), and store locally via imageStore
   */
  async downloadAndStoreImage(url, prefix = "google", fallbackThumbUrl = null) {
    const tryFetch = async (targetUrl) => {
      let referer = "https://www.google.com/";
      try {
        referer = new URL(targetUrl).origin + "/";
      } catch {}
      const resp = await axios.get(targetUrl, {
        timeout: 15000,
        responseType: "arraybuffer",
        maxContentLength: 8 * 1024 * 1024,
        maxRedirects: 5,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Referer": referer,
        },
      });
      const contentType = (resp.headers["content-type"] || "image/jpeg").split(";")[0].trim().toLowerCase();
      if (!contentType.startsWith("image/") || contentType.includes("svg")) {
        throw new Error(`Invalid content-type: ${contentType}`);
      }
      const buffer = Buffer.from(resp.data);
      if (buffer.byteLength < 8192) {
        throw new Error(`Image too small (${buffer.byteLength} bytes)`);
      }
      const base64DataUri = `data:${contentType};base64,${buffer.toString("base64")}`;
      return imageStore.normalizeImageUrl(base64DataUri, prefix);
    };

    try {
      return await tryFetch(url);
    } catch (err1) {
      if (fallbackThumbUrl && fallbackThumbUrl !== url) {
        console.log(`[AI-Image] Primary URL failed (${err1.message}), trying fallback thumbUrl...`);
        return await tryFetch(fallbackThumbUrl);
      }
      throw err1;
    }
  }

  /**
   * Legacy provider order (backward compat for mode: "fallback" — A5)
   */
  _getLegacyProviderOrder(mode, fallbackOrder) {
    if (mode === "fallback") {
      switch (fallbackOrder) {
        case "omnirouter":
        case "ninerouter":
          return ["omnirouter", "gemini", "openai", "openrouter"];
        case "gemini":
          return ["omnirouter", "gemini", "openai", "openrouter"];
        case "openai":
          return ["omnirouter", "openai", "gemini", "openrouter"];
        case "openrouter":
          return ["omnirouter", "openrouter", "gemini", "openai"];
        default:
          return ["omnirouter", "gemini", "openai", "openrouter"];
      }
    }
    if (mode && ["gemini", "openai", "openrouter", "omnirouter", "ninerouter"].includes(mode)) {
      return [mode];
    }
    return ["omnirouter", "gemini", "openai", "openrouter"];
  }

  _selectKey(keys) {
    // Priority-based selection (lower number = higher priority)
    const sorted = keys.sort((a, b) => (a.priority || 10) - (b.priority || 10));
    return sorted[0];
  }

  async _callProvider(provider, apiKey, prompt, config, stream, res) {
    switch (provider) {
      case "gemini":
        return this._callGemini(apiKey, prompt, config, stream, res);
      case "openai":
        return this._callOpenAI(apiKey, prompt, config, stream, res);
      case "openrouter":
        return this._callOpenRouter(apiKey, prompt, config, stream, res);
      case "omnirouter":
      case "ninerouter":
        return this._callOmniRouter(apiKey, prompt, config, stream, res);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  async _callGemini(apiKey, prompt, config, stream, res) {
    const model = config.textModel || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? "streamGenerateContent" : "generateContent"}?key=${apiKey}`;

    if (stream && res) {
      const response = await axios.post(
        url + "&alt=sse",
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 65536 },
        },
        { responseType: "stream", timeout: (config.timeout || 180) * 1000 },
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      return new Promise((resolve, reject) => {
        let fullText = "";
        response.data.on("data", (chunk) => {
          const text = chunk.toString();
          const lines = text.split("\n").filter((l) => l.startsWith("data: "));
          for (const line of lines) {
            try {
              const json = JSON.parse(line.slice(6));
              const content =
                json.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (content) {
                fullText += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              /* skip parse errors */
            }
          }
        });
        response.data.on("end", () => {
          res.write(`data: [DONE]\n\n`);
          res.end();
          resolve(fullText);
        });
        response.data.on("error", reject);
      });
    }

    const response = await axios.post(
      url,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 65536 },
      },
      { timeout: (config.timeout || 180) * 1000 },
    );

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  async _callOpenAI(apiKey, prompt, config, stream, res) {
    const model = config.textModel || "gpt-4o-mini";

    if (stream && res) {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          temperature: 0.7,
          max_tokens: 65536,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          responseType: "stream",
          timeout: (config.timeout || 120) * 1000,
        },
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      return new Promise((resolve, reject) => {
        let fullText = "";
        response.data.on("data", (chunk) => {
          const lines = chunk
            .toString()
            .split("\n")
            .filter((l) => l.startsWith("data: "));
          for (const line of lines) {
            if (line === "data: [DONE]") continue;
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices?.[0]?.delta?.content || "";
              if (content) {
                fullText += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              /* skip */
            }
          }
        });
        response.data.on("end", () => {
          res.write(`data: [DONE]\n\n`);
          res.end();
          resolve(fullText);
        });
        response.data.on("error", reject);
      });
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 65536,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: (config.timeout || 120) * 1000,
      },
    );

    return response.data.choices?.[0]?.message?.content || "";
  }

  async _callOpenRouter(apiKey, prompt, config, stream, res) {
    const model = config.textModel || "google/gemini-2.5-flash";
    // OpenRouter uses same API format as OpenAI
    const baseConfig = { ...config, textModel: model };

    if (stream && res) {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          temperature: 0.7,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          responseType: "stream",
          timeout: (config.timeout || 120) * 1000,
        },
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      return new Promise((resolve, reject) => {
        let fullText = "";
        response.data.on("data", (chunk) => {
          const lines = chunk
            .toString()
            .split("\n")
            .filter((l) => l.startsWith("data: "));
          for (const line of lines) {
            if (line === "data: [DONE]") continue;
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices?.[0]?.delta?.content || "";
              if (content) {
                fullText += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              /* skip */
            }
          }
        });
        response.data.on("end", () => {
          res.write(`data: [DONE]\n\n`);
          res.end();
          resolve(fullText);
        });
        response.data.on("error", reject);
      });
    }

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: (config.timeout || 120) * 1000,
      },
    );

    return response.data.choices?.[0]?.message?.content || "";
  }

  async _callOmniRouter(apiKey, prompt, config, stream, res) {
    const model = config.textModel || process.env.OMNIROUTER_MODEL || "spl";
    const endpoint =
      config.endpoint ||
      process.env.OMNIROUTER_ENDPOINT ||
      (process.env.OMNIROUTER_BASE_URL
        ? `${process.env.OMNIROUTER_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`
        : "");
    if (!endpoint) {
      throw new Error("Chưa cấu hình OMNIROUTER_ENDPOINT hoặc OMNIROUTER_BASE_URL trong biến môi trường");
    }

    if (stream && res) {
      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          responseType: "stream",
          timeout: (config.timeout || 180) * 1000,
        },
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      return new Promise((resolve, reject) => {
        let fullText = "";
        response.data.on("data", (chunk) => {
          const lines = chunk
            .toString()
            .split("\n")
            .filter((l) => l.startsWith("data: "));
          for (const line of lines) {
            if (line === "data: [DONE]") continue;
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices?.[0]?.delta?.content || "";
              if (content) {
                fullText += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              /* skip */
            }
          }
        });
        response.data.on("end", () => {
          res.write(`data: [DONE]\n\n`);
          res.end();
          resolve(fullText);
        });
        response.data.on("error", reject);
      });
    }

    const response = await axios.post(
      endpoint,
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 65536,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: (config.timeout || 180) * 1000,
      },
    );

    return response.data.choices?.[0]?.message?.content || "";
  }

  /**
   * Generate an image using AI
   * Provider chain: Gemini → OpenAI → OpenRouter → Photo Stock APIs
   * Supports: Imagen, Gemini native image (flash-image), GPT Image 1/1.5, DALL-E 3, OpenRouter
   * @param {string} prompt - Image description
   * @param {object} settings - App settings with aiProvider config
   * @param {object} options - { width, height, apiKeys, imageType: 'thumbnail'|'section' }
   */
  async generateImage(prompt, settings, options = {}) {
    const width = options.width || 1200;
    const height = options.height || 630;
    const apiKeys = options.apiKeys || [];
    const imageType = options.imageType || 'thumbnail'; // 'thumbnail' or 'section'
    const errors = [];

    const ratio = width / height;
    let aspectRatio = "16:9";
    if (ratio < 0.8) aspectRatio = "9:16";
    else if (ratio < 1.1) aspectRatio = "1:1";
    else if (ratio < 1.4) aspectRatio = "4:3";

    // Helper: get the right image model from settings based on imageType
    const getImageModel = (provider) => {
      const cfg = settings?.aiProvider?.[provider];
      if (!cfg) return null;
      // Support separate thumbnail/section models
      if (imageType === 'section' && cfg.sectionImageModel) return cfg.sectionImageModel;
      if (imageType === 'thumbnail' && cfg.thumbnailImageModel) return cfg.thumbnailImageModel;
      return cfg.imageModel; // fallback to generic imageModel
    };
    // Smart Image Routing: determine which AI providers to try (A2)
    const imageChain = options.preferRealImages ? ["google-search"] : this._getImageProviderChain(settings, apiKeys);
    console.log(`[AI-Image] Image routing: [${imageChain.join(" → ")}] | type: ${imageType}`);
    const shouldTryProvider = (p) => imageChain.includes(p);

    // ===== 1. Try GEMINI Image Generation =====
    const geminiKeys = apiKeys.filter(k => k.provider === "gemini" && k.active);
    if (shouldTryProvider("gemini") && geminiKeys.length > 0) {
      const geminiKey = this._selectKeyRoundRobin(geminiKeys, 'gemini', 'image');
      if (geminiKey) {
        const imageModel = getImageModel('gemini') || "imagen-4.0-fast-generate-001";

        // Helper: detect if model is a Gemini native image model (NOT a text-only model)
        const isGeminiNativeImage = (model) => {
          // Explicit image model patterns
          if (model.includes('image-generation')) return true; // gemini-2.0-flash-preview-image-generation
          if (model.includes('flash-image')) return true;      // gemini-2.5-flash-image (if exists)
          if (model.includes('image-preview')) return true;    // gemini-*-image-preview
          // EXCLUDE text-only gemini models (gemini-2.5-flash, gemini-2.5-pro, etc.)
          // A gemini model is only "native image" if it has an image-related suffix
          return false;
        };

        // 1a. Gemini Native Image — models that support responseModalities: ['IMAGE']
        if (isGeminiNativeImage(imageModel)) {
          try {
            console.log(`[AI-Image] Trying Gemini Native Image (${imageModel})...`);
            const resp = await axios.post(
              `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${geminiKey.apiKey}`,
              {
                contents: [{ parts: [{ text: `Generate a high-quality image: ${prompt}` }] }],
                generationConfig: {
                  responseModalities: ["IMAGE", "TEXT"],
                },
              },
              { timeout: 120000 },
            );

            // Extract image from response parts
            const parts = resp.data?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                const mimeType = part.inlineData.mimeType || "image/png";
                console.log(`[AI-Image] Gemini Native Image success (${imageModel})`);
                return imageStore.normalizeImageUrl(`data:${mimeType};base64,${part.inlineData.data}`, 'thumb');
              }
            }
            console.warn(`[AI-Image] Gemini Native Image returned no image data`);
          } catch (e) {
            await this._handleKeyError(geminiKey, e, 'gemini');
            const errMsg = e.response?.data?.error?.message || e.message;
            errors.push(`Gemini Native (${imageModel}): ${errMsg}`);
            console.error(`[AI-Image] Gemini Native Image failed:`, errMsg);
          }
        }

        // 1b. Gemini Imagen (imagen-*) — uses generateImages API
        if (imageModel.startsWith('imagen') || errors.length > 0) {
          const imagenModel = imageModel.startsWith('imagen') ? imageModel : 'imagen-4.0-fast-generate-001';
          try {
            console.log(`[AI-Image] Trying Gemini Imagen (${imagenModel})...`);

          // Try the generateImages endpoint first (works with API keys)
          const resp = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${imagenModel}:generateImages?key=${geminiKey.apiKey}`,
            {
              prompt: prompt.substring(0, 1000),
              config: {
                numberOfImages: 1,
                aspectRatio,
                outputOptions: { mimeType: "image/png" },
              },
            },
            { timeout: 90000 },
          );

          // Check generateImages response format
          const generated = resp.data?.generatedImages?.[0];
          if (generated?.image?.imageBytes) {
            console.log(`[AI-Image] Gemini Imagen success via generateImages (${imagenModel})`);
            return imageStore.normalizeImageUrl(`data:image/png;base64,${generated.image.imageBytes}`, 'thumb');
          }

          // Fallback: check predict-style response
          if (resp.data?.predictions?.[0]?.bytesBase64Encoded) {
            const mimeType = resp.data.predictions[0].mimeType || "image/png";
            console.log(`[AI-Image] Gemini Imagen success via predict (${imagenModel})`);
            return imageStore.normalizeImageUrl(`data:${mimeType};base64,${resp.data.predictions[0].bytesBase64Encoded}`, 'thumb');
          }
        } catch (e) {
          await this._handleKeyError(geminiKey, e, 'gemini');
          const errMsg = e.response?.data?.error?.message || e.message;
          errors.push(`Gemini Imagen (${imagenModel}): ${errMsg}`);
          console.error(`[AI-Image] Gemini Imagen failed:`, errMsg);

          // Also try the predict endpoint as fallback (for Vertex AI setups)
          if (!errMsg.includes('not found')) {
            try {
              console.log(`[AI-Image] Retrying Imagen with predict endpoint...`);
              const resp2 = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${imagenModel}:predict?key=${geminiKey.apiKey}`,
                {
                  instances: [{ prompt: prompt.substring(0, 1000) }],
                  parameters: { sampleCount: 1, aspectRatio },
                },
                { timeout: 90000 },
              );
              if (resp2.data?.predictions?.[0]?.bytesBase64Encoded) {
                const mimeType = resp2.data.predictions[0].mimeType || "image/png";
                console.log(`[AI-Image] Gemini Imagen predict success (${imagenModel})`);
                return imageStore.normalizeImageUrl(`data:${mimeType};base64,${resp2.data.predictions[0].bytesBase64Encoded}`, 'thumb');
              }
            } catch (e2) {
              await this._handleKeyError(geminiKey, e2, 'gemini');
              const errMsg2 = e2.response?.data?.error?.message || e2.message;
              errors.push(`Gemini Imagen predict (${imagenModel}): ${errMsg2}`);
              console.error(`[AI-Image] Gemini Imagen predict also failed:`, errMsg2);
            }
          }
        }
      }
    }
  }

    // ===== 2. Try OPENAI Image Generation =====
    const openaiKeys = apiKeys.filter(k => k.provider === "openai" && k.active);
    if (shouldTryProvider("openai") && openaiKeys.length > 0) {
      const openaiKey = this._selectKeyRoundRobin(openaiKeys, 'openai', 'image');
      if (openaiKey) {
        const imageModel = getImageModel('openai') || "gpt-image-1";

        // 2a. GPT Image 1 / 1.5 / 1-mini (new OpenAI Images API)
        if (imageModel.startsWith('gpt-image')) {
          try {
            console.log(`[AI-Image] Trying OpenAI GPT Image (${imageModel})...`);
            const size = width > height ? "1536x1024" : width < height ? "1024x1536" : "1024x1024";
            const resp = await axios.post(
              "https://api.openai.com/v1/images/generations",
              {
                model: imageModel,
                prompt: prompt.substring(0, 4000),
                n: 1,
                size,
                quality: imageModel.includes('mini') ? "low" : "high",
              },
              {
                headers: { Authorization: `Bearer ${openaiKey.apiKey}` },
                timeout: 120000,
              },
            );

            const imgData = resp.data?.data?.[0];
            if (imgData) {
              // GPT Image returns b64_json by default
              if (imgData.b64_json) {
                console.log(`[AI-Image] OpenAI GPT Image success (${imageModel}, base64)`);
                return imageStore.normalizeImageUrl(`data:image/png;base64,${imgData.b64_json}`, 'thumb');
              }
              if (imgData.url) {
                console.log(`[AI-Image] OpenAI GPT Image success (${imageModel}, url)`);
                return imgData.url;
              }
            }
          } catch (e) {
            await this._handleKeyError(openaiKey, e, 'openai');
            const errMsg = e.response?.data?.error?.message || e.message;
            errors.push(`OpenAI GPT Image (${imageModel}): ${errMsg}`);
            console.error(`[AI-Image] OpenAI GPT Image failed:`, errMsg);
          }
        }

        // 2b. DALL-E 3 / 2 (legacy)
        if (imageModel.startsWith('dall-e') || (!imageModel.startsWith('gpt-image') && errors.length > 0)) {
          const dalleModel = imageModel.startsWith('dall-e') ? imageModel : 'dall-e-3';
          try {
            console.log(`[AI-Image] Trying OpenAI ${dalleModel}...`);
            const size = dalleModel === 'dall-e-3'
              ? (width > height ? "1792x1024" : width < height ? "1024x1792" : "1024x1024")
              : "1024x1024";
            const resp = await axios.post(
              "https://api.openai.com/v1/images/generations",
              {
                model: dalleModel,
                prompt: prompt.substring(0, 4000),
                n: 1,
                size,
                quality: "hd",
              },
              {
                headers: { Authorization: `Bearer ${openaiKey.apiKey}` },
                timeout: 120000,
              },
            );

            if (resp.data?.data?.[0]?.url) {
              console.log(`[AI-Image] OpenAI ${dalleModel} success`);
              return resp.data.data[0].url;
            }
          } catch (e) {
            await this._handleKeyError(openaiKey, e, 'openai');
            const errMsg = e.response?.data?.error?.message || e.message;
            errors.push(`OpenAI ${dalleModel}: ${errMsg}`);
            console.error(`[AI-Image] OpenAI ${dalleModel} failed:`, errMsg);
          }
        }
      }
    }

    // ===== 3. Try OPENROUTER Image Generation =====
    const openrouterKeys = apiKeys.filter(k => k.provider === "openrouter" && k.active);
    if (shouldTryProvider("openrouter") && openrouterKeys.length > 0) {
      const orKey = this._selectKeyRoundRobin(openrouterKeys, 'openrouter', 'image');
      if (orKey) {
        const imageModel = getImageModel('openrouter') || "google/gemini-2.0-flash-exp:free";

        try {
          console.log(`[AI-Image] Trying OpenRouter (${imageModel})...`);
          const resp = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              model: imageModel,
              messages: [
                {
                  role: "user",
                  content: `Generate a high-quality image based on this description. Return ONLY the image, no text:\n\n${prompt}`,
                },
              ],
              response_format: { type: "image" },
            },
            {
              headers: {
                Authorization: `Bearer ${orKey.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://splseo.local",
                "X-Title": "SPLSEO",
              },
              timeout: 120000,
            },
          );

          // Handle different response formats
          const choice = resp.data?.choices?.[0];
          if (choice) {
            const msg = choice.message;

            // Format 1: Direct base64 data URI
            if (msg?.content && typeof msg.content === "string") {
              if (msg.content.startsWith("data:image")) {
                console.log("[AI-Image] OpenRouter success (data URI)");
                return msg.content;
              }
              // Raw base64
              if (/^[A-Za-z0-9+/=]+$/.test(msg.content.substring(0, 100)) && msg.content.length > 500) {
                console.log("[AI-Image] OpenRouter success (raw base64)");
                return imageStore.normalizeImageUrl(`data:image/png;base64,${msg.content}`, 'thumb');
              }
            }

            // Format 2: Multipart content with image_url
            if (Array.isArray(msg?.content)) {
              for (const part of msg.content) {
                if (part.type === "image_url" && part.image_url?.url) {
                  console.log("[AI-Image] OpenRouter success (image_url)");
                  return part.image_url.url;
                }
                if (part.type === "image" && part.source?.data) {
                  const mimeType = part.source?.media_type || "image/png";
                  console.log("[AI-Image] OpenRouter success (image part)");
                  return imageStore.normalizeImageUrl(`data:${mimeType};base64,${part.source.data}`, 'thumb');
                }
              }
            }

            // Format 3: Image URL in content text
            if (msg?.content && typeof msg.content === "string") {
              const urlMatch = msg.content.match(/https?:\/\/[^\s"'\]]+\.(png|jpg|jpeg|webp|gif)/i);
              if (urlMatch) {
                console.log("[AI-Image] OpenRouter success (URL in text)");
                return urlMatch[0];
              }
            }
          }

          console.warn("[AI-Image] OpenRouter returned response but no image found:", JSON.stringify(resp.data).substring(0, 500));
        } catch (e) {
          await this._handleKeyError(orKey, e, 'openrouter');
          const errMsg = e.response?.data?.error?.message || e.message;
          errors.push(`OpenRouter (${imageModel}): ${errMsg}`);
          console.error("[AI-Image] OpenRouter failed:", errMsg);
        }
      }
    }

    // ===== 4. Copyright-Free Topic Images — Openverse CC0 / Wikimedia / Bing CC / Google CC =====
    const recordUsedUrl = (u) => {
      if (!u || !options.excludeUrls) return;
      if (options.excludeUrls instanceof Set) options.excludeUrls.add(u);
      else if (Array.isArray(options.excludeUrls) && !options.excludeUrls.includes(u)) options.excludeUrls.push(u);
    };

    const englishVisualQuery = this._extractEnglishVisualKeywords(
      prompt,
      `${options.searchQuery || ""} ${options.fallbackQuery || ""}`
    );
    const rawQueries = [
      englishVisualQuery,
      options.searchQuery,
      options.fallbackQuery,
      this._cleanImageSearchQuery(prompt),
    ].filter(Boolean);

    const uniqueQueries = [...new Set(rawQueries.map(q => this._cleanImageSearchQuery(q)).filter(Boolean))];

    for (const q of uniqueQueries) {
      try {
        console.log(`[AI-Image] 🔍 Auto-searching Copyright-Free Images for: "${q}"...`);
        const candidates = await this.searchRealImages(q, {
          apiKeys,
          excludeUrls: options.excludeUrls,
          strictCopyright: true,
          limit: 10,
          minResults: 4,
        });

        for (const cand of candidates.slice(0, 6)) {
          try {
            const savedLocalUrl = await this.downloadAndStoreImage(cand.url, "google", cand.thumbUrl);
            recordUsedUrl(cand.url);
            if (cand.thumbUrl) recordUsedUrl(cand.thumbUrl);
            console.log(`[AI-Image] ✅ Auto-attached Copyright-Free Image (${cand.source}) → ${savedLocalUrl}`);
            return savedLocalUrl;
          } catch (dlErr) {
            // Try next candidate if hotlink-blocked or invalid
            continue;
          }
        }
      } catch (searchErr) {
        errors.push(`FreeImageSearch("${q}"): ${searchErr.message}`);
        console.warn(`[AI-Image] Search failed for "${q}":`, searchErr.message);
      }
    }

    // ===== 5. Photo Stock APIs — Unsplash → Pexels → Pixabay =====
    const cleanPrompt = (options.searchQuery || options.fallbackQuery || prompt).replace(/[^\p{L}\p{N}\s,.-]/gu, "").substring(0, 200).trim();
    const searchKeywords = cleanPrompt.split(/[,.\s]+/).filter(w => w.length > 2).slice(0, 5).join(" ");

    // 4a. Unsplash
    const unsplashKey = apiKeys.find(k => k.provider === "unsplash" && k.active);
    if (unsplashKey) {
      try {
        console.log(`[AI-Image] Trying Unsplash, query: "${searchKeywords}"...`);
        const resp = await axios.get("https://api.unsplash.com/search/photos", {
          params: { query: searchKeywords, per_page: 1, orientation: "landscape", client_id: unsplashKey.apiKey },
          timeout: 10000,
        });
        if (resp.data?.results?.[0]?.urls?.regular) {
          console.log("[AI-Image] Unsplash success");
          return resp.data.results[0].urls.regular;
        }
      } catch (e) {
        errors.push(`Unsplash: ${e.message}`);
        console.error("[AI-Image] Unsplash failed:", e.message);
      }
    }

    // 4b. Pexels
    const pexelsKey = apiKeys.find(k => k.provider === "pexels" && k.active);
    if (pexelsKey) {
      try {
        console.log(`[AI-Image] Trying Pexels, query: "${searchKeywords}"...`);
        const resp = await axios.get("https://api.pexels.com/v1/search", {
          headers: { Authorization: pexelsKey.apiKey },
          params: { query: searchKeywords, per_page: 1, orientation: "landscape" },
          timeout: 10000,
        });
        if (resp.data?.photos?.[0]?.src?.large) {
          console.log("[AI-Image] Pexels success");
          return resp.data.photos[0].src.large;
        }
      } catch (e) {
        errors.push(`Pexels: ${e.message}`);
        console.error("[AI-Image] Pexels failed:", e.message);
      }
    }

    // 4c. Pixabay
    const pixabayKey = apiKeys.find(k => k.provider === "pixabay" && k.active);
    if (pixabayKey) {
      try {
        console.log(`[AI-Image] Trying Pixabay, query: "${searchKeywords}"...`);
        const resp = await axios.get("https://pixabay.com/api/", {
          params: { key: pixabayKey.apiKey, q: searchKeywords, per_page: 3, image_type: "photo", orientation: "horizontal", safesearch: "true" },
          timeout: 10000,
        });
        if (resp.data?.hits?.[0]?.largeImageURL) {
          console.log("[AI-Image] Pixabay success");
          return resp.data.hits[0].largeImageURL;
        }
      } catch (e) {
        errors.push(`Pixabay: ${e.message}`);
        console.error("[AI-Image] Pixabay failed:", e.message);
      }
    }

    // ===== 5. FREE FALLBACKS — Pollinations.ai → Picsum.photos =====
    // NOTE: Both services return dynamic URLs that change on each load.
    // We MUST download the image and convert to base64 to keep it stable.

    // Helper: download image and convert to base64 data URI
    const downloadAsBase64 = async (url, timeoutMs = 60000) => {
      const resp = await axios.get(url, {
        timeout: timeoutMs,
        responseType: "arraybuffer",
        maxContentLength: 5 * 1024 * 1024, // 5MB max
        maxRedirects: 5,
      });
      const contentType = resp.headers["content-type"] || "image/jpeg";
      const base64 = Buffer.from(resp.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    };

    // 5a. Pollinations.ai (free, AI-generated, no API key)
    try {
      const encodedPrompt = encodeURIComponent(prompt.substring(0, 500));
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${Date.now()}`;
      console.log(`[AI-Image] Trying Pollinations.ai fallback...`);

      const base64DataUri = await downloadAsBase64(pollinationsUrl, 90000);
      const pollinUrl = imageStore.normalizeImageUrl(base64DataUri, 'pollinations');
      console.log(`[AI-Image] Pollinations.ai success → ${pollinUrl}`);
      return pollinUrl;
    } catch (e) {
      errors.push(`Pollinations.ai: ${e.message}`);
      console.error(`[AI-Image] Pollinations.ai failed:`, e.message);
    }

    // 5b. Picsum.photos (reliable placeholder, always works)
    try {
      const picsumUrl = `https://picsum.photos/${width}/${height}`;
      console.log(`[AI-Image] Trying Picsum.photos fallback...`);

      const base64DataUri = await downloadAsBase64(picsumUrl, 15000);
      const picsumSavedUrl = imageStore.normalizeImageUrl(base64DataUri, 'picsum');
      console.log(`[AI-Image] Picsum.photos success → ${picsumSavedUrl}`);
      return picsumSavedUrl;
    } catch (e) {
      errors.push(`Picsum: ${e.message}`);
    }

    // Final error (should rarely reach here since picsum is very reliable)
    const allErrors = errors.join("; ");
    console.error("[AI-Image] All providers failed:", allErrors);
    throw new Error(`Tất cả provider tạo ảnh đều thất bại. ${allErrors}`);
  }
}

module.exports = new AiService();
