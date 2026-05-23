import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg-primary)",
        gap: 12,
      }}>
        <div className="loader" style={{ width: 28, height: 28 }} />
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Đang kiểm tra đăng nhập...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
