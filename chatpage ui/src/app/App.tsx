import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Database,
  Plus,
  Search,
  RefreshCw,
  Film,
  Sparkles,
  Send,
  ChevronDown,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  X
} from 'lucide-react';

// Mock data types
interface Chunk {
  id: string;
  filename: string;
  date: string;
  time: string;
  fileSize: string;
  isLive?: boolean;
  thumbnailUrl?: string;
  videoUrl?: string;
  blobUrl?: string;
}

interface Message {
  id: string;
  type: 'user' | 'system' | 'bot';
  content: string;
  chunkId?: string;
  chunkLabel?: string;
  cameraScope?: string;
  chunkCount?: number;
  timestamps?: string[];
  isCached?: boolean;
  isError?: boolean;
}

export default function App() {
  const [chunks, setChunks] = useState<Chunk[]>([
    { id: '1', filename: 'cam01_20260511_234532.mp4', date: 'Yesterday', time: '23:45:32', fileSize: '2.4 GB', blobUrl: '' },
    { id: '2', filename: 'cam01_20260511_235532.mp4', date: 'Yesterday', time: '23:55:32', fileSize: '2.1 GB', blobUrl: '' },
    { id: '3', filename: 'cam02_20260511_234532.mp4', date: 'Yesterday', time: '23:45:32', fileSize: '1.8 GB' },
    { id: '4', filename: 'cam02_20260511_235532.mp4', date: 'Yesterday', time: '23:55:32', fileSize: '2.0 GB' },
    { id: '5', filename: 'cam01_20260512_000532.mp4', date: 'Today', time: '00:05:32', fileSize: '2.2 GB', isLive: true },
  ]);

  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>(['1']);
  const [activeChunkId, setActiveChunkId] = useState<string | null>('1');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [cameraScope, setCameraScope] = useState('all');
  const [isLocked, setIsLocked] = useState(false);
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [isChatMode, setIsChatMode] = useState(false);
  const [videoOverlay, setVideoOverlay] = useState<{
    isOpen: boolean;
    chunkId: string | null;
    timestamps: string[];
    currentTime?: number;
  }>({ isOpen: false, chunkId: null, timestamps: [] });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-height textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [inputValue]);

  const handleChunkClick = (chunkId: string) => {
    if (isLocked && !lockedIds.includes(chunkId)) return;

    setSelectedChunkIds(prev =>
      prev.includes(chunkId)
        ? prev.filter(id => id !== chunkId)
        : [...prev, chunkId]
    );
  };

  const handleChunkDoubleClick = (chunkId: string) => {
    setActiveChunkId(chunkId);
  };

  const handleNewChat = () => {
    setMessages([]);
    setIsLocked(false);
    setLockedIds([]);
    setInputValue('');
    setIsChatMode(false);
    // Revoke blob URLs
    chunks.forEach(chunk => {
      if (chunk.blobUrl) {
        URL.revokeObjectURL(chunk.blobUrl);
      }
    });
  };

  const handleBackToMain = () => {
    setMessages([]);
    setIsLocked(false);
    setLockedIds([]);
    setInputValue('');
    setIsChatMode(false);
    setVideoOverlay({ isOpen: false, chunkId: null, timestamps: [] });
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue,
      cameraScope: cameraScope === 'all' ? 'All cameras' : cameraScope,
      chunkCount: selectedChunkIds.length
    };

    setMessages(prev => [...prev, userMessage]);
    setIsChatMode(true);

    // Lock session on first send
    if (!isLocked) {
      setIsLocked(true);
      setLockedIds(selectedChunkIds);
    }

    const systemMessage: Message = {
      id: (Date.now() + 1).toString(),
      type: 'system',
      content: 'Analyzing...',
    };
    setMessages(prev => [...prev, systemMessage]);
    setInputValue('');
    setIsProcessing(true);
    setProcessingProgress({ current: 1, total: selectedChunkIds.length });

    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    setMessages(prev => prev.filter(m => m.id !== systemMessage.id));

    const botMessage: Message = {
      id: (Date.now() + 2).toString(),
      type: 'bot',
      content: `Analysis complete. Detected motion patterns in selected footage.\n\nKey observations:\n- Multiple individuals present in corridor\n- Activity concentrated between 23:45-23:55\n- No unauthorized access detected\n\nTimestamp references available for review.`,
      chunkId: chunks[0].id,
      chunkLabel: `${chunks[0].date} • ${chunks[0].time}`,
      timestamps: ['@23:45:12', '@23:47:33', '@23:52:18', '@23:54:41'],
      isCached: !!chunks[0].blobUrl
    };

    setMessages(prev => [...prev, botMessage]);
    setIsProcessing(false);
  };

  const handleJumpToTimestamp = (timestamp: string, chunkId?: string, allTimestamps?: string[]) => {
    // Parse timestamp and seek (simplified)
    const timeMatch = timestamp.match(/(\d{2}):(\d{2}):(\d{2})/);
    let seekTime = 0;
    if (timeMatch) {
      const [_, hours, minutes, seconds] = timeMatch;
      seekTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
    }

    // Open video overlay with the chunk and all timestamps
    setVideoOverlay({
      isOpen: true,
      chunkId: chunkId || activeChunkId,
      timestamps: allTimestamps || [],
      currentTime: seekTime
    });
  };

  const handleOverlayTimestampClick = (timestamp: string) => {
    const timeMatch = timestamp.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (timeMatch && overlayVideoRef.current) {
      const [_, hours, minutes, seconds] = timeMatch;
      const seekTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
      overlayVideoRef.current.currentTime = seekTime;
    }
  };

  const closeVideoOverlay = () => {
    setVideoOverlay({ isOpen: false, chunkId: null, timestamps: [] });
  };

  // Set video time when overlay opens
  useEffect(() => {
    if (videoOverlay.isOpen && overlayVideoRef.current && videoOverlay.currentTime !== undefined) {
      overlayVideoRef.current.currentTime = videoOverlay.currentTime;
    }
  }, [videoOverlay.isOpen, videoOverlay.currentTime]);

  const filteredChunks = chunks.filter(chunk =>
    chunk.filename.toLowerCase().includes(searchFilter.toLowerCase()) ||
    chunk.date.toLowerCase().includes(searchFilter.toLowerCase()) ||
    chunk.time.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const activeChunk = chunks.find(c => c.id === activeChunkId);
  const cachedCount = chunks.filter(c => c.blobUrl).length;

  return (
    <div className="h-screen bg-[#070707] text-white p-4 md:p-8">
      <div className="h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)] flex flex-col">

        {isChatMode ? (
          /* Chat Mode - Only Messages and Composer */
          <>
            {/* Back Button Header */}
            <div className="mb-6">
              <button
                onClick={handleBackToMain}
                className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-[#1a1a1a] transition-colors text-gray-300"
              >
                <ArrowLeft className="size-5" />
                <span>Back</span>
              </button>
            </div>

            {/* Messages Area */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 space-y-6 mb-6">
              {messages.map((message) => {
                if (message.type === 'user') {
                  return (
                    <div key={message.id} className="flex justify-end">
                      <div>
                        <div className="bg-[#00ff88] text-black px-4 py-3 rounded-2xl rounded-tr-md max-w-2xl">
                          {message.content}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 text-right">
                          {message.cameraScope} • {message.chunkCount} chunks
                        </div>
                      </div>
                    </div>
                  );
                }

                if (message.type === 'system') {
                  return (
                    <div key={message.id} className="flex justify-center">
                      <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${
                        message.isError ? 'bg-red-500/20 text-red-400' : 'bg-[#1a1a1a] text-gray-400'
                      }`}>
                        {!message.isError && <Loader2 className="size-4 animate-spin" />}
                        <span className="text-sm">{message.content}</span>
                      </div>
                    </div>
                  );
                }

                if (message.type === 'bot') {
                  return (
                    <div key={message.id} className="flex justify-start">
                      <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-2xl rounded-tl-md max-w-2xl overflow-hidden">
                        <div className="px-4 py-2 border-b border-[#1a1a1a] flex items-center gap-2">
                          <button
                            onClick={() => message.chunkId && setActiveChunkId(message.chunkId)}
                            className="text-sm text-[#00ff88] hover:underline"
                          >
                            {message.chunkLabel}
                          </button>
                          {message.isCached && (
                            <span className="text-xs text-gray-500">Cached</span>
                          )}
                        </div>
                        <div className="px-4 py-3">
                          <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans">
                            {message.content}
                          </pre>
                          {message.timestamps && message.timestamps.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">
                              {message.timestamps.map((ts, i) => (
                                <button
                                  key={i}
                                  onClick={() => handleJumpToTimestamp(ts, message.chunkId, message.timestamps)}
                                  className="px-2 py-1 rounded bg-[#1a1a1a] hover:bg-[#00ff88]/20 hover:text-[#00ff88] text-xs transition-colors"
                                >
                                  {ts}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              })}

              {isProcessing && processingProgress.total > 0 && (
                <div className="flex justify-center">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#1a1a1a] text-gray-400">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">
                      Processing {processingProgress.current} of {processingProgress.total}
                    </span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Composer */}
            <div className="p-6">
              <div className="w-full max-w-3xl mx-auto">
                <div className="relative px-4 py-3 rounded-3xl bg-[#1a1a1a] border border-[#2a2a2a] focus-within:border-[#00ff88] transition-colors">
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Message Local Chat"
                    rows={1}
                    className="w-full pr-12 bg-transparent resize-none focus:outline-none text-white placeholder:text-gray-500 py-1"
                    style={{ maxHeight: '160px' }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isProcessing}
                    className="absolute bottom-3 right-4 size-8 rounded-full bg-white hover:bg-gray-200 disabled:bg-[#2a2a2a] disabled:text-gray-600 flex items-center justify-center transition-colors"
                  >
                    {isProcessing ? (
                      <Loader2 className="size-4 animate-spin text-black" />
                    ) : (
                      <Send className="size-4 text-black" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Main Mode - Header, Chunks, and Composer */
          <>
            {/* Header Row */}
            <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-[#00ff88]/20 flex items-center justify-center">
              <MessageSquare className="size-5 text-[#00ff88]" />
            </div>
            <div>
              <h1 className="text-lg">Local Chat</h1>
              <p className="text-sm text-gray-400">Review raw footage and replay locally</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {cachedCount > 0 && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0a0a0a] border border-[#1a1a1a]">
                <Database className="size-4 text-gray-400" />
                <span className="text-sm text-gray-300">{cachedCount} cached</span>
              </div>
            )}
            <button
              onClick={handleNewChat}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00ff88] text-black hover:bg-[#00ff88]/90 transition-colors"
            >
              <Plus className="size-4" />
              <span>New chat</span>
            </button>
          </div>
        </div>

        {/* Chunks Strip */}
        <div className="mb-6 rounded-xl bg-[#0a0a0a] border border-[#1a1a1a] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Chunks</span>
              <span className="text-sm text-gray-400">{chunks.length}</span>
              {isLocked && (
                <span className="text-xs text-gray-500">Locked</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSearchOpen(!isSearchOpen)}
                className={`p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors ${isSearchOpen ? 'bg-[#1a1a1a]' : ''}`}
              >
                <Search className="size-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors">
                <RefreshCw className="size-4" />
              </button>
            </div>
          </div>

          {isSearchOpen && (
            <div className="px-4 py-3 border-b border-[#1a1a1a]">
              <input
                type="text"
                placeholder="Filter by filename, date, or time..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#070707] border border-[#1a1a1a] focus:outline-none focus:border-[#00ff88] text-sm"
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <div className="flex gap-3 p-4 min-w-max">
              {filteredChunks.map((chunk, index) => {
                const isSelected = selectedChunkIds.includes(chunk.id);
                const isActive = activeChunkId === chunk.id;
                const selectionOrder = selectedChunkIds.indexOf(chunk.id) + 1;
                const isDisabled = isLocked && !lockedIds.includes(chunk.id);

                return (
                  <div
                    key={chunk.id}
                    onClick={() => handleChunkClick(chunk.id)}
                    onDoubleClick={() => handleChunkDoubleClick(chunk.id)}
                    className={`w-[180px] rounded-lg overflow-hidden cursor-pointer transition-all ${
                      isDisabled ? 'opacity-30 cursor-not-allowed' : ''
                    } ${isSelected ? 'ring-2 ring-[#00ff88]' : 'border border-[#1a1a1a]'} ${
                      isActive ? 'shadow-lg shadow-[#00ff88]/20' : ''
                    }`}
                  >
                    <div className="aspect-video bg-[#0d0d0d] relative">
                      {chunk.thumbnailUrl ? (
                        <img src={chunk.thumbnailUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="size-full flex items-center justify-center">
                          <Film className="size-8 text-gray-600" />
                        </div>
                      )}

                      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />

                      {chunk.blobUrl && (
                        <div className="absolute top-2 left-2 px-2 py-1 rounded bg-[#00ff88]/90 text-black text-xs font-medium">
                          Local cache
                        </div>
                      )}

                      {isSelected && selectionOrder > 0 && (
                        <div className="absolute top-2 right-2 size-6 rounded-full bg-[#00ff88] text-black flex items-center justify-center text-xs font-bold">
                          {selectionOrder}
                        </div>
                      )}

                      {isActive && (
                        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-full bg-[#00ff88] text-black text-xs font-medium">
                          Active
                        </div>
                      )}

                      {chunk.isLive && (
                        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500 text-white text-xs font-medium">
                          <span className="size-1.5 bg-white rounded-full animate-pulse" />
                          LIVE
                        </div>
                      )}
                    </div>

                    <div className="p-3 bg-[#0a0a0a]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{chunk.date}</span>
                        <span className="text-gray-500">{chunk.fileSize}</span>
                      </div>
                      <div className="text-sm text-gray-200 mt-1">{chunk.time}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Composer */}
        <div className="flex-1 min-h-0 flex items-end p-6">
            <div className="w-full">
              <div className="relative px-4 py-3 rounded-3xl bg-[#1a1a1a] border border-[#2a2a2a] focus-within:border-[#00ff88] transition-colors">
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Message Local Chat"
                  rows={1}
                  className="w-full pr-12 bg-transparent resize-none focus:outline-none text-white placeholder:text-gray-500 py-1"
                  style={{ maxHeight: '160px' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isProcessing}
                  className="absolute bottom-3 right-4 size-8 rounded-full bg-white hover:bg-gray-200 disabled:bg-[#2a2a2a] disabled:text-gray-600 flex items-center justify-center transition-colors"
                >
                  {isProcessing ? (
                    <Loader2 className="size-4 animate-spin text-black" />
                  ) : (
                    <Send className="size-4 text-black" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3 mt-3 px-2">
                <div className={`text-xs ${
                  selectedChunkIds.length > 0 ? 'text-[#00ff88]' : 'text-gray-500'
                }`}>
                  {selectedChunkIds.length} chunks selected
                </div>
                <div className="text-gray-700">•</div>
                <div className="relative">
                  <select
                    value={cameraScope}
                    onChange={(e) => setCameraScope(e.target.value)}
                    className="appearance-none pl-2 pr-6 py-1 rounded bg-transparent text-xs text-gray-400 cursor-pointer focus:outline-none"
                    disabled={isLocked}
                  >
                    <option value="all">All cameras</option>
                    <option value="slot-1">Camera 1</option>
                    <option value="slot-2">Camera 2</option>
                    <option value="slot-3">Camera 3</option>
                  </select>
                  <ChevronDown className="size-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500" />
                </div>
                {isLocked && (
                  <>
                    <div className="text-gray-700">•</div>
                    <span className="text-xs text-gray-500">Session locked</span>
                  </>
                )}
              </div>
            </div>
          </div>
          </>
        )}

        {/* Video Overlay */}
        {videoOverlay.isOpen && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="w-full max-w-5xl bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl overflow-hidden">
              {/* Overlay Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a1a]">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Video Playback</span>
                  {videoOverlay.chunkId && (
                    <span className="text-sm text-gray-400">
                      {chunks.find(c => c.id === videoOverlay.chunkId)?.date} • {chunks.find(c => c.id === videoOverlay.chunkId)?.time}
                    </span>
                  )}
                </div>
                <button
                  onClick={closeVideoOverlay}
                  className="p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Video Player */}
              <div className="p-6">
                <video
                  ref={overlayVideoRef}
                  className="w-full aspect-video bg-black rounded-lg"
                  controls
                  autoPlay
                  playsInline
                  crossOrigin="anonymous"
                  src={chunks.find(c => c.id === videoOverlay.chunkId)?.blobUrl || chunks.find(c => c.id === videoOverlay.chunkId)?.videoUrl}
                />

                {/* Timestamps */}
                {videoOverlay.timestamps.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-medium mb-3">Timestamps</h3>
                    <div className="flex flex-wrap gap-2">
                      {videoOverlay.timestamps.map((ts, i) => (
                        <button
                          key={i}
                          onClick={() => handleOverlayTimestampClick(ts)}
                          className="px-3 py-2 rounded-lg bg-[#1a1a1a] hover:bg-[#00ff88]/20 hover:text-[#00ff88] text-sm transition-colors border border-[#2a2a2a]"
                        >
                          {ts}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
