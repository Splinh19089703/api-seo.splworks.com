import { Component } from "react";

/**
 * ErrorBoundary toàn cục — chặn white screen khi render error.
 * Fallback hiển thị thông báo + nút reload thay vì crash cả app.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          background: "var(--bg, #0b0e14)",
          color: "var(--text, #e2e8f0)",
          fontFamily: "system-ui, sans-serif",
        }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Đã xảy ra lỗi hiển thị</h2>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.7, maxWidth: 420, textAlign: "center" }}>
            {this.state.error?.message || "Lỗi không xác định khi render trang."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8, padding: "8px 20px", borderRadius: 8, border: "none",
              background: "#6366f1", color: "#fff", fontWeight: 600, cursor: "pointer",
            }}
          >
            Tải lại trang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
