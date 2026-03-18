import React, { useEffect, useState, type FormEvent } from "react";
import { ApiError, authApi, deviceConfigApi } from "../services/api";
import { ChevronRight, ChevronLeft, Eye, EyeOff } from "lucide-react";

interface RegisterPageProps {
  onRegister: () => void;
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onRegister, onSwitchToLogin }: RegisterPageProps) {
  const [step, setStep] = useState<"account" | "setup">("account");

  // Account fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Device config fields
  const [rtspUrl, setRtspUrl] = useState("");
  const [cameraName, setCameraName] = useState("");
  const [videoPreprompt, setVideoPreprompt] = useState("");
  const [r2AccountId, setR2AccountId] = useState("");
  const [r2AccessKeyId, setR2AccessKeyId] = useState("");
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState("");
  const [r2BucketName, setR2BucketName] = useState("");
  const [r2PublicUrlBase, setR2PublicUrlBase] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFromAddress, setSmtpFromAddress] = useState("");
  const [smtpUseTls, setSmtpUseTls] = useState(true);
  const [reliableInternet, setReliableInternet] = useState(true);
  const [localStorageMaxGb, setLocalStorageMaxGb] = useState(50);
  const [r2MaxGb, setR2MaxGb] = useState(10);

  const [configSection, setConfigSection] = useState<"camera" | "r2" | "smtp" | "storage">("camera");

  useEffect(() => {
    const prevHtmlBg = document.documentElement.style.backgroundColor;
    const prevBodyBg = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = "#0a0a0a";
    document.body.style.backgroundColor = "#0a0a0a";
    return () => {
      document.documentElement.style.backgroundColor = prevHtmlBg;
      document.body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError("Email is required."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }

    setLoading(true);
    try {
      await authApi.register(trimmedEmail, password);
      setStep("setup");
    } catch (err) {
      if (err instanceof ApiError) setError(err.detail || err.message || "Registration failed");
      else setError("Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      await deviceConfigApi.update({
        rtsp_url: rtspUrl,
        camera_name: cameraName,
        video_preprompt: videoPreprompt,
        r2_account_id: r2AccountId,
        r2_access_key_id: r2AccessKeyId,
        r2_secret_access_key: r2SecretAccessKey,
        r2_bucket_name: r2BucketName,
        r2_public_url_base: r2PublicUrlBase,
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_username: smtpUsername,
        smtp_password: smtpPassword,
        smtp_from_address: smtpFromAddress,
        smtp_use_tls: smtpUseTls,
        reliable_internet: reliableInternet,
        local_storage_max_gb: localStorageMaxGb,
        r2_max_gb: r2MaxGb,
      });
      onRegister();
    } catch (err) {
      if (err instanceof ApiError) setError(err.detail || err.message || "Failed to save config");
      else setError("Failed to save device configuration.");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#2a2a2a] transition-colors text-sm";
  const labelClass = "block text-sm font-medium text-gray-400 mb-1";
  const sectionBtn = (id: typeof configSection, label: string) => (
    <button
      type="button"
      onClick={() => setConfigSection(id)}
      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
        configSection === id ? "bg-white" : "bg-[#1a1a1a] text-gray-400 hover:text-white"
      }`}
      style={{ color: configSection === id ? "#000000" : undefined }}
    >
      {label}
    </button>
  );

  // Account creation form
  if (step === "account") {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] text-white overflow-y-auto flex items-center justify-center p-4" style={{ width: "100vw", height: "100vh" }}>
        <div className="w-full max-w-md">
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 md:p-8 shadow-[0_0_40px_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="w-full h-full">
                  <path d="M8 14 Q8 8 20 8 Q32 8 32 14 L32 16 L8 16 Z" stroke="white" strokeWidth="1.5" fill="none" />
                  <path d="M8 16 L6 20 Q6 22 8 22" stroke="white" strokeWidth="1.5" fill="none" />
                  <path d="M32 16 L34 20 Q34 22 32 22" stroke="white" strokeWidth="1.5" fill="none" />
                  <circle cx="20" cy="24" r="12" stroke="white" strokeWidth="1.5" fill="none" />
                  <circle cx="20" cy="24" r="9" stroke="white" strokeWidth="1.5" fill="none" />
                  <path d="M13 24 Q13 20 20 20 Q27 20 27 24 Q27 28 20 28 Q13 28 13 24" stroke="white" strokeWidth="1.5" fill="none" />
                  <circle cx="20" cy="24" r="2.5" fill="white" />
                  <circle cx="20" cy="24" r="1.2" fill="#0f0f0f" />
                  <circle cx="21" cy="23" r="0.8" fill="#00ff88" opacity="0.9" />
                </svg>
              </div>
              <div>
                <div className="text-white font-medium leading-tight">Inspectre</div>
                <div className="text-gray-500 text-sm leading-tight">Video Intelligence</div>
              </div>
            </div>

            <div className="mb-6">
              <h2 className="text-2xl font-medium text-white">Create account</h2>
              <p className="text-sm text-gray-500 mt-2">Step 1 of 2 — Sign up to get started.</p>
            </div>

            {error && (
              <div className="mb-5 p-3 rounded-xl border border-red-500/20 bg-red-500/10">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <label className={labelClass}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" required />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Password</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="new-password" minLength={6} required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Confirm password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} autoComplete="new-password" minLength={6} required />
              </div>
              <button type="submit" disabled={loading || !email.trim() || !password || !confirmPassword} className="w-full mt-2 bg-white hover:bg-gray-200 text-[#0a0a0a] rounded-xl py-3 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {loading ? "Creating..." : <>Next <ChevronRight size={16} /></>}
              </button>
            </form>

            <div className="mt-6 text-sm text-gray-500">
              Already have an account?{" "}
              <button type="button" onClick={onSwitchToLogin} className="text-white hover:text-gray-200 transition-colors">Sign in</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Device config setup wizard
  return (
    <div className="fixed inset-0 bg-[#0a0a0a] text-white overflow-y-auto flex items-center justify-center p-4" style={{ width: "100vw", height: "100vh" }}>
      <div className="w-full max-w-lg">
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 md:p-8 shadow-[0_0_40px_rgba(255,255,255,0.06)]">
          <div className="mb-6">
            <h2 className="text-2xl font-medium text-white">Device setup</h2>
            <p className="text-sm text-gray-500 mt-2">Step 2 of 2 — Configure your camera, cloud storage, and notifications.</p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl border border-red-500/20 bg-red-500/10">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <div className="flex gap-2 mb-6 flex-wrap">
            {sectionBtn("camera", "Camera")}
            {sectionBtn("r2", "Cloud Storage (R2)")}
            {sectionBtn("smtp", "Email (SMTP)")}
            {sectionBtn("storage", "Retention")}
          </div>

          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            {configSection === "camera" && (
              <>
                <div>
                  <label className={labelClass}>RTSP Stream URL *</label>
                  <input value={rtspUrl} onChange={(e) => setRtspUrl(e.target.value)} className={inputClass} placeholder="rtsp://192.168.1.100:554/stream" />
                </div>
                <div>
                  <label className={labelClass}>Camera Name</label>
                  <input value={cameraName} onChange={(e) => setCameraName(e.target.value)} className={inputClass} placeholder="Front door camera" />
                </div>
                <div>
                  <label className={labelClass}>Video Analysis Prompt</label>
                  <textarea value={videoPreprompt} onChange={(e) => setVideoPreprompt(e.target.value)} className={inputClass + " min-h-[80px] resize-y"} placeholder="Describe what the AI should focus on when analyzing footage..." />
                  <p className="text-xs text-gray-600 mt-1">This prompt guides the AI when analyzing your video footage.</p>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <div>
                    <p className="text-sm text-white font-medium">Reliable internet</p>
                    <p className="text-xs text-gray-500">Auto-upload footage after each recording chunk</p>
                  </div>
                  <button type="button" onClick={() => setReliableInternet(!reliableInternet)} className={`relative flex-shrink-0 h-6 w-11 items-center rounded-full transition-colors ${reliableInternet ? "bg-[#00ff88]" : "bg-gray-600"}`}>
                    <span className={`absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${reliableInternet ? "translate-x-6" : "translate-x-1"}`} style={{ top: "2px" }} />
                  </button>
                </div>
              </>
            )}

            {configSection === "r2" && (
              <>
                <p className="text-xs text-gray-500 mb-2">Cloudflare R2 credentials for video storage. Get these from your Cloudflare dashboard.</p>
                <div>
                  <label className={labelClass}>Account ID</label>
                  <input value={r2AccountId} onChange={(e) => setR2AccountId(e.target.value)} className={inputClass} placeholder="e.g. 87212c3db65e..." />
                </div>
                <div>
                  <label className={labelClass}>Access Key ID</label>
                  <input value={r2AccessKeyId} onChange={(e) => setR2AccessKeyId(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Secret Access Key</label>
                  <input type="password" value={r2SecretAccessKey} onChange={(e) => setR2SecretAccessKey(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Bucket Name</label>
                  <input value={r2BucketName} onChange={(e) => setR2BucketName(e.target.value)} className={inputClass} placeholder="inspectrevideos" />
                </div>
                <div>
                  <label className={labelClass}>Public URL Base</label>
                  <input value={r2PublicUrlBase} onChange={(e) => setR2PublicUrlBase(e.target.value)} className={inputClass} placeholder="https://pub-xxx.r2.dev" />
                </div>
              </>
            )}

            {configSection === "smtp" && (
              <>
                <p className="text-xs text-gray-500 mb-2">SMTP settings for email notifications (e.g. new tunnel URLs). Optional.</p>
                <div>
                  <label className={labelClass}>SMTP Host</label>
                  <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className={inputClass} placeholder="smtp.gmail.com" />
                </div>
                <div>
                  <label className={labelClass}>Port</label>
                  <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Username</label>
                  <input value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Password / App Password</label>
                  <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>From Address</label>
                  <input type="email" value={smtpFromAddress} onChange={(e) => setSmtpFromAddress(e.target.value)} className={inputClass} placeholder="inspectre@example.com" />
                </div>
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-white font-medium">Use TLS</p>
                  <button type="button" onClick={() => setSmtpUseTls(!smtpUseTls)} className={`relative flex-shrink-0 h-6 w-11 items-center rounded-full transition-colors ${smtpUseTls ? "bg-[#00ff88]" : "bg-gray-600"}`}>
                    <span className={`absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${smtpUseTls ? "translate-x-6" : "translate-x-1"}`} style={{ top: "2px" }} />
                  </button>
                </div>
              </>
            )}

            {configSection === "storage" && (
              <>
                <p className="text-xs text-gray-500 mb-2">Storage limits for automatic retention cleanup. Oldest footage is deleted first when limits are exceeded.</p>
                <div>
                  <label className={labelClass}>Local storage limit (GB)</label>
                  <input type="number" value={localStorageMaxGb} onChange={(e) => setLocalStorageMaxGb(Number(e.target.value))} className={inputClass} min={1} step={1} />
                  <p className="text-xs text-gray-600 mt-1">Maximum disk space for local footage files.</p>
                </div>
                <div>
                  <label className={labelClass}>R2 bucket limit (GB)</label>
                  <input type="number" value={r2MaxGb} onChange={(e) => setR2MaxGb(Number(e.target.value))} className={inputClass} min={1} step={1} />
                  <p className="text-xs text-gray-600 mt-1">Cloudflare R2 free tier is 10 GB.</p>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <button type="button" onClick={() => setStep("account")} className="flex-1 bg-[#1a1a1a] hover:bg-[#222] text-white rounded-xl py-3 font-medium transition-colors flex items-center justify-center gap-2">
              <ChevronLeft size={16} /> Back
            </button>
            <button type="button" onClick={handleSaveConfig} disabled={loading || !rtspUrl.trim()} className="flex-1 bg-white hover:bg-gray-200 text-[#0a0a0a] rounded-xl py-3 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? "Saving..." : "Finish setup"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
