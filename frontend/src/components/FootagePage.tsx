import React from "react";
import { useEffect, useRef, useState } from "react";
import { Film, Loader2, RotateCcw, Send } from "lucide-react";
import { API_BASE_URL, getAuthToken, rawFootageApi, RawFootageItem } from "../services/api";

interface Timestamp {
  seconds: number;
  display: string;
  original: string;
}

interface FootageAnalysisResult {
  video_url: string;
  local_path: string | null;
  analysis: string | null;
  error: string | null;
  timestamps?: Timestamp[];
}

export function FootagePage({
  onArchive,
}: {
  onArchive?: (userText: string, botText: string) => void;
}) {
  const [chunks, setChunks] = useState<RawFootageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<{ query: string; results: FootageAnalysisResult[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);

  useEffect(() => {
    loadFootage();
  }, []);

  // When chunks first load, automatically select and show the newest chunk
  useEffect(() => {
    if (chunks.length > 0 && selectedIds.size === 0) {
      const firstId = chunks[0].id;
      setSelectedIds(new Set([firstId]));
      setActiveChunkId(firstId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks]);

  async function loadFootage() {
    setLoading(true);
    try {
      const res = await rawFootageApi.list();
      setChunks(res.chunks || []);
    } catch (e) {
      console.error("Failed to load footage:", e);
      setChunks([]);
    } finally {
      setLoading(false);
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
    setActiveChunkId(id);
  };

  const playUrlForChunk = (item: RawFootageItem): string => {
    const token = getAuthToken();
    // Always prefer backend streaming endpoint to avoid R2 CORS issues
    return `${API_BASE_URL}/raw/videos/${encodeURIComponent(item.filename)}${
      token ? `?token=${encodeURIComponent(token)}` : ""
    }`;
  };

  const playUrlForId = (id: string | null): string | null => {
    if (!id) return null;
    const item = chunks.find(c => c.id === id);
    return item ? playUrlForChunk(item) : null;
  };

  const primaryPlayUrl = playUrlForId(activeChunkId);

  // Timestamp parsing (same patterns as ChatPage)
  const parseTimestamps = (text: string | null): Timestamp[] => {
    if (!text) return [];
    const timestamps: Timestamp[] = [];

    // HH:MM:SS
    const hmsPattern = /(\d{1,2}):(\d{2}):(\d{2})/g;
    let match: RegExpExecArray | null;
    while ((match = hmsPattern.exec(text)) !== null) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      timestamps.push({
        seconds: totalSeconds,
        display: match[0],
        original: match[0],
      });
    }

    // MM:SS
    const msPattern = /(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$|[^\d:])/g;
    while ((match = msPattern.exec(text)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      if (minutes < 60) {
        const totalSeconds = minutes * 60 + seconds;
        if (!timestamps.some(t => t.seconds === totalSeconds)) {
          timestamps.push({
            seconds: totalSeconds,
            display: match[0].trim(),
            original: match[0].trim(),
          });
        }
      }
    }

    // X minutes Y seconds
    const minutesSecondsPattern =
      /(\d+)\s*(?:minutes?|mins?|m)\s*(?:and\s*)?(\d+)?\s*(?:seconds?|secs?|s)?/gi;
    while ((match = minutesSecondsPattern.exec(text)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = match[2] ? parseInt(match[2], 10) : 0;
      const totalSeconds = minutes * 60 + seconds;
      if (!timestamps.some(t => t.seconds === totalSeconds)) {
        timestamps.push({
          seconds: totalSeconds,
          display: `${minutes}:${seconds.toString().padStart(2, "0")}`,
          original: match[0],
        });
      }
    }

    // X seconds
    const secondsPattern = /(\d+)\s*(?:seconds?|secs?|s)(?:\s|$|[^\d])/gi;
    while ((match = secondsPattern.exec(text)) !== null) {
      const seconds = parseInt(match[1], 10);
      if (!timestamps.some(t => t.seconds === seconds)) {
        timestamps.push({
          seconds,
          display: `0:${seconds.toString().padStart(2, "0")}`,
          original: match[0],
        });
      }
    }

    const unique: Timestamp[] = [];
    const seen = new Set<number>();
    timestamps
      .sort((a, b) => a.seconds - b.seconds)
      .forEach(t => {
        if (!seen.has(t.seconds)) {
          seen.add(t.seconds);
          unique.push(t);
        }
      });
    return unique;
  };

  const handleSubmit = async () => {
    if (!query.trim() || selectedIds.size < 1) return;
    const trimmed = query.trim();
    setSubmitting(true);
    try {
      const chunkIds = Array.from(selectedIds);
      const res = await rawFootageApi.queryChunks(trimmed, chunkIds);
      const resultsWithTimestamps: FootageAnalysisResult[] = res.results.map(r => ({
        ...r,
        timestamps: parseTimestamps(r.analysis),
      }));
      setResponse({ query: res.query, results: resultsWithTimestamps });

      // Archive as a simple two-message conversation
      if (onArchive) {
        const botText =
          resultsWithTimestamps.length === 0
            ? "No analysis results."
            : resultsWithTimestamps
                .map((r, idx) => {
                  const header = `Footage ${idx + 1} (${r.local_path || "unknown"}):`;
                  const body = r.analysis || r.error || "No analysis available.";
                  return `${header}\n${body}`;
                })
                .join("\n\n---\n\n");
        onArchive(trimmed, botText);
      }
    } catch (e) {
      console.error("Query failed:", e);
      const errorText = String(e);
      setResponse({
        query: trimmed,
        results: [
          {
            video_url: "",
            local_path: null,
            analysis: null,
            error: errorText,
            timestamps: [],
          },
        ],
      });
      if (onArchive) {
        onArchive(trimmed, `Error running footage query: ${errorText}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleJumpToTimestamp = (seconds: number, chunkId: string | null) => {
    // If we're already on this chunk and the video element is ready, seek immediately
    if (videoRef.current && (!chunkId || chunkId === activeChunkId)) {
      videoRef.current.currentTime = seconds;
      videoRef.current
        .play()
        .catch(() => {
          /* ignore autoplay errors */
        });
      return;
    }

    // Otherwise switch chunk (if provided) and defer the seek until metadata loads
    if (chunkId) {
      setActiveChunkId(chunkId);
    }
    pendingSeekRef.current = seconds;
  };

  const handleVideoLoaded = () => {
    if (pendingSeekRef.current != null && videoRef.current) {
      videoRef.current.currentTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
      videoRef.current
        .play()
        .catch(() => {
          /* ignore autoplay errors */
        });
    }
  };

  const selectedCount = selectedIds.size;
  const analysisResults = response && Array.isArray(response.results) ? response.results : [];

  return (
    <div className="flex flex-col min-h-[calc(100vh-2rem)] max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-white font-semibold">Raw Footage</h1>
          <p className="text-gray-500 text-sm mt-1">
            Select 1 or 2 chunks, play footage, then ask targeted questions.
          </p>
        </div>
        <div className="text-xs text-gray-500">
          {selectedCount}/2 selected
        </div>
      </div>

      {/* Video area */}
      <div className="mb-5 rounded-2xl border border-[#1a1a1a] bg-gradient-to-b from-black via-black to-[#050505] overflow-hidden relative aspect-video max-h-[60vh]">
        {primaryPlayUrl ? (
          <video
            ref={videoRef}
            key={primaryPlayUrl}
            src={primaryPlayUrl}
            controls
            className="w-full h-full object-contain bg-black"
            crossOrigin="anonymous"
            playsInline
            onLoadedMetadata={handleVideoLoaded}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 gap-2">
            <Film className="w-8 h-8 text-gray-600" />
            <p className="text-sm">Select a chunk below to start playback</p>
          </div>
        )}
      </div>

      {/* Chunk timeline */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-gray-400 text-[11px] tracking-wide uppercase">
            <span>Chunks</span>
            <span className="text-gray-600">•</span>
            <span>Newest first</span>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 py-4">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading raw footage…
          </div>
        ) : chunks.length === 0 ? (
          <p className="text-gray-500 py-4 text-sm">
            No raw footage yet. Start a raw recording in Settings.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {chunks.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  toggleSelect(c.id);
                  setActiveChunkId(c.id);
                }}
                className={`min-w-[120px] px-3 py-2 rounded-xl text-left transition-colors border ${
                  selectedIds.has(c.id)
                    ? "border-white bg-white/5 text-white"
                    : "border-[#1a1a1a] bg-[#0b0b0b] text-gray-300 hover:border-[#2a2a2a]"
                }`}
              >
                <div className="text-[11px] text-gray-500">{c.date}</div>
                <div className="text-sm font-medium">{c.time}</div>
                {c.size_bytes > 0 && (
                  <div className="text-[11px] text-gray-500 mt-1">
                    {(c.size_bytes / 1024 / 1024).toFixed(1)} MB
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Analysis results below chunk cards */}
      {analysisResults.length > 0 && (
        <div className="mb-4 rounded-2xl border border-[#1a1a1a] bg-[#050505] px-4 py-3 space-y-3 max-h-80 md:max-h-96 overflow-y-auto overflow-x-hidden">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">
                Analysis
              </p>
              {response?.query && (
                <p className="text-sm text-white mt-0.5 line-clamp-2">
                  “{response.query}”
                </p>
              )}
            </div>
          </div>
          <div className="space-y-3">
            {analysisResults.map((r, i) => (
              <div
                key={i}
                className="rounded-xl border border-[#1e1e1e] bg-[#050505] p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-500">
                    Footage {i + 1}
                    {r.local_path ? ` • ${r.local_path}` : ""}
                  </div>
                  {r.timestamps && r.timestamps.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {r.timestamps.slice(0, 6).map((t, idx) => (
                        <button
                          key={`${t.seconds}-${idx}`}
                          type="button"
                          onClick={() =>
                            handleJumpToTimestamp(t.seconds, r.local_path)
                          }
                          className="px-2 py-0.5 rounded-full text-[11px] bg-[#111111] hover:bg-[#1f1f1f] text-gray-200 border border-[#2a2a2a] transition-colors"
                        >
                          {t.display}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {r.error && (
                  <p className="text-xs text-red-400">{r.error}</p>
                )}
                {r.analysis && (
                  <pre
                    className="w-full max-w-full text-[13px] text-gray-200 whitespace-pre-wrap break-words font-sans leading-relaxed overflow-y-auto overflow-x-hidden"
                  >
                    {r.analysis}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Query input */}
      <div className="mt-auto pt-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Ask something about the selected chunk(s)…"
            className="flex-1 bg-[#050505] border border-[#1a1a1a] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            disabled={selectedCount < 1 || submitting}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={selectedCount < 1 || !query.trim() || submitting}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#00ff88] text-[#050505] text-sm font-medium hover:bg-[#00e67b] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
            Query
          </button>
        </div>
        {selectedCount < 1 && (
          <p className="text-gray-600 text-xs mt-2">
            Select 1 or 2 chunks above to enable querying.
          </p>
        )}
      </div>
    </div>
  );
}
