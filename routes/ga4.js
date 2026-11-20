const express = require("express");
const router = express.Router();
const axios = require("axios");
const crypto = require("crypto");
const storage = require("../services/storage");

/**
 * Google Analytics 4 (GA4) Integration Routes
 *
 * Dùng chung OAuth Client + Redirect URI (`/api/gsc/callback`) thông qua `state.flow = "ga4"`
 * nên KHÔNG cần cấu hình thêm Redirect URI mới trên Google Cloud Console.
 *
 * GET  /api/ga4/status             — Trạng thái kết nối GA4
 * GET  /api/ga4/auth-url           — Tạo URL đăng nhập Google OAuth (scope analytics.readonly)
 * POST /api/ga4/disconnect         — Ngắt kết nối & xóa cache
 * GET  /api/ga4/properties         — Tự động lấy danh sách GA4 Properties (kèm manual properties)
 * POST /api/ga4/properties/manual  — Thêm tay Property ID dự phòng
 * GET  /api/ga4/overview           — Tổng quan KPI + Trend theo ngày + Kênh + Thiết bị + Realtime
 * GET  /api/ga4/events             — Bảng Sự kiện (tách rõ Sự kiện chuyển đổi / Custom vs Hệ thống)
 * GET  /api/ga4/event-pages        — Chi tiết bài viết / URL nào kích hoạt 1 sự kiện cụ thể
 * GET  /api/ga4/pages              — Top trang / bài viết có nhiều lượt xem & tương tác nhất
 * POST /api/ga4/clear-cache        — Xóa cache thủ công
 */

const TOKEN_COLLECTION = "ga4-tokens";
const CACHE_COLLECTION = "ga4-cache";
const CUSTOM_PROP_COLLECTION = "ga4-custom-properties";
const STATE_COLLECTION = "gsc-oauth-states";
const STATE_TTL_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 tiếng

const GA4_DATA_HOST = "https://analyticsdata.googleapis.com/v1beta";
const GA4_ADMIN_HOST = "https://analyticsadmin.googleapis.com/v1beta";

/** Các sự kiện tự động cơ bản của GA4 (ngoài nhóm này là sự kiện tương tác sâu / chuyển đổi / custom) */
const SYSTEM_AUTO_EVENTS = new Set([
  "page_view",
  "session_start",
  "first_visit",
  "user_engagement",
  "scroll",
]);

/** Các sự kiện có tính tương tác trung gian mặc định */
const ENHANCED_INTERACTION_EVENTS = new Set([
  "click",
  "file_download",
  "video_start",
  "video_progress",
  "video_complete",
]);

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalizePropertyId(raw) {
  const clean = String(raw || "")
    .trim()
    .replace(/^properties\//i, "")
    .replace(/[^0-9]/g, "");
  return clean;
}

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

async function getToken(userId) {
  const tokens = await storage.getAll(TOKEN_COLLECTION);
  return tokens.find((t) => t.userId === userId) || null;
}

async function refreshAccessToken(tokenRecord) {
  if (!tokenRecord.refreshToken) {
    const err = new Error("Phiên Google Analytics đã hết hạn (thiếu refresh token). Vui lòng kết nối lại.");
    err.code = "GA4_TOKEN_EXPIRED";
    throw err;
  }
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  try {
    const resp = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRecord.refreshToken,
        grant_type: "refresh_token",
      },
      { timeout: 15000 }
    );
    const { access_token, expires_in } = resp.data;
    const expiresAt = Date.now() + ((expires_in || 3600) - 60) * 1000;
    await storage.update(TOKEN_COLLECTION, tokenRecord.id, {
      accessToken: access_token,
      expiresAt,
    });
    return access_token;
  } catch (e) {
    if (e.response?.data?.error === "invalid_grant") {
      const err = new Error("Quyền kết nối Google Analytics đã hết hạn hoặc bị thu hồi. Vui lòng bấm Kết nối lại.");
      err.code = "GA4_TOKEN_EXPIRED";
      throw err;
    }
    throw e;
  }
}

