import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { Link, useNavigate } from "react-router-dom";

export default function Login() {
  const { login, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError("Vui lòng nhập email và mật khẩu"); return; }
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Đăng nhập thất bại");
    }
    setLoading(false);
  };

  const handleGoogleResponse = useCallback(async (response) => {
    if (!response.credential) return;
    setError("");
    setGoogleLoading(true);
    try {
      await googleLogin(response.credential);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Đăng nhập Google thất bại");
    } finally {
      setGoogleLoading(false);
    }
  }, [googleLogin, navigate]);

  // Google Sign-In
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    let cancelled = false;

    const initGoogle = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleResponse,
        auto_select: false,
      });
      if (googleBtnRef.current) {
        googleBtnRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: googleBtnRef.current.offsetWidth || 348,
          locale: "vi",
        });
      }
    };

    // Check if script already loaded
    if (window.google?.accounts?.id) {
      initGoogle();
      return () => {
        cancelled = true;
      };
    }

    // Load Google Identity Services script
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", initGoogle);
      return () => {
        cancelled = true;
        existing.removeEventListener("load", initGoogle);
      };
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);
    return () => {
      cancelled = true;
      script.onload = null;
    };
  }, [handleGoogleResponse]);

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-bg-orb auth-bg-orb-1" />
        <div className="auth-bg-orb auth-bg-orb-2" />
        <div className="auth-bg-orb auth-bg-orb-3" />
      </div>
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">S</div>
          <div>
            <div className="auth-logo-text">SPLSEO</div>
            <div className="auth-logo-sub">AI Content & SEO Automation</div>
          </div>
        </div>

        <h1 className="auth-title">Đăng nhập</h1>
        <p className="auth-subtitle">Chào mừng bạn quay lại</p>

        {error && (
          <div className="auth-error">
            <span>⚠️</span> {error}
          </div>
        )}

        {/* Google Sign-In Button */}
        {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
          <>
            <div
              ref={googleBtnRef}
              className="auth-google-btn-wrap"
              style={{ marginBottom: 16 }}
            />
            {googleLoading && (
              <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>
                <span className="loader" style={{ width: 14, height: 14, display: "inline-block", verticalAlign: "middle", marginRight: 6 }} />
                Đang đăng nhập với Google...
              </div>
            )}
            <div className="auth-divider">
              <span>hoặc đăng nhập bằng email</span>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="text"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={!import.meta.env.VITE_GOOGLE_CLIENT_ID}
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label>Mật khẩu</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="auth-toggle-pw"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
            {loading ? (
              <><span className="loader" style={{ width: 16, height: 16 }} /> Đang đăng nhập...</>
            ) : (
              "Đăng nhập"
            )}
          </button>
        </form>

        <div className="auth-footer">
          Chưa có tài khoản?{" "}
          <Link to="/register" className="auth-link">Đăng ký miễn phí</Link>
        </div>
      </div>
    </div>
  );
}
