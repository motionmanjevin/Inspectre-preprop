import { useState, useEffect } from "react";
import { Save, Play, Square, Trash2, CheckCircle, AlertCircle, Loader2, Settings2, Server } from "lucide-react";
import { recordingApi, healthApi, deviceConfigApi, type DeviceConfig } from "../services/api";

type SettingsTab = "recording" | "device";
type CameraMode = "single" | "multi";
type CameraSlot = { slot: number; name: string; rtsp_url: string; enabled: boolean };

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("recording");

  // Recording settings
  const [rtspLink, setRtspLink] = useState("");
  const [cameraName, setCameraName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [chunkDuration, setChunkDuration] = useState(10);
  const [motionDetectionEnabled, setMotionDetectionEnabled] = useState(false);
  const [motionThreshold, setMotionThreshold] = useState(0.3);
  const [rawMode, setRawMode] = useState(false);
  const [reliableInternet, setReliableInternet] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  // Device config state
  const [dcRtspUrl, setDcRtspUrl] = useState("");
  const [dcCameraName, setDcCameraName] = useState("");
  const [dcCameraMode, setDcCameraMode] = useState<CameraMode>("single");
  const [dcMultiCameras, setDcMultiCameras] = useState<CameraSlot[]>([
    { slot: 1, name: "Cam 1", rtsp_url: "", enabled: false },
    { slot: 2, name: "Cam 2", rtsp_url: "", enabled: false },
    { slot: 3, name: "Cam 3", rtsp_url: "", enabled: false },
    { slot: 4, name: "Cam 4", rtsp_url: "", enabled: false },
  ]);
  const [dcVideoPreprompt, setDcVideoPreprompt] = useState("");
  const [dcR2AccountId, setDcR2AccountId] = useState("");
  const [dcR2AccessKeyId, setDcR2AccessKeyId] = useState("");
  const [dcR2SecretAccessKey, setDcR2SecretAccessKey] = useState("");
  const [dcR2BucketName, setDcR2BucketName] = useState("");
  const [dcR2PublicUrlBase, setDcR2PublicUrlBase] = useState("");
  const [dcSmtpHost, setDcSmtpHost] = useState("");
  const [dcSmtpPort, setDcSmtpPort] = useState(587);
  const [dcSmtpUsername, setDcSmtpUsername] = useState("");
  const [dcSmtpPassword, setDcSmtpPassword] = useState("");
  const [dcSmtpFromAddress, setDcSmtpFromAddress] = useState("");
  const [dcSmtpUseTls, setDcSmtpUseTls] = useState(true);
  const [dcReliableInternet, setDcReliableInternet] = useState(true);
  const [dcLocalStorageMaxGb, setDcLocalStorageMaxGb] = useState(50);
  const [dcR2MaxGb, setDcR2MaxGb] = useState(10);
  const [dcLoading, setDcLoading] = useState(false);

  const [dcSection, setDcSection] = useState<"camera" | "r2" | "smtp" | "storage">("camera");

  useEffect(() => {
    const savedSettings = localStorage.getItem('inspectre_settings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        setRtspLink(settings.rtspLink || "");
        setCameraName(settings.cameraName || "");
        setSystemPrompt(settings.systemPrompt || "");
        setChunkDuration(settings.chunkDuration || 10);
        setMotionDetectionEnabled(settings.motionDetectionEnabled || false);
        setMotionThreshold(settings.motionThreshold || 0.3);
        setRawMode(settings.rawMode || false);
        setReliableInternet(settings.reliableInternet !== false);
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }
  }, []);

  useEffect(() => { checkBackendStatus(); checkRecordingStatus(); }, []);

  useEffect(() => { loadDeviceConfig(); }, []);

  const loadDeviceConfig = async () => {
    try {
      const cfg = await deviceConfigApi.get();
      setDcRtspUrl(cfg.rtsp_url);
      setDcCameraName(cfg.camera_name);
      setDcCameraMode((cfg.camera_mode || "single") as CameraMode);
      setDcMultiCameras((cfg.multi_cameras_json && cfg.multi_cameras_json.length > 0 ? cfg.multi_cameras_json : [
        { slot: 1, name: "Cam 1", rtsp_url: "", enabled: false },
        { slot: 2, name: "Cam 2", rtsp_url: "", enabled: false },
        { slot: 3, name: "Cam 3", rtsp_url: "", enabled: false },
        { slot: 4, name: "Cam 4", rtsp_url: "", enabled: false },
      ]) as CameraSlot[]);
      setDcVideoPreprompt(cfg.video_preprompt);
      setDcR2AccountId(cfg.r2_account_id);
      setDcR2AccessKeyId(cfg.r2_access_key_id);
      setDcR2SecretAccessKey(cfg.r2_secret_access_key);
      setDcR2BucketName(cfg.r2_bucket_name);
      setDcR2PublicUrlBase(cfg.r2_public_url_base);
      setDcSmtpHost(cfg.smtp_host);
      setDcSmtpPort(cfg.smtp_port);
      setDcSmtpUsername(cfg.smtp_username);
      setDcSmtpPassword(cfg.smtp_password);
      setDcSmtpFromAddress(cfg.smtp_from_address);
      setDcSmtpUseTls(cfg.smtp_use_tls);
      setDcReliableInternet(cfg.reliable_internet);
      setDcLocalStorageMaxGb(cfg.local_storage_max_gb);
      setDcR2MaxGb(cfg.r2_max_gb);
    } catch {
      // not configured yet
    }
  };

  const checkBackendStatus = async () => {
    try { await healthApi.check(); setBackendStatus('online'); } catch { setBackendStatus('offline'); }
  };

  const checkRecordingStatus = async () => {
    try {
      const status = await recordingApi.getStatus();
      setIsDetecting(status.recording);
      if (status.rtsp_url && !rtspLink) setRtspLink(status.rtsp_url);
    } catch { /* ignore */ }
  };

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const handleSave = () => {
    const settings = { rtspLink, cameraName, systemPrompt, chunkDuration, motionDetectionEnabled, motionThreshold, rawMode, reliableInternet };
    localStorage.setItem('inspectre_settings', JSON.stringify(settings));
    showStatus('success', 'Settings saved successfully');
  };

  const toggleDetection = async () => {
    if (!rtspLink.trim() && !isDetecting) { showStatus('error', 'Please enter an RTSP link first'); return; }
    setIsLoading(true);
    try {
      if (isDetecting) {
        await recordingApi.stop();
        setIsDetecting(false);
        showStatus('success', 'Recording stopped');
      } else {
        await recordingApi.start(rtspLink, chunkDuration, motionDetectionEnabled, motionThreshold, rawMode, rawMode ? reliableInternet : undefined);
        setIsDetecting(true);
        const motionText = motionDetectionEnabled ? ` (motion: ${(motionThreshold * 100).toFixed(0)}%)` : '';
        const rawText = rawMode ? ' raw 1‑hour footage' : '';
        showStatus('success', `Recording started${rawText || ` (${chunkDuration} min chunks${motionText})`}`);
      }
    } catch (error) {
      showStatus('error', `Failed to ${isDetecting ? 'stop' : 'start'} recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally { setIsLoading(false); }
  };

  const handleClearDatabase = () => setShowClearDialog(true);
  const confirmClearDatabase = async () => {
    setIsLoading(true);
    try {
      await recordingApi.clearDatabase();
      showStatus('success', 'Database and all recorded clips cleared successfully');
      setShowClearDialog(false);
    } catch (error) {
      showStatus('error', `Failed to clear database: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setShowClearDialog(false);
    } finally { setIsLoading(false); }
  };

  const handleSaveDeviceConfig = async () => {
    setDcLoading(true);
    try {
      const normalizedMulti = dcMultiCameras.map((c, i) => ({
        slot: i + 1,
        name: (c.name || `Cam ${i + 1}`).trim() || `Cam ${i + 1}`,
        rtsp_url: (c.rtsp_url || "").trim(),
        enabled: Boolean((c.rtsp_url || "").trim()) && Boolean(c.enabled),
      }));
      const primaryMulti = normalizedMulti.find((c) => c.enabled && c.rtsp_url);
      await deviceConfigApi.update({
        rtsp_url: dcCameraMode === "single" ? dcRtspUrl : (primaryMulti?.rtsp_url || ""),
        camera_name: dcCameraMode === "single" ? dcCameraName : (primaryMulti?.name || "Multi Camera Grid"),
        camera_mode: dcCameraMode,
        multi_cameras_json: normalizedMulti,
        video_preprompt: dcVideoPreprompt,
        r2_account_id: dcR2AccountId,
        r2_access_key_id: dcR2AccessKeyId,
        r2_secret_access_key: dcR2SecretAccessKey,
        r2_bucket_name: dcR2BucketName,
        r2_public_url_base: dcR2PublicUrlBase,
        smtp_host: dcSmtpHost,
        smtp_port: dcSmtpPort,
        smtp_username: dcSmtpUsername,
        smtp_password: dcSmtpPassword,
        smtp_from_address: dcSmtpFromAddress,
        smtp_use_tls: dcSmtpUseTls,
        reliable_internet: dcReliableInternet,
        local_storage_max_gb: dcLocalStorageMaxGb,
        r2_max_gb: dcR2MaxGb,
      });
      showStatus('success', 'Device configuration saved');
    } catch (error) {
      showStatus('error', `Failed to save device config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally { setDcLoading(false); }
  };

  const inputClass = "w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#2a2a2a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm";

  const toggleBtn = (checked: boolean, onChange: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: 44,
        height: 24,
        borderRadius: 9999,
        border: "2px solid",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background-color 0.2s, border-color 0.2s",
        backgroundColor: checked ? "#22c55e" : "#4b5563",
        borderColor: checked ? "#16a34a" : "#9ca3af",
        outline: "none",
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "block",
          width: 18,
          height: 18,
          borderRadius: 9999,
          backgroundColor: "#ffffff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          transition: "transform 0.2s",
          transform: checked ? "translateX(22px)" : "translateX(2px)",
        }}
      />
    </button>
  );

  return (
    <>
      <div className="max-w-4xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl text-white mb-2">Settings</h1>
              <p className="text-gray-500">Configure your Inspectre system</p>
            </div>
            <div className="flex items-center gap-2">
              {backendStatus === 'checking' && <div className="flex items-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Checking...</span></div>}
              {backendStatus === 'online' && <div className="flex items-center gap-2 text-green-400"><div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" /><span className="text-sm">Backend Online</span></div>}
              {backendStatus === 'offline' && <div className="flex items-center gap-2 text-red-400"><div className="w-2 h-2 bg-red-400 rounded-full" /><span className="text-sm">Backend Offline</span></div>}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 mb-6 border-b border-[#1a1a1a] pb-3">
          <button
            onClick={() => setActiveTab("recording")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
              activeTab === "recording" ? "bg-white" : "text-gray-400 hover:text-white"
            }`}
            style={{ color: activeTab === "recording" ? "#000000" : undefined }}
          >
            <Settings2 size={16} /> Recording
          </button>
          <button
            onClick={() => setActiveTab("device")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
              activeTab === "device" ? "bg-white" : "text-gray-400 hover:text-white"
            }`}
            style={{ color: activeTab === "device" ? "#000000" : undefined }}
          >
            <Server size={16} /> Device &amp; Cloud
          </button>
        </div>

        {statusMessage && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${statusMessage.type === 'success' ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
            {statusMessage.type === 'success' ? <CheckCircle className="w-5 h-5 text-green-400" /> : <AlertCircle className="w-5 h-5 text-red-400" />}
            <span className={statusMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}>{statusMessage.text}</span>
          </div>
        )}

        {/* === RECORDING TAB === */}
        {activeTab === "recording" && (
          <div className="space-y-6">
            {isDetecting && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
                  <div>
                    <p className="text-green-400 font-medium">Recording Active</p>
                    <p className="text-green-400/70 text-sm">Currently recording from: {rtspLink}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-white text-sm font-medium">RTSP Camera Link</label>
              <p className="text-gray-500 text-sm mb-3">Enter the RTSP stream URL for your camera feed</p>
              <input type="text" value={rtspLink} onChange={(e) => setRtspLink(e.target.value)} placeholder="rtsp://username:password@camera-ip:554/stream" disabled={isDetecting} className={inputClass} />
            </div>

            <div className="space-y-2">
              <label className="block text-white text-sm font-medium">Chunk Duration</label>
              <p className="text-gray-500 text-sm mb-3">Duration of each video chunk for processing (in minutes)</p>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <input type="range" min="1" max="60" value={chunkDuration} onChange={(e) => setChunkDuration(parseInt(e.target.value))} disabled={isDetecting} className="flex-1 h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer accent-white disabled:opacity-50 disabled:cursor-not-allowed" />
                  <div className="flex items-center gap-2">
                    <input type="number" min="1" max="60" value={chunkDuration} onChange={(e) => { const v = parseInt(e.target.value); if (v >= 1 && v <= 60) setChunkDuration(v); }} disabled={isDetecting} className="w-16 bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg px-2 py-2 text-white text-center focus:outline-none focus:border-[#2a2a2a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed" />
                    <span className="text-gray-400 text-sm">min</span>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-gray-600"><span>1 min</span><span>30 min</span><span>60 min</span></div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-white text-sm font-medium mb-1">Raw recording</label>
                  <p className="text-gray-500 text-sm">Record 1‑hour chunks only (no AI processing). Use the Footage page to play and query.</p>
                </div>
                {toggleBtn(rawMode, () => setRawMode(!rawMode), isDetecting)}
              </div>
            </div>

            {rawMode && (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <label className="block text-white text-sm font-medium mb-1">Reliable internet</label>
                    <p className="text-gray-500 text-sm">When on: footage is uploaded to the bucket after each chunk. When off: saved locally, uploaded on demand.</p>
                  </div>
                  {toggleBtn(reliableInternet, () => setReliableInternet(!reliableInternet), isDetecting)}
                </div>
              </div>
            )}

            {!rawMode && (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <label className="block text-white text-sm font-medium mb-1">Capture Only on Motion</label>
                    <p className="text-gray-500 text-sm">Only record video chunks when motion is detected (uses frame differencing)</p>
                  </div>
                  {toggleBtn(motionDetectionEnabled, () => setMotionDetectionEnabled(!motionDetectionEnabled), isDetecting)}
                </div>
                {motionDetectionEnabled && (
                  <div className="mt-4 space-y-3 pl-2 border-l-2 border-[#00ff88]/30">
                    <div className="flex items-center justify-between">
                      <label className="block text-white text-sm font-medium">Motion Detection Threshold</label>
                      <span className="text-[#00ff88] text-sm font-medium">{(motionThreshold * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-gray-500 text-sm mb-3">Higher values require more motion (less sensitive)</p>
                    <div className="flex items-center gap-4">
                      <input type="range" min="0" max="1" step="0.01" value={motionThreshold} onChange={(e) => setMotionThreshold(parseFloat(e.target.value))} disabled={isDetecting} className="flex-1 h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer accent-[#00ff88] disabled:opacity-50 disabled:cursor-not-allowed" />
                      <input type="number" min="0" max="1" step="0.01" value={motionThreshold} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0 && v <= 1) setMotionThreshold(v); }} disabled={isDetecting} className="w-20 bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg px-2 py-2 text-white text-center focus:outline-none focus:border-[#2a2a2a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed" />
                    </div>
                    <div className="flex justify-between text-xs text-gray-600"><span>More Sensitive</span><span>Less Sensitive</span></div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-white text-sm font-medium">Camera Name</label>
              <p className="text-gray-500 text-sm mb-3">Give your camera a name for easy identification</p>
              <input type="text" value={cameraName} onChange={(e) => setCameraName(e.target.value)} placeholder="Living Room Camera" className={inputClass} />
            </div>

            <div className="space-y-2">
              <label className="block text-white text-sm font-medium">Analysis Prompt</label>
              <p className="text-gray-500 text-sm mb-3">Define how the AI should analyze video footage</p>
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Analyze this video in detail..." rows={8} className={inputClass + " resize-none"} />
            </div>

            <div className="pt-4 flex flex-col md:flex-row gap-3">
              <button onClick={handleSave} className="flex-1 md:flex-initial md:w-auto flex items-center justify-center gap-2 bg-white hover:bg-gray-200 text-[#0a0a0a] px-6 py-3 rounded-lg transition-colors">
                <Save className="w-5 h-5" /> Save Settings
              </button>
              <button onClick={toggleDetection} disabled={isLoading || backendStatus === 'offline'} className={`flex-1 md:flex-initial md:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDetecting ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}>
                {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" />{isDetecting ? 'Stopping...' : 'Starting...'}</> : isDetecting ? <><Square className="w-5 h-5" />Stop Recording</> : <><Play className="w-5 h-5" />Start Recording</>}
              </button>
              <button onClick={handleClearDatabase} disabled={backendStatus === 'offline' || isDetecting || isLoading} className="flex-1 md:flex-initial md:w-auto flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <Trash2 className="w-5 h-5" /> Clear Database
              </button>
            </div>

            {backendStatus === 'offline' && (
              <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-yellow-400 text-sm"><strong>Backend not connected.</strong> Make sure the backend server is running at <code className="bg-yellow-500/20 px-1 rounded">http://localhost:8000</code></p>
                <p className="text-yellow-400/70 text-sm mt-2">Run <code className="bg-yellow-500/20 px-1 rounded">python run.py</code> in the Inspectre directory.</p>
              </div>
            )}
          </div>
        )}

        {/* === DEVICE & CLOUD TAB === */}
        {activeTab === "device" && (
          <div className="space-y-6">
            <div className="flex gap-2 flex-wrap">
              {(["camera", "r2", "smtp", "storage"] as const).map((id) => (
                <button
                  key={id}
                  onClick={() => setDcSection(id)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    dcSection === id ? "bg-white" : "bg-[#1a1a1a] text-gray-400 hover:text-white"
                  }`}
                  style={{ color: dcSection === id ? "#000000" : undefined }}
                >
                  {{ camera: "Camera", r2: "Cloud Storage (R2)", smtp: "Email (SMTP)", storage: "Retention" }[id]}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {dcSection === "camera" && (<>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Camera Mode</label>
                  <div className="inline-flex bg-[#151515] rounded-xl p-1 border border-[#222]">
                    <button
                      type="button"
                      onClick={() => setDcCameraMode("single")}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${dcCameraMode === "single" ? "bg-white text-black" : "text-gray-400 hover:text-white"}`}
                    >
                      Single Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => setDcCameraMode("multi")}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${dcCameraMode === "multi" ? "bg-white text-black" : "text-gray-400 hover:text-white"}`}
                    >
                      Multiple Cameras
                    </button>
                  </div>
                </div>
                {dcCameraMode === "single" ? (
                  <>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">RTSP Stream URL</label>
                  <input value={dcRtspUrl} onChange={(e) => setDcRtspUrl(e.target.value)} className={inputClass} placeholder="rtsp://192.168.1.100:554/stream" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Camera Name</label>
                  <input value={dcCameraName} onChange={(e) => setDcCameraName(e.target.value)} className={inputClass} placeholder="Front door camera" />
                </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    {dcMultiCameras.map((cam, idx) => (
                      <div key={cam.slot} className="border border-[#222] rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-400">Grid Slot {cam.slot}</p>
                          <button
                            type="button"
                            onClick={() => setDcMultiCameras((prev) => prev.map((c, i) => i === idx ? { ...c, enabled: !c.enabled } : c))}
                            className={`px-2 py-1 rounded-md text-xs ${cam.enabled ? "bg-[#14532d] text-green-200" : "bg-[#1f2937] text-gray-300"}`}
                          >
                            {cam.enabled ? "Enabled" : "Disabled"}
                          </button>
                        </div>
                        <input
                          value={cam.name}
                          onChange={(e) => setDcMultiCameras((prev) => prev.map((c, i) => i === idx ? { ...c, name: e.target.value } : c))}
                          className={inputClass}
                          placeholder={`Cam ${cam.slot}`}
                        />
                        <input
                          value={cam.rtsp_url}
                          onChange={(e) => setDcMultiCameras((prev) => prev.map((c, i) => i === idx ? { ...c, rtsp_url: e.target.value, enabled: Boolean(e.target.value.trim()) || c.enabled } : c))}
                          className={inputClass}
                          placeholder="rtsp://camera-ip:554/stream"
                        />
                      </div>
                    ))}
                    <p className="text-xs text-gray-500">Leave empty slots blank. They render as No Signal in the merged grid.</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Video Analysis Prompt</label>
                  <textarea value={dcVideoPreprompt} onChange={(e) => setDcVideoPreprompt(e.target.value)} className={inputClass + " min-h-[80px] resize-y"} placeholder="Describe what the AI should focus on..." />
                  <p className="text-xs text-gray-600 mt-1">Overrides the default prompt from .env when processing video.</p>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <div><p className="text-sm text-white font-medium">Reliable internet</p><p className="text-xs text-gray-500">Auto-upload footage chunks for raw recording</p></div>
                  {toggleBtn(dcReliableInternet, () => setDcReliableInternet(!dcReliableInternet))}
                </div>
              </>)}

              {dcSection === "r2" && (<>
                <p className="text-xs text-gray-500 mb-2">Cloudflare R2 credentials for video storage.</p>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">Account ID</label><input value={dcR2AccountId} onChange={(e) => setDcR2AccountId(e.target.value)} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">Access Key ID</label><input value={dcR2AccessKeyId} onChange={(e) => setDcR2AccessKeyId(e.target.value)} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">Secret Access Key</label><input type="password" value={dcR2SecretAccessKey} onChange={(e) => setDcR2SecretAccessKey(e.target.value)} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">Bucket Name</label><input value={dcR2BucketName} onChange={(e) => setDcR2BucketName(e.target.value)} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">Public URL Base</label><input value={dcR2PublicUrlBase} onChange={(e) => setDcR2PublicUrlBase(e.target.value)} className={inputClass} placeholder="https://pub-xxx.r2.dev" /></div>
              </>)}

              {dcSection === "smtp" && (<>
                <p className="text-xs text-gray-500 mb-2">SMTP settings for email notifications (tunnel link, alerts). Optional.</p>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">SMTP Host</label><input value={dcSmtpHost} onChange={(e) => setDcSmtpHost(e.target.value)} className={inputClass} placeholder="smtp.gmail.com" /></div>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">Port</label><input type="number" value={dcSmtpPort} onChange={(e) => setDcSmtpPort(Number(e.target.value))} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">Username</label><input value={dcSmtpUsername} onChange={(e) => setDcSmtpUsername(e.target.value)} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">Password / App Password</label><input type="password" value={dcSmtpPassword} onChange={(e) => setDcSmtpPassword(e.target.value)} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-400 mb-1">From Address</label><input type="email" value={dcSmtpFromAddress} onChange={(e) => setDcSmtpFromAddress(e.target.value)} className={inputClass} placeholder="inspectre@example.com" /></div>
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-white font-medium">Use TLS</p>
                  {toggleBtn(dcSmtpUseTls, () => setDcSmtpUseTls(!dcSmtpUseTls))}
                </div>
              </>)}

              {dcSection === "storage" && (<>
                <p className="text-xs text-gray-500 mb-2">Storage limits for automatic retention cleanup. Oldest footage is deleted first.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Local storage limit (GB)</label>
                  <input type="number" value={dcLocalStorageMaxGb} onChange={(e) => setDcLocalStorageMaxGb(Number(e.target.value))} className={inputClass} min={1} />
                  <p className="text-xs text-gray-600 mt-1">Maximum disk space for local footage files.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">R2 bucket limit (GB)</label>
                  <input type="number" value={dcR2MaxGb} onChange={(e) => setDcR2MaxGb(Number(e.target.value))} className={inputClass} min={1} />
                  <p className="text-xs text-gray-600 mt-1">Cloudflare R2 free tier is 10 GB.</p>
                </div>
              </>)}
            </div>

            <div className="pt-4">
              <button onClick={handleSaveDeviceConfig} disabled={dcLoading} className="flex items-center justify-center gap-2 bg-white hover:bg-gray-200 text-[#0a0a0a] px-6 py-3 rounded-lg transition-colors disabled:opacity-50">
                {dcLoading ? <><Loader2 className="w-5 h-5 animate-spin" />Saving...</> : <><Save className="w-5 h-5" />Save Device Config</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {showClearDialog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg shadow-[0_0_40px_rgba(255,255,255,0.1)] max-w-md w-full p-6">
            <h2 className="text-xl text-white mb-3">Clear Database</h2>
            <p className="text-gray-400 text-sm mb-6">
              Are you sure? This will delete all ChromaDB entries and recorded video clips.
              <br />
              <br />
              <strong className="text-red-400">This cannot be undone.</strong>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearDialog(false)}
                disabled={isLoading}
                className="flex-1 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white px-4 py-2.5 rounded-lg transition-colors border border-[#2a2a2a] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmClearDatabase}
                disabled={isLoading}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  "Clear Database"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