async function getValidAccessToken(userId, { forceRefresh = false } = {}) {
  const token = await getToken(userId);
  if (!token) {
    const err = new Error("Google Analytics chưa được kết nối");
    err.code = "GA4_NOT_CONNECTED";
    throw err;
  }
  if (token.missingScope) {
    const err = new Error(
      "Tài khoản Google chưa cấp quyền đọc dữ liệu Google Analytics. Vui lòng bấm 'Cấp lại quyền Google' và tích chọn ô quyền Analytics."
    );
    err.code = "GA4_MISSING_SCOPE";
    throw err;
  }
  if (forceRefresh || Date.now() > (token.expiresAt || 0)) {
    return await refreshAccessToken(token);
  }
  return token.accessToken;
}

function parseGa4Error(error) {
  if (
    error.code === "GA4_TOKEN_EXPIRED" ||
    error.code === "GA4_MISSING_SCOPE" ||
    error.code === "GA4_NOT_CONNECTED"
  ) {
    return {
      httpStatus: 400,
      payload: { error: error.message, code: error.code },
    };
  }

  const upstreamStatus = error.response?.status;
  const gErr = error.response?.data?.error;
  const rawMessage =
    (typeof gErr === "object" ? gErr?.message : gErr) ||
    error.response?.data?.error_description ||
    error.message ||
    "Lỗi không xác định khi gọi Google Analytics API";

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

  if (
    reasons.includes("SERVICE_DISABLED") ||
    reasons.includes("accessNotConfigured") ||
    lowerMsg.includes("has not been used in project") ||
    lowerMsg.includes("it is disabled") ||
    lowerMsg.includes("api has not been enabled")
  ) {
    const isAdminApi = lowerMsg.includes("analyticsadmin");
    const serviceSlug = isAdminApi
      ? "analyticsadmin.googleapis.com"
      : "analyticsdata.googleapis.com";
    const actionUrl = projectNumber
      ? `https://console.cloud.google.com/apis/library/${serviceSlug}?project=${projectNumber}`
      : `https://console.cloud.google.com/apis/library/${serviceSlug}`;
    const secondaryUrl = projectNumber
      ? `https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com?project=${projectNumber}`
      : "https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com";

    return {
      httpStatus: 502,
      payload: {
        error: isAdminApi
          ? "Google Analytics Admin API chưa được bật trên Google Cloud Project của hệ thống."
          : "Google Analytics Data API chưa được bật trên Google Cloud Project của hệ thống. Hãy bật API bên dưới, đợi ~30 giây rồi bấm Tải lại.",
        code: "GA4_API_DISABLED",
        actionUrl,
        secondaryUrl,
        detail: rawMessage,
      },
    };
  }

  if (
    reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    lowerMsg.includes("insufficient authentication scopes")
  ) {
    return {
      httpStatus: 400,
      payload: {
        error:
          "Tài khoản Google chưa cấp quyền đọc dữ liệu Analytics. Vui lòng bấm 'Cấp lại quyền Google' và tích chọn ô quyền xem dữ liệu Google Analytics.",
        code: "GA4_MISSING_SCOPE",
        detail: rawMessage,
      },
    };
  }

  if (upstreamStatus === 401 || reasons.includes("UNAUTHENTICATED")) {
    return {
      httpStatus: 400,
      payload: {
        error: "Phiên kết nối Google Analytics đã hết hạn. Vui lòng kết nối lại tài khoản Google.",
        code: "GA4_TOKEN_EXPIRED",
        detail: rawMessage,
      },
    };
  }

  if (upstreamStatus === 403) {
    return {
      httpStatus: 502,
      payload: {
        error: `Tài khoản Google hiện tại không có quyền xem Property GA4 này (403): ${rawMessage}`,
        code: "GA4_FORBIDDEN",
        detail: rawMessage,
      },
    };
  }

  return {
    httpStatus: 500,
    payload: {
      error: rawMessage,
      code: "GA4_UPSTREAM_ERROR",
      detail: rawMessage,
    },
  };
}

