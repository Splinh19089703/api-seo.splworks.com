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
 * GET  /api/gsc/trend           — Trend theo ngày
 * POST /api/gsc/clear-cache     — Xóa cache thủ công
 */

// ============================================================
// Helpers
// ============================================================

const TOKEN_COLLECTION = "gsc-tokens";
const CACHE_COLLECTION = "gsc-cache";
const STATE_COLLECTION = "gsc-oauth-states";
const STATE_TTL_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 tiếng

const GSC_PRIMARY_HOST = "https://searchconsole.googleapis.com";
const GSC_LEGACY_HOST = "https://www.googleapis.com";

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Client URL for OAuth redirects (production: https://seo.splworks.com) */
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const projectNumber = clientId.includes("-") ? clientId.split("-")[0] : "";
  return {
    clientId,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    projectNumber,
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
 * Refresh access token nếu sắp hết hạn hoặc bị 401
 */
async function refreshAccessToken(tokenRecord) {
  if (!tokenRecord.refreshToken) {
    const err = new Error("Phiên Google Search Console đã hết hạn (thiếu refresh token). Vui lòng kết nối lại.");
    err.code = "GSC_TOKEN_EXPIRED";
    throw err;
  }
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  try {
    const resp = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRecord.refreshToken,
      grant_type: "refresh_token",
    }, { timeout: 15000 });
    const { access_token, expires_in } = resp.data;
    const expiresAt = Date.now() + ((expires_in || 3600) - 60) * 1000;
    await storage.update(TOKEN_COLLECTION, tokenRecord.id, {
      accessToken: access_token,
      expiresAt,
    });
    return access_token;
  } catch (e) {
    const oauthErr = e.response?.data?.error || "";
    if (oauthErr === "invalid_grant") {
      const err = new Error("Quyền kết nối Google đã hết hạn hoặc bị thu hồi. Vui lòng bấm Kết nối lại.");
      err.code = "GSC_TOKEN_EXPIRED";
      throw err;
    }
    throw e;
  }
}

/**
 * Lấy valid access token theo userId (auto-refresh nếu cần)
 */
async function getValidAccessToken(userId, { forceRefresh = false } = {}) {
  const token = await getToken(userId);
  if (!token) {
    const err = new Error("GSC chưa được kết nối");
    err.code = "GSC_NOT_CONNECTED";
    throw err;
  }
  if (token.missingScope) {
    const err = new Error(
      "Tài khoản Google chưa cấp quyền đọc dữ liệu Search Console. Vui lòng bấm 'Cấp lại quyền Google' và tích chọn ô quyền Search Console."
    );
    err.code = "GSC_MISSING_SCOPE";
    throw err;
  }
  if (forceRefresh || Date.now() > (token.expiresAt || 0)) {
    return await refreshAccessToken(token);
  }
  return token.accessToken;
}

/**
 * Chuẩn hóa lỗi trả về từ Google API sang tiếng Việt rõ nguyên nhân + hướng xử lý.
 * Lưu ý: KHÔNG trả HTTP 403 về client vì client/src/api.js hiểu 403 là lỗi khóa gói License!
 */
