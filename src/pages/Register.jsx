import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

export default function Register() {
  const { register, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref") || "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError("Vui lòng nhập đầy đủ thông tin"); return; }
    if (password.length < 6) { setError("Mật khẩu phải ít nhất 6 ký tự"); return; }
    if (password !== confirmPassword) { setError("Mật khẩu xác nhận không khớp"); return; }
    setError("");
    setLoading(true);
    try {
      await register(email, password, name, refCode);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Đăng ký thất bại");
    }
    setLoading(false);
  };

  // Google Sign-In
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    const initGoogle = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleResponse,
        auto_select: false,
      });
      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "signup_with",
          width: googleBtnRef.current.offsetWidth || 348,
          locale: "vi",
        });
      }
    };

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", initGoogle);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);
  }, []);

  const handleGoogleResponse = async (response) => {
    if (!response.credential) return;
    setError("");
    setGoogleLoading(true);
    try {
      await googleLogin(response.credential, refCode || undefined);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Đăng ký Google thất bại");
    }
    setGoogleLoading(false);
  };

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

        <h1 className="auth-title">Tạo tài khoản</h1>
        <p className="auth-subtitle">Bắt đầu dùng thử miễn phí 7 ngày</p>

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
                Đang đăng ký với Google...
              </div>
            )}
            <div className="auth-divider">
              <span>hoặc đăng ký bằng email</span>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Tên hiển thị</label>
            <input
              type="text"
              placeholder="Nguyễn Văn A"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus={!import.meta.env.VITE_GOOGLE_CLIENT_ID}
            />
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input
              type="text"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label>Mật khẩu *</label>
            <input
              type="password"
              placeholder="Ít nhất 6 ký tự"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="form-group">
            <label>Xác nhận mật khẩu *</label>
            <input
              type="password"
              placeholder="Nhập lại mật khẩu"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
            {loading ? (
              <><span className="loader" style={{ width: 16, height: 16 }} /> Đang tạo tài khoản...</>
            ) : (
              "Đăng ký & Dùng thử miễn phí"
            )}
          </button>
        </form>

        <div className="auth-trial-info">
          <span>🎁</span> Gói dùng thử: 10 bài viết, 7 ngày, miễn phí
        </div>
        {refCode && (
          <div className="auth-trial-info" style={{ background: "rgba(16,185,129,0.1)", borderColor: "rgba(16,185,129,0.3)", color: "#10b981", marginTop: 8 }}>
            <span>👤</span> Được giới thiệu bởi CTV: <strong>{refCode}</strong>
          </div>
        )}

        <div className="auth-footer">
          Đã có tài khoản?{" "}
          <Link to="/login" className="auth-link">Đăng nhập</Link>
        </div>
      </div>
    </div>
  );
}
