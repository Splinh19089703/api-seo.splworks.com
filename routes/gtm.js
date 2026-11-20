const express = require("express");
const router = express.Router();
const axios = require("axios");
const crypto = require("crypto");
const storage = require("../services/storage");

/**
 * Google Tag Manager (GTM) API v2 Integration Routes
 *
 * Dùng chung OAuth Client + Redirect URI (`/api/gsc/callback`) qua `state.flow = "gtm"`.
 * Hỗ trợ:
 *  - Xem danh sách Accounts, Containers (`GTM-XXXXXXX`), Tags, Triggers & kiểm tra sức khỏe đo lường.
 *  - 1-Click Tạo tự động Google Tag (`G-XXXXXXXX`) + Bộ Tag Sự kiện Chuyển đổi chuẩn SEO
 *    (`click_hotline`, `click_zalo`, `click_messenger`, `click_map`, `form_submit`) vào GTM Workspace
 *    kèm tùy chọn Xuất bản (Publish) ngay lập tức.
 *  - Xuất file JSON mẫu chuẩn GTM (`exportFormatVersion: 2`) để Import thủ công (không cần cấp quyền ghi).
 */

const TOKEN_COLLECTION = "gtm-tokens";
const CACHE_COLLECTION = "gtm-cache";
const STATE_COLLECTION = "gsc-oauth-states";
const STATE_TTL_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút

const GTM_API_HOST = "https://tagmanager.googleapis.com/tagmanager/v2";
const ALL_PAGES_TRIGGER_ID = "2147479553";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

/** Danh mục bộ Sự kiện Chuyển đổi chuẩn SPLSEO */
const CONVERSION_PRESETS = {
  click_hotline: {
    eventName: "click_hotline",
    tagName: "SPLSEO - GA4 Event - click_hotline",
    triggerName: "SPLSEO - Click Hotline (tel:)",
    triggerType: "LINK_CLICK",
    filterType: "STARTS_WITH",
    filterVar: "{{Click URL}}",
    filterVal: "tel:",
    description: "Khách bấm gọi số điện thoại (link tel:...)",
  },
  click_zalo: {
    eventName: "click_zalo",
    tagName: "SPLSEO - GA4 Event - click_zalo",
    triggerName: "SPLSEO - Click Zalo (zalo.me)",
    triggerType: "LINK_CLICK",
    filterType: "CONTAINS",
    filterVar: "{{Click URL}}",
    filterVal: "zalo.me",
    description: "Khách bấm chat Zalo (link zalo.me/...)",
  },
  click_messenger: {
    eventName: "click_messenger",
    tagName: "SPLSEO - GA4 Event - click_messenger",
    triggerName: "SPLSEO - Click Messenger (m.me)",
    triggerType: "LINK_CLICK",
    filterType: "MATCH_REGEX",
    filterVar: "{{Click URL}}",
    filterVal: "(m\\.me|messenger\\.com)",
    description: "Khách bấm chat Facebook Messenger (m.me / messenger.com)",
  },
  click_map: {
    eventName: "click_map",
    tagName: "SPLSEO - GA4 Event - click_map",
    triggerName: "SPLSEO - Click Google Maps",
    triggerType: "LINK_CLICK",
    filterType: "MATCH_REGEX",
    filterVar: "{{Click URL}}",
    filterVal: "(google\\.com/maps|maps\\.app\\.goo\\.gl|goo\\.gl/maps)",
    description: "Khách bấm xem chỉ đường bản đồ Google Maps",
  },
  form_submit: {
    eventName: "form_submit",
    tagName: "SPLSEO - GA4 Event - form_submit",
    triggerName: "SPLSEO - Form Submit",
    triggerType: "FORM_SUBMISSION",
    filterType: null,
    description: "Khách gửi biểu mẫu liên hệ / đăng ký báo giá",
  },
};

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

function normalizeMeasurementId(raw) {
  const clean = String(raw || "").trim().toUpperCase();
  if (/^G-[A-Z0-9]{4,20}$/.test(clean)) return clean;
  return "";
}