function sendGa4Error(res, error, label = "GA4") {
  const { httpStatus, payload } = parseGa4Error(error);
  console.error(`[${label}] Error (${payload.code}):`, payload.detail || payload.error);
  return res.status(httpStatus).json(payload);
}

async function callGa4Api(userId, { method = "POST", url, data = undefined }) {
  let accessToken = await getValidAccessToken(userId);
  try {
    return await axios({
      method,
      url,
      data,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 25000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      accessToken = await getValidAccessToken(userId, { forceRefresh: true });
      return await axios({
        method,
        url,
        data,
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 25000,
      });
    }
    throw err;
  }
}

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

async function setCache(cacheKey, data) {
  const all = await storage.getAll(CACHE_COLLECTION);
  const old = all.find((c) => c.cacheKey === cacheKey);
  if (old) await storage.delete(CACHE_COLLECTION, old.id);
  await storage.create(CACHE_COLLECTION, { cacheKey, data });
}

function buildChannelFilter(channel) {
  if (!channel || channel === "all") return undefined;
  return {
    filter: {
      fieldName: "sessionDefaultChannelGroup",
      stringFilter: {
        matchType: "EXACT",
        value: channel,
      },
    },
  };
}

function classifyEvent(eventName) {
  const name = String(eventName || "").trim();
  const lower = name.toLowerCase();
  if (SYSTEM_AUTO_EVENTS.has(lower)) {
    return { category: "system", isCustomOrLead: false, label: "Tự động" };
  }
  if (
    /(hotline|zalo|call|phone|messenger|chat|lead|form_submit|contact|purchase|checkout|add_to_cart|booking|order|map|register|sign_up)/i.test(
      lower
    )
  ) {
    return { category: "conversion", isCustomOrLead: true, label: "Chuyển đổi / Liên hệ" };
  }
  if (ENHANCED_INTERACTION_EVENTS.has(lower)) {
    return { category: "interaction", isCustomOrLead: false, label: "Tương tác" };
  }
  return { category: "custom", isCustomOrLead: true, label: "Sự kiện riêng" };
}

// ============================================================
// Shared OAuth Callback Handler (invoked by /api/gsc/callback when state.flow === 'ga4')
// ============================================================
async function handleGa4OAuthCallback(req, res, stateRecord) {
  const { code } = req.query;
  const userId = stateRecord.userId;

  try {
    const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
    const tokenResp = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      },
      { timeout: 15000 }
    );

    const { access_token, refresh_token, expires_in, scope = "" } = tokenResp.data;
    const expiresAt = Date.now() + ((expires_in || 3600) - 60) * 1000;
    const grantedScopes = String(scope);
    const hasAnalyticsScope =
      !grantedScopes || grantedScopes.includes("analytics");

    let email = null;
    try {
      const userResp = await axios.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${access_token}` }, timeout: 10000 }
      );
      email = userResp.data.email;
    } catch {}

    const existing = await getToken(userId);
    const finalRefreshToken = refresh_token || existing?.refreshToken || null;
    if (existing) await storage.delete(TOKEN_COLLECTION, existing.id);

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
      missingScope: !hasAnalyticsScope,
    });

    if (!hasAnalyticsScope) {
      return res.redirect(`${CLIENT_URL}/ga4?ga4=error&msg=missing_scope`);
    }

    return res.redirect(`${CLIENT_URL}/ga4?ga4=success`);
  } catch (error) {
    console.error("[GA4] OAuth callback error:", error.response?.data || error.message);
    const msg = error.response?.status === 400 ? "invalid_code" : "server_error";
    return res.redirect(`${CLIENT_URL}/ga4?ga4=error&msg=${msg}`);
  }
}

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/ga4/status
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
 * GET /api/ga4/auth-url
 */
router.get("/auth-url", async (req, res) => {
  const { clientId, redirectUri } = getGoogleOAuthConfig();
  if (!clientId) {
    return res.status(400).json({
      error: "GOOGLE_CLIENT_ID chưa được cấu hình trên server.",
    });
  }

  const scopes = [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ].join(" ");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");

  const state = crypto.randomBytes(32).toString("hex");
  await storage.create(STATE_COLLECTION, {
    state,
    userId: req.user.id,
    flow: "ga4",
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  url.searchParams.set("state", state);

  res.json({ url: url.toString() });
});

/**
 * POST /api/ga4/disconnect
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
 * GET /api/ga4/properties
 * Liệt kê danh sách GA4 Properties từ Google Analytics Admin API + manual properties
 */
router.get("/properties", async (req, res) => {
  try {
    const force = req.query.refresh === "1" || req.query.refresh === "true";
    const cacheKey = `${req.user.id}:ga4:properties`;

    const allManual = await storage.getAll(CUSTOM_PROP_COLLECTION);
    const userManual = allManual
      .filter((p) => p.userId === req.user.id)
      .map((p) => ({
        propertyId: p.propertyId,
        displayName: p.displayName || `Property ${p.propertyId}`,
        accountName: "Thêm thủ công",
        isManual: true,
      }));

    if (!force) {
      const cached = await getCache(cacheKey);
      if (cached) {
        const merged = [...cached];
        for (const mp of userManual) {
          if (!merged.some((x) => x.propertyId === mp.propertyId)) merged.push(mp);
        }
        return res.json({ properties: merged, fromCache: true });
      }
    }

    let autoProps = [];
    let adminApiWarning = null;

    try {
      const resp = await callGa4Api(req.user.id, {
        method: "GET",
        url: `${GA4_ADMIN_HOST}/accountSummaries?pageSize=200`,
      });
      const summaries = resp.data.accountSummaries || [];
      for (const acc of summaries) {
        const accountName = acc.displayName || acc.account || "";
        for (const prop of acc.propertySummaries || []) {
          const propertyId = normalizePropertyId(prop.property);
          if (!propertyId) continue;
          autoProps.push({
            propertyId,
            displayName: prop.displayName || `Property ${propertyId}`,
            accountName,
            isManual: false,
          });
        }
      }
      await setCache(cacheKey, autoProps);
    } catch (err) {
      const parsed = parseGa4Error(err);
      // Nếu chỉ thiếu Analytics Admin API nhưng user đã nhập tay Property ID thì vẫn trả về dùng bình thường!
      if (parsed.payload.code === "GA4_API_DISABLED" && String(parsed.payload.detail || "").toLowerCase().includes("analyticsadmin")) {
        adminApiWarning = {
          message:
            "Chưa bật Google Analytics Admin API nên chưa tự động quét danh sách Property. Bạn có thể bấm bật Admin API bên dưới hoặc nhập thẳng mã Property ID (dãy số) để xem báo cáo ngay.",
          actionUrl: parsed.payload.actionUrl,
        };
      } else {
        throw err;
      }
    }

    const merged = [...autoProps];
    for (const mp of userManual) {
      if (!merged.some((x) => x.propertyId === mp.propertyId)) merged.push(mp);
    }

    res.json({ properties: merged, adminApiWarning });
  } catch (error) {
    return sendGa4Error(res, error, "GA4/Properties");
  }
});

/**
 * POST /api/ga4/properties/manual
 * Cho phép lưu nhanh Property ID dạng số (dự phòng khi chưa bật Admin API)
 */
router.post("/properties/manual", async (req, res) => {
  try {
    const propertyId = normalizePropertyId(req.body?.propertyId);
    const displayName = String(req.body?.displayName || "").trim();
    if (!propertyId || propertyId.length < 5) {
      return res.status(400).json({ error: "Property ID không hợp lệ (ví dụ: 412345678)." });
    }

    const all = await storage.getAll(CUSTOM_PROP_COLLECTION);
    const existing = all.find(
      (p) => p.userId === req.user.id && p.propertyId === propertyId
    );
    if (existing) {
      await storage.update(CUSTOM_PROP_COLLECTION, existing.id, {
        displayName: displayName || existing.displayName || `Property ${propertyId}`,
      });
    } else {
      await storage.create(CUSTOM_PROP_COLLECTION, {
        userId: req.user.id,
        propertyId,
        displayName: displayName || `Property ${propertyId}`,
      });
    }

    res.json({
      success: true,
      property: {
        propertyId,
        displayName: displayName || `Property ${propertyId}`,
        accountName: "Thêm thủ công",
        isManual: true,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ga4/overview?propertyId=...&days=28&channel=all
 * Chạy batchRunReports (4 báo cáo gộp 1 request) + Realtime activeUsers
 */
router.get("/overview", async (req, res) => {
  try {
    const propertyId = normalizePropertyId(req.query.propertyId);
    if (!propertyId) return res.status(400).json({ error: "propertyId là bắt buộc" });

    const safeDays = clampInt(req.query.days, 28, 1, 365);
    const channel = String(req.query.channel || "all");
    const dimensionFilter = buildChannelFilter(channel);

    const cacheKey = `${req.user.id}:ga4:overview:${propertyId}:${safeDays}:${channel}`;
    const cached = await getCache(cacheKey);

    // Realtime luôn lấy tươi nhẹ nhàng (không cache 3 tiếng)
    const fetchRealtime = async () => {
      try {
        const rtResp = await callGa4Api(req.user.id, {
          method: "POST",
          url: `${GA4_DATA_HOST}/properties/${propertyId}:runRealtimeReport`,
          data: {
            metrics: [{ name: "activeUsers" }],
          },
        });
        const val =
          rtResp.data?.totals?.[0]?.metricValues?.[0]?.value ??
          rtResp.data?.rows?.[0]?.metricValues?.[0]?.value ??
          "0";
        return parseInt(val, 10) || 0;
      } catch {
        return null;
      }
    };

    if (cached) {
      const realtimeUsers = await fetchRealtime();
      return res.json({ ...cached, realtimeUsers, fromCache: true });
    }

    const dateRanges = [{ startDate: `${safeDays}daysAgo`, endDate: "today" }];

    const [batchResp, realtimeUsers] = await Promise.all([
      callGa4Api(req.user.id, {
        method: "POST",
        url: `${GA4_DATA_HOST}/properties/${propertyId}:batchRunReports`,
        data: {
          requests: [
            // 0: Dimensionless Totals
            {
              dateRanges,
              metrics: [
                { name: "totalUsers" },
                { name: "newUsers" },
                { name: "sessions" },
                { name: "screenPageViews" },
                { name: "engagementRate" },
                { name: "bounceRate" },
                { name: "averageSessionDuration" },
                { name: "eventCount" },
                { name: "keyEvents" },
              ],
              ...(dimensionFilter ? { dimensionFilter } : {}),
            },
            // 1: Daily Trend
            {
              dateRanges,
              dimensions: [{ name: "date" }],
              metrics: [
                { name: "sessions" },
                { name: "totalUsers" },
                { name: "screenPageViews" },
                { name: "eventCount" },
              ],
              ...(dimensionFilter ? { dimensionFilter } : {}),
              orderBys: [{ dimension: { dimensionName: "date" } }],
              limit: safeDays + 5,
            },
            // 2: Channels
            {
              dateRanges,
              dimensions: [{ name: "sessionDefaultChannelGroup" }],
              metrics: [
                { name: "sessions" },
                { name: "totalUsers" },
                { name: "engagementRate" },
                { name: "eventCount" },
                { name: "keyEvents" },
              ],
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              limit: 15,
            },
            // 3: Devices
            {
              dateRanges,
              dimensions: [{ name: "deviceCategory" }],
              metrics: [
                { name: "sessions" },
                { name: "totalUsers" },
              ],
              ...(dimensionFilter ? { dimensionFilter } : {}),
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              limit: 10,
            },
          ],
        },
      }),
      fetchRealtime(),
    ]);

    const reports = batchResp.data?.reports || [];

    // Parse Totals
    const totalRow = reports[0]?.rows?.[0]?.metricValues || [];
    const totals = {
      totalUsers: parseInt(totalRow[0]?.value || "0", 10),
      newUsers: parseInt(totalRow[1]?.value || "0", 10),
      sessions: parseInt(totalRow[2]?.value || "0", 10),
      pageviews: parseInt(totalRow[3]?.value || "0", 10),
      engagementRate: parseFloat((parseFloat(totalRow[4]?.value || "0") * 100).toFixed(1)),
      bounceRate: parseFloat((parseFloat(totalRow[5]?.value || "0") * 100).toFixed(1)),
      avgSessionDuration: Math.round(parseFloat(totalRow[6]?.value || "0")),
      eventCount: parseInt(totalRow[7]?.value || "0", 10),
      keyEvents: Math.round(parseFloat(totalRow[8]?.value || "0")),
    };

    // Parse Daily Trend
    const trend = (reports[1]?.rows || []).map((r) => {
      const rawDate = r.dimensionValues?.[0]?.value || "";
      const formattedDate =
        rawDate.length === 8
          ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
          : rawDate;
      return {
        date: formattedDate,
        sessions: parseInt(r.metricValues?.[0]?.value || "0", 10),
        users: parseInt(r.metricValues?.[1]?.value || "0", 10),
        pageviews: parseInt(r.metricValues?.[2]?.value || "0", 10),
        events: parseInt(r.metricValues?.[3]?.value || "0", 10),
      };
    });

    // Parse Channels
    const channels = (reports[2]?.rows || []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value || "(Other)",
      sessions: parseInt(r.metricValues?.[0]?.value || "0", 10),
      users: parseInt(r.metricValues?.[1]?.value || "0", 10),
      engagementRate: parseFloat((parseFloat(r.metricValues?.[2]?.value || "0") * 100).toFixed(1)),
      events: parseInt(r.metricValues?.[3]?.value || "0", 10),
      keyEvents: Math.round(parseFloat(r.metricValues?.[4]?.value || "0")),
    }));

    // Parse Devices
    const devices = (reports[3]?.rows || []).map((r) => ({
      device: r.dimensionValues?.[0]?.value || "other",
      sessions: parseInt(r.metricValues?.[0]?.value || "0", 10),
      users: parseInt(r.metricValues?.[1]?.value || "0", 10),
    }));

    const payload = { propertyId, days: safeDays, channel, totals, trend, channels, devices };
    await setCache(cacheKey, payload);
    res.json({ ...payload, realtimeUsers });
  } catch (error) {
    return sendGa4Error(res, error, "GA4/Overview");
  }
});

/**
 * GET /api/ga4/events?propertyId=...&days=28&channel=all&limit=200
 * Bảng đầy đủ Sự kiện GA4 (giống hệt màn hình Events trên GA4 + phân loại Sự kiện chuyển đổi/custom)
 */
router.get("/events", async (req, res) => {
  try {
    const propertyId = normalizePropertyId(req.query.propertyId);
    if (!propertyId) return res.status(400).json({ error: "propertyId là bắt buộc" });

    const safeDays = clampInt(req.query.days, 28, 1, 365);
    const safeLimit = clampInt(req.query.limit, 200, 1, 500);
    const channel = String(req.query.channel || "all");
    const dimensionFilter = buildChannelFilter(channel);

    const cacheKey = `${req.user.id}:ga4:events:${propertyId}:${safeDays}:${channel}:${safeLimit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });

    const resp = await callGa4Api(req.user.id, {
      method: "POST",
      url: `${GA4_DATA_HOST}/properties/${propertyId}:runReport`,
      data: {
        dateRanges: [{ startDate: `${safeDays}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "eventName" }],
        metrics: [
          { name: "eventCount" },
          { name: "totalUsers" },
          { name: "eventCountPerUser" },
          { name: "totalRevenue" },
        ],
        ...(dimensionFilter ? { dimensionFilter } : {}),
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        metricAggregations: ["TOTAL"],
        limit: safeLimit,
      },
    });

    const currencyCode = resp.data?.metadata?.currencyCode || "VND";
    const totalAgg = resp.data?.totals?.[0]?.metricValues || [];
    const grandTotalEvents = parseInt(totalAgg[0]?.value || "0", 10);
    const grandTotalUsers = parseInt(totalAgg[1]?.value || "0", 10);

    const rawRows = resp.data?.rows || [];
    const sumEventsFallback = rawRows.reduce(
      (s, r) => s + parseInt(r.metricValues?.[0]?.value || "0", 10),
      0
    );
    const denomEvents = grandTotalEvents || sumEventsFallback || 1;

    const events = rawRows.map((r) => {
      const eventName = r.dimensionValues?.[0]?.value || "(not set)";
      const eventCount = parseInt(r.metricValues?.[0]?.value || "0", 10);
      const totalUsers = parseInt(r.metricValues?.[1]?.value || "0", 10);
      const eventsPerUser = parseFloat(parseFloat(r.metricValues?.[2]?.value || "0").toFixed(2));
      const totalRevenue = parseFloat(parseFloat(r.metricValues?.[3]?.value || "0").toFixed(2));
      const eventSharePct = parseFloat(((eventCount / denomEvents) * 100).toFixed(2));
      const userSharePct =
        grandTotalUsers > 0
          ? parseFloat(((totalUsers / grandTotalUsers) * 100).toFixed(2))
          : 0;
      const meta = classifyEvent(eventName);

      return {
        eventName,
        eventCount,
        eventSharePct,
        totalUsers,
        userSharePct,
        eventsPerUser,
        totalRevenue,
        category: meta.category,
        isCustomOrLead: meta.isCustomOrLead,
        categoryLabel: meta.label,
      };
    });

    const customEventsCount = events
      .filter((e) => e.isCustomOrLead)
      .reduce((sum, e) => sum + e.eventCount, 0);

    const payload = {
      events,
      currencyCode,
      totalEvents: grandTotalEvents || sumEventsFallback,
      totalUsers: grandTotalUsers,
      customEventsCount,
    };

    await setCache(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    return sendGa4Error(res, error, "GA4/Events");
  }
});

/**
 * GET /api/ga4/event-pages?propertyId=...&eventName=click_zalo&days=28&channel=all
 * Xem chi tiết những trang / bài viết nào phát sinh 1 sự kiện cụ thể
 */
router.get("/event-pages", async (req, res) => {
  try {
    const propertyId = normalizePropertyId(req.query.propertyId);
    const eventName = String(req.query.eventName || "").trim();
    if (!propertyId || !eventName) {
      return res.status(400).json({ error: "propertyId và eventName là bắt buộc" });
    }

    const safeDays = clampInt(req.query.days, 28, 1, 365);
    const channel = String(req.query.channel || "all");

    const eventFilter = {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: eventName },
      },
    };
    const channelFilter = buildChannelFilter(channel);
    const dimensionFilter = channelFilter
      ? { andGroup: { expressions: [eventFilter, channelFilter] } }
      : eventFilter;

    const resp = await callGa4Api(req.user.id, {
      method: "POST",
      url: `${GA4_DATA_HOST}/properties/${propertyId}:runReport`,
      data: {
        dateRanges: [{ startDate: `${safeDays}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter,
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 30,
      },
    });

    const pages = (resp.data?.rows || []).map((r) => ({
      pagePath: r.dimensionValues?.[0]?.value || "/",
      pageTitle: r.dimensionValues?.[1]?.value || "",
      eventCount: parseInt(r.metricValues?.[0]?.value || "0", 10),
      totalUsers: parseInt(r.metricValues?.[1]?.value || "0", 10),
    }));

    res.json({ eventName, pages });
  } catch (error) {
    return sendGa4Error(res, error, "GA4/EventPages");
  }
});

