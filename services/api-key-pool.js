const storage = require("./storage");
const { getCreditUsage } = require("../middleware/ai-credit-tracker");

function activeOnly(keys) {
  return (keys || []).filter((key) => key && key.active !== false);
}

function getSharedPoolOwnerIds() {
  return (process.env.SHARED_API_KEY_USER_IDS || process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isSharedKey(key, sharedOwnerIds) {
  return key.shared === true || key.scope === "shared" || sharedOwnerIds.includes(key.userId);
}

function tagSharedKeys(keys, userId) {
  return (keys || []).map((k) => ({
    ...k,
    _isSharedPool: true,
    _forUserId: userId || null,
  }));
}

/**
 * Resolve API keys for a user with tiered shared pool support.
 * 
 * Priority order:
 * 1. User's own keys (BYOK) — if user has added personal API keys
 * 2. Priority shared pool — pro+ users get access to high-priority keys (priority < 10)
 * 3. Standard shared pool — trial/basic users only get standard keys (priority >= 10)
 * 
 * @param {string} userId
 * @param {object|null} license — license object with features/plan (optional, for pool tiering)
 */
async function resolveApiKeys(userId, license = null) {
  // 1. User's own keys first (BYOK — no credit deduction)
  const userKeys = activeOnly(await storage.getAllForUser("api-keys", userId));
  if (userKeys.length > 0) return userKeys;

  // 2. Shared pool — disabled via env
  if (process.env.ENABLE_SHARED_API_KEYS === "false") return [];

  // Enforce monthly AI credit limit when using shared pool
  if (userId && userId !== "dev-user" && process.env.DEV_SKIP_AUTH !== "true") {
    try {
      const creditUsage = await getCreditUsage(userId, license);
      if (creditUsage && creditUsage.remaining <= 0) {
        const err = new Error(
          `Đã hết AI credits tháng này (${creditUsage.used}/${creditUsage.limit}). Vui lòng nâng cấp gói hoặc thêm API Key cá nhân trong Cài đặt.`
        );
        err.code = "AI_CREDITS_EXCEEDED";
        throw err;
      }
    } catch (creditErr) {
      if (creditErr.code === "AI_CREDITS_EXCEEDED") throw creditErr;
    }
  }

  const sharedOwnerIds = getSharedPoolOwnerIds();
  const allKeys = await storage.getAll("api-keys");
  const sharedKeys = activeOnly(allKeys.filter((key) => isSharedKey(key, sharedOwnerIds)));

  // Debug logging (remove after confirming production works)
  if (sharedKeys.length === 0) {
    console.warn(`[API-Key-Pool] ⚠️ No shared keys found for user ${userId}`);
    console.warn(`  → ADMIN_USER_IDS env: "${process.env.ADMIN_USER_IDS || "(not set)"}"`);
    console.warn(`  → Shared owner IDs: [${sharedOwnerIds.join(", ")}]`);
    console.warn(`  → Total keys in DB: ${allKeys.length}`);
    console.warn(`  → Key userIds in DB: [${[...new Set(allKeys.map(k => k.userId))].join(", ")}]`);
  }

  if (sharedKeys.length === 0) {
    const systemOmniKey = process.env.OMNIROUTER_API_KEY;
    if (systemOmniKey) {
      console.log(`[API-Key-Pool] ⚡ Dùng fallback key OmniRouter hệ thống cho user ${userId}`);
      return tagSharedKeys([{
        id: "system_omnirouter_key",
        name: "OmniRouter System",
        provider: "omnirouter",
        apiKey: systemOmniKey,
        active: true,
        priority: 1
      }], userId);
    }
    return [];
  }

  // 3. Tiered access: Priority pool for pro+ users with priorityAiPool feature
  const hasPriority = license?.features?.priorityAiPool === true;

  if (hasPriority) {
    // Pro+/Agency+: access ALL shared keys including priority (priority < 10)
    return tagSharedKeys(sharedKeys, userId);
  }

  // Trial/Basic: only standard shared keys (priority >= 10)
  // Keys with no priority set default to 10 (standard tier)
  const standardKeys = sharedKeys.filter(k => (k.priority || 10) >= 10);

  // Fallback: if no standard keys exist, use all shared keys
  // (don't lock users out if admin hasn't set priorities)
  if (standardKeys.length === 0) {
    console.warn("[API-Key-Pool] Không có standard shared keys, dùng tất cả shared keys cho trial/basic user.");
    return tagSharedKeys(sharedKeys, userId);
  }

  return tagSharedKeys(standardKeys, userId);
}

module.exports = { resolveApiKeys };
