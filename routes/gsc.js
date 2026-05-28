const express = require("express");
const router = express.Router();
const axios = require("axios");
const crypto = require("crypto");
const storage = require("../services/storage");

/**
 * Google Search Console Integration Routes
 *
 * GET  /api/gsc/status          — Trạng thái kết nối GSC (đã connect chưa)
 * GET  /api/gsc/auth-url        — Lấy Google OAuth URL để redirect
 * GET  /api/gsc/callback        — OAuth callback (code → tokens)
 * POST /api/gsc/disconnect      — Xóa tokens, ngắt kết nối
 * GET  /api/gsc/sites           — Danh sách sites trong GSC account
 * POST /api/gsc/data            — Pull analytics data (clicks, impressions, CTR, position)
 * GET  /api/gsc/top-queries     — Top keywords theo site
 * GET  /api/gsc/top-pages       — Top pages theo site
 */

// ============================================================
// Helpers
// ============================================================

const TOKEN_COLLECTION = "gsc-tokens";
const CACHE_COLLECTION = "gsc-cache";
const STATE_COLLECTION = "gsc-oauth-states";
const STATE_TTL_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 tiếng

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Client URL for OAuth redirects (production: https://seo.splworks.com) */
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

function getGoogleOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      "http://localhost:3001/api/gsc/callback",
  };
}

/**
 * Lấy token record của một user cụ thể
 */
async function getToken(userId) {
  const tokens = await storage.getAll(TOKEN_COLLECTION);
  return tokens.find((t) => t.userId === userId) || null;
}

/**
 * Refresh access token nếu sắp hết hạn
 */
async function refreshAccessToken(tokenRecord) {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const resp = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokenRecord.refreshToken,
    grant_type: "refresh_token",
  });
  const { access_token, expires_in } = resp.data;
  const expiresAt = Date.now() + (expires_in - 60) * 1000;
  await storage.update(TOKEN_COLLECTION, tokenRecord.id, {
    accessToken: access_token,
    expiresAt,
  });
  return access_token;
}

/**
 * Lấy valid access token theo userId (auto-refresh nếu cần)
 */
async function getValidAccessToken(userId) {
  const token = await getToken(userId);
  if (!token) throw new Error("GSC chưa được kết nối");
  if (Date.now() > (token.expiresAt || 0)) {
    return await refreshAccessToken(token);
  }
  return token.accessToken;
}

/**
 * Lấy cache từ DB
 */
async function getCache(cacheKey) {
  const all = await storage.getAll(CACHE_COLLECTION);
  const hit = all.find((c) => c.cacheKey === cacheKey);
  if (!hit) return null;
  if (Date.now() - new Date(hit.createdAt).getTime() > CACHE_TTL_MS) {
    await storage.delete(CACHE_COLLECTION, hit.id);
    return null;
  }
  return hit.data;
}

/**
 * Lưu cache vào DB
 */
async function setCache(cacheKey, data) {
  // Xóa cache cũ nếu có
  const all = await storage.getAll(CACHE_COLLECTION);
  const old = all.find((c) => c.cacheKey === cacheKey);
  if (old) await storage.delete(CACHE_COLLECTION, old.id);
  await storage.create(CACHE_COLLECTION, { cacheKey, data });
}

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/gsc/status
 * Kiểm tra đã kết nối GSC chưa
 */
