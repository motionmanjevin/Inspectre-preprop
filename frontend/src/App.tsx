import { Sidebar } from "./components/Sidebar";
import { SettingsPage } from "./components/SettingsPage";
import { LoginPage } from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";
import { StartupPopup } from "./components/StartupPopup";
import { RtspErrorPopup } from "./components/RtspErrorPopup";
import { useState, useRef, useEffect } from "react";
import { authApi, getAuthToken, systemApi, type SystemStatus } from "./services/api";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<"settings">("settings");
  const [showStartupPopup, setShowStartupPopup] = useState(false);
  const [rtspErrorStatus, setRtspErrorStatus] = useState<SystemStatus | null>(null);
  const chatPageRef = useRef<{ clearMessages: () => void; getMessages: () => any[]; restoreMessages: (messages: any[]) => void } | null>(null);

  // Check authentication on mount and check system status
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      authApi.getCurrentUser()
        .then(() => {
          setIsAuthenticated(true);
          systemApi.getStatus()
            .then((s) => {
              if (s.mode === "pending_decision") setShowStartupPopup(true);
              if (s.rtsp_error) setRtspErrorStatus(s);
            })
            .catch(() => {});
        })
        .catch(() => {
          authApi.logout();
          setIsAuthenticated(false);
        });
    } else {
      systemApi.getStatus()
        .then((s) => {
          if (s.mode === "pending_decision") setShowStartupPopup(true);
        })
        .catch(() => {});
    }
  }, []);

  // Poll for RTSP errors while authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(async () => {
      try {
        const s = await systemApi.getStatus();
        if (s.rtsp_error && !rtspErrorStatus) setRtspErrorStatus(s);
        else if (!s.rtsp_error && rtspErrorStatus) setRtspErrorStatus(null);
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, rtspErrorStatus]);

  // Chat/archives functionality is intentionally disabled on web for now; mobile is the main interaction surface.

  const handleLogin = () => {
    setIsAuthenticated(true);
    setShowRegister(false);
  };

  const handleLogout = () => {
    authApi.logout();
    setIsAuthenticated(false);
  };

  // Show login/register if not authenticated
  if (!isAuthenticated) {
    if (showRegister) {
      return (
        <>
          {showStartupPopup && <StartupPopup onResolved={() => setShowStartupPopup(false)} />}
          <RegisterPage onRegister={handleLogin} onSwitchToLogin={() => setShowRegister(false)} />
        </>
      );
    }
    return (
      <>
        {showStartupPopup && <StartupPopup onResolved={() => setShowStartupPopup(false)} />}
        <LoginPage onLogin={handleLogin} onSwitchToRegister={() => setShowRegister(true)} />
      </>
    );
  }

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden">
      {showStartupPopup && <StartupPopup onResolved={() => setShowStartupPopup(false)} />}
      {rtspErrorStatus && <RtspErrorPopup status={rtspErrorStatus} onResolved={() => setRtspErrorStatus(null)} />}
      {/* Sidebar */}
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)}
        onNavigate={(page) => {
          setCurrentPage(page);
          setSidebarOpen(false);
        }}
        onRefreshChat={() => {}}
        onLogout={handleLogout}
      />
      
      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-8">
          {currentPage === "settings" && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}