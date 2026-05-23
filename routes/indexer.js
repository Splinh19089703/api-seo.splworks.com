const express = require("express");
const router = express.Router();
const axios = require("axios");
const crypto = require("crypto");
const storage = require("../services/storage");

// ===== Central SPLSEO Service Account (Option A) =====
function getSPLSEOServiceAccount() {
  const jsonStr = process.env.SPLSEO_GOOGLE_SA_JSON;
  if (!jsonStr) return null;
  try { return JSON.parse(jsonStr); } catch { return null; }
}
function getSPLSEOSAEmail() {
  return process.env.SPLSEO_GOOGLE_SA_EMAIL || getSPLSEOServiceAccount()?.client_email || null;
}

// ===== Resolve which SA to use for a project =====
// Priority: project own SA (Option B) → central SPLSEO SA (Option A) → null
async function resolveServiceAccount(projectId, cfg) {
  // Option B: project has its own SA
  if (cfg?.googleServiceAccount) return { sa: cfg.googleServiceAccount, mode: "own" };
  // Option A: project opted-in to SPLSEO central SA
  if (cfg?.useSharedSA !== false) {
    const centralSA = getSPLSEOServiceAccount();
    if (centralSA) return { sa: centralSA, mode: "shared" };
  }
  return { sa: null, mode: null };
}

// ===== Helper: Bing IndexNow Submit =====
async function submitToBing(host, key, urls) {
  const body = {
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList: Array.isArray(urls) ? urls : [urls],
  };
  const resp = await axios.post("https://api.indexnow.org/indexnow", body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    timeout: 15000,
  });
  return { success: true, statusCode: resp.status };
}

// ===== Helper: Google Indexing API with Service Account JWT =====
async function submitToGoogle(serviceAccountJson, urls) {
  const sa = typeof serviceAccountJson === "string"
    ? JSON.parse(serviceAccountJson)
    : serviceAccountJson;

  // Build JWT for Google OAuth2
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/indexing",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const privateKey = sa.private_key;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${signingInput}.${signature}`;

  // Exchange JWT for access token
  const tokenResp = await axios.post("https://oauth2.googleapis.com/token", {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }, { timeout: 15000 });

  const accessToken = tokenResp.data.access_token;

  // Submit each URL
  const urlList = Array.isArray(urls) ? urls : [urls];
  const results = [];
  for (const url of urlList) {
    try {
      await axios.post(
        "https://indexing.googleapis.com/v3/urlNotifications:publish",
        { url, type: "URL_UPDATED" },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 15000,
        }
      );
      results.push({ url, success: true });
    } catch (e) {
      results.push({ url, success: false, error: e.response?.data?.error?.message || e.message });
    }
  }
  return results;
}

// ===== Helper: Get project indexer config =====
async function getProjectIndexerConfig(projectId, userId) {
  if (!projectId) return null;
  const project = userId
    ? await storage.getByIdForUser("projects", projectId, userId)
    : await storage.getById("projects", projectId);
  return project?.config?.indexing || null;
}

