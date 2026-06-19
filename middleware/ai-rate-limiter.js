/**
 * AI Rate Limiter — Plan-based rate limiting for AI-heavy endpoints
 * 
 * Limits AI requests per user based on their license plan:
 *   - Trial: 10 req/min
 *   - Basic: 30 req/min
 *   - Pro: 60 req/min
 *   - Agency: 120 req/min
 *   - Unlimited: 200 req/min
 * 
 * Uses userId as key (per-user, not per-IP) so VPN/proxy doesn't affect limits.
 * Must be applied AFTER licenseGuard middleware (needs req.userId and req.license).
 */

const PLAN_LIMITS = {
  trial:     { windowMs: 60 * 1000, max: 10 },
  basic:     { windowMs: 60 * 1000, max: 30 },
  pro:       { windowMs: 60 * 1000, max: 60 },
  agency:    { windowMs: 60 * 1000, max: 120 },
  unlimited: { windowMs: 60 * 1000, max: 200 },
};

// In-memory sliding window counters per user
// Structure: { userId: { count: number, windowStart: number } }
const userWindows = new Map();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of userWindows) {
    if (now - window.windowStart > 5 * 60 * 1000) {
      userWindows.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * AI rate limiter middleware
 * Must be used AFTER licenseGuard
 */
function aiRateLimiter(req, res, next) {
  // DEV mode bypass
  if (process.env.DEV_SKIP_AUTH === "true") return next();
  // Admin bypass
  if (req.isAdmin) return next();

  const userId = req.userId;
  if (!userId) return next();

  const plan = req.license?.plan || "trial";

  // Trial bypass — trial đã bị giới hạn bởi article limit (10 bài) và AI credits (100)
  // Không cần rate limit per-request, để user trải nghiệm mượt mà → chuyển đổi mua
  if (plan === "trial") return next();
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.trial;
  const now = Date.now();

  let window = userWindows.get(userId);

  // Reset window if expired
  if (!window || now - window.windowStart >= limits.windowMs) {
    window = { count: 0, windowStart: now };
    userWindows.set(userId, window);
  }

  window.count++;

  if (window.count > limits.max) {
    const retryAfter = Math.ceil((window.windowStart + limits.windowMs - now) / 1000);

    console.warn(`[AI-RateLimit] User ${userId} (${plan}) exceeded ${limits.max} req/min. Count: ${window.count}`);

    return res.status(429).json({
      error: `Quá nhiều yêu cầu AI. Gói ${plan} giới hạn ${limits.max} lượt/phút. Thử lại sau ${retryAfter}s.`,
      code: "AI_RATE_LIMIT",
      plan,
      limit: limits.max,
      retryAfter,
      upgradeRequired: plan === "trial" || plan === "basic",
    });
  }

  // Add rate limit headers
  res.setHeader("X-RateLimit-Limit", limits.max);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, limits.max - window.count));
  res.setHeader("X-RateLimit-Reset", Math.ceil((window.windowStart + limits.windowMs) / 1000));

  next();
}

/**
 * Get current rate limit status for a user (for dashboard/monitoring)
 */
function getRateLimitStatus(userId) {
  const window = userWindows.get(userId);
  if (!window) return { count: 0, windowStart: null };
  return { count: window.count, windowStart: window.windowStart };
}

module.exports = { aiRateLimiter, getRateLimitStatus, PLAN_LIMITS };
