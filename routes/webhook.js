const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const storage = require("../services/storage");

/**
 * POST /api/webhook/wp — Receive webhooks from SPLSEO Connector Plugin
 * 
 * Events:
 * - post.created
 * - post.updated
 * - post.trashed
 * - post.restored
 * - post.deleted
 */
router.post("/wp", async (req, res) => {
  try {
    const signature = req.headers["x-splseo-signature"];
    const event = req.headers["x-splseo-event"];
    const rawPayload = req.rawBody
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body || {}), "utf8");

    // Find matching WP site by exact normalized hostname
    const siteUrl = req.body?.site_url;
    if (!siteUrl || typeof siteUrl !== "string") {
      return res.status(400).json({ error: "Missing site_url" });
    }

    let incomingHost;
    try {
      const normalized = /^https?:\/\//i.test(siteUrl.trim())
        ? siteUrl.trim()
        : `https://${siteUrl.trim()}`;
      incomingHost = new URL(normalized).hostname.toLowerCase();
    } catch {
      return res.status(400).json({ error: "Invalid site_url" });
    }

    const sites = await storage.getAll("wp-sites");
    const site = sites.find((s) => {
      if (!s.siteUrl) return false;
      try {
        const regNorm = /^https?:\/\//i.test(s.siteUrl.trim())
          ? s.siteUrl.trim()
          : `https://${s.siteUrl.trim()}`;
        return new URL(regNorm).hostname.toLowerCase() === incomingHost;
      } catch {
        return false;
      }
    });

    if (!site) {
      return res.status(404).json({ error: "Unregistered WP site" });
    }

    // Always require HMAC webhook secret & signature
    if (!site.webhookSecret) {
      return res.status(403).json({
        error: "Webhook secret chưa được đồng bộ cho site này. Hãy nhấn Kiểm tra kết nối Plugin trong Cài đặt.",
      });
    }
    if (!signature || typeof signature !== "string") {
      return res.status(401).json({ error: "Missing webhook signature" });
    }
    const expected = crypto
      .createHmac("sha256", site.webhookSecret)
      .update(rawPayload)
      .digest("hex");
    const sigBuf = Buffer.from(signature.trim(), "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    // Log webhook event
    console.log(`[Webhook] ${event} from ${siteUrl}:`, req.body.data);

    // Process event
    const data = req.body.data || {};
    
    switch (event) {
      case "post.updated":
        // Could trigger re-sync of article in project
        console.log(`[Webhook] Post updated: ${data.post_id} — "${data.title}"`);
        break;

      case "post.created":
        console.log(`[Webhook] New post: ${data.post_id} — "${data.title}"`);
        break;

      case "post.trashed":
        console.log(`[Webhook] Post trashed: ${data.post_id} — "${data.title}"`);
        break;

      case "post.deleted":
        console.log(`[Webhook] Post permanently deleted: ${data.post_id}`);
        break;

      default:
        console.log(`[Webhook] Unknown event: ${event}`);
    }

    res.json({ received: true, event });
  } catch (error) {
    console.error("[Webhook] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