// ===== POST /api/indexer/bing — Submit to Bing IndexNow =====
router.post("/bing", async (req, res) => {
  try {
    const { projectId, urls } = req.body;
    if (!urls?.length) return res.status(400).json({ error: "urls là bắt buộc" });

    let key, host;

    // Load from project config if projectId given
    if (projectId) {
      const cfg = await getProjectIndexerConfig(projectId, req.userId);
      if (!cfg) return res.status(404).json({ error: "Project not found" });
      key = cfg?.bingIndexNowKey;
      host = cfg?.siteHost;
    }
    // Allow direct override from request
    if (req.body.key) key = req.body.key;
    if (req.body.host) host = req.body.host;

    if (!key) return res.status(400).json({ error: "Chưa cấu hình Bing IndexNow key. Vào Project Settings → Indexing." });
    if (!host) {
      // Try to extract host from first URL
      try { host = new URL(urls[0]).hostname; } catch {}
    }
    if (!host) return res.status(400).json({ error: "Không xác định được host. Điền domain vào Project Settings." });

    const result = await submitToBing(host, key, urls);

    // Save history
    for (const url of urls) {
      await storage.createForUser("index-history", {
        projectId: projectId || null,
        url,
        platform: "bing",
        status: result.success ? "submitted" : "failed",
        error: result.success ? null : result.error,
        submittedAt: new Date().toISOString(),
      }, req.userId);
    }

    res.json({ success: true, platform: "bing", submitted: urls.length, ...result });
  } catch (e) {
    console.error("[Indexer/Bing] Error:", e.response?.data || e.message);
    const msg = e.response?.data?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// ===== GET /api/indexer/config — Public config (SA email for user to copy) =====
router.get("/config", (req, res) => {
  res.json({
    splseoSAEmail: getSPLSEOSAEmail(),
    hasSharedSA: !!getSPLSEOServiceAccount(),
  });
});

// ===== POST /api/indexer/google — Submit to Google Indexing API =====
router.post("/google", async (req, res) => {
  try {
    const { projectId, urls } = req.body;
    if (!urls?.length) return res.status(400).json({ error: "urls là bắt buộc" });

    const cfg = projectId ? await getProjectIndexerConfig(projectId, req.userId) : null;
    if (projectId && !cfg) return res.status(404).json({ error: "Project not found" });
    const { sa: serviceAccountJson, mode } = await resolveServiceAccount(projectId, cfg);

    // Also allow direct override from request body (manual submit from Indexer page)
    const finalSA = req.body.serviceAccountJson || serviceAccountJson;

    if (!finalSA) {
      const saEmail = getSPLSEOSAEmail();
      if (saEmail) {
        return res.status(400).json({
          error: `Chưa cấu hình Google Indexing. Vào Project Settings → Indexing → thêm email "${saEmail}" làm Owner trong Google Search Console của website.`,
          needsGSCSetup: true,
          splseoSAEmail: saEmail,
        });
      }
      return res.status(400).json({
        error: "Chưa cấu hình Google Service Account. Vào Project Settings → Indexing để thiết lập.",
      });
    }

    console.log(`[Indexer/Google] Using ${mode || "manual"} SA for project ${projectId}`);
    const results = await submitToGoogle(finalSA, urls);

    for (const r of results) {
      await storage.createForUser("index-history", {
        projectId: projectId || null,
        url: r.url,
        platform: "google",
        saMode: mode || "manual",
        status: r.success ? "submitted" : "failed",
        error: r.success ? null : r.error,
        submittedAt: new Date().toISOString(),
      }, req.userId);
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: successCount > 0,
      platform: "google",
      saMode: mode || "manual",
      submitted: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (e) {
    console.error("[Indexer/Google] Error:", e.response?.data || e.message);
    const errMsg = e.response?.data?.error_description || e.message;
    if (errMsg.includes("invalid_grant") || errMsg.includes("PERMISSION_DENIED")) {
      return res.status(403).json({
        error: "Lỗi xác thực Google. Kiểm tra: (1) Service Account JSON đúng không, (2) Email Service Account đã được thêm làm Owner trong Google Search Console chưa."
      });
    }
    res.status(500).json({ error: errMsg });
  }
});

// ===== GET /api/indexer/history — List submission history =====
router.get("/history", async (req, res) => {
  try {
    let history = await storage.getAllForUser("index-history", req.userId);
    if (req.query.projectId) history = history.filter(h => h.projectId === req.query.projectId);
    if (req.query.platform) history = history.filter(h => h.platform === req.query.platform);
    history.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    res.json(history.slice(0, 200));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== DELETE /api/indexer/history — Clear history =====
router.delete("/history", async (req, res) => {
  try {
    const all = await storage.getAllForUser("index-history", req.userId);
    for (const h of all) await storage.delete("index-history", h.id);
    res.json({ success: true, cleared: all.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== POST /api/indexer/verify-bing — Test Bing key =====
router.post("/verify-bing", async (req, res) => {
  try {
    const { key, host } = req.body;
    if (!key || !host) return res.status(400).json({ error: "key và host là bắt buộc" });
    // Test with a known valid URL from the host
    const testUrl = `https://${host}/`;
    const result = await submitToBing(host, key, [testUrl]);
    res.json({ success: result.success, message: result.success ? "✅ Kết nối Bing IndexNow thành công!" : "❌ Lỗi" });
  } catch (e) {
    // 400 from IndexNow means key is valid but URL already submitted — that's actually OK
    if (e.response?.status === 400) {
      return res.json({ success: true, message: "✅ Key hợp lệ! (URL test đã được index trước đó)" });
    }
    res.json({ success: false, message: `❌ Lỗi: ${e.response?.data?.message || e.message}` });
  }
});

// ===== Internal helper — exported for use in publish.js =====
router.autoIndex = async function (projectId, urls, userId = null) {
  try {
    const cfg = await getProjectIndexerConfig(projectId, userId);
    if (!cfg) return;

    const urlList = Array.isArray(urls) ? urls : [urls];
    const results = { bing: null, google: null };

    // Bing IndexNow
    if (cfg.bingIndexNowKey && cfg.siteHost) {
      try {
        const r = await submitToBing(cfg.siteHost, cfg.bingIndexNowKey, urlList);
        results.bing = r;
        for (const url of urlList) {
          await storage.create("index-history", {
            userId,
            projectId, url, platform: "bing",
            status: "submitted", error: null,
            submittedAt: new Date().toISOString(),
          });
        }
        console.log(`[Indexer] Auto-submitted ${urlList.length} URLs to Bing for project ${projectId}`);
      } catch (e) {
        console.warn("[Indexer] Bing auto-index failed:", e.message);
        results.bing = { success: false, error: e.message };
      }
    }

    // Google Indexing API — try own SA first, then shared SPLSEO SA
    const { sa: googleSA, mode: saMode } = await resolveServiceAccount(projectId, cfg);
    if (googleSA) {
      try {
        const r = await submitToGoogle(googleSA, urlList);
        results.google = r;
        for (const item of r) {
          await storage.create("index-history", {
            userId,
            projectId, url: item.url, platform: "google",
            saMode, status: item.success ? "submitted" : "failed",
            error: item.error || null,
            submittedAt: new Date().toISOString(),
          });
        }
        console.log(`[Indexer] Auto-submitted ${urlList.length} URLs to Google (${saMode} SA) for project ${projectId}`);
      } catch (e) {
        console.warn("[Indexer] Google auto-index failed:", e.message);
        results.google = { success: false, error: e.message };
      }
    }

    return results;
  } catch (e) {
    console.error("[Indexer] autoIndex error:", e.message);
  }
};

module.exports = router;
