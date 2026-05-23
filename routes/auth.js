/**
 * Auth routes for SPLSEO App
 * Proxies auth requests to the License Server
 */
const express = require("express");
const licenseClient = require("../services/license-client");

const router = express.Router();

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  return null;
}

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    }
    const result = await licenseClient.login(email, password);
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.error || "Đăng nhập thất bại" });
  }
});

/**
 * POST /api/auth/register
 */
router.post("/register", async (req, res) => {
  try {
    const { email, password, name, referredBy } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    }
    const result = await licenseClient.register(email, password, name, referredBy);
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.error || "Đăng ký thất bại" });
  }
});

/**
 * POST /api/auth/google
 * Google Sign-In — proxy to license server
 */
router.post("/google", async (req, res) => {
  try {
    const { idToken, referralCode } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: "Thiếu Google ID token" });
    }
    const result = await licenseClient.googleLogin(idToken, referralCode);
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.error || "Đăng nhập Google thất bại" });
  }
});

/**
 * GET /api/auth/me
 */
router.get("/me", async (req, res) => {
  // DEV mode: return mock user
  if (process.env.DEV_SKIP_AUTH === "true") {
    return res.json({
      user: {
        id: "dev-user",
        email: "dev@splseo.vn",
        name: "Developer",
        role: "admin",
      },
      license: {
        id: "dev-license",
        licenseKey: "SPLSEO-DEV0-MODE-0000",
        plan: "unlimited",
        period: "lifetime",
        status: "active",
        activatedAt: new Date().toISOString(),
        expiresAt: null,
        limits: {
          maxArticlesPerMonth: 999999,
          maxProjects: 999999,
          maxDevices: 99,
          maxAudits: 999999,
        },
        features: {
          aiWriting: true,
          aiImage: true,
          wpPublish: true,
          multiPlatform: true,
          internalLinks: true,
          knowledgeBase: true,
          seoAudit: true,
          googleSearchConsole: true,
          prioritySupport: true,
          affiliate: true,
        },
      },
      usage: { articlesCreated: 0, articlesPublished: 0, aiCalls: 0 },
    });
  }

  try {
    const token = getBearerToken(req);

    if (!token) {
      return res
        .status(401)
        .json({ error: "Chưa đăng nhập", requireAuth: true });
    }

    const forceRefresh = req.query.refresh === "true";
    const result = await licenseClient.getMe(token, forceRefresh);
    res.json(result);
  } catch (error) {
    if (error.status === 401) {
      // Token expired, clear it
      await licenseClient.clearToken();
      return res
        .status(401)
        .json({ error: "Phiên đăng nhập hết hạn", requireAuth: true });
    }
    res
      .status(error.status || 500)
      .json({ error: error.error || "Lỗi server" });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", async (req, res) => {
  try {
    await licenseClient.clearToken();
    res.json({ success: true, message: "Đã đăng xuất" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi đăng xuất" });
  }
});

/**
 * POST /api/auth/change-password
 */
router.post("/change-password", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Chưa đăng nhập" });
    }

    const { currentPassword, newPassword } = req.body;
    const result = await licenseClient.changePassword(
      token,
      currentPassword,
      newPassword,
    );
    res.json(result);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: error.error || "Lỗi đổi mật khẩu" });
  }
});

/**
 * GET /api/auth/license-info
 */
router.get("/license-info", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Chưa đăng nhập" });
    }

    const result = await licenseClient.getLicenseInfo(token);
    res.json(result);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: error.error || "Lỗi server" });
  }
});

/**
 * POST /api/auth/deactivate-device
 */
router.post("/deactivate-device", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Chưa đăng nhập" });
    }

    const { deviceId } = req.body;
    const result = await licenseClient.deactivateDevice(token, deviceId);
    res.json(result);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: error.error || "Lỗi server" });
  }
});

/**
 * GET /api/auth/plans
 */
router.get("/plans", async (req, res) => {
  try {
    const result = await licenseClient.getPlans();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Không thể lấy bảng giá" });
  }
});

/**
 * POST /api/auth/create-order
 */
router.post("/create-order", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Chưa đăng nhập" });
    }

    const result = await licenseClient.createOrder(token, req.body);
    res.json(result);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: error.error || "Lỗi tạo đơn hàng" });
  }
});

/**
 * POST /api/auth/apply-coupon
 */
router.post("/apply-coupon", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Chưa đăng nhập" });
    }

    const result = await licenseClient.applyCoupon(token, req.body);
    res.json(result);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: error.error || "Lỗi kiểm tra mã giảm giá" });
  }
});

/**
 * GET /api/auth/my-orders
 */
router.get("/my-orders", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Chưa đăng nhập" });
    }

    const result = await licenseClient.getMyOrders(token);
    res.json(result);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: error.error || "Lỗi server" });
  }
});

module.exports = router;
