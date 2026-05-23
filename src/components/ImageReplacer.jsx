import { useState, useRef } from "react";

// C5: Extracted from Pipeline.jsx — Reusable Image Replacer Dialog
export default function ImageReplacer({ onReplace, onClose, label }) {
  const [mode, setMode] = useState(null); // 'file' | 'url'
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert("File quá lớn (tối đa 20MB)"); return; }
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        await onReplace({ base64: reader.result });
        setLoading(false);
        onClose();
      };
      reader.readAsDataURL(file);
    } catch { setLoading(false); }
  };

  const handleUrl = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    try {
      await onReplace({ url: urlInput.trim() });
      onClose();
    } catch { }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "var(--bg-card)", borderRadius: 12, padding: 24, maxWidth: 480, width: "90%", boxShadow: "var(--shadow-lg)" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>{"📤"} {label || "Thay thế ảnh"}</h3>

        {!mode && (
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-primary" style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
              onClick={() => { setMode("file"); setTimeout(() => fileRef.current?.click(), 100); }}>
              <span style={{ fontSize: 28 }}>{"📁"}</span>
              <span style={{ fontSize: 13 }}>Upload từ máy</span>
            </button>
            <button className="btn btn-primary" style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "var(--accent-blue)" }}
              onClick={() => setMode("url")}>
              <span style={{ fontSize: 28 }}>{"🔗"}</span>
              <span style={{ fontSize: 13 }}>Paste URL</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>Google Drive, Unsplash...</span>
            </button>
          </div>
        )}

        {mode === "file" && (
          <div style={{ textAlign: "center" }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={loading}>
              {loading ? "⏳ Đang upload..." : "📁 Chọn file ảnh"}
            </button>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Hỗ trợ: JPG, PNG, WebP (tối đa 20MB)</p>
          </div>
        )}

        {mode === "url" && (
          <div>
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://drive.google.com/... hoặc URL ảnh trực tiếp"
              style={{ width: "100%", marginBottom: 12, padding: "10px 12px", fontSize: 14 }}
              onKeyDown={e => e.key === "Enter" && handleUrl()} autoFocus />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
              {"💡"} Paste URL trực tiếp từ Google Drive (share link), Unsplash, Pexels, hoặc bất kỳ URL ảnh nào.
            </div>
            <button className="btn btn-primary" onClick={handleUrl} disabled={!urlInput.trim() || loading} style={{ width: "100%" }}>
              {loading ? "⏳ Đang xử lý..." : "✅ Sử dụng URL này"}
            </button>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          {mode && <button className="btn btn-secondary btn-sm" style={{ marginRight: 8 }} onClick={() => setMode(null)}>← Quay lại</button>}
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
