import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { api } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [license, setLicense] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const requestToken = localStorage.getItem("splseo-token");
    const isAuthPage =
      window.location.pathname.startsWith("/login") ||
      window.location.pathname.startsWith("/register");

    if (!requestToken && isAuthPage) {
      setUser(null);
      setLicense(null);
      setUsage(null);
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }

    try {
      // Always try getMe() — in DEV_SKIP_AUTH mode, server returns mock user even without token
      const result = await api.getMe();
      if (localStorage.getItem("splseo-token") !== requestToken) {
        return;
      }
      setUser(result.user);
      setLicense(result.license);
      setUsage(result.usage);
      setIsAuthenticated(true);
    } catch (error) {
      if (localStorage.getItem("splseo-token") !== requestToken) {
        return;
      }
      // Token invalid, expired, or no auth
      localStorage.removeItem("splseo-token");
      setUser(null);
      setLicense(null);
      setUsage(null);
      setIsAuthenticated(false);
    } finally {
      if (localStorage.getItem("splseo-token") === requestToken) {
        setLoading(false);
      }
    }
  };

  const login = useCallback(async (email, password) => {
    const result = await api.login(email, password);
    localStorage.setItem("splseo-token", result.token);
    setUser(result.user);
    setLicense(result.license);
    setUsage(result.usage);
    setIsAuthenticated(true);
    setLoading(false);
    return result;
  }, []);

  const register = useCallback(async (email, password, name, referredBy) => {
    const result = await api.register(email, password, name, referredBy);
    localStorage.setItem("splseo-token", result.token);
    setUser(result.user);
    setLicense(result.license);
    setUsage(result.usage);
    setIsAuthenticated(true);
    setLoading(false);
    return result;
  }, []);

  const googleLogin = useCallback(async (idToken, referralCode) => {
    const result = await api.googleLogin(idToken, referralCode);
    localStorage.setItem("splseo-token", result.token);
    setUser(result.user);
    setLicense(result.license);
    setUsage(result.usage);
    setIsAuthenticated(true);
    setLoading(false);
    return result;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (e) {}
    localStorage.removeItem("splseo-token");
    setUser(null);
    setLicense(null);
    setUsage(null);
    setIsAuthenticated(false);
  }, []);

  const refreshLicense = useCallback(async () => {
    try {
      // Use getMeFresh to bypass server-side 1h license cache
      const result = await api.getMeFresh();
      setLicense(result.license);
      setUsage(result.usage);
    } catch (e) {
      console.error("Failed to refresh license:", e);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        license,
        usage,
        loading,
        isAuthenticated,
        login,
        register,
        googleLogin,
        logout,
        refreshLicense,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export default AuthContext;