/**
 * GET /api/ga4/pages?propertyId=...&days=28&channel=all&limit=100
 * Top trang / bài viết trên website
 */
router.get("/pages", async (req, res) => {
  try {
    const propertyId = normalizePropertyId(req.query.propertyId);
    if (!propertyId) return res.status(400).json({ error: "propertyId là bắt buộc" });

    const safeDays = clampInt(req.query.days, 28, 1, 365);
    const safeLimit = clampInt(req.query.limit, 100, 1, 300);
    const channel = String(req.query.channel || "all");
    const dimensionFilter = buildChannelFilter(channel);

    const cacheKey = `${req.user.id}:ga4:pages:${propertyId}:${safeDays}:${channel}:${safeLimit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ pages: cached, fromCache: true });

    const resp = await callGa4Api(req.user.id, {
      method: "POST",
      url: `${GA4_DATA_HOST}/properties/${propertyId}:runReport`,
      data: {
        dateRanges: [{ startDate: `${safeDays}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "totalUsers" },
          { name: "sessions" },
          { name: "engagementRate" },
          { name: "averageSessionDuration" },
          { name: "eventCount" },
        ],
        ...(dimensionFilter ? { dimensionFilter } : {}),
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: safeLimit,
      },
    });

    const pages = (resp.data?.rows || []).map((r) => ({
      pagePath: r.dimensionValues?.[0]?.value || "/",
      pageTitle: r.dimensionValues?.[1]?.value || "",
      pageviews: parseInt(r.metricValues?.[0]?.value || "0", 10),
      users: parseInt(r.metricValues?.[1]?.value || "0", 10),
      sessions: parseInt(r.metricValues?.[2]?.value || "0", 10),
      engagementRate: parseFloat((parseFloat(r.metricValues?.[3]?.value || "0") * 100).toFixed(1)),
      avgDuration: Math.round(parseFloat(r.metricValues?.[4]?.value || "0")),
      events: parseInt(r.metricValues?.[5]?.value || "0", 10),
    }));

    await setCache(cacheKey, pages);
    res.json({ pages });
  } catch (error) {
    return sendGa4Error(res, error, "GA4/Pages");
  }
});

