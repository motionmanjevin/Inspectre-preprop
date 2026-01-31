import { X, Settings, Home, RefreshCw, Archive, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { searchApi, ProcessingStatsResponse } from "../services/api";

export function Sidebar({ isOpen, onClose, onNavigate, onRefreshChat, onLogout }: { 
  isOpen: boolean; 
  onClose: () => void; 
  onNavigate: (page: "chat" | "settings" | "archives") => void;
  onRefreshChat: () => void;
  onLogout: () => void;
}) {
  const [stats, setStats] = useState<ProcessingStatsResponse | null>(null);

  // Fetch processing stats on mount and periodically
  useEffect(() => {
    fetchStats();
    
    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const response = await searchApi.getProcessingStats();
      setStats(response);
    } catch (error) {
      // Silently fail - backend might not be running
      console.debug("Failed to fetch processing stats:", error);
    }
  };

  // Format minutes to hours:minutes display
  const formatTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`
        fixed md:relative
        w-64 bg-[#0f0f0f] border-r border-[#1a1a1a] 
        flex flex-col h-full z-50
        transition-transform duration-300
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="p-6 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 relative">
              {/* Eye + CCTV Camera Logo */}
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                {/* Camera dome top */}
                <path
                  d="M8 14 Q8 8 20 8 Q32 8 32 14 L32 16 L8 16 Z"
                  stroke="white"
                  strokeWidth="1.5"
                  fill="none"
                />
                {/* Camera dome sides */}
                <path
                  d="M8 16 L6 20 Q6 22 8 22"
                  stroke="white"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path
                  d="M32 16 L34 20 Q34 22 32 22"
                  stroke="white"
                  strokeWidth="1.5"
                  fill="none"
                />
                {/* Main circular housing */}
                <circle cx="20" cy="24" r="12" stroke="white" strokeWidth="1.5" fill="none" />
                <circle cx="20" cy="24" r="9" stroke="white" strokeWidth="1.5" fill="none" />
                
                {/* Eye shape inside circle */}
                <path
                  d="M13 24 Q13 20 20 20 Q27 20 27 24 Q27 28 20 28 Q13 28 13 24"
                  stroke="white"
                  strokeWidth="1.5"
                  fill="none"
                />
                
                {/* Iris/Pupil */}
                <circle cx="20" cy="24" r="2.5" fill="white" />
                <circle cx="20" cy="24" r="1.2" fill="#0f0f0f" />
                
                {/* Light reflection */}
                <circle cx="21" cy="23" r="0.8" fill="#00ff88" opacity="0.9" />
              </svg>
            </div>
            <div className="flex-1">
              <h1 className="text-white">Inspectre</h1>
              <p className="text-gray-500 text-sm">Video Intelligence</p>
            </div>
            {/* Close button for mobile */}
            <button 
              className="md:hidden p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors"
              onClick={onClose}
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Footer Info */}
        <div className="p-6 border-t border-[#1a1a1a] space-y-4">
          <div className="space-y-4">
            {/* Navigation Buttons */}
            <div className="flex gap-2">
              {/* Home Button */}
              <button 
                onClick={() => onNavigate("chat")}
                className="flex-1 flex items-center justify-center p-3 hover:bg-[#1a1a1a] rounded-lg transition-colors"
              >
                <Home className="w-5 h-5 text-gray-400" />
              </button>
              
              {/* Archives Button */}
              <button 
                onClick={() => onNavigate("archives")}
                className="flex-1 flex items-center justify-center p-3 hover:bg-[#1a1a1a] rounded-lg transition-colors"
                title="View archived conversations"
              >
                <Archive className="w-5 h-5 text-gray-400" />
              </button>
              
              {/* Refresh Chat Button */}
              <button 
                onClick={onRefreshChat}
                className="flex-1 flex items-center justify-center p-3 hover:bg-[#1a1a1a] rounded-lg transition-colors group"
                title="Clear chat messages"
              >
                <RefreshCw className="w-5 h-5 text-gray-400 group-hover:rotate-180 transition-transform duration-500" />
              </button>
              
              {/* Settings Button */}
              <button 
                onClick={() => onNavigate("settings")}
                className="flex-1 flex items-center justify-center p-3 hover:bg-[#1a1a1a] rounded-lg transition-colors"
              >
                <Settings className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            
            {/* Logout Button */}
            <button 
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 p-3 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors text-red-400 hover:text-red-300"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm">Logout</span>
            </button>
            
            {/* 24 Hour Processing Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>00:00</span>
                <span className="text-gray-400">
                  {stats ? formatTime(stats.total_minutes) : '--:--'}
                </span>
                <span>24:00</span>
              </div>
              <div className="w-full h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-white to-gray-400 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.4)] transition-all duration-500"
                  style={{ 
                    width: `${stats ? stats.progress_percent : 0}%` 
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-600">
                <span>{stats ? `${stats.chunks_processed} chunks` : 'No data'}</span>
                <span>{stats ? `${stats.progress_percent}%` : ''}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
