const express = require("express");
const cors = require("cors");
const path = require("path");
const imageStore = require('./services/image-store');

// Load env (support .env file)
try { require("dotenv").config({ path: path.join(__dirname, ".env") }); } catch(e) {}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
// C4: Gzip compression — reduces response size ~60-70% for JSON/text
let compression;
try { compression = require("compression"); } catch(e) { /* optional */ }
if (compression) app.use(compression());

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5173'],
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));

// ===== Static: serve AI-generated images (local file storage) =====
const uploadsDir = path.join(__dirname, 'uploads', 'images');
app.use('/api/uploads/images', express.static(uploadsDir, {
  maxAge: '7d',
  immutable: false,
}));

// ===== Auth Routes (public, no license guard) =====
app.use("/api/auth", require("./routes/auth"));

// ===== License Guard (protect all other routes) =====
const { licenseGuard, featureGate } = require("./middleware/license-guard");
app.use("/api/projects", licenseGuard, require("./routes/projects"));
app.use("/api/projects", licenseGuard, require("./routes/project-content"));
app.use("/api/settings", licenseGuard, require("./routes/settings"));
app.use("/api/audit", licenseGuard, require("./routes/audit"));
app.use("/api/content", licenseGuard, require("./routes/content"));
app.use("/api/publish", licenseGuard, require("./routes/publish"));
app.use("/api/topical-map", licenseGuard, require("./routes/topical-map"));
app.use("/api/indexer", licenseGuard, require("./routes/indexer"));
app.use("/api/queue", licenseGuard, require("./routes/queue"));
app.use("/api/woo", licenseGuard, require("./routes/woo"));
app.use("/api/keywords", licenseGuard, require("./routes/keywords"));
// GSC: callback phải public (Google redirect không gửi Authorization)
app.get("/api/gsc/callback", require("./routes/gsc").callbackHandler);
app.use("/api/gsc", licenseGuard, featureGate("googleSearchConsole"), require("./routes/gsc").router);
app.use("/api/affiliate", licenseGuard, require("./routes/affiliate"));

// ===== Webhook (public — plugin authenticates via HMAC signature) =====
app.use("/api/webhook", require("./routes/webhook"));

// Health check (public)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "2.0.0", name: "SPLSEO" });
});

// Dashboard stats (protected)
app.get("/api/dashboard", licenseGuard, async (req, res) => {
  try {
    const storage = require("./services/storage");
    const projects = await storage.getAllForUser("projects", req.userId);
    const audits = await storage.getAllForUser("audits", req.userId);
    const apiKeys = await storage.getAllForUser("api-keys", req.userId);

    res.json({
      projects: projects.length,
      audits: audits.length,
      apiKeys: apiKeys.filter((k) => k.active).length,
      recentAudits: audits.slice(-5).reverse(),
      running: 0,
      pending: 0,
      completedToday: audits.filter((a) => {
        const today = new Date().toISOString().split("T")[0];
        return a.createdAt?.startsWith(today) && a.status === "completed";
      }).length,
      failedToday: audits.filter((a) => {
        const today = new Date().toISOString().split("T")[0];
        return a.createdAt?.startsWith(today) && a.status === "failed";
      }).length,
      // Include license info for dashboard
      license: req.license || null,
      usage: req.usage || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  const skipAuth = process.env.DEV_SKIP_AUTH === "true";
  console.log(`\n🚀 SPLSEO Server running at http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/health`);
  console.log(`   Auth: ${skipAuth ? "⚠️  DEV_SKIP_AUTH=true (bypassed)" : "✅ Enabled"}`);
  console.log(`   Images: http://localhost:${PORT}/api/uploads/images/\n`);

  // Dọn ảnh cũ hơn 30 ngày mỗi giờ
  setInterval(() => imageStore.cleanupOldFiles(), 60 * 60 * 1000);
});
