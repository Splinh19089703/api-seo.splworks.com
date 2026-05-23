import { useAuth } from "../context/AuthContext";
import UpgradePrompt from "./UpgradePrompt";

/**
 * FeatureGate — Conditional wrapper that renders children only if the user's
 * license includes the specified feature. Otherwise shows UpgradePrompt.
 * 
 * Usage:
 *   <FeatureGate feature="seoAudit">
 *     <AuditList />
 *   </FeatureGate>
 */
export default function FeatureGate({ feature, children, variant = "fullpage" }) {
  const { license, loading } = useAuth();

  // While loading auth, show nothing (prevent flash)
  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <div className="spinner" />
      </div>
    );
  }

  // Check if feature is enabled
  const hasFeature = license?.features?.[feature];

  if (hasFeature) {
    return children;
  }

  return <UpgradePrompt type="feature_locked" feature={feature} variant={variant} />;
}
