import { useCallback, useState } from "react";
import UpgradePrompt from "../components/UpgradePrompt";

/**
 * Hook xử lý lỗi 403 license từ API — tự map err.code → UpgradePrompt.
 * Dùng trong các action tạo bài/dự án/sản phẩm:
 *
 *   const { upgradeState, withUpgradePrompt, UpgradePromptUI } = useUpgradePrompt();
 *   try { await api.createProject(...) } catch (e) { withUpgradePrompt(e) || setError(e.message); }
 *   {UpgradePromptUI}
 *
 * Các code được hỗ trợ (backend trả qua api.js): FEATURE_LOCKED, ARTICLE_LIMIT, PROJECT_LIMIT
 */
export default function useUpgradePrompt() {
  const [upgradeState, setUpgradeState] = useState(null); // { type, feature, limit, used }

  const withUpgradePrompt = useCallback((err) => {
    if (!err?.isLicenseError) return false;
    const map = {
      FEATURE_LOCKED: { type: "feature_locked", feature: err.feature },
      ARTICLE_LIMIT: { type: "article_limit", limit: err.limit, used: err.used },
      PROJECT_LIMIT: { type: "project_limit", limit: err.limit, used: err.used },
    };
    const state = map[err.code];
    if (!state) return false;
    setUpgradeState(state);
    return true;
  }, []);

  const closeUpgrade = useCallback(() => setUpgradeState(null), []);

  // Render element — đặt ở cuối component caller
  const UpgradePromptUI = upgradeState ? (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 24,
      }}
      onClick={closeUpgrade}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: "100%" }}>
        <UpgradePrompt {...upgradeState} variant="card" />
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={closeUpgrade}>
            Để sau
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { upgradeState, withUpgradePrompt, closeUpgrade, UpgradePromptUI };
}
