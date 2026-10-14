/**
 * social-queue-worker.js — Social Queue Cron Worker
 * Social SPLSEO — Phase 1
 *
 * Multi-tenant: mỗi user có queue riêng, token lưu trong credentials.
 * Runs every 60 seconds, picks up scheduled social posts
 * and publishes them to the respective platforms.
 */

const storage = require("./storage");
const facebookService = require("./facebook-service");
const aiService = require("./ai-service");
const { resolveApiKeys } = require("./api-key-pool");

let isRunning = false;
let intervalId = null;

const POLL_INTERVAL = 60 * 1000; // 60 seconds
const MAX_PER_TICK = 5; // Max items to process per tick

/**
 * Process pending social queue items
 */
async function processSocialQueue() {
  if (isRunning) return;
  isRunning = true;

  try {
    // Get ALL queue items across all users (cron runs globally)
    const allItems = (await storage.getAll("social-queue")) || [];

    // Filter: pending/scheduled items whose time has come
    const now = new Date();
    const dueItems = allItems
      .filter(
        (item) =>
          (item.status === "pending" || item.status === "scheduled") &&
          new Date(item.scheduledAt) <= now
      )
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      .slice(0, MAX_PER_TICK);

    if (!dueItems.length) {
      isRunning = false;
      return;
    }

    console.log(`[Social Queue] Processing ${dueItems.length} items...`);

    for (const item of dueItems) {
      try {
        // Mark as processing
        await storage.update("social-queue", item.id, { status: "processing" });

        // Get the social account (with credentials)
        const account = await storage.getByIdForUser(
          "social-accounts",
          item.accountId,
          item.userId
        );

        if (!account) {
          await storage.update("social-queue", item.id, {
            status: "failed",
            error: "Tài khoản social không tìm thấy hoặc đã bị xóa",
          });
          continue;
        }

        if (!account.active) {
          await storage.update("social-queue", item.id, {
            status: "failed",
            error: "Tài khoản social đã bị tắt",
          });
          continue;
        }

        // Get credentials from account
        const creds = account.credentials || {};
        const pageId = creds.pageId || account.pageId;
        const pageToken = creds.pageToken;

        if (!pageId || !pageToken) {
          await storage.update("social-queue", item.id, {
            status: "failed",
            error: "Thiếu Page ID hoặc Page Token trong tài khoản",
          });
          continue;
        }

        // Build the message
        let message = item.message || "";

        // If useAI and no message yet, generate from OG data via AI (fallback to template)
        if (item.useAI && !message && item.ogData) {
          try {
            const settings = await storage.getUserSettings(item.userId);
            const keys = await resolveApiKeys(item.userId);
            const prompt = `Viết một bài đăng mạng xã hội (Facebook) ngắn gọn, hấp dẫn, chuyên nghiệp bằng tiếng Việt để chia sẻ bài viết sau:\nTiêu đề: ${item.ogData.title || ""}\nMô tả: ${item.ogData.description || ""}\nURL: ${item.url || ""}\nYêu cầu: Mở đầu thu hút, tóm tắt 2-3 ý chính ngắn gọn, kèm lời kêu gọi đọc tiếp và 3-4 hashtag phù hợp. Chỉ trả về nội dung bài đăng, không giải thích thêm.`;
            const aiCaption = await aiService.generate(prompt, settings, keys, {
              feature: "social-caption",
            });
            if (aiCaption && typeof aiCaption === "string" && aiCaption.trim()) {
              message = aiCaption.trim();
            }
          } catch (aiErr) {
            console.warn(`[Social Queue] AI caption failed for ${item.id}, using fallback:`, aiErr.message);
          }
          if (!message) {
            message = generateCaption(item.ogData);
          }
        }

        // If still no message, use OG title
        if (!message && item.ogData?.title) {
          message = item.ogData.title;
        }

        // Publish based on platform
        let result;
        if (account.platform === "facebook") {
          result = await facebookService.publishLink(pageId, pageToken, {
            link: item.url,
            message,
          });
        } else {
          throw new Error(`Platform ${account.platform} chưa được hỗ trợ`);
        }

        // Success — update queue item
        await storage.update("social-queue", item.id, {
          status: "published",
          message,
          publishedAt: new Date().toISOString(),
          result,
          error: null,
        });

        // Save to history
        await storage.createForUser(
          "social-history",
          {
            accountId: account.id,
            accountName: account.pageName,
            platform: account.platform,
            type: "link",
            link: item.url,
            message,
            status: "success",
            result,
            error: null,
            source: "queue",
            ogData: item.ogData || null,
            sharedAt: new Date().toISOString(),
          },
          item.userId
        );

        // Update account stats
        await storage.update("social-accounts", account.id, {
          stats: {
            totalShared: (account.stats?.totalShared || 0) + 1,
            lastShared: new Date().toISOString(),
          },
        });

        console.log(
          `[Social Queue] ✅ Published: ${item.url} → ${account.pageName}`
        );
      } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error(
          `[Social Queue] ❌ Failed: ${item.url} — ${errorMsg}`
        );

        await storage.update("social-queue", item.id, {
          status: "failed",
          error: errorMsg,
        });

        // Save failed history
        try {
          const account = await storage.getByIdForUser(
            "social-accounts",
            item.accountId,
            item.userId
          );
          await storage.createForUser(
            "social-history",
            {
              accountId: item.accountId,
              accountName: account?.pageName || "Unknown",
              platform: item.platform || "facebook",
              type: "link",
              link: item.url,
              message: item.message || "",
              status: "failed",
              result: null,
              error: errorMsg,
              source: "queue",
              sharedAt: new Date().toISOString(),
            },
            item.userId
          );
        } catch {}
      }
    }
  } catch (err) {
    console.error("[Social Queue] Worker error:", err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Generate a simple caption from OG data
 */
function generateCaption(ogData) {
  const parts = [];
  if (ogData.title) parts.push(ogData.title);
  if (ogData.description) {
    const desc =
      ogData.description.length > 200
        ? ogData.description.substring(0, 197) + "..."
        : ogData.description;
    parts.push(desc);
  }
  if (ogData.siteName) parts.push(`📰 ${ogData.siteName}`);
  return parts.join("\n\n") || "";
}

/**
 * Start the social queue worker
 */
function startWorker() {
  if (intervalId) return;
  console.log("[Social Queue] Worker started (polling every 60s)");
  intervalId = setInterval(processSocialQueue, POLL_INTERVAL);
  // Run once after 5s delay
  setTimeout(processSocialQueue, 5000);
}

/**
 * Stop the social queue worker
 */
function stopWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[Social Queue] Worker stopped");
  }
}

module.exports = { startWorker, stopWorker, processSocialQueue };
