/**
 * secret-mask.js — Mask sensitive tokens/passwords in API responses & preserve masked secrets on PUT
 */

const MASK_PLACEHOLDER = "••••••••";
const SECRET_KEY_REGEX = /token|secret|password|passwd|apikey|api_key|private_key|access_key|client_secret/i;

function isMaskedValue(val) {
  if (typeof val !== "string") return false;
  return (
    val === MASK_PLACEHOLDER ||
    val.includes("••••") ||
    /^\.{3}[A-Za-z0-9_-]{1,8}$/.test(val)
  );
}

function maskSecretString(val, keepLast = 4) {
  if (!val || typeof val !== "string") return val;
  if (isMaskedValue(val)) return val;
  if (val.length <= keepLast + 4) return MASK_PLACEHOLDER;
  return `${MASK_PLACEHOLDER}${val.slice(-keepLast)}`;
}

function maskCredentialsObj(creds) {
  if (!creds || typeof creds !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v === "string" && SECRET_KEY_REGEX.test(k)) {
      out[k] = maskSecretString(v, 4);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function mergePreservingMaskedCredentials(existingCreds = {}, incomingCreds = {}) {
  const merged = { ...(existingCreds || {}) };
  if (!incomingCreds || typeof incomingCreds !== "object") return merged;
  for (const [k, v] of Object.entries(incomingCreds)) {
    if (isMaskedValue(v)) {
      // Keep existing secret in DB when client echoes masked placeholder
      continue;
    }
    merged[k] = v;
  }
  return merged;
}

function maskAccountSecrets(account) {
  if (!account || typeof account !== "object") return account;
  return {
    ...account,
    credentials: maskCredentialsObj(account.credentials),
  };
}

function maskProjectSecrets(project) {
  if (!project || typeof project !== "object") return project;
  const cloned = JSON.parse(JSON.stringify(project));
  const cfg = cloned.config;
  if (!cfg || typeof cfg !== "object") return cloned;

  if (cfg.publishing?.wordpress?.appPassword) {
    cfg.publishing.wordpress.appPassword = MASK_PLACEHOLDER;
  }
  if (cfg.youtubeApiKey) {
    cfg.youtubeApiKey = maskSecretString(cfg.youtubeApiKey, 4);
  }
  if (cfg.youtube?.youtubeApiKey) {
    cfg.youtube.youtubeApiKey = maskSecretString(cfg.youtube.youtubeApiKey, 4);
  }
  if (cfg.indexing?.bingIndexNowKey) {
    cfg.indexing.bingIndexNowKey = maskSecretString(cfg.indexing.bingIndexNowKey, 4);
  }
  if (cfg.indexing?.googleServiceAccount?.private_key) {
    cfg.indexing.googleServiceAccount.private_key = MASK_PLACEHOLDER;
  }
  return cloned;
}

function mergeProjectConfigPreservingSecrets(existingConfig = {}, incomingConfig = {}) {
  if (!incomingConfig || typeof incomingConfig !== "object") return existingConfig;
  const next = JSON.parse(JSON.stringify(incomingConfig));

  const oldWpPass = existingConfig?.publishing?.wordpress?.appPassword;
  if (oldWpPass && isMaskedValue(next?.publishing?.wordpress?.appPassword)) {
    next.publishing.wordpress.appPassword = oldWpPass;
  }

  const oldTopYtKey = existingConfig?.youtubeApiKey;
  if (oldTopYtKey && isMaskedValue(next?.youtubeApiKey)) {
    next.youtubeApiKey = oldTopYtKey;
  }

  const oldYtKey = existingConfig?.youtube?.youtubeApiKey;
  if (oldYtKey && isMaskedValue(next?.youtube?.youtubeApiKey)) {
    next.youtube.youtubeApiKey = oldYtKey;
  }

  const oldBingKey = existingConfig?.indexing?.bingIndexNowKey;
  if (oldBingKey && isMaskedValue(next?.indexing?.bingIndexNowKey)) {
    next.indexing.bingIndexNowKey = oldBingKey;
  }

  const oldGsaKey = existingConfig?.indexing?.googleServiceAccount?.private_key;
  if (oldGsaKey && isMaskedValue(next?.indexing?.googleServiceAccount?.private_key)) {
    next.indexing.googleServiceAccount.private_key = oldGsaKey;
  }

  return next;
}

module.exports = {
  MASK_PLACEHOLDER,
  isMaskedValue,
  maskSecretString,
  maskCredentialsObj,
  mergePreservingMaskedCredentials,
  maskAccountSecrets,
  maskProjectSecrets,
  mergeProjectConfigPreservingSecrets,
};
