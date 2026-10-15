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
    const routing = settings.aiProvider?.imageRouting;

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
    const imageChain = this._getImageProviderChain(settings, apiKeys);
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

    // ===== 4. Photo Stock APIs — Unsplash → Pexels → Pixabay =====
    const cleanPrompt = prompt.replace(/[^\w\s,.-]/g, "").substring(0, 200).trim();
    const searchKeywords = cleanPrompt.split(/[,.\s]+/).filter(w => w.length > 3).slice(0, 3).join(" ");

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
