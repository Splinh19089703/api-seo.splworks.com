/**
 * License Enforcement Middleware for SPLSEO App Server
 * Checks usage limits and feature access before allowing operations
 */
const licenseClient = require("../services/license-client");

/**
 * Extract auth token from request
 */
function getAuthToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  return null;
}

/**
 * Get license data (with caching via licenseClient)
 */
async function getLicenseData(req) {
  // DEV mode bypass
  if (process.env.DEV_SKIP_AUTH === "true") {
    return {
      valid: true,
      license: {
        plan: "unlimited",
        limits: { maxArticlesPerMonth: 999999, maxProjects: 999999, maxDevices: 99, maxAudits: 999999, aiCreditsPerMonth: 50000, maxUserApiKeys: 999999 },
        features: {
          aiWriting: true, aiImage: true, wpPublish: true,
          multiPlatform: true, internalLinks: true, knowledgeBase: true,
          seoAudit: true, googleSearchConsole: true, prioritySupport: true, affiliate: true,
          sharedAiPool: true, bringYourOwnKey: true, priorityAiPool: true,
        },
      },
      usage: { articlesCreated: 0, articlesPublished: 0, aiCalls: 0 },
    };
  }

  const token = getAuthToken(req) || await licenseClient.getToken();
  if (!token) return null;

  try {
    return await licenseClient.validateLicense(token, null, "splseo");
  } catch (e) {
    console.error("[LicenseMiddleware] Validate error:", e.message || e);
    return null;
  }
}

/**
 * Middleware: Check article creation limit
 * Use before routes that create new articles
 */
function checkArticleLimit(req, res, next) {
  getLicenseData(req).then(data => {
    if (!data || !data.valid) {
      return res.status(403).json({
        error: "License không hợp lệ",
        code: "NO_LICENSE",
        upgradeRequired: true,
      });
    }

    const { license, usage } = data;
    const max = license.limits?.maxArticlesPerMonth || 0;
    const used = usage?.articlesCreated || 0;

    if (max < 999999 && used >= max) {
      return res.status(403).json({
        error: `Đã đạt giới hạn ${max} bài/tháng (gói ${license.plan}). Nâng cấp để tạo thêm.`,
        code: "ARTICLE_LIMIT",
        upgradeRequired: true,
        limit: max,
        used: used,
        plan: license.plan,
      });
    }

    req.licenseData = data;
    next();
  }).catch(err => {
    console.error("[LicenseMiddleware] checkArticleLimit error:", err);
    // Fail open — allow action if license server is down
    next();
  });
}

/**
 * Middleware: Check project creation limit
 * Use before routes that create new projects
 */
function checkProjectLimit(req, res, next) {
  // This needs project count from local DB, so we just attach license data
  // and let the route handler check against actual project count
  getLicenseData(req).then(data => {
    if (!data || !data.valid) {
      return res.status(403).json({
        error: "License không hợp lệ",
        code: "NO_LICENSE",
        upgradeRequired: true,
      });
    }
    req.licenseData = data;
    next();
  }).catch(err => {
    console.error("[LicenseMiddleware] checkProjectLimit error:", err);
    next();
  });
}

/**
 * Middleware factory: Check if a feature is enabled
 * @param {string} featureName — e.g. "seoAudit", "multiPlatform"
 */
function checkFeature(featureName) {
  return (req, res, next) => {
    getLicenseData(req).then(data => {
      if (!data || !data.valid) {
        return res.status(403).json({
          error: "License không hợp lệ",
          code: "NO_LICENSE",
          upgradeRequired: true,
        });
      }

      const hasFeature = data.license?.features?.[featureName];
      if (!hasFeature) {
        return res.status(403).json({
          error: `Tính năng "${featureName}" cần nâng cấp gói.`,
          code: "FEATURE_LOCKED",
          feature: featureName,
          upgradeRequired: true,
          plan: data.license?.plan,
        });
      }

      req.licenseData = data;
      next();
    }).catch(err => {
      console.error(`[LicenseMiddleware] checkFeature(${featureName}) error:`, err);
      next();
    });
  };
}

/**
 * Middleware: Report usage after successful article creation
 * Call this AFTER the article has been created successfully
 */
async function reportArticleCreated(req, res, next) {
  try {
    if (process.env.DEV_SKIP_AUTH === "true") return next();

    const token = getAuthToken(req) || await licenseClient.getToken();
    if (token) {
      // Fire and forget — don't block the response
      licenseClient.reportUsage(token, { articlesCreated: 1 }).catch(e => {
        console.warn("[LicenseMiddleware] Report usage failed:", e.message || e);
      });
    }
  } catch (e) {
    console.warn("[LicenseMiddleware] reportArticleCreated error:", e);
  }
  next();
}

/**
 * Middleware: Check audit creation limit
 * Counts local audits vs license limit
 */
function checkAuditLimit(req, res, next) {
  getLicenseData(req).then(data => {
    if (!data || !data.valid) {
      return res.status(403).json({
        error: "License không hợp lệ",
        code: "NO_LICENSE",
        upgradeRequired: true,
      });
    }

    req.licenseData = data;
    // Actual count check is done in the route handler
    // because it needs access to local storage
    next();
  }).catch(err => {
    console.error("[LicenseMiddleware] checkAuditLimit error:", err);
    next();
  });
}

module.exports = {
  getAuthToken,
  getLicenseData,
  checkArticleLimit,
  checkProjectLimit,
  checkFeature,
  checkAuditLimit,
  reportArticleCreated,
};