async function getToken(userId) {
  const tokens = await storage.getAll(TOKEN_COLLECTION);
  return tokens.find((t) => t.userId === userId) || null;
}

async function refreshAccessToken(tokenRecord) {
  if (!tokenRecord.refreshToken) {
    const err = new Error("Phiên Google Tag Manager đã hết hạn. Vui lòng kết nối lại.");
    err.code = "GTM_TOKEN_EXPIRED";
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
      const err = new Error("Quyền kết nối Google Tag Manager đã hết hạn hoặc bị thu hồi. Vui lòng kết nối lại.");
      err.code = "GTM_TOKEN_EXPIRED";
      throw err;
    }
    throw e;
  }
}

async function getValidAccessToken(userId, { forceRefresh = false } = {}) {
  const token = await getToken(userId);
  if (!token) {
    const err = new Error("Google Tag Manager chưa được kết nối");
    err.code = "GTM_NOT_CONNECTED";
    throw err;
  }
  if (token.missingScope) {
    const err = new Error(
      "Tài khoản Google chưa cấp quyền truy cập Google Tag Manager. Vui lòng bấm 'Cấp lại quyền GTM' và tích chọn đầy đủ quyền."
    );
    err.code = "GTM_MISSING_SCOPE";
    throw err;
  }
  if (forceRefresh || Date.now() > (token.expiresAt || 0)) {
    return await refreshAccessToken(token);
  }
  return token.accessToken;
}

function parseGtmError(error) {
  if (
    error.code === "GTM_TOKEN_EXPIRED" ||
    error.code === "GTM_MISSING_SCOPE" ||
    error.code === "GTM_NOT_CONNECTED"
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
    "Lỗi không xác định khi gọi Google Tag Manager API";

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
    const actionUrl = projectNumber
      ? `https://console.cloud.google.com/apis/library/tagmanager.googleapis.com?project=${projectNumber}`
      : "https://console.cloud.google.com/apis/library/tagmanager.googleapis.com";

    return {
      httpStatus: 502,
      payload: {
        error:
          "Tag Manager API chưa được bật trên Google Cloud Project của hệ thống. Hãy bấm nút bên dưới để bật (Enable), đợi ~30 giây rồi bấm Tải lại.",
        code: "GTM_API_DISABLED",
        actionUrl,
        detail: rawMessage,
      },
    };
  }

  if (
    reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    lowerMsg.includes("insufficient authentication scopes") ||
    lowerMsg.includes("insufficient permission")
  ) {
    return {
      httpStatus: 400,
      payload: {
        error:
          "Tài khoản Google chưa cấp đủ quyền chỉnh sửa / quản lý GTM Container. Vui lòng bấm 'Cấp lại quyền GTM' và tích chọn tất cả các ô quyền.",
        code: "GTM_MISSING_SCOPE",
        detail: rawMessage,
      },
    };
  }

  if (upstreamStatus === 401 || reasons.includes("UNAUTHENTICATED")) {
    return {
      httpStatus: 400,
      payload: {
        error: "Phiên kết nối Google Tag Manager đã hết hạn. Vui lòng kết nối lại.",
        code: "GTM_TOKEN_EXPIRED",
        detail: rawMessage,
      },
    };
  }

  if (upstreamStatus === 429 || lowerMsg.includes("quota")) {
    return {
      httpStatus: 429,
      payload: {
        error: "Google Tag Manager API đang giới hạn tốc độ tạm thời (Quota). Vui lòng đợi 30 giây rồi thử lại.",
        code: "GTM_RATE_LIMIT",
        detail: rawMessage,
      },
    };
  }

  return {
    httpStatus: 500,
    payload: {
      error: rawMessage,
      code: "GTM_UPSTREAM_ERROR",
      detail: rawMessage,
    },
  };
}

