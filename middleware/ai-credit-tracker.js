/**
 * AI Credit Tracker — Track and enforce AI credit usage per user
 * 
 * Credits are consumed for each AI operation:
 *   - Text generation (outline, content, rewrite): 1 credit
 *   - Image generation (thumbnail, section): 3 credits
 *   - Full auto-pipeline (research→content→images): 10 credits
 *   - Keyword clustering: 1 credit
 * 
 * Limits from license plan (aiCreditsPerMonth):
 *   - Trial: 100
 *   - Basic: 500
 *   - Pro: 2,000
 *   - Agency: 10,000
 *   - Unlimited: 50,000
 * 
 * Storage: SQLite via storage service (collection: ai-credits)
 */

const storage = require("../services/storage");

// Credit costs per operation type
const CREDIT_COSTS = {
  text:      1,  // outline, content gen, rewrite, keyword clustering
  image:     3,  // thumbnail or section image
  pipeline: 10,  // full auto-pipeline (includes research + outline + content + images)
  audit:     2,  // SEO audit with AI analysis
};

/**
 * Get current month key (YYYY-MM)
 */
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Get or create AI credit record for user+month
 */
async function getCreditsRecord(userId) {
  const month = getCurrentMonth();
  const recordId = `credits_${userId}_${month}`;

  try {
    const existing = await storage.getById("ai-credits", recordId);
    if (existing) return existing;
  } catch {}

  // Create new record
  const record = {
    id: recordId,
    userId,
    month,
    totalUsed: 0,
    breakdown: { text: 0, image: 0, pipeline: 0, audit: 0 },
    lastUpdated: new Date().toISOString(),
  };

  try {
    return await storage.create("ai-credits", record);
  } catch {
    // Race condition — record was created by another request
    return await storage.getById("ai-credits", recordId);
  }
}

/**
 * Get AI credit usage summary for a user
 */
async function getCreditUsage(userId, license = null) {
  const record = await getCreditsRecord(userId);
  const limit = license?.limits?.aiCreditsPerMonth || 100;

  return {
    used: record.totalUsed,
    limit,
    remaining: Math.max(0, limit - record.totalUsed),
    percentage: Math.min(100, Math.round((record.totalUsed / limit) * 100)),
    breakdown: record.breakdown,
    month: record.month,
  };
}

/**
 * Middleware factory: Check AI credits before allowing operation
 * @param {"text"|"image"|"pipeline"|"audit"} operationType
 */
function checkAiCredits(operationType = "text") {
  const cost = CREDIT_COSTS[operationType] || 1;

  return async (req, res, next) => {
    // DEV mode bypass
    if (process.env.DEV_SKIP_AUTH === "true") return next();
    // Admin bypass
    if (req.isAdmin) return next();

    const userId = req.userId;
    if (!userId || userId === "unknown") return next();

    try {
      const limit = req.license?.limits?.aiCreditsPerMonth || 100;
      const record = await getCreditsRecord(userId);

      if (record.totalUsed + cost > limit) {
        const plan = req.license?.plan || "trial";

        console.warn(`[AI-Credits] User ${userId} (${plan}) exceeded AI credits: ${record.totalUsed}/${limit}`);

        return res.status(403).json({
          error: `Đã hết AI credits tháng này (${record.totalUsed}/${limit}). Nâng cấp gói để có thêm credits.`,
          code: "AI_CREDITS_EXCEEDED",
          used: record.totalUsed,
          limit,
          cost,
          currentPlan: plan,
          upgradeRequired: true,
        });
      }

      // Attach for post-processing
      req._aiCreditCost = cost;
      req._aiCreditsRecord = record;

      next();
    } catch (err) {
      console.error("[AI-Credits] Check error:", err.message);
      // Fail open — don't block if tracking fails
      next();
    }
  };
}

/**
 * Consume AI credits after successful operation
 * Call this AFTER the AI operation succeeds (not in middleware chain)
 * 
 * @param {string} userId
 * @param {"text"|"image"|"pipeline"|"audit"} operationType
 * @param {number} [multiplier=1] — for batch operations
 */
async function consumeCredits(userId, operationType = "text", multiplier = 1) {
  if (process.env.DEV_SKIP_AUTH === "true") return;
  if (!userId || userId === "unknown" || userId === "dev-user") return;

  const cost = (CREDIT_COSTS[operationType] || 1) * multiplier;

  try {
    const record = await getCreditsRecord(userId);

    record.totalUsed += cost;
    if (!record.breakdown) record.breakdown = {};
    record.breakdown[operationType] = (record.breakdown[operationType] || 0) + cost;
    record.lastUpdated = new Date().toISOString();

    await storage.update("ai-credits", record.id, {
      totalUsed: record.totalUsed,
      breakdown: record.breakdown,
      lastUpdated: record.lastUpdated,
    });

    console.log(`[AI-Credits] User ${userId}: +${cost} credits (${operationType}) → total ${record.totalUsed}`);
  } catch (err) {
    console.error("[AI-Credits] Consume error:", err.message);
    // Don't throw — credit tracking failure shouldn't break the app
  }
}

module.exports = {
  CREDIT_COSTS,
  checkAiCredits,
  consumeCredits,
  getCreditUsage,
  getCreditsRecord,
};
