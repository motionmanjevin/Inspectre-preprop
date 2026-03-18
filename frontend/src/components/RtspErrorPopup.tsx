import { useState, useEffect, useRef } from "react";
import { VideoOff, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { systemApi, type SystemStatus } from "../services/api";

interface RtspErrorPopupProps {
  status: SystemStatus;
  onResolved: () => void;
}

export function RtspErrorPopup({ status, onResolved }: RtspErrorPopupProps) {
  const [loading, setLoading] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const s = await systemApi.getStatus();
        if (!s.rtsp_error) onResolved();
      } catch {}
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await systemApi.rtspRetry();
      if (res.success) onResolved();
      else setError(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setLoading(false);
    }
  };

  const handleChangeUrl = async () => {
    const url = newUrl.trim();
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const res = await systemApi.rtspRetry(url);
      if (res.success) onResolved();
      else setError(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-8 max-w-md w-full shadow-[0_0_60px_rgba(255,100,50,0.1)]">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center">
            <VideoOff size={32} className="text-orange-400" />
          </div>
        </div>

        <h2 className="text-xl font-semibold text-white text-center mb-2">Camera Connection Lost</h2>
        <p className="text-sm text-gray-400 text-center mb-4">
          {status.rtsp_error_message || "The RTSP stream disconnected and could not be restored after 10 attempts."}
        </p>

        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-6">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-400">
              Check that the camera is powered on and connected to the same network as this device. Verify router/switch connections.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/20 bg-red-500/10">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {!showUrlInput ? (
          <div className="flex flex-col gap-3">
            <button onClick={handleRetry} disabled={loading}
              className="w-full bg-white hover:bg-gray-200 text-black rounded-xl py-3 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Retry connection
            </button>
            <button onClick={() => setShowUrlInput(true)} disabled={loading}
              className="w-full bg-[#1a1a1a] hover:bg-[#222] text-white rounded-xl py-3 font-medium transition-colors disabled:opacity-50">
              Change RTSP link
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">New RTSP URL</label>
              <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#2a2a2a] transition-colors"
                placeholder="rtsp://192.168.1.100:554/stream" autoFocus />
              <p className="text-xs text-gray-600 mt-1">If this link works, it will replace the stored one.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowUrlInput(false); setError(null); }}
                className="flex-1 bg-[#1a1a1a] hover:bg-[#222] text-white rounded-xl py-3 font-medium transition-colors">
                Back
              </button>
              <button onClick={handleChangeUrl} disabled={loading || !newUrl.trim()}
                className="flex-1 bg-white hover:bg-gray-200 text-black rounded-xl py-3 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <Loader2 size={16} className="animate-spin" /> : "Connect"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
