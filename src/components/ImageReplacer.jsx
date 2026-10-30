import { useState, useRef, useEffect } from "react";
import { api } from "../api";

// C5: Extracted from Pipeline.jsx — Reusable Image Replacer Dialog with Google Images Search
export default function ImageReplacer({ onReplace, onClose, label, defaultQuery = "" }) {
  const [mode, setMode] = useState(defaultQuery ? "google" : null); // 'google' | 'file' | 'url'
  const [urlInput, setUrlInput] = useState("");
  const [searchQuery, setSearchQuery] = useState(defaultQuery || "");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const handleSearchGoogle = async (customQuery) => {
    const q = (customQuery !== undefined ? customQuery : searchQuery).trim();
    if (!q) return;
    setSearching(true);
    setSearchError("");
    try {
      const data = await api.searchImages(q, 16);
      setSearchResults(data?.results || []);
      if (!data?.results?.length) {
        setSearchError("Không tìm thấy ảnh phù hợp. Hãy thử từ khóa ngắn gọn hơn.");
      }
    } catch (e) {
      setSearchError(e.message || "Lỗi tìm kiếm ảnh");
    }
    setSearching(false);
  };

  useEffect(() => {
    if (defaultQuery && mode === "google" && searchResults.length === 0) {
      handleSearchGoogle(defaultQuery);
    }
  }, []);

  const handleSelectGoogleImage = async (item) => {
    setLoading(true);
    try {
      await onReplace({ url: item.url, thumbUrl: item.thumbUrl });
      onClose();
    } catch (e) {
      alert("Lỗi chọn ảnh: " + (e.message || "Không thể tải ảnh này"));
    }
    setLoading(false);
  };

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
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "var(--bg-card)", borderRadius: 12, padding: 24, maxWidth: mode === "google" ? 720 : 520, width: "95%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{"🖼️"} {label || "Chọn / Thay thế ảnh"}</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={`btn btn-sm ${mode === "google" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => { setMode("google"); if (searchQuery && searchResults.length === 0) handleSearchGoogle(searchQuery); }}>
              🔍 Ảnh Google
            </button>
            <button className={`btn btn-sm ${mode === "file" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => { setMode("file"); setTimeout(() => fileRef.current?.click(), 100); }}>
              📁 Upload
            </button>
            <button className={`btn btn-sm ${mode === "url" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMode("url")}>
              🔗 Dán URL
            </button>
          </div>
        </div>

        {!mode && (
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-primary" style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "var(--accent-green)" }}
              onClick={() => { setMode("google"); if (searchQuery) handleSearchGoogle(searchQuery); }}>
              <span style={{ fontSize: 28 }}>{"🔍"}</span>
              <span style={{ fontSize: 13 }}>Tìm ảnh Google</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.85)" }}>Ảnh thực tế chuẩn chủ đề</span>
            </button>
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

        {mode === "google" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Nhập từ khóa tìm ảnh thực tế trên Google..."
                style={{ flex: 1, padding: "9px 12px", fontSize: 13 }}
                onKeyDown={e => e.key === "Enter" && handleSearchGoogle()}
                autoFocus
              />
              <button className="btn btn-primary" onClick={() => handleSearchGoogle()} disabled={searching || !searchQuery.trim()}>
                {searching ? "⏳ Đang tìm..." : "🔍 Tìm ảnh"}
              </button>
            </div>

            {loading && (
              <div style={{ padding: 12, marginBottom: 10, borderRadius: 8, background: "rgba(59,130,246,0.12)", color: "var(--accent-blue)", fontSize: 13, textAlign: "center" }}>
                ⏳ Đang tải ảnh về server và chèn vào bài viết...
              </div>
            )}

            {searchError && (
              <div style={{ padding: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "var(--accent-red)", fontSize: 12, marginBottom: 10 }}>
                {searchError}
              </div>
            )}

            <div style={{ overflowY: "auto", flex: 1, maxHeight: 420, paddingRight: 4 }}>
              {searching ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)", fontSize: 13 }}>
                  <span className="loader" style={{ display: "inline-block", marginBottom: 10 }} />
                  <div>Đang tìm ảnh thực tế từ Google Images...</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
                  {searchResults.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => !loading && handleSelectGoogleImage(item)}
                      style={{
                        cursor: loading ? "wait" : "pointer",
                        borderRadius: 8,
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        background: "var(--bg-secondary)",
                        transition: "transform 0.15s, border-color 0.15s",
                      }}
                      title={`${item.title || ""}\nNguồn: ${item.source || "Google"}`}
                    >
                      <div style={{ width: "100%", height: 105, overflow: "hidden", background: "#111" }}>
                        <img
                          src={item.thumbUrl || item.url}
                          alt={item.title || ""}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                      </div>
                      <div style={{ padding: "6px 8px", fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        🌐 {item.source || "Google Images"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "file" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
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
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
