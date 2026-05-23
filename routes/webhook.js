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
    const body = JSON.stringify(req.body);

    // Find matching WP site by site_url
    const siteUrl = req.body?.site_url;
    if (!siteUrl) {
      return res.status(400).json({ error: "Missing site_url" });
    }

    // Verify webhook signature
    const sites = await storage.getAll("wp-sites");
    const site = sites.find(
      (s) => s.siteUrl && siteUrl.includes(new URL(s.siteUrl).hostname)
    );

    if (site && site.webhookSecret && signature) {
      const expected = crypto
        .createHmac("sha256", site.webhookSecret)
        .update(body)
        .digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return res.status(403).json({ error: "Invalid signature" });
      }
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