function sendGtmError(res, error, label = "GTM") {
  const { httpStatus, payload } = parseGtmError(error);
  console.error(`[${label}] Error (${payload.code}):`, payload.detail || payload.error);
  return res.status(httpStatus).json(payload);
}

async function callGtmApi(userId, { method = "GET", path, data = undefined, params = undefined }) {
  let accessToken = await getValidAccessToken(userId);
  const url = path.startsWith("http") ? path : `${GTM_API_HOST}${path}`;

  try {
    return await axios({
      method,
      url,
      data,
      params,
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
        params,
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 25000,
      });
    }
    throw err;
  }
}

async function clearUserCache(userId) {
  const caches = await storage.getAll(CACHE_COLLECTION);
  for (const c of caches) {
    if (c.cacheKey?.startsWith(`${userId}:`)) {
      await storage.delete(CACHE_COLLECTION, c.id);
    }
  }
}

function buildTriggerPayload(preset) {
  if (preset.triggerType === "FORM_SUBMISSION") {
    return {
      name: preset.triggerName,
      type: "FORM_SUBMISSION",
      waitForTags: { type: "BOOLEAN", value: "false" },
      checkValidation: { type: "BOOLEAN", value: "false" },
    };
  }

  const filterObj = {
    type: preset.filterType,
    parameter: [
      { type: "TEMPLATE", key: "arg0", value: preset.filterVar },
      { type: "TEMPLATE", key: "arg1", value: preset.filterVal },
    ],
  };
  if (preset.filterType === "MATCH_REGEX") {
    filterObj.parameter.push({ type: "BOOLEAN", key: "ignoreCase", value: "true" });
  }

  return {
    name: preset.triggerName,
    type: "LINK_CLICK",
    filter: [filterObj],
    waitForTags: { type: "BOOLEAN", value: "false" },
    checkValidation: { type: "BOOLEAN", value: "false" },
  };
}

function buildGa4EventTagPayload(preset, measurementId, triggerId) {
  const eventParams = [
    {
      type: "MAP",
      map: [
        { type: "TEMPLATE", key: "name", value: "page_path" },
        { type: "TEMPLATE", key: "value", value: "{{Page Path}}" },
      ],
    },
  ];

  if (preset.triggerType === "LINK_CLICK") {
    eventParams.push(
      {
        type: "MAP",
        map: [
          { type: "TEMPLATE", key: "name", value: "link_url" },
          { type: "TEMPLATE", key: "value", value: "{{Click URL}}" },
        ],
      },
      {
        type: "MAP",
        map: [
          { type: "TEMPLATE", key: "name", value: "link_text" },
          { type: "TEMPLATE", key: "value", value: "{{Click Text}}" },
        ],
      }
    );
  }

  return {
    name: preset.tagName,
    type: "gaawe",
    parameter: [
      { type: "TEMPLATE", key: "eventName", value: preset.eventName },
      { type: "TEMPLATE", key: "measurementIdOverride", value: measurementId },
      { type: "LIST", key: "eventParameters", list: eventParams },
    ],
    firingTriggerId: [String(triggerId)],
  };
}

// ============================================================
// Shared OAuth Callback Handler (invoked by /api/gsc/callback when state.flow === 'gtm')
// ============================================================
async function handleGtmOAuthCallback(req, res, stateRecord) {
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
    const hasGtmScope = !grantedScopes || grantedScopes.includes("tagmanager");
    const hasWriteScope =
      !grantedScopes || grantedScopes.includes("tagmanager.edit.containers");

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

    await clearUserCache(userId);

    await storage.create(TOKEN_COLLECTION, {
      userId,
      accessToken: access_token,
      refreshToken: finalRefreshToken,
      expiresAt,
      email,
      scope: grantedScopes,
      missingScope: !hasGtmScope,
      canEdit: hasWriteScope,
    });

    if (!hasGtmScope) {
      return res.redirect(`${CLIENT_URL}/ga4?mode=gtm&gtm=error&msg=missing_scope`);
    }

    return res.redirect(`${CLIENT_URL}/ga4?mode=gtm&gtm=success`);
  } catch (error) {
    console.error("[GTM] OAuth callback error:", error.response?.data || error.message);
    const msg = error.response?.status === 400 ? "invalid_code" : "server_error";
    return res.redirect(`${CLIENT_URL}/ga4?mode=gtm&gtm=error&msg=${msg}`);
  }
}

