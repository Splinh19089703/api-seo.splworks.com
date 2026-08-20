/**
 * License Guard Middleware
 * Validates auth token and license for SPLSEO app routes
 * 
 * DEV_SKIP_AUTH=true → bypass all checks (development mode)
 */
const licenseClient = require("../services/license-client");

// Admin user IDs from env (comma-separated)
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

function isAdminUser(userId) {
  return ADMIN_USER_IDS.includes(userId);
}

// Default "unlimited" mock for dev mode and admin override
const UNLIMITED_LICENSE = {
  plan: "unlimited",
  status: "active",
  limits: { maxArticlesPerMonth: 999999, maxProjects: 999999, maxDevices: 99, maxAudits: 999999 },
  features: {
    aiWriting: true, aiImage: true, wpPublish: true,
    multiPlatform: true, internalLinks: true, knowledgeBase: true,
    seoAudit: true, googleSearchConsole: true, prioritySupport: true, affiliate: true,
  },
};

const DEV_USAGE = { articlesCreated: 0, articlesPublished: 0, aiCalls: 0 };

/**
 * Main license guard middleware
 */
async function licenseGuard(req, res, next) {
  // DEV mode: skip all checks
  if (process.env.DEV_SKIP_AUTH === "true") {
    req.license = UNLIMITED_LICENSE;
    req.usage = DEV_USAGE;
    req.authToken = "dev-token";
    req.userId = "dev-user";
    req.isAdmin = true;
    return next();
  }

  try {
    // Get token from request header only. A server-wide stored token would
    // collapse multiple browser users into the same tenant.
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ 
        error: "Chưa đăng nhập", 
        code: "NOT_AUTHENTICATED",
        requireAuth: true,
      });
    }

    // Validate license
    const result = await licenseClient.validateLicense(token, null, "splseo");
    
    if (!result.valid && !result.license) {
      return res.status(403).json({ 
        error: result.error || "License không hợp lệ",
        code: result.code || "INVALID_LICENSE",
        requireAuth: true,
      });
    }

    req.license = result.license;
    req.usage = result.usage;
    req.authToken = token;
    req.userId = result.userId || "unknown";
    req.isAdmin = isAdminUser(req.userId) || result.user?.role === "admin" || result.role === "admin";
    req.user = { id: req.userId, isAdmin: req.isAdmin, role: req.isAdmin ? "admin" : (result.user?.role || "user") };
    if (!result.userId || result.userId === "unknown") {
      return res.status(401).json({
        error: "Không xác định được người dùng",
        code: "UNKNOWN_USER",
        requireAuth: true,
      });
    }

    // Admin override: unlimited license regardless of actual plan
    if (req.isAdmin) {
      req.license = UNLIMITED_LICENSE;
      req.usage = DEV_USAGE;
    }

    next();
  } catch (error) {
    console.error("[LicenseGuard] Error:", error.error || error.message || error);
    
    // Optional local-only fallback, disabled by default.
    if (process.env.ALLOW_LICENSE_FALLBACK === "true" && process.env.NODE_ENV !== "production") {
      console.warn("[LicenseGuard] License server unreachable, allowing access in dev mode");
      req.license = UNLIMITED_LICENSE;
      req.usage = DEV_USAGE;
      req.authToken = "fallback-dev-token";
      req.userId = "dev-user";
      req.isAdmin = true;
      req.user = { id: req.userId, isAdmin: true };
      return next();
    }
    
    return res.status(503).json({ 
      error: "Không thể kết nối license server",
      code: "LICENSE_SERVER_DOWN",
    });
  }
}

/**
 * Feature gate middleware factory
 * Usage: router.use(featureGate("seoAudit"))
 */
function featureGate(featureName) {
  return (req, res, next) => {
    if (process.env.DEV_SKIP_AUTH === "true") return next();
    
    if (!req.license?.features?.[featureName]) {
      return res.status(403).json({
        error: `Tính năng "${featureName}" không có trong gói ${req.license?.plan || "hiện tại"}`,
        code: "FEATURE_LOCKED",
        feature: featureName,
        currentPlan: req.license?.plan,
      });
    }
    next();
  };
}

/**
 * Article limit check middleware
 */
function articleLimitCheck(req, res, next) {
  if (process.env.DEV_SKIP_AUTH === "true") return next();
  
  const limit = req.license?.limits?.maxArticlesPerMonth || 0;
  const used = req.usage?.articlesCreated || 0;
  
  if (used >= limit) {
    return res.status(403).json({
      error: `Đã đạt giới hạn ${limit} bài/tháng. Nâng cấp gói để tạo thêm.`,
      code: "ARTICLE_LIMIT",
      limit,
      used,
      currentPlan: req.license?.plan,
    });
  }
  next();
}

/**
 * Project limit check middleware
 */
function projectLimitCheck(currentCount) {
  return (req, res, next) => {
    if (process.env.DEV_SKIP_AUTH === "true") return next();
    
    const limit = req.license?.limits?.maxProjects || 0;
    if (currentCount >= limit) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${limit} dự án. Nâng cấp gói để tạo thêm.`,
        code: "PROJECT_LIMIT",
        limit,
        used: currentCount,
        currentPlan: req.license?.plan,
      });
    }
    next();
  };
}

/**
 * Audit limit check middleware
 */
function auditLimitCheck(currentCount) {
  return (req, res, next) => {
    if (process.env.DEV_SKIP_AUTH === "true") return next();
    
    const limit = req.license?.limits?.maxAudits || 3;
    if (currentCount >= limit) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${limit} lần audit (gói ${req.license?.plan || "hiện tại"}). Nâng cấp để audit thêm.`,
        code: "AUDIT_LIMIT",
        limit,
        used: currentCount,
        currentPlan: req.license?.plan,
      });
    }
    next();
  };
}

module.exports = { licenseGuard, featureGate, articleLimitCheck, projectLimitCheck, auditLimitCheck, isAdminUser };
