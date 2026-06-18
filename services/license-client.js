/**
 * License Client — communicate with remote License Server
 * Used by SPLSEO App backend to proxy auth & validate licenses
 */
const http = require("http");
const https = require("https");
const storage = require("./storage");

const LICENSE_SERVER_URL =
  process.env.LICENSE_SERVER_URL || "http://localhost:3002";

// Dynamic cache TTL by plan — trial checks more frequently to prevent post-expiry usage
const CACHE_TTL_MAP = {
  trial:     5 * 60 * 1000,     // 5 minutes (detect expiry quickly)
  basic:     30 * 60 * 1000,    // 30 minutes
  pro:       60 * 60 * 1000,    // 1 hour
  agency:    60 * 60 * 1000,    // 1 hour
  unlimited: 60 * 60 * 1000,    // 1 hour
};
const DEFAULT_CACHE_TTL = 60 * 60 * 1000;

// Per-token cache entries: Map<cacheKey, { data, time, plan }>
const _licenseCacheMap = new Map();

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _licenseCacheMap) {
    const ttl = CACHE_TTL_MAP[entry.plan] || DEFAULT_CACHE_TTL;
    if (now - entry.time >= ttl) {
      _licenseCacheMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Make HTTP request to license server
 */
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, LICENSE_SERVER_URL);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    };

    if (token) {
      options.headers["Authorization"] = `Bearer ${token}`;
    }

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject({ status: res.statusCode, ...json });
          } else {
            resolve(json);
          }
        } catch (e) {
          reject({ status: res.statusCode, error: "Invalid JSON response" });
        }
      });
    });

    req.on("error", (e) => reject({ error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      reject({ error: "License server timeout" });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Login via license server
 */
async function login(email, password) {
  const result = await request("POST", "/auth/login", { email, password });
  // Save token locally
  await saveToken(result.token);
  // Auth responses do not include the full /license/validate payload
  // (notably top-level userId). Keep validation cache separate.
  _licenseCacheMap.clear();
  return result;
}

/**
 * Google Sign-In via license server
 */
async function googleLogin(idToken, referralCode) {
  const body = { idToken };
  if (referralCode) body.referralCode = referralCode;
  const result = await request("POST", "/auth/google", body);
  await saveToken(result.token);
  // Auth responses do not include the full /license/validate payload
  // (notably top-level userId). Keep validation cache separate.
  _licenseCacheMap.clear();
  return result;
}

/**
 * Register via license server
 */
async function register(email, password, name, referredBy) {
  const body = { email, password, name };
  if (referredBy) body.referredBy = referredBy;
  const result = await request("POST", "/auth/register", body);
  await saveToken(result.token);
  // Auth responses do not include the full /license/validate payload
  // (notably top-level userId). Keep validation cache separate.
  _licenseCacheMap.clear();
  return result;
}

/**
 * Get current user info
 * @param {string} token
 * @param {boolean} forceRefresh - clear cache before fetching
 */
async function getMe(token, forceRefresh = false) {
  if (forceRefresh) {
    _licenseCacheMap.clear();
  }
  return request("GET", "/auth/me", null, token);
}

/**
 * Validate license (with per-entry caching and dynamic TTL)
 */
async function validateLicense(token, fingerprint, productSlug = "splseo") {
  // Check cache first (per-token entry with plan-based TTL)
  const cacheKey = `${token}:${productSlug}`;
  const cached = _licenseCacheMap.get(cacheKey);
  if (cached) {
    const ttl = CACHE_TTL_MAP[cached.plan] || DEFAULT_CACHE_TTL;
    if (Date.now() - cached.time < ttl) {
      return cached.data;
    }
    // Expired — remove stale entry
    _licenseCacheMap.delete(cacheKey);
  }

  const result = await request(
    "POST",
    "/license/validate",
    {
      deviceFingerprint: fingerprint || "dev-device",
      deviceName: require("os").hostname(),
      os: process.platform,
      productSlug,
    },
    token,
  );

  if (result.valid) {
    _licenseCacheMap.set(cacheKey, {
      data: result,
      time: Date.now(),
      plan: result.license?.plan || "trial",
    });
  }

  return result;
}

/**
 * Report usage to license server
 */
async function reportUsage(token, data) {
  const result = await request("POST", "/license/report-usage", data, token);
  // Invalidate cache so next validate gets fresh data
  _licenseCacheMap.clear();
  return result;
}

/**
 * Get license info
 */
async function getLicenseInfo(token) {
  return request("GET", "/license/info", null, token);
}

/**
 * Change password
 */
async function changePassword(token, currentPassword, newPassword) {
  return request(
    "POST",
    "/auth/change-password",
    { currentPassword, newPassword },
    token,
  );
}

/**
 * Deactivate device
 */
async function deactivateDevice(token, deviceId) {
  return request("POST", "/license/deactivate-device", { deviceId }, token);
}

/**
 * Get plans
 */
async function getPlans() {
  return request("GET", "/plans");
}

/**
 * Create an order
 */
async function createOrder(token, data) {
  return request("POST", "/order/create", data, token);
}

/**
 * Apply coupon (preview discount)
 */
async function applyCoupon(token, data) {
  return request("POST", "/order/apply-coupon", data, token);
}

/**
 * Get user's orders
 */
async function getMyOrders(token) {
  return request("GET", "/order/my-orders", null, token);
}

// ===== Token persistence (in SQLite settings) =====

async function saveToken(token) {
  const settings = await storage.getSettings();
  settings._authToken = token;
  await storage.saveSettings(settings);
}

async function getToken() {
  const settings = await storage.getSettings();
  return settings._authToken || null;
}

async function clearToken() {
  const settings = await storage.getSettings();
  delete settings._authToken;
  await storage.saveSettings(settings);
  _licenseCacheMap.clear();
}

function clearCache() {
  _licenseCacheMap.clear();
}

module.exports = {
  login,
  register,
  googleLogin,
  getMe,
  validateLicense,
  reportUsage,
  getLicenseInfo,
  changePassword,
  deactivateDevice,
  getPlans,
  createOrder,
  applyCoupon,
  getMyOrders,
  saveToken,
  getToken,
  clearToken,
  clearCache,

  // ===== Affiliate / CTV =====
  getAffiliateLink: (token) => request("GET", "/affiliate/my-link", null, token),
  getAffiliateStats: (token) => request("GET", "/affiliate/my-stats", null, token),
  getAffiliateHistory: (token, params = "") => request("GET", `/affiliate/my-history${params}`, null, token),
  requestAffiliatePayout: (token, data) => request("POST", "/affiliate/request-payout", data, token),
};
