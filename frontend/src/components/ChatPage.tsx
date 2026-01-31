import { Send, Search, X, Clock } from "lucide-react";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { searchApi, analysisApi, ClipInfo, getAuthToken } from "../services/api";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
  videoResults?: VideoSearchResult[];
  analysisResult?: string;
  isLoading?: boolean;
}

interface VideoSearchResult {
  camera: string;
  timestamp: string;
  description: string;
  videoUrl: string;
}

export const ChatPage = forwardRef<{ 
  clearMessages: () => void;
  getMessages: () => Message[];
  restoreMessages: (messages: Message[]) => void;
}>((props, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoSearchResult | null>(null);
  const [showTimeFilter, setShowTimeFilter] = useState(false);
  const [timeFilter, setTimeFilter] = useState("Last 24 hours");
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const timeFilterRef = useRef<HTMLDivElement>(null);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    clearMessages: () => {
      setMessages([]);
      setInput("");
      setIsTyping(false);
      setSelectedVideo(null);
    },
    getMessages: () => {
      return messages;
    },
    restoreMessages: (restoredMessages: Message[]) => {
      setMessages(restoredMessages);
      setInput("");
      setIsTyping(false);
      setSelectedVideo(null);
    }
  }));

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch available dates when time filter dropdown opens
  useEffect(() => {
    if (showTimeFilter && availableDates.length === 0) {
      fetchAvailableDates();
    }
  }, [showTimeFilter]);

  const fetchAvailableDates = async () => {
    setLoadingDates(true);
    try {
      const response = await searchApi.getAvailableDates();
      setAvailableDates(response.dates);
    } catch (error) {
      console.error("Failed to fetch available dates:", error);
    } finally {
      setLoadingDates(false);
    }
  };

  // Convert backend clip to frontend VideoSearchResult
  const clipToVideoResult = (clip: ClipInfo): VideoSearchResult => {
    const metadata = clip.metadata;
    const timestamp = metadata.timestamp 
      ? new Date(metadata.timestamp).toLocaleString()
      : "Unknown time";
    
    // Extract camera name from metadata or URL
    const camera = metadata.camera_name || "Camera Feed";
    
    // Get description from the analysis content (full description, not truncated)
    let description = "Video footage from monitoring system";
    if (metadata.analysis) {
      try {
        const analysis = JSON.parse(metadata.analysis);
        if (analysis.choices?.[0]?.message?.content) {
          description = analysis.choices[0].message.content;
        }
      } catch {
        // Use default description
      }
    }

    // Use local endpoint if local_path exists, otherwise fallback to R2 URL
    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const token = getAuthToken();
    const videoUrl = metadata.local_path
      ? `${API_BASE_URL}/videos/${encodeURIComponent(String(metadata.local_path))}${token ? `?token=${encodeURIComponent(token)}` : ""}`
      : clip.video_url;

    return {
      camera,
      timestamp,
      description,
      videoUrl: videoUrl
    };
  };

  // Handle sending analysis query (Send button)
  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const queryText = input;
    setInput("");
    setIsTyping(true);

    try {
      // Determine target date for the query
      const targetDate = selectedDate || undefined;
      
      // Call analysis API
      const response = await analysisApi.analyze(queryText, 5, targetDate);
      
      if (response.results.length === 0) {
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `No videos found matching your query in ${timeFilter}. Try adjusting your search or selecting a different date.`,
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, botMessage]);
      } else {
        // Combine all analysis results
        const successfulResults = response.results.filter(r => r.analysis);
        const failedResults = response.results.filter(r => r.error);

        let responseText = "";
        if (successfulResults.length > 0) {
          responseText = successfulResults.map((r, i) => {
            return `**Video ${i + 1}:**\n${r.analysis}`;
          }).join("\n\n---\n\n");
        }
        
        if (failedResults.length > 0) {
          responseText += `\n\n(${failedResults.length} video(s) could not be analyzed)`;
        }

        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const token = getAuthToken();
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: responseText || "Analysis complete but no insights available.",
          sender: "bot",
          timestamp: new Date(),
          videoResults: response.results
            .filter(r => r.video_url)
            .map(r => {
              // Use local endpoint if local_path exists, otherwise fallback to R2 URL
              const videoUrl = r.local_path 
                ? `${API_BASE_URL}/videos/${encodeURIComponent(String(r.local_path))}${token ? `?token=${encodeURIComponent(token)}` : ""}`
                : r.video_url;
              return {
                camera: "Analyzed Video",
                timestamp: new Date().toLocaleString(),
                description: r.analysis || "Video analyzed",
                videoUrl: videoUrl
              };
            })
        };
        setMessages((prev) => [...prev, botMessage]);
      }
    } catch (error) {
      console.error("Analysis error:", error);
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: `Sorry, I couldn't analyze the videos. ${error instanceof Error ? error.message : 'Please try again.'}`,
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  // Handle search for clips (Search button)
  const handleSearch = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const queryText = input;
    setInput("");
    setIsTyping(true);

    try {
      // Determine target date for the query
      const targetDate = selectedDate || undefined;
      
      // Call search API
      const response = await searchApi.searchClips(queryText, 5, targetDate);
      
      if (response.clips.length === 0) {
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `No video clips found matching your query in ${timeFilter}. Try adjusting your search or selecting a different date.`,
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, botMessage]);
      } else {
        const videoResults = response.clips.map(clipToVideoResult);
        
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `Found ${response.clips.length} video clip${response.clips.length > 1 ? 's' : ''} matching your query. Click to view.`,
          sender: "bot",
          timestamp: new Date(),
          videoResults: videoResults,
        };
        setMessages((prev) => [...prev, botMessage]);
      }
    } catch (error) {
      console.error("Search error:", error);
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: `Sorry, I couldn't search for videos. ${error instanceof Error ? error.message : 'Please try again.'}`,
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Close time filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (timeFilterRef.current && !timeFilterRef.current.contains(event.target as Node)) {
        setShowTimeFilter(false);
        setShowCalendar(false);
      }
    };

    if (showTimeFilter || showCalendar) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showTimeFilter, showCalendar]);

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    const formattedDate = new Date(date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    setTimeFilter(formattedDate);
    setShowCalendar(false);
    setShowTimeFilter(false);
  };

  const handleLast24Hours = () => {
    setTimeFilter("Last 24 hours");
    setSelectedDate("");
    setShowTimeFilter(false);
  };

  const handleSelectAvailableDate = (date: string) => {
    handleDateSelect(date);
  };

  return (
    <>
      <div className="flex flex-col h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)] max-w-4xl mx-auto relative">
        {/* Time Filter Button - Top Right */}
        <div className="absolute top-0 right-4 z-10" ref={timeFilterRef}>
          <button
            onClick={() => setShowTimeFilter(!showTimeFilter)}
            className="flex items-center gap-2 bg-[#0f0f0f] border border-[#1a1a1a] hover:border-[#2a2a2a] rounded-lg px-3 py-2 transition-colors"
          >
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-400 hidden sm:inline">{timeFilter}</span>
          </button>

          {/* Time Filter Dropdown */}
          {showTimeFilter && !showCalendar && (
            <div className="absolute top-full right-0 mt-2 bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg shadow-[0_0_40px_rgba(255,255,255,0.1)] min-w-[220px] overflow-hidden">
              <button
                onClick={handleLast24Hours}
                className={`w-full text-left px-4 py-3 text-sm transition-colors border-b border-[#1a1a1a] ${
                  timeFilter === "Last 24 hours"
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-white'
                }`}
              >
                Last 24 hours
              </button>
              
              {/* Available Dates Section */}
              {loadingDates ? (
                <div className="px-4 py-3 text-sm text-gray-500">
                  Loading dates...
                </div>
              ) : availableDates.length > 0 ? (
                <div className="max-h-48 overflow-y-auto">
                  <div className="px-4 py-2 text-xs text-gray-500 border-b border-[#1a1a1a]">
                    Available Dates
                  </div>
                  {availableDates.slice(0, 10).map((date) => (
                    <button
                      key={date}
                      onClick={() => handleSelectAvailableDate(date)}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        selectedDate === date
                          ? 'bg-[#1a1a1a] text-white'
                          : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-white'
                      }`}
                    >
                      {new Date(date).toLocaleDateString('en-US', { 
                        weekday: 'short',
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}
                    </button>
                  ))}
                </div>
              ) : null}
              
              <button
                onClick={() => setShowCalendar(true)}
                className="w-full text-left px-4 py-3 text-sm transition-colors text-gray-400 hover:bg-[#1a1a1a] hover:text-white border-t border-[#1a1a1a]"
              >
                Select another date...
              </button>
            </div>
          )}

          {/* Calendar for Date Selection */}
          {showCalendar && (
            <div className="absolute top-full right-0 mt-2 bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg shadow-[0_0_40px_rgba(255,255,255,0.1)] p-4">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateSelect(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#1a1a1a] text-white border border-[#2a2a2a] rounded focus:outline-none focus:border-gray-500"
                style={{
                  colorScheme: 'dark'
                }}
              />
            </div>
          )}
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto py-8 px-4 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {messages.length === 0 && !isTyping ? (
            /* Empty State with Spinning Eye */
            <div className="flex flex-col items-center justify-center h-full">
              <div className="mb-6">
                <svg 
                  width="120" 
                  height="120" 
                  viewBox="0 0 120 120" 
                  fill="none"
                  className="animate-spin"
                  style={{ animationDuration: '3s' }}
                >
                  {/* Main circular housing */}
                  <circle cx="60" cy="60" r="40" stroke="white" strokeWidth="2" fill="none" opacity="0.3" />
                  <circle cx="60" cy="60" r="32" stroke="white" strokeWidth="2" fill="none" opacity="0.5" />
                  
                  {/* Eye shape inside circle */}
                  <path
                    d="M35 60 Q35 48 60 48 Q85 48 85 60 Q85 72 60 72 Q35 72 35 60"
                    stroke="white"
                    strokeWidth="2"
                    fill="none"
                  />
                  
                  {/* Iris/Pupil */}
                  <circle cx="60" cy="60" r="8" fill="white" />
                  <circle cx="60" cy="60" r="4" fill="#0a0a0a" />
                  
                  {/* Light reflection */}
                  <circle cx="63" cy="57" r="2.5" fill="#00ff88" opacity="0.9" />
                  
                  {/* Scanning lines */}
                  <line x1="20" y1="60" x2="35" y2="60" stroke="white" strokeWidth="1.5" opacity="0.4" />
                  <line x1="85" y1="60" x2="100" y2="60" stroke="white" strokeWidth="1.5" opacity="0.4" />
                </svg>
              </div>
              <p className="text-gray-400 text-lg">What are we looking for?</p>
            </div>
          ) : (
            <div className="space-y-6 md:space-y-8">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className="w-full"
                >
                  {message.sender === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] md:max-w-[70%]">
                        <div className="bg-[#00ff88] text-[#0a0a0a] rounded-3xl px-5 py-3">
                          <p className="leading-relaxed">{message.text}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-[85%] md:max-w-[70%]">
                      <div className="text-white">
                        <p className="leading-relaxed mb-1 whitespace-pre-wrap">{message.text}</p>
                      </div>
                      
                      {/* Video Results */}
                      {message.videoResults && message.videoResults.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {message.videoResults.map((video, index) => (
                            <button
                              key={index}
                              onClick={() => setSelectedVideo(video)}
                              className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4 hover:border-[#2a2a2a] transition-colors text-left w-full"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 bg-white rounded-full shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
                                <span className="text-white">{video.camera}</span>
                              </div>
                              <p className="text-gray-400 text-sm mb-2 line-clamp-2">{video.description}</p>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 text-sm">{video.timestamp}</span>
                                <span className="text-gray-500 text-sm">Click to view →</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              
              {isTyping && (
                <div className="max-w-[85%] md:max-w-[70%]">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="flex-shrink-0 pb-6 px-4">
          <div className="max-w-3xl mx-auto">
            <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-3xl p-2 flex items-end gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Message Inspectre"
                className="flex-1 bg-transparent px-4 py-3 text-white placeholder-gray-500 focus:outline-none resize-none"
              />
              <div className="flex gap-1">
                <button
                  onClick={handleSearch}
                  disabled={!input.trim() || isTyping}
                  className="w-10 h-10 bg-transparent hover:bg-white/5 disabled:hover:bg-transparent disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors"
                  title="Search video clips"
                >
                  <Search className={`w-5 h-5 ${input.trim() && !isTyping ? 'text-gray-400 hover:text-white' : 'text-gray-600'}`} />
                </button>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="w-10 h-10 bg-white hover:bg-gray-200 disabled:bg-[#1a1a1a] disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors"
                  title="Analyze videos"
                >
                  <Send className={`w-5 h-5 ${input.trim() && !isTyping ? 'text-[#0a0a0a]' : 'text-gray-600'}`} />
                </button>
              </div>
            </div>
            <p className="text-center text-gray-600 text-xs mt-2">
              Search (🔍) finds clips • Send (→) analyzes with AI
            </p>
          </div>
        </div>
      </div>

      {/* Video Overlay Modal */}
      {selectedVideo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedVideo(null)}>
          <div className="bg-[#0f0f0f] rounded-2xl border border-[#1a1a1a] max-w-4xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-[#1a1a1a]">
              <div>
                <h3 className="text-white text-lg mb-1">{selectedVideo.camera}</h3>
                <p className="text-gray-500 text-sm">{selectedVideo.timestamp}</p>
              </div>
              <button
                onClick={() => setSelectedVideo(null)}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center transition-colors border border-white/10"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            {/* Video Player and Description Side Panel */}
            <div className="flex flex-col md:flex-row md:h-[500px]">
              {/* Video Player */}
              <div className="relative flex-1">
                <video
                  key={selectedVideo.videoUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                  className="w-full h-[300px] md:h-full object-cover bg-black"
                >
                  {(() => {
                    // Determine MIME type based on file extension
                    const url = selectedVideo.videoUrl.toLowerCase();
                    let mimeType = "video/mp4"; // default
                    if (url.endsWith(".avi")) {
                      mimeType = "video/x-msvideo";
                    } else if (url.endsWith(".mov")) {
                      mimeType = "video/quicktime";
                    } else if (url.endsWith(".webm")) {
                      mimeType = "video/webm";
                    } else if (url.endsWith(".mkv")) {
                      mimeType = "video/x-matroska";
                    }
                    return <source src={selectedVideo.videoUrl} type={mimeType} />;
                  })()}
                  Your browser does not support the video tag.
                </video>
              </div>

              {/* Description Side Panel */}
              <div className="w-full md:w-80 bg-[#0a0a0a] border-t md:border-t-0 md:border-l border-[#1a1a1a] p-4 md:p-6 overflow-y-auto">
                <h4 className="text-white text-sm mb-2">Event Description</h4>
                <p className="text-gray-400 text-sm whitespace-pre-wrap break-words">{selectedVideo.description}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
