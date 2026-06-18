const storage = require("./storage");

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

async function resolveApiKeys(userId) {
  const userKeys = activeOnly(await storage.getAllForUser("api-keys", userId));
  if (userKeys.length > 0) return userKeys;

  if (process.env.ENABLE_SHARED_API_KEYS === "false") return [];

  const sharedOwnerIds = getSharedPoolOwnerIds();
  const allKeys = await storage.getAll("api-keys");
  return activeOnly(allKeys.filter((key) => isSharedKey(key, sharedOwnerIds)));
}

module.exports = { resolveApiKeys };