function parseGoogleError(error) {
  if (error.code === "GSC_TOKEN_EXPIRED" || error.code === "GSC_MISSING_SCOPE" || error.code === "GSC_NOT_CONNECTED") {
    return {
      httpStatus: 400,
      payload: {
        error: error.message,
        code: error.code,
      },
    };
  }

  const upstreamStatus = error.response?.status;
  const gErr = error.response?.data?.error;
  const rawMessage =
    (typeof gErr === "object" ? gErr?.message : gErr) ||
    error.response?.data?.error_description ||
    error.message ||
    "Lỗi không xác định khi gọi Google Search Console API";

  const details = Array.isArray(gErr?.details) ? gErr.details : [];
  const reasons = [
    ...(Array.isArray(gErr?.errors) ? gErr.errors.map((x) => x.reason) : []),
    ...details.map((d) => d.reason),
    gErr?.status,
  ]
    .filter(Boolean)
    .join(" ");

  const lowerMsg = String(rawMessage).toLowerCase();
  const { projectNumber } = getGoogleOAuthConfig();

  // 1. Google Search Console API chưa được bật trong Google Cloud Project
  if (
    reasons.includes("SERVICE_DISABLED") ||
    reasons.includes("accessNotConfigured") ||
    lowerMsg.includes("has not been used in project") ||
    lowerMsg.includes("it is disabled") ||
    lowerMsg.includes("api has not been enabled")
  ) {
    let actionUrl = "";
    for (const d of details) {
      if (d?.metadata?.activationUrl) {
        actionUrl = d.metadata.activationUrl;
        break;
      }
    }
    if (!actionUrl) {
      const urlMatch = String(rawMessage).match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"']+/);
      if (urlMatch) actionUrl = urlMatch[0];
    }
    if (!actionUrl) {
      actionUrl = projectNumber
        ? `https://console.cloud.google.com/apis/library/searchconsole.googleapis.com?project=${projectNumber}`
        : "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com";
    }

    return {
      httpStatus: 502,
      payload: {
        error:
          "Google Search Console API chưa được bật trên Google Cloud Project của hệ thống. Hãy bấm nút bên dưới để bật (Enable), đợi khoảng 1 phút rồi bấm Tải lại.",
        code: "GSC_API_DISABLED",
        actionUrl,
        detail: rawMessage,
      },
    };
  }

  // 2. User quên tích chọn checkbox quyền Search Console trên màn hình Google Consent
  if (
    reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    lowerMsg.includes("insufficient authentication scopes") ||
    lowerMsg.includes("insufficient permission") && lowerMsg.includes("scope")
  ) {
    return {
      httpStatus: 400,
      payload: {
        error:
          "Tài khoản Google chưa được cấp quyền xem dữ liệu Search Console (bạn có thể đã bỏ tích ô quyền trên màn hình đăng nhập Google). Vui lòng bấm 'Cấp lại quyền Google' và tích chọn đầy đủ quyền.",
        code: "GSC_MISSING_SCOPE",
        detail: rawMessage,
      },
    };
  }

  // 3. Token hết hạn / bị thu hồi (401)
  if (upstreamStatus === 401 || reasons.includes("UNAUTHENTICATED") || lowerMsg.includes("invalid credentials")) {
    return {
      httpStatus: 400,
      payload: {
        error: "Phiên kết nối Google Search Console đã hết hạn. Vui lòng kết nối lại tài khoản Google.",
        code: "GSC_TOKEN_EXPIRED",
        detail: rawMessage,
      },
    };
  }

  // 4. Không có quyền truy cập property cụ thể (403 forbidden trên 1 siteUrl)
  if (upstreamStatus === 403) {
    return {
      httpStatus: 502,
      payload: {
        error: `Google từ chối truy cập dữ liệu Search Console (403): ${rawMessage}`,
        code: "GSC_FORBIDDEN",
        detail: rawMessage,
      },
    };
  }

  return {
    httpStatus: 500,
    payload: {
      error: rawMessage,
      code: "GSC_UPSTREAM_ERROR",
      detail: rawMessage,
    },
  };
}

function sendGoogleError(res, error, contextLabel = "GSC") {
  const { httpStatus, payload } = parseGoogleError(error);
  console.error(`[${contextLabel}] Error (${payload.code}):`, payload.detail || payload.error);
  return res.status(httpStatus).json(payload);
}

/**
 * Gọi Google Search Console REST API:
 * - Ưu tiên host mới `https://searchconsole.googleapis.com` (dịch vụ Google Search Console API v1)
 * - Tự fallback sang `https://www.googleapis.com` nếu dự án GCP cũ chỉ bật legacy Webmasters API
 * - Tự refresh access token 1 lần nếu gặp HTTP 401
 */
