import React, { useEffect, useState, type FormEvent } from "react";
import { ApiError, authApi } from "../services/api";

interface LoginPageProps {
  onLogin: () => void;
  onSwitchToRegister: () => void;
}

export function LoginPage({ onLogin, onSwitchToRegister }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Ensure body/html are dark (prevents white flash/whitespace).
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

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.login(email.trim(), password);
      onLogin();
    } catch (err) {
      if (err instanceof ApiError) setError(err.detail || err.message || "Login failed");
      else setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[#0a0a0a] text-white overflow-y-auto flex items-center justify-center p-4"
      style={{ width: "100vw", height: "100vh" }}
    >
      <div className="w-full max-w-md">
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 md:p-8 shadow-[0_0_40px_rgba(255,255,255,0.06)]">
            {/* Brand */}
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="w-full h-full">
                  <path
                    d="M8 14 Q8 8 20 8 Q32 8 32 14 L32 16 L8 16 Z"
                    stroke="white"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <path d="M8 16 L6 20 Q6 22 8 22" stroke="white" strokeWidth="1.5" fill="none" />
                  <path d="M32 16 L34 20 Q34 22 32 22" stroke="white" strokeWidth="1.5" fill="none" />
                  <circle cx="20" cy="24" r="12" stroke="white" strokeWidth="1.5" fill="none" />
                  <circle cx="20" cy="24" r="9" stroke="white" strokeWidth="1.5" fill="none" />
                  <path
                    d="M13 24 Q13 20 20 20 Q27 20 27 24 Q27 28 20 28 Q13 28 13 24"
                    stroke="white"
                    strokeWidth="1.5"
                    fill="none"
                  />
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
              <h2 className="text-2xl font-medium text-white">Sign in</h2>
              <p className="text-sm text-gray-500 mt-2">Enter your credentials to continue.</p>
            </div>

            {error && (
              <div className="mb-5 p-3 rounded-xl border border-red-500/20 bg-red-500/10">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-400">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#2a2a2a] transition-colors"
                autoComplete="email"
                required
              />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-400">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#2a2a2a] transition-colors"
                autoComplete="current-password"
                required
              />
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim() || !password.trim()}
                className="w-full mt-2 bg-white hover:bg-gray-200 text-[#0a0a0a] rounded-xl py-3 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>

            <div className="mt-6 text-sm text-gray-500">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="text-white hover:text-gray-200 transition-colors"
              >
                Register
              </button>
            </div>
        </div>
      </div>
    </div>
  );
}