/**
 * GET /api/ga4/streams?propertyId=...
 * Lấy Measurement ID (`G-XXXXXXXXXX`) và URL website từ Data Streams của GA4 Property
 */
router.get("/streams", async (req, res) => {
  try {
    const propertyId = normalizePropertyId(req.query.propertyId);
    if (!propertyId) return res.status(400).json({ error: "propertyId là bắt buộc" });

    const resp = await callGa4Api(req.user.id, {
      method: "GET",
      url: `${GA4_ADMIN_HOST}/properties/${propertyId}/dataStreams`,
    });

    const streams = (resp.data?.dataStreams || [])
      .filter((s) => s.webStreamData?.measurementId)
      .map((s) => ({
        streamName: s.displayName || "",
        measurementId: s.webStreamData.measurementId,
        defaultUri: s.webStreamData.defaultUri || "",
      }));

    res.json({
      propertyId,
      measurementId: streams[0]?.measurementId || "",
      defaultUri: streams[0]?.defaultUri || "",
      streams,
    });
  } catch {
    // Nếu chưa bật Admin API thì trả rỗng nhẹ nhàng, không làm gián đoạn giao diện
    res.json({ propertyId: req.query.propertyId, measurementId: "", streams: [] });
  }
});

/**
 * POST /api/ga4/clear-cache
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

module.exports = { router, handleGa4OAuthCallback };