async function callGscApi(userId, { method = "GET", path, data = undefined }) {
  let accessToken = await getValidAccessToken(userId);

  const doRequest = async (host, token) => {
    return await axios({
      method,
      url: `${host}${path}`,
      data,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 25000,
    });
  };

  try {
    return await doRequest(GSC_PRIMARY_HOST, accessToken);
  } catch (primaryErr) {
    const status = primaryErr.response?.status;

    // Nếu 401 -> thử force refresh token 1 lần rồi gọi lại
    if (status === 401) {
      accessToken = await getValidAccessToken(userId, { forceRefresh: true });
      return await doRequest(GSC_PRIMARY_HOST, accessToken);
    }

    // Nếu searchconsole.googleapis.com báo 403/404 do project chỉ bật webmasters.googleapis.com cũ -> thử fallback
    if (status === 403 || status === 404) {
      try {
        return await doRequest(GSC_LEGACY_HOST, accessToken);
      } catch {
        // Ném lỗi gốc từ searchconsole.googleapis.com để hiển thị đúng link kích hoạt searchconsole.googleapis.com
        throw primaryErr;
      }
    }

    throw primaryErr;
  }
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
      missingScope: !!token.missingScope,
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
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent"); // Force refresh_token + re-prompt scopes
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
 * GET /api/gsc/callback?code=xxx&state=xxx
 * OAuth callback — PUBLIC (không qua licenseGuard)
 */
async function callbackHandler(req, res) {
  const { code, state, error: oauthError } = req.query;
  if (oauthError) {
    // Kiểm tra state để redirect về đúng trang (/ga4 hoặc /gsc) nếu người dùng bấm Hủy
    if (state) {
      try {
        const states = await storage.getAll(STATE_COLLECTION);
        const st = states.find((item) => item.state === state);
        if (st?.flow === "ga4") {
          await storage.delete(STATE_COLLECTION, st.id);
          return res.redirect(`${CLIENT_URL}/ga4?ga4=error&msg=${encodeURIComponent(oauthError)}`);
        }
        if (st?.flow === "gtm") {
          await storage.delete(STATE_COLLECTION, st.id);
          return res.redirect(`${CLIENT_URL}/ga4?mode=gtm&gtm=error&msg=${encodeURIComponent(oauthError)}`);
        }
      } catch {}
    }
    return res.redirect(`${CLIENT_URL}/gsc?gsc=error&msg=${encodeURIComponent(oauthError)}`);
  }
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

    // Chuyển luồng sang Google Analytics 4 hoặc Google Tag Manager nếu state thuộc flow tương ứng
    if (stateRecord.flow === "ga4") {
      const { handleGa4OAuthCallback } = require("./ga4");
      return await handleGa4OAuthCallback(req, res, stateRecord);
    }
    if (stateRecord.flow === "gtm") {
      const { handleGtmOAuthCallback } = require("./gtm");
      return await handleGtmOAuthCallback(req, res, stateRecord);
    }

    const userId = stateRecord.userId;

    const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
    const tokenResp = await axios.post("https://oauth2.googleapis.com/token", {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }, { timeout: 15000 });

    const { access_token, refresh_token, expires_in, scope = "" } = tokenResp.data;
    const expiresAt = Date.now() + ((expires_in || 3600) - 60) * 1000;
    const grantedScopes = String(scope);
    const hasWebmastersScope =
      !grantedScopes || grantedScopes.includes("webmasters");

    // Lấy email user
    let email = null;
    try {
      const userResp = await axios.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${access_token}` }, timeout: 10000 }
      );
      email = userResp.data.email;
    } catch {}

    // Giữ lại refreshToken cũ nếu lần này Google không trả refresh_token mới
    const existing = await getToken(userId);
    const finalRefreshToken = refresh_token || existing?.refreshToken || null;
    if (existing) await storage.delete(TOKEN_COLLECTION, existing.id);

    // Xóa cache cũ khi kết nối lại để luôn tải danh sách site mới nhất
    const caches = await storage.getAll(CACHE_COLLECTION);
    for (const c of caches) {
      if (c.cacheKey?.startsWith(`${userId}:`)) {
        await storage.delete(CACHE_COLLECTION, c.id);
      }
    }

    await storage.create(TOKEN_COLLECTION, {
      userId,
      accessToken: access_token,
      refreshToken: finalRefreshToken,
      expiresAt,
      email,
      scope: grantedScopes,
      missingScope: !hasWebmastersScope,
    });

    if (!hasWebmastersScope) {
      return res.redirect(`${CLIENT_URL}/gsc?gsc=error&msg=missing_scope`);
    }

    res.redirect(`${CLIENT_URL}/gsc?gsc=success`);
  } catch (error) {
    console.error("[GSC] OAuth callback error:", error.response?.data || error.message);
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
      try {
        await axios.post(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.accessToken)}`,
          null,
          { timeout: 8000 }
        );
      } catch {}
    }
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
    const force = req.query.refresh === "1" || req.query.refresh === "true";
    const cacheKey = `${req.user.id}:gsc:sites`;
    if (!force) {
      const cached = await getCache(cacheKey);
      if (cached) return res.json({ sites: cached, fromCache: true });
    }

    const resp = await callGscApi(req.user.id, {
      method: "GET",
      path: "/webmasters/v3/sites",
    });

    const sites = (resp.data.siteEntry || []).map((s) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
    }));
    await setCache(cacheKey, sites);
    res.json({ sites });
  } catch (error) {
    return sendGoogleError(res, error, "GSC/Sites");
  }
});

