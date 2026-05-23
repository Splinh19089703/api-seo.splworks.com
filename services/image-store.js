/**
 * image-store.js
 * Lưu ảnh base64 (từ AI) xuống file local → trả URL ngắn /api/uploads/filename
 * Giải quyết vấn đề: AI generate trả base64 ~500KB-2MB → lưu thẳng vào DB gây bài viết bị nhúng mã dài
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'images');
const MAX_FILE_AGE_DAYS = 30; // Xóa file cũ hơn 30 ngày

// Đảm bảo thư mục uploads tồn tại
function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

/**
 * Lưu base64 data URI → file local
 * @param {string} dataUri - "data:image/png;base64,..." hoặc plain base64
 * @param {string} [prefix] - prefix cho tên file (vd: "thumb", "section")
 * @returns {string} URL ngắn: "/api/uploads/images/{uuid}.webp"
 */
function saveBase64ToFile(dataUri, prefix = 'img') {
  ensureUploadsDir();

  let base64Data;
  let ext = 'jpg';

  if (dataUri.startsWith('data:')) {
    // Parse "data:image/png;base64,XXXXX"
    const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) throw new Error('Invalid base64 data URI');
    const mimeType = matches[1];
    base64Data = matches[2];
    ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    // Normalize webp
    if (ext === 'webp') ext = 'webp';
    else if (['png', 'gif', 'webp'].includes(ext)) ext = ext;
    else ext = 'jpg';
  } else {
    // Plain base64 — assume JPEG
    base64Data = dataUri;
  }

  const uuid = crypto.randomBytes(12).toString('hex');
  const filename = `${prefix}-${uuid}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

  return `/api/uploads/images/${filename}`;
}

/**
 * Kiểm tra xem một string có phải base64 data URI dài không
 * @param {string} str
 * @returns {boolean}
 */
function isBase64DataUri(str) {
  return typeof str === 'string' && str.startsWith('data:image') && str.length > 1000;
}

/**
 * Nếu URL là base64 dài → lưu file, trả URL ngắn
 * Nếu URL ngắn bình thường → giữ nguyên
 * @param {string} urlOrBase64
 * @param {string} [prefix]
 * @returns {string}
 */
function normalizeImageUrl(urlOrBase64, prefix = 'img') {
  if (!urlOrBase64) return urlOrBase64;
  if (isBase64DataUri(urlOrBase64)) {
    try {
      return saveBase64ToFile(urlOrBase64, prefix);
    } catch (e) {
      console.error('[ImageStore] Failed to save base64 to file:', e.message);
      return urlOrBase64; // Fallback: giữ nguyên base64
    }
  }
  return urlOrBase64;
}

/**
 * Xóa file ảnh local (khi bài viết bị xóa)
 * @param {string} url - "/api/uploads/images/xxx.jpg"
 */
function deleteImageFile(url) {
  if (!url || !url.startsWith('/api/uploads/images/')) return;
  const filename = path.basename(url);
  const filePath = path.join(UPLOADS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn('[ImageStore] Failed to delete image file:', e.message);
  }
}

/**
 * Dọn dẹp file ảnh cũ hơn MAX_FILE_AGE_DAYS ngày (gọi định kỳ)
 */
function cleanupOldFiles() {
  if (!fs.existsSync(UPLOADS_DIR)) return;
  const cutoff = Date.now() - MAX_FILE_AGE_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(UPLOADS_DIR);
  let deleted = 0;
  for (const f of files) {
    const filePath = path.join(UPLOADS_DIR, f);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    } catch {}
  }
  if (deleted > 0) console.log(`[ImageStore] Cleaned up ${deleted} old image files`);
}

/**
 * Lấy đường dẫn file thực từ URL /api/uploads/images/xxx.jpg
 * Dùng để đọc file khi upload lên WP
 * @param {string} url
 * @returns {string|null} absolute file path
 */
function getFilePath(url) {
  if (!url || !url.startsWith('/api/uploads/images/')) return null;
  const filename = path.basename(url);
  const filePath = path.join(UPLOADS_DIR, filename);
  return fs.existsSync(filePath) ? filePath : null;
}

module.exports = { saveBase64ToFile, normalizeImageUrl, isBase64DataUri, deleteImageFile, cleanupOldFiles, getFilePath, UPLOADS_DIR };
