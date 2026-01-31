import { useState, useEffect } from "react";
import { Save, Play, Square, Trash2, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { recordingApi, healthApi } from "../services/api";

export function SettingsPage() {
  const [rtspLink, setRtspLink] = useState("");
  const [cameraName, setCameraName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [chunkDuration, setChunkDuration] = useState(10); // Default 10 minutes
  const [isDetecting, setIsDetecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  // Load saved settings from localStorage
  useEffect(() => {
    const savedSettings = localStorage.getItem('inspectre_settings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        setRtspLink(settings.rtspLink || "");
        setCameraName(settings.cameraName || "");
        setSystemPrompt(settings.systemPrompt || "");
        setChunkDuration(settings.chunkDuration || 10);
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }
  }, []);

  // Check backend status and recording state on mount
  useEffect(() => {
    checkBackendStatus();
    checkRecordingStatus();
  }, []);

  const checkBackendStatus = async () => {
    try {
      await healthApi.check();
      setBackendStatus('online');
    } catch (error) {
      setBackendStatus('offline');
    }
  };

  const checkRecordingStatus = async () => {
    try {
      const status = await recordingApi.getStatus();
      setIsDetecting(status.recording);
      if (status.rtsp_url && !rtspLink) {
        setRtspLink(status.rtsp_url);
      }
    } catch (error) {
      console.error('Failed to check recording status:', error);
    }
  };

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const handleSave = () => {
    // Save settings to localStorage
    const settings = {
      rtspLink,
      cameraName,
      systemPrompt,
      chunkDuration
    };
    localStorage.setItem('inspectre_settings', JSON.stringify(settings));
    showStatus('success', 'Settings saved successfully');
  };

  const toggleDetection = async () => {
    if (!rtspLink.trim() && !isDetecting) {
      showStatus('error', 'Please enter an RTSP link first');
      return;
    }

    setIsLoading(true);
    try {
      if (isDetecting) {
        // Stop recording
        await recordingApi.stop();
        setIsDetecting(false);
        showStatus('success', 'Recording stopped');
      } else {
        // Start recording with chunk duration
        await recordingApi.start(rtspLink, chunkDuration);
        setIsDetecting(true);
        showStatus('success', `Recording started (${chunkDuration} min chunks)`);
      }
    } catch (error) {
      console.error('Toggle detection error:', error);
      showStatus('error', `Failed to ${isDetecting ? 'stop' : 'start'} recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearDatabase = () => {
    setShowClearDialog(true);
  };

  const confirmClearDatabase = async () => {
    setIsLoading(true);
    try {
      await recordingApi.clearDatabase();
      showStatus('success', 'Database and all recorded clips cleared successfully');
      setShowClearDialog(false);
    } catch (error) {
      console.error('Clear database error:', error);
      showStatus('error', `Failed to clear database: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setShowClearDialog(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)] max-w-4xl mx-auto">
      <div className="flex-1 overflow-y-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl text-white mb-2">Settings</h1>
              <p className="text-gray-500">Configure your Inspectre system</p>
            </div>
            {/* Backend Status Indicator */}
            <div className="flex items-center gap-2">
              {backendStatus === 'checking' && (
                <div className="flex items-center gap-2 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Checking...</span>
                </div>
              )}
              {backendStatus === 'online' && (
                <div className="flex items-center gap-2 text-green-400">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-sm">Backend Online</span>
                </div>
              )}
              {backendStatus === 'offline' && (
                <div className="flex items-center gap-2 text-red-400">
                  <div className="w-2 h-2 bg-red-400 rounded-full" />
                  <span className="text-sm">Backend Offline</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            statusMessage.type === 'success' 
              ? 'bg-green-500/10 border border-green-500/20' 
              : 'bg-red-500/10 border border-red-500/20'
          }`}>
            {statusMessage.type === 'success' 
              ? <CheckCircle className="w-5 h-5 text-green-400" />
              : <AlertCircle className="w-5 h-5 text-red-400" />
            }
            <span className={statusMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}>
              {statusMessage.text}
            </span>
          </div>
        )}

        {/* Settings Form */}
        <div className="space-y-6">
          {/* Recording Status */}
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

          {/* RTSP Link Input */}
          <div className="space-y-2">
            <label className="block text-white text-sm font-medium">
              RTSP Camera Link
            </label>
            <p className="text-gray-500 text-sm mb-3">
              Enter the RTSP stream URL for your camera feed
            </p>
            <input
              type="text"
              value={rtspLink}
              onChange={(e) => setRtspLink(e.target.value)}
              placeholder="rtsp://username:password@camera-ip:554/stream"
              disabled={isDetecting}
              className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#2a2a2a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Chunk Duration Slider */}
          <div className="space-y-2">
            <label className="block text-white text-sm font-medium">
              Chunk Duration
            </label>
            <p className="text-gray-500 text-sm mb-3">
              Duration of each video chunk for processing (in minutes)
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="60"
                  value={chunkDuration}
                  onChange={(e) => setChunkDuration(parseInt(e.target.value))}
                  disabled={isDetecting}
                  className="flex-1 h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer accent-white disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={chunkDuration}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (val >= 1 && val <= 60) setChunkDuration(val);
                    }}
                    disabled={isDetecting}
                    className="w-16 bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg px-2 py-2 text-white text-center focus:outline-none focus:border-[#2a2a2a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-gray-400 text-sm">min</span>
                </div>
              </div>
              <div className="flex justify-between text-xs text-gray-600">
                <span>1 min</span>
                <span>30 min</span>
                <span>60 min</span>
              </div>
            </div>
          </div>

          {/* Camera Name Input */}
          <div className="space-y-2">
            <label className="block text-white text-sm font-medium">
              Camera Name
            </label>
            <p className="text-gray-500 text-sm mb-3">
              Give your camera a name for easy identification
            </p>
            <input
              type="text"
              value={cameraName}
              onChange={(e) => setCameraName(e.target.value)}
              placeholder="Living Room Camera"
              className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#2a2a2a] transition-colors"
            />
          </div>

          {/* System Prompt Input */}
          <div className="space-y-2">
            <label className="block text-white text-sm font-medium">
              Analysis Prompt
            </label>
            <p className="text-gray-500 text-sm mb-3">
              Define how the AI should analyze video footage (used for processing each video chunk)
            </p>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Analyze this video in detail. Describe all activities, objects, people, and events. Identify any unusual or noteworthy occurrences..."
              rows={8}
              className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#2a2a2a] transition-colors resize-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-4 flex flex-col md:flex-row gap-3">
            {/* Save Button */}
            <button
              onClick={handleSave}
              className="flex-1 md:flex-initial md:w-auto flex items-center justify-center gap-2 bg-white hover:bg-gray-200 text-[#0a0a0a] px-6 py-3 rounded-lg transition-colors"
            >
              <Save className="w-5 h-5" />
              Save Settings
            </button>

            {/* Detection Toggle */}
            <button
              onClick={toggleDetection}
              disabled={isLoading || backendStatus === 'offline'}
              className={`flex-1 md:flex-initial md:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isDetecting 
                  ? 'bg-red-600 hover:bg-red-700 text-white' 
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {isDetecting ? 'Stopping...' : 'Starting...'}
                </>
              ) : isDetecting ? (
                <>
                  <Square className="w-5 h-5" />
                  Stop Recording
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Start Recording
                </>
              )}
            </button>

            {/* Clear Database Button */}
            <button
              onClick={handleClearDatabase}
              disabled={backendStatus === 'offline' || isDetecting || isLoading}
              className="flex-1 md:flex-initial md:w-auto flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-5 h-5" />
              Clear Database
            </button>
          </div>

          {/* Backend Connection Info */}
          {backendStatus === 'offline' && (
            <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-yellow-400 text-sm">
                <strong>Backend not connected.</strong> Make sure the backend server is running at{' '}
                <code className="bg-yellow-500/20 px-1 rounded">http://localhost:8000</code>
              </p>
              <p className="text-yellow-400/70 text-sm mt-2">
                Run <code className="bg-yellow-500/20 px-1 rounded">python run.py</code> in the Inspectre directory.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Clear Database Confirmation Dialog */}
      {showClearDialog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg shadow-[0_0_40px_rgba(255,255,255,0.1)] max-w-md w-full p-6">
            <h2 className="text-xl text-white mb-3">Clear Database</h2>
            <p className="text-gray-400 text-sm mb-6">
              Are you sure you want to clear all data? This will:
              <br />• Delete all entries from ChromaDB
              <br />• Delete all recorded video clips
              <br />
              <br />
              <strong className="text-red-400">This action cannot be undone.</strong>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearDialog(false)}
                disabled={isLoading}
                className="flex-1 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white px-4 py-2.5 rounded-lg transition-colors border border-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={confirmClearDatabase}
                disabled={isLoading}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  'Clear Database'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