/**
 * POST /api/gsc/data
 * Pull analytics data (hỗ trợ cả dimensionless aggregate `dimensions: []` để lấy tổng chính xác)
 */
router.post("/data", async (req, res) => {
  try {
    const {
      siteUrl,
      startDate,
      endDate,
      dimensions = [],
      rowLimit = 100,
    } = req.body;
    if (!siteUrl) return res.status(400).json({ error: "siteUrl là bắt buộc" });

    const dims = Array.isArray(dimensions) ? dimensions : ["query"];
    const safeRowLimit = dims.length === 0 ? 1 : clampInt(rowLimit, 100, 1, 1000);
    const cacheKey = `${req.user.id}:gsc:data:${siteUrl}:${startDate}:${endDate}:${dims.join(",") || "total"}:${safeRowLimit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });

    const resp = await callGscApi(req.user.id, {
      method: "POST",
      path: `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      data: {
        startDate,
        endDate,
        dimensions: dims,
        rowLimit: safeRowLimit,
        dataState: "all",
      },
    });

    const rawRows = resp.data.rows || [];
    const rows = rawRows.map((row) => {
      const result = {
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: parseFloat(((row.ctr || 0) * 100).toFixed(2)),
        position: parseFloat((row.position || 0).toFixed(1)),
      };
      dims.forEach((dim, i) => {
        if (row.keys && row.keys[i] !== undefined) {
          result[dim] = row.keys[i];
        }
      });
      return result;
    });

    let totals;
    if (dims.length === 0) {
      const agg = rawRows[0];
      totals = agg
        ? {
            clicks: agg.clicks || 0,
            impressions: agg.impressions || 0,
            avgCtr: parseFloat(((agg.ctr || 0) * 100).toFixed(2)),
            avgPosition: parseFloat((agg.position || 0).toFixed(1)),
          }
        : { clicks: 0, impressions: 0, avgCtr: 0, avgPosition: 0 };
    } else {
      const sums = rows.reduce(
        (acc, row) => ({
          clicks: acc.clicks + row.clicks,
          impressions: acc.impressions + row.impressions,
        }),
        { clicks: 0, impressions: 0 }
      );
      totals = {
        ...sums,
        avgCtr:
          sums.impressions > 0
            ? parseFloat(((sums.clicks / sums.impressions) * 100).toFixed(2))
            : 0,
        avgPosition:
          sums.impressions > 0
            ? parseFloat(
                (
                  rows.reduce((s, r) => s + r.position * r.impressions, 0) /
                  sums.impressions
                ).toFixed(1)
              )
            : 0,
      };
    }

    const payload = {
      siteUrl,
      startDate,
      endDate,
      rows,
      totals,
      total: rows.length,
    };
    await setCache(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    return sendGoogleError(res, error, "GSC/Data");
  }
});

/**
 * GET /api/gsc/top-queries?siteUrl=...&days=28
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

    const resp = await callGscApi(req.user.id, {
      method: "POST",
      path: `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      data: {
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit: safeLimit,
        dataState: "all",
      },
    });

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
    return sendGoogleError(res, error, "GSC/TopQueries");
  }
});

/**
 * GET /api/gsc/top-pages?siteUrl=...&days=28
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

    const resp = await callGscApi(req.user.id, {
      method: "POST",
      path: `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      data: {
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: safeLimit,
        dataState: "all",
      },
    });

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
    return sendGoogleError(res, error, "GSC/TopPages");
  }
});

/**
 * GET /api/gsc/trend?siteUrl=...&days=28
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

    const resp = await callGscApi(req.user.id, {
      method: "POST",
      path: `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      data: {
        startDate,
        endDate,
        dimensions: ["date"],
        rowLimit: safeDays + 5,
        dataState: "all",
      },
    });

    const trend = (resp.data.rows || [])
      .map((row) => ({
        date: row.keys[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: parseFloat((row.ctr * 100).toFixed(2)),
        position: parseFloat(row.position.toFixed(1)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    await setCache(cacheKey, trend);
    res.json({ trend, startDate, endDate });
  } catch (error) {
    return sendGoogleError(res, error, "GSC/Trend");
  }
});

/**
 * POST /api/gsc/clear-cache
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
