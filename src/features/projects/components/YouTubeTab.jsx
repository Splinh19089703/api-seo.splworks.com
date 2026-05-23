import { useState, useEffect } from "react";
import { api } from "../../../api";

export default function YouTubeTab({ projectId, onUpdate }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState("single");
  const [urls, setUrls] = useState("");
  const [getTranscript, setGetTranscript] = useState(true);

  useEffect(() => {
    api
      .getVideos(projectId)
      .then(setVideos)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleAdd = async () => {
    await api.addVideos(projectId, { mode, urls, getTranscript });
    setShowModal(false);
    setUrls("");
    const v = await api.getVideos(projectId);
    setVideos(v);
    onUpdate();
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>Video YouTube</h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              margin: "4px 0 0",
            }}
          >
            Thêm video YouTube để AI trích xuất transcript và tạo bài viết
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowModal(true)}
        >
          + Thêm video
        </button>
      </div>

      {loading ? (
        <div className="loading-overlay">
          <span className="loader" />
        </div>
      ) : videos.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: 48 }}>
            ▶️
          </div>
          <h3>Chưa có video YouTube</h3>
          <p>Thêm video YouTube để AI tạo bài viết từ transcript.</p>
          <button
            className="btn btn-primary"
            onClick={() => setShowModal(true)}
          >
            Thêm video YouTube
          </button>
        </div>
      ) : (
        <div>
          {videos.map((v) => (
            <div
              key={v.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderBottom: "1px solid var(--border-light)",
              }}
            >
              {v.thumbnailUrl && (
                <img
                  src={v.thumbnailUrl}
                  alt=""
                  style={{
                    width: 80,
                    height: 45,
                    borderRadius: 4,
                    objectFit: "cover",
                  }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{v.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {v.url}
                </div>
              </div>
              <span
                className={`badge ${v.status === "added" ? "badge-success" : "badge-info"}`}
              >
                {v.status === "added" ? "Đã thêm" : "Đang lấy transcript"}
              </span>
              <button
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  await api.deleteVideo(projectId, v.id);
                  const updated = await api.getVideos(projectId);
                  setVideos(updated);
                  onUpdate();
                }}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <h2>Thêm video YouTube</h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[
                { id: "single", label: "Đơn lẻ" },
                { id: "bulk", label: "Hàng loạt" },
                { id: "playlist", label: "Playlist" },
              ].map((m) => (
                <button
                  key={m.id}
                  className={`btn ${mode === m.id ? "btn-primary" : "btn-secondary"} btn-sm`}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="form-group">
              <label>
                {mode === "single"
                  ? "URL Video"
                  : mode === "bulk"
                    ? "URLs (mỗi dòng 1 URL)"
                    : "URL Playlist/Channel"}
              </label>
              {mode === "single" ? (
                <input
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                />
              ) : (
                <textarea
                  rows={5}
                  placeholder={
                    mode === "bulk"
                      ? "https://youtube.com/watch?v=...\nhttps://youtube.com/watch?v=..."
                      : "https://www.youtube.com/playlist?list=..."
                  }
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                />
              )}
            </div>
            <div className="toggle-row" style={{ borderBottom: "none" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>
                  Lấy transcript ngay
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Trích xuất transcript ngay sau khi thêm
                </div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={getTranscript}
                  onChange={(e) => setGetTranscript(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
              >
                Hủy
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={!urls.trim()}
              >
                Thêm video
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
