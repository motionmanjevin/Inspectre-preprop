import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff, RefreshCw, Loader2 } from "lucide-react";
import { systemApi, type SystemStatus } from "../services/api";

interface StartupPopupProps {
  onResolved: () => void;
}

export function StartupPopup({ onResolved }: StartupPopupProps) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const s = await systemApi.getStatus();
      setStatus(s);
      setCountdown(s.decision_remaining_seconds);
      if (s.mode !== "pending_decision") {
        onResolved();
      }
    } catch {
      // backend might not be ready yet
    }
  };

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleRetry = async () => {
    setLoading(true);
    try {
      const res = await systemApi.postDecision("retry");
      if (res.mode !== "pending_decision") onResolved();
      else await fetchStatus();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleOffline = async () => {
    setLoading(true);
    try {
      await systemApi.postDecision("offline");
      onResolved();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (!status || status.mode !== "pending_decision") return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-8 max-w-md w-full shadow-[0_0_60px_rgba(255,50,50,0.1)]">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
            <WifiOff size={32} className="text-red-400" />
          </div>
        </div>

        <h2 className="text-xl font-semibold text-white text-center mb-2">No Internet Connection</h2>
        <p className="text-sm text-gray-400 text-center mb-6">
          The device cannot reach the internet. Online services (R2 storage, AI analysis, Cloudflare tunnel) are unavailable.
        </p>

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-[#1a1a1a] rounded-full px-4 py-2 text-sm">
            <Loader2 size={14} className="animate-spin text-gray-500" />
            <span className="text-gray-400">Auto-deciding in</span>
            <span className="text-white font-mono font-medium">{countdown}s</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleRetry}
            disabled={loading}
            className="flex-1 bg-white hover:bg-gray-200 text-black rounded-xl py-3 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Retry
          </button>
          <button
            onClick={handleOffline}
            disabled={loading}
            className="flex-1 bg-[#1a1a1a] hover:bg-[#222] text-white rounded-xl py-3 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <WifiOff size={16} />
            Offline mode
          </button>
        </div>

        <p className="text-xs text-gray-600 text-center mt-4">
          Offline mode starts raw recording locally. The system will keep trying to reconnect every 2 minutes.
        </p>
      </div>
    </div>
  );
}
