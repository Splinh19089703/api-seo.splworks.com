import { useState, useEffect } from "react";
import { api } from "../api";

const GTM_HOME_URL = "https://tagmanager.google.com/";

const DEFAULT_PRESET_ITEMS = [
  {
    key: "click_hotline",
    label: "click_hotline",
    desc: "Đo lượt bấm gọi số điện thoại (link tel:...)",
  },
  {
    key: "click_zalo",
    label: "click_zalo",
    desc: "Đo lượt bấm chat Zalo (link zalo.me/...)",
  },
  {
    key: "click_messenger",
    label: "click_messenger",
    desc: "Đo lượt bấm Messenger (link m.me / messenger.com)",
  },
  {
    key: "click_map",
    label: "click_map",
    desc: "Đo lượt bấm chỉ đường Google Maps",
  },
  {
    key: "form_submit",
    label: "form_submit",
    desc: "Đo lượt gửi biểu mẫu liên hệ / báo giá",
  },
];

function buildHeadSnippet(publicId) {
  return `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${publicId}');</script>
<!-- End Google Tag Manager -->`;
}

function buildBodySnippet(publicId) {
  return `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${publicId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;
}

export default function GTMPanel({ suggestedMeasurementId = "", initialCallbackStatus = null }) {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [authUrl, setAuthUrl] = useState("");
  const [reconnecting, setReconnecting] = useState(false);

  // Containers & Workspace
  const [containers, setContainers] = useState([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [selectedContainerKey, setSelectedContainerKey] = useState(
    () => localStorage.getItem("splseo_gtm_container") || ""
  );
  const [workspaceData, setWorkspaceData] = useState(null);
  const [wsLoading, setWsLoading] = useState(false);

  // Auto-setup & JSON Export form
  const [measurementId, setMeasurementId] = useState(suggestedMeasurementId || "");
  const [selectedPresets, setSelectedPresets] = useState([
    "click_hotline",
    "click_zalo",
    "click_messenger",
    "click_map",
    "form_submit",
  ]);
  const [includeGoogleTag, setIncludeGoogleTag] = useState(true);
  const [publishNow, setPublishNow] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [setupResult, setSetupResult] = useState(null);

  // UI toggles
  const [showSnippets, setShowSnippets] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const [errorInfo, setErrorInfo] = useState(null);

  // Sync suggested Measurement ID from GA4 tab if input is still empty
  useEffect(() => {
    if (suggestedMeasurementId && !measurementId) {
      setMeasurementId(suggestedMeasurementId);
    }
  }, [suggestedMeasurementId]);

  useEffect(() => {
    if (initialCallbackStatus?.type === "error") {
      setErrorInfo({
        message: initialCallbackStatus.message,
        code: initialCallbackStatus.code || "",
      });
    }
    checkGtmStatus(initialCallbackStatus?.type === "success");
  }, []);

  const setErrorFromException = (prefix, e) => {
    const rawMsg = e?.message || "Lỗi không xác định";
    const cleanMsg =
      e?.code === "GTM_API_DISABLED" ||
      e?.code === "GTM_MISSING_SCOPE" ||
      e?.code === "GTM_TOKEN_EXPIRED"
        ? rawMsg
        : `${prefix}: ${rawMsg}`;
    setErrorInfo({
      message: cleanMsg,
      code: e?.code || "",
      actionUrl: e?.actionUrl || "",
    });
  };

  const checkGtmStatus = async (forceRefresh = false) => {
    setAuthLoading(true);
    try {
      const st = await api.gtmStatus();
      setConnected(st.connected);
      setEmail(st.email || "");
      if (st.connected) {
        if (st.missingScope) {
          setErrorInfo({
            message:
              "Tài khoản Google chưa cấp đủ quyền quản lý GTM. Vui lòng bấm 'Cấp lại quyền GTM' và tích chọn tất cả các ô quyền.",
            code: "GTM_MISSING_SCOPE",
          });
        } else {
          await loadContainers(forceRefresh);
        }
      } else {
        try {
          const { url } = await api.gtmAuthUrl();
          setAuthUrl(url);
        } catch {}
      }
    } catch {
      setConnected(false);
    } finally {
      setAuthLoading(false);
    }
  };

  const loadContainers = async (forceRefresh = false) => {
    setContainersLoading(true);
    try {
      const res = await api.gtmContainers(forceRefresh);
      const list = res?.containers || [];
      setContainers(list);
      setErrorInfo(null);
      if (list.length > 0) {
        setSelectedContainerKey((prev) => {
          const exists = prev && list.some((c) => `${c.accountId}:${c.containerId}` === prev);
          const next = exists ? prev : `${list[0].accountId}:${list[0].containerId}`;
          localStorage.setItem("splseo_gtm_container", next);
          return next;
        });
      } else {
        setSelectedContainerKey("");
        setWorkspaceData(null);
      }
    } catch (e) {
      setErrorFromException("Không tải được danh sách GTM Container", e);
    } finally {
      setContainersLoading(false);
    }
  };

  const selectedContainer = containers.find(
    (c) => `${c.accountId}:${c.containerId}` === selectedContainerKey
  );

  useEffect(() => {
    if (connected && selectedContainer) {
      loadWorkspace(selectedContainer.accountId, selectedContainer.containerId);
    }
  }, [connected, selectedContainerKey]);

  const loadWorkspace = async (accountId, containerId) => {
    setWsLoading(true);
    setSetupResult(null);
    try {
      const data = await api.gtmWorkspace({ accountId, containerId });
      setWorkspaceData(data);
      if (data?.detectedMeasurementId && !measurementId) {
        setMeasurementId(data.detectedMeasurementId);
      }
    } catch (e) {
      setErrorFromException("Không đọc được Workspace GTM", e);
    } finally {
      setWsLoading(false);
    }
  };

  const handleConnectGtm = async () => {
    if (authUrl) {
      window.location.href = authUrl;
      return;
    }
    setReconnecting(true);
    try {
      const { url } = await api.gtmAuthUrl();
      if (url) window.location.href = url;
    } catch (e) {
      setErrorFromException("Không tạo được link kết nối GTM", e);
      setReconnecting(false);
    }
  };

  const handleReconnectGtm = async () => {
    setReconnecting(true);
    try {
      const { url } = await api.gtmAuthUrl();
      if (url) {
        window.location.href = url;
        return;
      }
    } catch (e) {
      setErrorFromException("Không tạo được link cấp quyền lại", e);
    }
    setReconnecting(false);
  };

  const handleDisconnectGtm = async () => {
    if (!window.confirm("Ngắt kết nối Google Tag Manager?")) return;
    try {
      await api.gtmDisconnect();
      setConnected(false);
      setEmail("");
      setContainers([]);
      setSelectedContainerKey("");
      setWorkspaceData(null);
      setSetupResult(null);
      setErrorInfo(null);
      try {
        const { url } = await api.gtmAuthUrl();
        setAuthUrl(url);
      } catch {}
    } catch (e) {
      setErrorFromException("Ngắt kết nối GTM thất bại", e);
    }
  };

  const togglePreset = (key) => {
    setSelectedPresets((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleAutoSetup = async () => {
    if (!selectedContainer || !workspaceData?.workspace?.workspaceId) return;
    if (!measurementId.trim()) {
      setErrorInfo({
        message: "Vui lòng nhập mã đo lường GA4 (ví dụ: G-XXXXXXXXXX) trước khi tạo bộ Tag.",
      });
      return;
    }

    setProvisioning(true);
    setErrorInfo(null);
    setSetupResult(null);

    try {
      const res = await api.gtmAutoSetup({
        accountId: selectedContainer.accountId,
        containerId: selectedContainer.containerId,
        workspaceId: workspaceData.workspace.workspaceId,
        measurementId: measurementId.trim(),
        presets: selectedPresets,
        includeGoogleTag,
        publishNow,
      });
      setSetupResult(res);
      await loadWorkspace(selectedContainer.accountId, selectedContainer.containerId);
    } catch (e) {
      setErrorFromException("Tạo bộ Tag tự động thất bại", e);
    } finally {
      setProvisioning(false);
    }
  };

  const handleExportJson = async () => {
    setExportingJson(true);
    try {
      const res = await api.gtmExportPreset({
        measurementId: measurementId.trim() || "G-XXXXXXXXXX",
        presets: selectedPresets,
      });
      const blob = new Blob([JSON.stringify(res.containerJson, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename || "splseo-gtm-preset.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErrorFromException("Không xuất được file JSON mẫu", e);
    } finally {
      setExportingJson(false);
    }
  };

  const copySnippet = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 2000);
    } catch {}
  };

  const renderError = () => {
    if (!errorInfo) return null;
    const isApiDisabled = errorInfo.code === "GTM_API_DISABLED";
    const needsReauth =
      errorInfo.code === "GTM_MISSING_SCOPE" || errorInfo.code === "GTM_TOKEN_EXPIRED";

    return (
      <div
        className="card"
        style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <p style={{ color: "#dc2626", margin: 0, fontSize: 13.5, fontWeight: 600, lineHeight: 1.5 }}>
          ❌ {errorInfo.message}
        </p>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {isApiDisabled && errorInfo.actionUrl && (
            <a
              href={errorInfo.actionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
              style={{ textDecoration: "none" }}
            >
              🔗 Mở Google Cloud bật Tag Manager API
            </a>
          )}
          {needsReauth && (
            <button className="btn btn-primary btn-sm" onClick={handleReconnectGtm} disabled={reconnecting}>
              {reconnecting ? "⏳ Đang chuyển hướng..." : "🔑 Cấp lại quyền Google Tag Manager"}
            </button>
          )}
          {connected && (
            <button className="btn btn-sm" onClick={() => loadContainers(true)} disabled={containersLoading}>
              🔄 Thử tải lại
            </button>
          )}
        </div>
      </div>
    );
  };

  if (authLoading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <span className="loader" />
        <p style={{ marginTop: 14, color: "var(--text-muted)" }}>Đang kiểm tra kết nối Google Tag Manager...</p>
      </div>
    );
  }

  return (
    <div>
      {renderError()}

      {/* ─── TRẠNG THÁI CHƯA KẾT NỐI GTM ─── */}
      {!connected ? (
        <div className="gsc-connect-card card" style={{ marginBottom: 20 }}>
          <div className="gsc-connect-icon">🏷️</div>
          <h2>Kết nối Google Tag Manager (GTM)</h2>
          <p style={{ color: "var(--text-muted)", maxWidth: 520, margin: "0 auto 24px" }}>
            Tự động tạo bộ thẻ đo lường <strong>GA4 + Sự kiện khách bấm Gọi điện, Zalo, Messenger, Google Maps, Gửi Form</strong> chỉ với 1 cú click mà không cần tự viết từng biến hay Trigger phức tạp.
          </p>

          <div className="gsc-features-preview">
            {[
              ["⚡", "1-Click Tạo Tag tự động", "Tự cấu hình click_hotline, click_zalo..."],
              ["🚀", "Xuất bản thẳng lên web", "Tự tạo Version & Publish Container"],
              ["📋", "Lấy mã GTM gắn WordPress", "Copy nhanh đoạn mã <head> & <body>"],
              ["📥", "Xuất file JSON mẫu GTM", "Import thủ công nếu không muốn cấp quyền"],
            ].map(([icon, title, sub]) => (
              <div key={title} className="gsc-feature-item">
                <span style={{ fontSize: 24 }}>{icon}</span>
                <strong>{title}</strong>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{sub}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary gsc-connect-btn" onClick={handleConnectGtm} disabled={reconnecting}>
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                style={{ width: 18, height: 18 }}
              />
              {reconnecting ? "Đang chuyển hướng..." : "Kết nối Google Tag Manager"}
            </button>
          </div>

          {/* Công cụ tải file JSON mẫu ngay cả khi chưa kết nối OAuth */}
          <div className="gsc-setup-box" style={{ marginTop: 24 }}>
            <div className="gsc-setup-box__title">
              <span>📥 Hoặc tải nhanh file JSON mẫu GTM (không cần kết nối tài khoản)</span>
              <a
                href={GTM_HOME_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#6366f1", fontSize: 12, textDecoration: "none", fontWeight: 600 }}
              >
                Mở Google Tag Manager ↗
              </a>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-secondary)" }}>
              Nhập mã <code>G-XXXXXXXXXX</code> của bạn rồi tải file JSON về, sau đó vào <em>GTM → Quản trị (Admin) → Nhập vùng chứa (Import Container)</em> là có đủ bộ đo lường sự kiện.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                className="input-field"
                placeholder="Nhập mã G-XXXXXXXXXX"
                value={measurementId}
                onChange={(e) => setMeasurementId(e.target.value.toUpperCase())}
                style={{ width: 220, fontSize: 13 }}
              />
              <button className="btn btn-sm" onClick={handleExportJson} disabled={exportingJson}>
                {exportingJson ? "⏳ Đang tạo file..." : "📥 Tải file JSON mẫu GTM"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ─── HEADER ĐÃ KẾT NỐI GTM ─── */}
          <div
            className="card"
            style={{
              padding: "16px 20px",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                🏷️ Google Tag Manager · <span style={{ color: "#10b981" }}>{email}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                {selectedContainer
                  ? `Đang chọn vùng chứa: ${selectedContainer.name} (${selectedContainer.publicId})`
                  : `Tìm thấy ${containers.length} vùng chứa (Container)`}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {containers.length > 0 && (
                <select
                  className="select-field"
                  value={selectedContainerKey}
                  onChange={(e) => {
                    setSelectedContainerKey(e.target.value);
                    localStorage.setItem("splseo_gtm_container", e.target.value);
                  }}
                  style={{ minWidth: 250 }}
                >
                  {containers.map((c) => (
                    <option key={`${c.accountId}:${c.containerId}`} value={`${c.accountId}:${c.containerId}`}>
                      {c.publicId} — {c.name} ({c.accountName})
                    </option>
                  ))}
                </select>
              )}

              {selectedContainer && (
                <>
                  <button
                    className="btn btn-sm"
                    onClick={() => setShowSnippets((v) => !v)}
                    style={{
                      fontSize: 12,
                      borderColor: showSnippets ? "#6366f1" : undefined,
                      color: showSnippets ? "#6366f1" : undefined,
                    }}
                  >
                    📋 Mã gắn Web ({selectedContainer.publicId})
                  </button>
                  <a
                    href={selectedContainer.tagManagerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-sm"
                    style={{ textDecoration: "none", fontSize: 12 }}
                  >
                    🌐 Mở trên GTM ↗
                  </a>
                </>
              )}

              <a
                href={GTM_HOME_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm"
                style={{ textDecoration: "none", fontSize: 12 }}
                title="Tạo vùng chứa (Container) mới trên Google Tag Manager"
              >
                ➕ Tạo Container mới
              </a>

              <button
                className="btn btn-sm"
                onClick={() => loadContainers(true)}
                disabled={containersLoading || wsLoading}
                title="Tải lại danh sách Container"
              >
                {containersLoading || wsLoading ? "⏳" : "🔄"}
              </button>

              <button className="btn btn-sm" style={{ color: "#ef4444" }} onClick={handleDisconnectGtm}>
                Ngắt kết nối
              </button>
            </div>
          </div>

          {/* ─── NẾU CHƯA CÓ CONTAINER NÀO ─── */}
          {!containersLoading && containers.length === 0 && !errorInfo && (
            <div className="card gsc-guide-card">
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                🚀 Tài khoản {email} chưa có vùng chứa (Container) GTM nào
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 12px" }}>
                Hãy mở Google Tag Manager, tạo 1 Tài khoản & Vùng chứa loại <strong>Web</strong> cho tên miền của bạn, sau đó quay lại đây bấm <strong>Tải lại</strong> để cài tự động bộ sự kiện chỉ với 1 click!
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  href={GTM_HOME_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                  style={{ textDecoration: "none" }}
                >
                  ➕ Mở Google Tag Manager tạo Container đầu tiên
                </a>
                <button className="btn btn-sm" onClick={() => loadContainers(true)}>
                  🔄 Đã tạo xong — Tải lại danh sách
                </button>
              </div>
            </div>
          )}

          {/* ─── HỘP ĐOẠN MÃ GẮN LÊN WEBSITE WORDPRESS (<head> & <body>) ─── */}
          {selectedContainer && showSnippets && (
            <div className="card gsc-guide-card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <strong>
                  📋 Đoạn mã cài đặt {selectedContainer.publicId} lên Website WordPress
                </strong>
                <button className="btn btn-sm" onClick={() => setShowSnippets(false)}>
                  Đóng ✕
                </button>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-secondary)" }}>
                Dán đoạn 1 vào thẻ <code>&lt;head&gt;</code> và đoạn 2 ngay sau thẻ mở <code>&lt;body&gt;</code> (trong mục <em>Insert Headers and Footers / WPCode</em>, cài đặt Theme hoặc điền mã <code>{selectedContainer.publicId}</code> vào plugin <em>GTM4WP</em>).
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
                <div style={{ background: "var(--bg-card)", padding: 12, borderRadius: 8, border: "1px solid var(--border-light)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>1. Dán trong thẻ &lt;head&gt;</span>
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: 11, padding: "3px 8px" }}
                      onClick={() => copySnippet("head", buildHeadSnippet(selectedContainer.publicId))}
                    >
                      {copiedKey === "head" ? "✅ Đã copy" : "📋 Copy mã <head>"}
                    </button>
                  </div>
                  <pre style={{ margin: 0, fontSize: 11, overflowX: "auto", color: "var(--text-secondary)" }}>
                    {buildHeadSnippet(selectedContainer.publicId)}
                  </pre>
                </div>

                <div style={{ background: "var(--bg-card)", padding: 12, borderRadius: 8, border: "1px solid var(--border-light)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>2. Dán ngay sau thẻ mở &lt;body&gt;</span>
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: 11, padding: "3px 8px" }}
                      onClick={() => copySnippet("body", buildBodySnippet(selectedContainer.publicId))}
                    >
                      {copiedKey === "body" ? "✅ Đã copy" : "📋 Copy mã <body>"}
                    </button>
                  </div>
                  <pre style={{ margin: 0, fontSize: 11, overflowX: "auto", color: "var(--text-secondary)" }}>
                    {buildBodySnippet(selectedContainer.publicId)}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* ─── BỘ CÀI ĐẶT TỰ ĐỘNG 1-CLICK TAG CHUYỂN ĐỔI CHUẨN SEO ─── */}
          {selectedContainer && (
            <div className="card" style={{ padding: "18px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                <div>
                  <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>
                    ⚡ Cài đặt tự động Bộ Thẻ Đo Lường Sự Kiện Chuyển Đổi (GA4 + GTM)
                  </h3>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>
                    Hệ thống tự động kiểm tra những thẻ chưa có để tạo mới (không bao giờ tạo trùng lặp thẻ đã cài).
                  </p>
                </div>
                {workspaceData && (
                  <span
                    style={{
                      fontSize: 12,
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontWeight: 600,
                      background: workspaceData.hasGoogleTag ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                      color: workspaceData.hasGoogleTag ? "#10b981" : "#f59e0b",
                    }}
                  >
                    {workspaceData.hasGoogleTag
                      ? `✅ Đã có Google Tag ${workspaceData.detectedMeasurementId ? `(${workspaceData.detectedMeasurementId})` : ""}`
                      : "⚠️ Container chưa có Google Tag (G-XXXX)"}
                  </span>
                )}
              </div>

              {/* Input Measurement ID */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>
                    Mã đo lường GA4 (Measurement ID) *
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="VD: G-XXXXXXXXXX"
                    value={measurementId}
                    onChange={(e) => setMeasurementId(e.target.value.toUpperCase())}
                    style={{ width: 240, fontWeight: 700, letterSpacing: 0.4 }}
                  />
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 18, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={includeGoogleTag}
                    onChange={(e) => setIncludeGoogleTag(e.target.checked)}
                  />
                  Tạo kèm thẻ gốc <strong>Google Tag (All Pages)</strong> nếu chưa có
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 18, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={publishNow}
                    onChange={(e) => setPublishNow(e.target.checked)}
                  />
                  🚀 <strong>Xuất bản (Publish) luôn</strong> lên website sau khi tạo
                </label>
              </div>

              {/* Checklist các sự kiện */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                {DEFAULT_PRESET_ITEMS.map((item) => {
                  const statusItem = workspaceData?.presetChecklist?.find((p) => p.key === item.key);
                  const isInstalled = !!statusItem?.installed;
                  const checked = selectedPresets.includes(item.key);

                  return (
                    <label
                      key={item.key}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: checked
                          ? "1.5px solid rgba(99,102,241,0.55)"
                          : "1px solid var(--border-light)",
                        background: isInstalled
                          ? "rgba(16,185,129,0.06)"
                          : "var(--bg-surface)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePreset(item.key)}
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <code style={{ fontWeight: 700, fontSize: 12.5, color: "var(--text-primary)" }}>
                            {item.label}
                          </code>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: isInstalled ? "#10b981" : "var(--text-muted)",
                            }}
                          >
                            {isInstalled ? "✅ Đã cài" : "Chưa cài"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                          {item.desc}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="btn btn-primary"
                  onClick={handleAutoSetup}
                  disabled={provisioning || wsLoading || selectedPresets.length === 0}
                >
                  {provisioning
                    ? "⏳ Đang tạo Tag & Trigger trên GTM..."
                    : "⚡ Tạo tự động bộ Tag vào GTM"}
                </button>
                <button
                  className="btn"
                  onClick={handleExportJson}
                  disabled={exportingJson}
                  title="Tải file JSON về máy để Import thủ công nếu muốn"
                >
                  {exportingJson ? "⏳ Đang xuất..." : "📥 Xuất file JSON mẫu"}
                </button>
              </div>

              {/* Kết quả sau khi bấm Tạo tự động */}
              {setupResult && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "12px 14px",
                    borderRadius: 8,
                    background: "rgba(16,185,129,0.1)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#10b981" }}>
                    ✅ Hoàn tất đồng bộ GTM cho mã {setupResult.measurementId}!
                  </div>
                  {setupResult.createdTags?.length > 0 && (
                    <div>
                      • Đã tạo mới ({setupResult.createdTags.length}):{" "}
                      <strong>{setupResult.createdTags.join(", ")}</strong>
                    </div>
                  )}
                  {setupResult.skippedTags?.length > 0 && (
                    <div style={{ color: "var(--text-secondary)" }}>
                      • Đã có sẵn nên bỏ qua ({setupResult.skippedTags.length}):{" "}
                      {setupResult.skippedTags.join(", ")}
                    </div>
                  )}
                  {setupResult.publishedVersion && (
                    <div style={{ fontWeight: 600, color: "#10b981" }}>
                      🚀 Đã xuất bản trực tiếp lên phiên bản Container #{setupResult.publishedVersion}!
                    </div>
                  )}
                  {setupResult.publishWarning && (
                    <div style={{ color: "#f59e0b", marginTop: 4 }}>
                      ⚠️ {setupResult.publishWarning}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── BẢNG DANH SÁCH THẺ (TAGS) HIỆN CÓ TRONG CONTAINER ─── */}
          {selectedContainer && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border-color)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <strong style={{ fontSize: 13.5 }}>
                  🏷️ Danh sách Thẻ (Tags) hiện có trong {selectedContainer.publicId}{" "}
                  {workspaceData?.tags && (
                    <span className="gsc-tab-count" style={{ marginLeft: 6 }}>
                      {workspaceData.tags.length}
                    </span>
                  )}
                </strong>
                {workspaceData?.triggers && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Tổng Triggers: {workspaceData.triggers.length}
                  </span>
                )}
              </div>

              <table className="data-table gsc-table">
                <thead>
                  <tr>
                    <th>Tên thẻ (Tag Name)</th>
                    <th style={{ width: 130 }}>Loại thẻ</th>
                    <th style={{ width: 170 }}>Tên sự kiện / Mã G-ID</th>
                    <th>Điều kiện kích hoạt (Firing Triggers)</th>
                    <th style={{ width: 110, textAlign: "center" }}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {wsLoading ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                        ⏳ Đang tải danh sách thẻ từ GTM Workspace...
                      </td>
                    </tr>
                  ) : !workspaceData?.tags?.length ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: 36, color: "var(--text-muted)" }}>
                        Container này hiện chưa có thẻ nào. Hãy bấm nút <strong>Tạo tự động bộ Tag vào GTM</strong> ở trên!
                      </td>
                    </tr>
                  ) : (
                    workspaceData.tags.map((t) => (
                      <tr key={t.tagId}>
                        <td style={{ fontWeight: 600 }}>{t.name}</td>
                        <td>
                          <code>{t.type === "gaawe" ? "GA4 Event" : t.type === "googtag" ? "Google Tag" : t.type}</code>
                        </td>
                        <td>
                          {t.eventName ? (
                            <span style={{ color: "#6366f1", fontWeight: 600 }}>{t.eventName}</span>
                          ) : t.measurementId ? (
                            <span style={{ color: "#10b981", fontWeight: 600 }}>{t.measurementId}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                          {t.firingTriggers?.join(", ") || "—"}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {t.paused ? (
                            <span style={{ color: "#f59e0b", fontSize: 12, fontWeight: 600 }}>Tạm dừng</span>
                          ) : (
                            <span style={{ color: "#10b981", fontSize: 12, fontWeight: 600 }}>Hoạt động</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
