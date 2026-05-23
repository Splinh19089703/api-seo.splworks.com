import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { TaskQueueProvider } from "./context/TaskQueueContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import FeatureGate from "./components/FeatureGate";

// Eagerly loaded (fast first paint)
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";

// C1: Lazy loaded routes (heavy pages, split bundle)
const Projects = lazy(() => import("./pages/Projects"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const AuditList = lazy(() => import("./pages/AuditList"));
const AuditDetail = lazy(() => import("./pages/AuditDetail"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const Publishing = lazy(() => import("./pages/Publishing"));
const Settings = lazy(() => import("./pages/Settings"));
const Account = lazy(() => import("./pages/Account"));
const TopicalMap = lazy(() => import("./pages/TopicalMap"));
const Indexer = lazy(() => import("./pages/Indexer"));
const Queue = lazy(() => import("./pages/Queue"));
const WooProducts = lazy(() => import("./pages/WooProducts"));
const KeywordPlanner = lazy(() => import("./pages/KeywordPlanner"));
const GSC = lazy(() => import("./pages/GSC"));
const Affiliate = lazy(() => import("./pages/Affiliate"));

import { api } from "./api";
import "./index.css";

// Suspense fallback — minimal loading indicator
const PageLoader = () => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "40vh" }}>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, opacity: 0.6 }}>
      <span className="loader" />
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Đang tải...</span>
    </div>
  </div>
);

function AppContent() {
  const { isAuthenticated, loading } = useAuth();

  // Load saved theme on app init
  useEffect(() => {
    const applyTheme = (theme) => {
      if (theme === "auto") {
        const prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;
        document.documentElement.setAttribute(
          "data-theme",
          prefersDark ? "dark" : "light",
        );
      } else {
        document.documentElement.setAttribute("data-theme", theme || "dark");
      }
    };

    // Instant apply from localStorage (no flash)
    const cached = localStorage.getItem("splseo-theme");
    if (cached) applyTheme(cached);

    if (loading || !isAuthenticated) {
      if (!cached) applyTheme("dark");
      return;
    }

    // Validate from API only after auth is ready. Calling protected settings
    // while login is still pending can race with Google login and clear token.
    api
      .getSettings()
      .then((settings) => {
        const theme = settings?.theme || "dark";
        if (theme !== cached) {
          applyTheme(theme);
          localStorage.setItem("splseo-theme", theme);
        }
      })
      .catch(() => {
        if (!cached) applyTheme("dark");
      });
  }, [isAuthenticated, loading]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
        <Route element={<TaskQueueProvider><Layout /></TaskQueueProvider>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Suspense fallback={<PageLoader />}><Projects /></Suspense>} />
            <Route path="/projects/:id" element={<Suspense fallback={<PageLoader />}><ProjectDetail /></Suspense>} />
            <Route path="/audit" element={<Suspense fallback={<PageLoader />}><FeatureGate feature="seoAudit"><AuditList /></FeatureGate></Suspense>} />
            <Route path="/audit/:id" element={<Suspense fallback={<PageLoader />}><FeatureGate feature="seoAudit"><AuditDetail /></FeatureGate></Suspense>} />
            <Route path="/pipeline" element={<Suspense fallback={<PageLoader />}><Pipeline /></Suspense>} />
            <Route path="/publish" element={<Suspense fallback={<PageLoader />}><Publishing /></Suspense>} />
            <Route path="/account" element={<Suspense fallback={<PageLoader />}><Account /></Suspense>} />
            <Route path="/settings/*" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
            <Route path="/topical-map" element={<Suspense fallback={<PageLoader />}><TopicalMap /></Suspense>} />
            <Route path="/indexer" element={<Suspense fallback={<PageLoader />}><Indexer /></Suspense>} />
            <Route path="/queue" element={<Suspense fallback={<PageLoader />}><Queue /></Suspense>} />
            <Route path="/woo" element={<Suspense fallback={<PageLoader />}><WooProducts /></Suspense>} />
            <Route path="/keyword-planner" element={<Suspense fallback={<PageLoader />}><KeywordPlanner /></Suspense>} />
            <Route path="/gsc" element={<Suspense fallback={<PageLoader />}><GSC /></Suspense>} />
            <Route path="/affiliate" element={<Suspense fallback={<PageLoader />}><Affiliate /></Suspense>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
