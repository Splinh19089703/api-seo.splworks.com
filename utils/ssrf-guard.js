/**
 * ssrf-guard.js — Centralized Anti-SSRF URL & DNS Socket Guard
 * Blocks requests and redirects to loopback, private RFC1918, CGNAT, link-local / cloud metadata IPs.
 */
const dns = require("dns");
const net = require("net");
const http = require("http");
const https = require("https");

/**
 * Check whether an IPv4 or IPv6 address belongs to a private, loopback, link-local, or reserved range.
 * @param {string} rawIp
 * @returns {boolean}
 */
function isPrivateOrReservedIp(rawIp) {
  if (!rawIp || typeof rawIp !== "string") return true;
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];

  const ipType = net.isIP(ip);
  if (ipType === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10.0.0.0/8
      a === 127 || // 127.0.0.0/8 loopback
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      (a === 169 && b === 254) || // 169.254.0.0/16 link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmark
      a >= 224 // multicast & reserved
    ) {
      return true;
    }
    return false;
  }

  if (ipType === 6) {
    if (
      ip === "::" ||
      ip === "::1" ||
      ip === "0:0:0:0:0:0:0:0" ||
      ip === "0:0:0:0:0:0:0:1" ||
      /^fe[89ab][0-9a-f]:/i.test(ip) || // fe80::/10 link-local
      /^f[cd][0-9a-f]{2}:/i.test(ip) || // fc00::/7 unique local
      /^ff[0-9a-f]{2}:/i.test(ip) // ff00::/8 multicast
    ) {
      return true;
    }

    // Dotted IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    if (ip.startsWith("::ffff:")) {
      const rest = ip.slice(7);
      if (net.isIP(rest) === 4) {
        return isPrivateOrReservedIp(rest);
      }
      // Hex IPv4-mapped IPv6 normalized by WHATWG URL (e.g. ::ffff:7f00:1)
      const hexMatch = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
      if (hexMatch) {
        const hi = parseInt(hexMatch[1], 16);
        const lo = parseInt(hexMatch[2], 16);
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateOrReservedIp(v4);
      }
    }
    return false;
  }

  return true;
}

/**
 * Synchronous URL check (validates protocol, hostname blocklist, and IP literals).
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  let parsed;
  try {
    const normalized = /^https?:\/\//i.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    parsed = new URL(normalized);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return false;

  const hostname = (parsed.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) return false;

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data"
  ) {
    return false;
  }

  if (net.isIP(hostname) !== 0) {
    return !isPrivateOrReservedIp(hostname);
  }

  return true;
}

/**
 * Async URL + DNS resolution check (blocks domains resolving to internal/private IPs).
 * @param {string} rawUrl
 * @returns {Promise<string>} Normalized URL
 */
async function assertSafeExternalUrl(rawUrl) {
  if (!isSafeExternalUrl(rawUrl)) {
    throw new Error("URL không hợp lệ hoặc bị chặn vì lý do bảo mật (SSRF protection)");
  }
  const normalized = /^https?:\/\//i.test(rawUrl.trim())
    ? rawUrl.trim()
    : `https://${rawUrl.trim()}`;
  const parsed = new URL(normalized);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(hostname) === 0) {
    let records;
    try {
      records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    } catch (e) {
      throw new Error(`Không thể phân giải tên miền: ${hostname}`);
    }
    if (!records || records.length === 0) {
      throw new Error(`Không tìm thấy địa chỉ IP cho tên miền: ${hostname}`);
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error("Tên miền trỏ về địa chỉ IP nội bộ bị chặn (SSRF protection)");
      }
    }
  }

  return normalized;
}

/**
 * Custom dns.lookup hook for http.Agent / https.Agent.
 * Blocks DNS rebinding and HTTP 30x redirects to internal/private IPs at socket connection time.
 */
function safeLookup(hostname, options, callback) {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options || {};

  const cleanHost = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (
    cleanHost === "localhost" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost.endsWith(".local") ||
    cleanHost.endsWith(".internal") ||
    cleanHost === "metadata.google.internal"
  ) {
    return process.nextTick(() =>
      cb(new Error(`SSRF protection: blocked internal host ${hostname}`))
    );
  }

  dns.lookup(hostname, opts, (err, addressOrList, family) => {
    if (err) return cb(err);

    if (Array.isArray(addressOrList)) {
      for (const item of addressOrList) {
        if (isPrivateOrReservedIp(item.address)) {
          return cb(new Error(`SSRF protection: blocked private IP for ${hostname}`));
        }
      }
      return cb(null, addressOrList);
    }

    if (isPrivateOrReservedIp(addressOrList)) {
      return cb(new Error(`SSRF protection: blocked private IP for ${hostname}`));
    }
    return cb(null, addressOrList, family);
  });
}

const safeHttpAgent = new http.Agent({ lookup: safeLookup });
const safeHttpsAgent = new https.Agent({ lookup: safeLookup });
const safeInsecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  lookup: safeLookup,
});

module.exports = {
  isPrivateOrReservedIp,
  isSafeExternalUrl,
  assertSafeExternalUrl,
  safeLookup,
  safeHttpAgent,
  safeHttpsAgent,
  safeInsecureHttpsAgent,
};