// ============================================================
// Routes
// ============================================================

router.get("/status", async (req, res) => {
  try {
    const token = await getToken(req.user.id);
    if (!token) return res.json({ connected: false });
    res.json({
      connected: true,
      email: token.email || null,
      connectedAt: token.createdAt,
      missingScope: !!token.missingScope,
      canEdit: token.canEdit !== false,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/auth-url", async (req, res) => {
  const { clientId, redirectUri } = getGoogleOAuthConfig();
  if (!clientId) {
    return res.status(400).json({ error: "GOOGLE_CLIENT_ID chưa được cấu hình trên server." });
  }

  const scopes = [
    "https://www.googleapis.com/auth/tagmanager.readonly",
    "https://www.googleapis.com/auth/tagmanager.edit.containers",
    "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
    "https://www.googleapis.com/auth/tagmanager.publish",
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
    flow: "gtm",
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  url.searchParams.set("state", state);

  res.json({ url: url.toString() });
});

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
    await clearUserCache(req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/gtm/containers
 * Lấy toàn bộ danh sách GTM Accounts & Containers (`GTM-XXXXXXX`)
 */
router.get("/containers", async (req, res) => {
  try {
    const force = req.query.refresh === "1" || req.query.refresh === "true";
    const cacheKey = `${req.user.id}:gtm:containers`;

    if (!force) {
      const allCache = await storage.getAll(CACHE_COLLECTION);
      const hit = allCache.find((c) => c.cacheKey === cacheKey);
      if (hit && Date.now() - new Date(hit.createdAt).getTime() < CACHE_TTL_MS) {
        return res.json({ containers: hit.data, fromCache: true });
      }
    }

    const accResp = await callGtmApi(req.user.id, {
      method: "GET",
      path: "/accounts",
    });
    const accounts = accResp.data?.account || [];

    const containerLists = await Promise.all(
      accounts.map(async (acc) => {
        try {
          const cResp = await callGtmApi(req.user.id, {
            method: "GET",
            path: `/accounts/${acc.accountId}/containers`,
          });
          return (cResp.data?.container || []).map((c) => ({
            accountId: acc.accountId,
            accountName: acc.name || `Account ${acc.accountId}`,
            containerId: c.containerId,
            name: c.name || c.publicId,
            publicId: c.publicId || "",
            usageContext: c.usageContext || [],
            domainName: c.domainName || [],
            tagManagerUrl:
              c.tagManagerUrl ||
              `https://tagmanager.google.com/#/container/accounts/${acc.accountId}/containers/${c.containerId}`,
          }));
        } catch {
          return [];
        }
      })
    );

    const containers = containerLists.flat();

    const allCache = await storage.getAll(CACHE_COLLECTION);
    const old = allCache.find((c) => c.cacheKey === cacheKey);
    if (old) await storage.delete(CACHE_COLLECTION, old.id);
    await storage.create(CACHE_COLLECTION, { cacheKey, data: containers });

    res.json({ containers });
  } catch (error) {
    return sendGtmError(res, error, "GTM/Containers");
  }
});

/**
 * GET /api/gtm/workspace?accountId=...&containerId=...
 * Đọc chi tiết Workspace, Tags, Triggers và kiểm tra sức khỏe cài đặt sự kiện
 */
router.get("/workspace", async (req, res) => {
  try {
    const { accountId, containerId } = req.query;
    if (!accountId || !containerId) {
      return res.status(400).json({ error: "accountId và containerId là bắt buộc" });
    }

    const wsResp = await callGtmApi(req.user.id, {
      method: "GET",
      path: `/accounts/${accountId}/containers/${containerId}/workspaces`,
    });
    const workspaces = wsResp.data?.workspace || [];
    const workspace = workspaces[0];
    if (!workspace) {
      return res.status(404).json({ error: "Không tìm thấy Workspace nào trong Container này." });
    }

    const basePath = `/accounts/${accountId}/containers/${containerId}/workspaces/${workspace.workspaceId}`;
    const [tagsResp, triggersResp] = await Promise.all([
      callGtmApi(req.user.id, { method: "GET", path: `${basePath}/tags` }),
      callGtmApi(req.user.id, { method: "GET", path: `${basePath}/triggers` }),
    ]);

    const rawTags = tagsResp.data?.tag || [];
    const rawTriggers = triggersResp.data?.trigger || [];
    const triggerNameById = {};
    for (const tr of rawTriggers) {
      triggerNameById[tr.triggerId] = tr.name;
    }

    let detectedMeasurementId = "";
    const installedEvents = new Set();

    const tags = rawTags.map((t) => {
      const params = t.parameter || [];
      let eventName = "";
      let tagMeasurementId = "";

      for (const p of params) {
        if (p.key === "tagId" && /^G-[A-Z0-9]+$/i.test(String(p.value || ""))) {
          tagMeasurementId = String(p.value).toUpperCase();
          if (!detectedMeasurementId) detectedMeasurementId = tagMeasurementId;
        }
        if (
          (p.key === "measurementIdOverride" || p.key === "measurementId") &&
          /^G-[A-Z0-9]+$/i.test(String(p.value || ""))
        ) {
          tagMeasurementId = String(p.value).toUpperCase();
          if (!detectedMeasurementId) detectedMeasurementId = tagMeasurementId;
        }
        if (p.key === "eventName" && p.value) {
          eventName = String(p.value);
          installedEvents.add(eventName.toLowerCase());
        }
      }

      return {
        tagId: t.tagId,
        name: t.name,
        type: t.type,
        paused: !!t.paused,
        eventName,
        measurementId: tagMeasurementId,
        firingTriggers: (t.firingTriggerId || []).map(
          (id) => triggerNameById[id] || (id === ALL_PAGES_TRIGGER_ID ? "All Pages" : `Trigger #${id}`)
        ),
      };
    });

    const triggers = rawTriggers.map((tr) => ({
      triggerId: tr.triggerId,
      name: tr.name,
      type: tr.type,
    }));

    const hasGoogleTag = rawTags.some(
      (t) => t.type === "googtag" || t.type === "gaawc"
    );

    const presetChecklist = Object.entries(CONVERSION_PRESETS).map(([key, p]) => ({
      key,
      eventName: p.eventName,
      description: p.description,
      installed:
        installedEvents.has(p.eventName.toLowerCase()) ||
        rawTags.some((t) => t.name === p.tagName),
    }));

    res.json({
      workspace: {
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        description: workspace.description || "",
      },
      hasGoogleTag,
      detectedMeasurementId,
      tags,
      triggers,
      presetChecklist,
    });
  } catch (error) {
    return sendGtmError(res, error, "GTM/Workspace");
  }
});

/**
 * POST /api/gtm/auto-setup
 * 1-Click Tạo tự động Google Tag + Bộ Tag Sự kiện Chuyển đổi chuẩn SEO vào GTM Workspace
 */
router.post("/auto-setup", async (req, res) => {
  try {
    const {
      accountId,
      containerId,
      workspaceId,
      measurementId: rawMid,
      presets = ["click_hotline", "click_zalo", "click_messenger", "click_map", "form_submit"],
      includeGoogleTag = true,
      publishNow = false,
    } = req.body || {};

    if (!accountId || !containerId || !workspaceId) {
      return res.status(400).json({ error: "Thiếu accountId, containerId hoặc workspaceId." });
    }

    const measurementId = normalizeMeasurementId(rawMid);
    if (!measurementId) {
      return res.status(400).json({
        error: "Mã đo lường GA4 (Measurement ID) không hợp lệ. Vui lòng nhập đúng định dạng G-XXXXXXXXXX.",
      });
    }

    const basePath = `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`;

    // 1. Bật Built-in Variables cần thiết (idempotent)
    try {
      await callGtmApi(req.user.id, {
        method: "POST",
        path: `${basePath}/built_in_variables?type=clickUrl&type=clickText&type=clickClasses&type=pageUrl&type=pagePath&type=formId&type=formClasses`,
      });
    } catch {
      // Bỏ qua nếu một số biến đã được bật sẵn
    }

    // 2. Lấy danh sách Tags & Triggers hiện có để tránh tạo trùng
    const [tagsResp, triggersResp] = await Promise.all([
      callGtmApi(req.user.id, { method: "GET", path: `${basePath}/tags` }),
      callGtmApi(req.user.id, { method: "GET", path: `${basePath}/triggers` }),
    ]);
    const existingTags = tagsResp.data?.tag || [];
    const existingTriggers = triggersResp.data?.trigger || [];

    const createdTags = [];
    const skippedTags = [];

    // 3. Tạo Google Tag (googtag) nếu chưa có
    if (includeGoogleTag) {
      const alreadyHasGoogleTag = existingTags.some((t) => {
        if (t.type !== "googtag" && t.type !== "gaawc") return false;
        return (t.parameter || []).some(
          (p) => String(p.value || "").toUpperCase() === measurementId
        );
      });

      if (alreadyHasGoogleTag) {
        skippedTags.push(`Google Tag (${measurementId})`);
      } else {
        const googleTagName = `SPLSEO - Google Tag (${measurementId})`;
        const nameTaken = existingTags.some((t) => t.name === googleTagName);
        if (!nameTaken) {
          await callGtmApi(req.user.id, {
            method: "POST",
            path: `${basePath}/tags`,
            data: {
              name: googleTagName,
              type: "googtag",
              parameter: [
                { type: "TEMPLATE", key: "tagId", value: measurementId },
              ],
              firingTriggerId: [ALL_PAGES_TRIGGER_ID],
            },
          });
          createdTags.push(googleTagName);
        } else {
          skippedTags.push(googleTagName);
        }
      }
    }

    // 4. Tạo từng Trigger + GA4 Event Tag cho các sự kiện chuyển đổi đã chọn
    for (const key of presets) {
      const preset = CONVERSION_PRESETS[key];
      if (!preset) continue;

      // Nếu đã có tag cùng eventName hoặc cùng tên -> bỏ qua không tạo trùng
      const tagExists = existingTags.some((t) => {
        if (t.name === preset.tagName) return true;
        return (t.parameter || []).some(
          (p) => p.key === "eventName" && String(p.value || "").toLowerCase() === preset.eventName
        );
      });

      if (tagExists) {
        skippedTags.push(preset.eventName);
        continue;
      }

      // Tìm hoặc tạo Trigger
      let trigger = existingTriggers.find((tr) => tr.name === preset.triggerName);
      if (!trigger) {
        const trResp = await callGtmApi(req.user.id, {
          method: "POST",
          path: `${basePath}/triggers`,
          data: buildTriggerPayload(preset),
        });
        trigger = trResp.data;
        existingTriggers.push(trigger);
      }

      // Tạo GA4 Event Tag
      await callGtmApi(req.user.id, {
        method: "POST",
        path: `${basePath}/tags`,
        data: buildGa4EventTagPayload(preset, measurementId, trigger.triggerId),
      });
      createdTags.push(preset.eventName);
    }

    // 5. Xuất bản (Publish) phiên bản Container ngay nếu người dùng chọn publishNow
    let publishedVersion = null;
    let publishWarning = null;
    if (publishNow && createdTags.length > 0) {
      try {
        const verResp = await callGtmApi(req.user.id, {
          method: "POST",
          path: `${basePath}:create_version`,
          data: {
            name: `SPLSEO Auto-Setup (${measurementId})`,
            notes: `Tạo tự động bởi SPLSEO: ${createdTags.join(", ")}`,
          },
        });
        const versionId = verResp.data?.containerVersion?.containerVersionId;
        if (versionId) {
          await callGtmApi(req.user.id, {
            method: "POST",
            path: `/accounts/${accountId}/containers/${containerId}/versions/${versionId}:publish`,
          });
          publishedVersion = versionId;
        }
      } catch (pubErr) {
        publishWarning =
          "Đã tạo xong toàn bộ Tag trong Workspace, nhưng tài khoản của bạn chưa có quyền Publish trực tiếp. Hãy mở GTM và bấm nút Submit (Gửi) ở góc phải trên cùng.";
        console.warn("[GTM/AutoSetup] Publish warning:", pubErr.response?.data || pubErr.message);
      }
    }

    res.json({
      success: true,
      measurementId,
      createdTags,
      skippedTags,
      publishedVersion,
      publishWarning,
    });
  } catch (error) {
    return sendGtmError(res, error, "GTM/AutoSetup");
  }
});

/**
 * POST /api/gtm/export-preset
 * Tạo file JSON GTM Container chuẩn (`exportFormatVersion: 2`) để người dùng tải về Import vào GTM
 * (Hoạt động ngay cả khi chưa kết nối OAuth GTM)
 */
router.post("/export-preset", async (req, res) => {
  try {
    const measurementId = normalizeMeasurementId(req.body?.measurementId) || "G-XXXXXXXXXX";
    const presets = Array.isArray(req.body?.presets) && req.body.presets.length > 0
      ? req.body.presets
      : Object.keys(CONVERSION_PRESETS);

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const triggers = [];
    const tags = [
      {
        accountId: "0",
        containerId: "0",
        tagId: "1",
        name: `SPLSEO - Google Tag (${measurementId})`,
        type: "googtag",
        parameter: [
          { type: "TEMPLATE", key: "tagId", value: measurementId },
        ],
        firingTriggerId: [ALL_PAGES_TRIGGER_ID],
      },
    ];

    let nextId = 10;
    for (const key of presets) {
      const preset = CONVERSION_PRESETS[key];
      if (!preset) continue;
      const trigId = String(nextId++);
      const tagId = String(nextId++);

      triggers.push({
        accountId: "0",
        containerId: "0",
        triggerId: trigId,
        ...buildTriggerPayload(preset),
      });

      tags.push({
        accountId: "0",
        containerId: "0",
        tagId,
        ...buildGa4EventTagPayload(preset, measurementId, trigId),
      });
    }

    const containerJson = {
      exportFormatVersion: 2,
      exportTime: now,
      containerVersion: {
        accountId: "0",
        containerId: "0",
        name: `SPLSEO Conversion Tracking (${measurementId})`,
        description: "Bộ thẻ đo lường GA4 & Sự kiện Chuyển đổi (Hotline, Zalo, Messenger, Maps, Form) tạo bởi SPLSEO",
        container: {
          accountId: "0",
          containerId: "0",
          name: "SPLSEO Preset",
          publicId: "GTM-SPLSEO",
          usageContext: ["WEB"],
        },
        builtInVariable: [
          { accountId: "0", containerId: "0", type: "PAGE_URL", name: "Page URL" },
          { accountId: "0", containerId: "0", type: "PAGE_PATH", name: "Page Path" },
          { accountId: "0", containerId: "0", type: "CLICK_URL", name: "Click URL" },
          { accountId: "0", containerId: "0", type: "CLICK_TEXT", name: "Click Text" },
          { accountId: "0", containerId: "0", type: "CLICK_CLASSES", name: "Click Classes" },
          { accountId: "0", containerId: "0", type: "FORM_ID", name: "Form ID" },
        ],
        trigger: triggers,
        tag: tags,
      },
    };

    res.json({
      filename: `splseo-gtm-${measurementId.toLowerCase()}.json`,
      containerJson,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, handleGtmOAuthCallback };