router.get("/status", async (req, res) => {
  try {
    const token = await getToken(req.user.id);
    if (!token) {
      return res.json({ connected: false });
    }
    res.json({
      connected: true,
      email: token.email || null,
      connectedAt: token.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/gsc/auth-url
 * Tạo Google OAuth URL
 */
router.get("/auth-url", async (req, res) => {
  const { clientId, redirectUri } = getGoogleOAuthConfig();
  if (!clientId) {
    return res.status(400).json({
      error:
        "GOOGLE_CLIENT_ID chưa được cấu hình. Vui lòng thêm vào file .env",
    });
  }
  const scopes = [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ].join(" ");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // Force refresh_token
  // Truyền userId qua state để callback biết ai đang kết nối
  const state = crypto.randomBytes(32).toString("hex");
  await storage.create(STATE_COLLECTION, {
    state,
    userId: req.user.id,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  url.searchParams.set("state", state);
  res.json({ url: url.toString() });
});

/**
 * GET /api/gsc/callback?code=xxx&state=userId
 * OAuth callback — PUBLIC (không qua licenseGuard)
 * Được export riêng để index.js mount trước guard
 */
async function callbackHandler(req, res) {
  const { code, state } = req.query;
  if (!code) {
    return res.redirect(`${CLIENT_URL}/gsc?gsc=error&msg=no_code`);
  }
  if (!state) {
    return res.redirect(`${CLIENT_URL}/gsc?gsc=error&msg=missing_state`);
  }
  try {
    const states = await storage.getAll(STATE_COLLECTION);
    const stateRecord = states.find((item) => item.state === state);
    if (!stateRecord || Date.now() > stateRecord.expiresAt) {
      return res.redirect(`${CLIENT_URL}/gsc?gsc=error&msg=invalid_state`);
    }
    await storage.delete(STATE_COLLECTION, stateRecord.id);
    const userId = stateRecord.userId;

    const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
    // Exchange code for tokens
    const tokenResp = await axios.post("https://oauth2.googleapis.com/token", {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const { access_token, refresh_token, expires_in } = tokenResp.data;
    const expiresAt = Date.now() + (expires_in - 60) * 1000;

    // Lấy email user
    let email = null;
    try {
      const userResp = await axios.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      email = userResp.data.email;
    } catch {}

    // Xóa token cũ của user này nếu có
    const existing = await getToken(userId);
    if (existing) await storage.delete(TOKEN_COLLECTION, existing.id);

    // Lưu tokens mới kèm userId
    await storage.create(TOKEN_COLLECTION, {
      userId,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt,
      email,
    });

    // Redirect về GSC với success
    res.redirect(`${CLIENT_URL}/gsc?gsc=success`);
  } catch (error) {
    console.error("[GSC] OAuth callback error:", error.message);
    const msg = error.response?.status === 400 ? "invalid_code" : "server_error";
    res.redirect(`${CLIENT_URL}/gsc?gsc=error&msg=${msg}`);
  }
}

/**
 * POST /api/gsc/disconnect
 * Xóa tokens, ngắt kết nối
 */
router.post("/disconnect", async (req, res) => {
  try {
    const token = await getToken(req.user.id);
    if (token) {
      await storage.delete(TOKEN_COLLECTION, token.id);
      // Revoke token tại Google (best-effort)
      try {
        await axios.post(
          `https://oauth2.googleapis.com/revoke?token=${token.accessToken}`
        );
      } catch {}
    }
    // Xóa cache của user này
    const caches = await storage.getAll(CACHE_COLLECTION);
    for (const c of caches) {
      if (c.cacheKey?.startsWith(`${req.user.id}:`)) {
        await storage.delete(CACHE_COLLECTION, c.id);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/gsc/sites
 * Danh sách sites trong GSC
 */
router.get("/sites", async (req, res) => {
  try {
    const cacheKey = `${req.user.id}:gsc:sites`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ sites: cached, fromCache: true });

    const accessToken = await getValidAccessToken(req.user.id);
    const resp = await axios.get(
      "https://www.googleapis.com/webmasters/v3/sites",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const sites = (resp.data.siteEntry || []).map((s) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
    }));
    await setCache(cacheKey, sites);
    res.json({ sites });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/gsc/data
 * Pull analytics data
 * Body: { siteUrl, startDate, endDate, dimensions, rowLimit }
 */
router.post("/data", async (req, res) => {
  try {
    const {
      siteUrl,
      startDate,
      endDate,
      dimensions = ["query"],
      rowLimit = 100,
    } = req.body;
    if (!siteUrl) return res.status(400).json({ error: "siteUrl là bắt buộc" });

    const safeRowLimit = clampInt(rowLimit, 100, 1, 1000);
    const cacheKey = `${req.user.id}:gsc:data:${siteUrl}:${startDate}:${endDate}:${dimensions.join(",")}:${safeRowLimit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });

    const accessToken = await getValidAccessToken(req.user.id);
    const resp = await axios.post(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        startDate,
        endDate,
        dimensions,
        rowLimit: safeRowLimit,
        dataState: "all",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const rows = (resp.data.rows || []).map((row) => {
      const result = {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: parseFloat((row.ctr * 100).toFixed(2)),
        position: parseFloat(row.position.toFixed(1)),
      };
      dimensions.forEach((dim, i) => {
        result[dim] = row.keys[i];
      });
      return result;
    });

    const totals = rows.reduce(
      (acc, row) => ({
        clicks: acc.clicks + row.clicks,
        impressions: acc.impressions + row.impressions,
      }),
      { clicks: 0, impressions: 0 }
    );

    const payload = {
      siteUrl,
      startDate,
      endDate,
      rows,
      totals: {
        ...totals,
        avgCtr:
          totals.impressions > 0
            ? parseFloat(
                ((totals.clicks / totals.impressions) * 100).toFixed(2)
              )
            : 0,
        avgPosition: (() => {
          const totalImpr = rows.reduce((s, r) => s + r.impressions, 0);
          return totalImpr > 0
            ? parseFloat((rows.reduce((s, r) => s + r.position * r.impressions, 0) / totalImpr).toFixed(1))
            : 0;
        })(),
      },
      total: rows.length,
    };
    await setCache(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    const status = error.response?.status;
    if (status === 403) {
      return res.status(403).json({
        error: "Không có quyền truy cập site này trong GSC",
        detail: error.response?.data?.error?.message,
      });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/gsc/top-queries?siteUrl=...&days=28
 * Top keywords (theo clicks)
 */
router.get("/top-queries", async (req, res) => {
  try {
    const { siteUrl, days = 28, limit = 50 } = req.query;
    if (!siteUrl) return res.status(400).json({ error: "siteUrl là bắt buộc" });

    const safeDays = clampInt(days, 28, 1, 180);
    const safeLimit = clampInt(limit, 50, 1, 1000);
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - safeDays * 86400000)
      .toISOString()
      .split("T")[0];

    const cacheKey = `${req.user.id}:gsc:top-queries:${siteUrl}:${safeDays}:${safeLimit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ queries: cached, fromCache: true });

    const accessToken = await getValidAccessToken(req.user.id);
    const resp = await axios.post(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit: safeLimit,
        dataState: "all",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const queries = (resp.data.rows || []).map((row) => ({
      query: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: parseFloat((row.ctr * 100).toFixed(2)),
      position: parseFloat(row.position.toFixed(1)),
    }));

    await setCache(cacheKey, queries);
    res.json({ queries, total: queries.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/gsc/top-pages?siteUrl=...&days=28
 * Top pages (theo clicks)
 */
router.get("/top-pages", async (req, res) => {
  try {
    const { siteUrl, days = 28, limit = 50 } = req.query;
    if (!siteUrl) return res.status(400).json({ error: "siteUrl là bắt buộc" });

    const safeDays = clampInt(days, 28, 1, 180);
    const safeLimit = clampInt(limit, 50, 1, 1000);
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - safeDays * 86400000)
      .toISOString()
      .split("T")[0];

    const cacheKey = `${req.user.id}:gsc:top-pages:${siteUrl}:${safeDays}:${safeLimit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ pages: cached, fromCache: true });

    const accessToken = await getValidAccessToken(req.user.id);
    const resp = await axios.post(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: safeLimit,
        dataState: "all",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const pages = (resp.data.rows || []).map((row) => ({
      page: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: parseFloat((row.ctr * 100).toFixed(2)),
      position: parseFloat(row.position.toFixed(1)),
    }));

    await setCache(cacheKey, pages);
    res.json({ pages, total: pages.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/gsc/trend?siteUrl=...&days=28
 * Trend data theo ngày (clicks + impressions)
 */
router.get("/trend", async (req, res) => {
  try {
    const { siteUrl, days = 28 } = req.query;
    if (!siteUrl) return res.status(400).json({ error: "siteUrl là bắt buộc" });

    const safeDays = clampInt(days, 28, 1, 180);
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - safeDays * 86400000)
      .toISOString()
      .split("T")[0];

    const cacheKey = `${req.user.id}:gsc:trend:${siteUrl}:${safeDays}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ trend: cached, fromCache: true });

    const accessToken = await getValidAccessToken(req.user.id);
    const resp = await axios.post(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        startDate,
        endDate,
        dimensions: ["date"],
        rowLimit: safeDays,
        dataState: "all",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const trend = (resp.data.rows || []).map((row) => ({
      date: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: parseFloat((row.ctr * 100).toFixed(2)),
      position: parseFloat(row.position.toFixed(1)),
    }));

    await setCache(cacheKey, trend);
    res.json({ trend, startDate, endDate });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/gsc/clear-cache
 * Xóa cache thủ công để lấy dữ liệu mới
 */
router.post("/clear-cache", async (req, res) => {
  try {
    const caches = await storage.getAll(CACHE_COLLECTION);
    const userPrefix = `${req.user.id}:`;
    const userCaches = caches.filter((c) => c.cacheKey?.startsWith(userPrefix));
    for (const c of userCaches) await storage.delete(CACHE_COLLECTION, c.id);
    res.json({ success: true, cleared: userCaches.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, callbackHandler };
