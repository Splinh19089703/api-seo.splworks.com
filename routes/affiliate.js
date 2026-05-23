/**
 * Affiliate proxy routes — SPLSEO App backend
 * Proxies requests to License Server /affiliate/* endpoints
 */
const express = require("express");
const router = express.Router();
const licenseClient = require("../services/license-client");

// Helper lấy token từ request header
function extractToken(req) {
  return req.headers.authorization?.replace("Bearer ", "") || null;
}

/**
 * GET /api/affiliate/link — Referral code + link
 */
router.get("/link", async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
    const data = await licenseClient.getAffiliateLink(token);
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.error || "Lỗi server" });
  }
});

/**
 * GET /api/affiliate/stats — Tổng hoa hồng, referrals, orders
 */
router.get("/stats", async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
    const data = await licenseClient.getAffiliateStats(token);
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.error || "Lỗi server" });
  }
});

/**
 * GET /api/affiliate/history?page=1&limit=20 — Lịch sử hoa hồng
 */
router.get("/history", async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
    const qs = new URLSearchParams(req.query).toString();
    const data = await licenseClient.getAffiliateHistory(token, qs ? `?${qs}` : "");
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.error || "Lỗi server" });
  }
});

/**
 * POST /api/affiliate/payout — Yêu cầu thanh toán hoa hồng
 */
router.post("/payout", async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
    const data = await licenseClient.requestAffiliatePayout(token, req.body);
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.error || "Lỗi server" });
  }
});

module.exports = router;
