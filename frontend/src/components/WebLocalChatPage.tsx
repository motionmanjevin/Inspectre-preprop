import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Film,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import {
  API_BASE_URL,
  billingApi,
  getAuthToken,
  rawFootageApi,
  type AnalysisResult,
  type BillingState,
  type CameraScopeOption,
  type RawFootageItem,
} from "../services/api";

interface Timestamp {
  seconds: number;
  display: string;
}

interface UserMsg {
  id: string;
  type: "user";
  content: string;
  cameraScope: string;
  chunkCount: number;
}

interface BotMsg {
  id: string;
  type: "bot";
  content: string;
  chunkId: string | null;
  chunkLabel: string;
  timestamps: Timestamp[];
  error: string | null;
  /** Original user query for this analysis job (used for per-chunk retry). */
  sourceQuery?: string;
  /** Raw footage job id for this turn (enables retry gating until the full job finishes). */
  jobTurnId?: string;
  /** True while a per-chunk retry is in flight. */
  retrying?: boolean;
}

interface SystemMsg {
  id: string;
  type: "system";
  content: string;
  loading?: boolean;
  isError?: boolean;
}

type Message = UserMsg | BotMsg | SystemMsg;

function latestTimestampsForChunk(messages: Message[], chunkId: string): Timestamp[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === "bot" && m.chunkId === chunkId && m.timestamps.length > 0) {
      return m.timestamps;
    }
  }
  return [];
}

interface VideoOverlayState {
  isOpen: boolean;
  chunkId: string | null;
  timestamps: Timestamp[];
  currentTime?: number;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function parseChunkStartDateTime(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Wall-clock span for a chunk card (start – end from filename start + duration). */
function chunkTimeIntervalLabel(item: RawFootageItem): string {
  if (item.is_live) {
    const end = parseChunkStartDateTime(item.date, item.time);
    const done = item.segments_done ?? 0;
    if (!end || done <= 0) return `${item.time} · live`;
    const start = new Date(end.getTime() - done * 60_000);
    return `${formatClock(start)} – ${formatClock(end)}`;
  }
  const start = parseChunkStartDateTime(item.date, item.time);
  const dur = item.duration_seconds;
  if (!start) return item.time;
  if (!dur || dur <= 0 || !Number.isFinite(dur)) return `${item.time} – …`;
  const end = new Date(start.getTime() + dur * 1000);
  const a = formatClock(start);
  const b = formatClock(end);
  if (start.toDateString() === end.toDateString()) return `${a} – ${b}`;
  return `${a} – ${b} (+1)`;
}

function thumbnailUrl(item: RawFootageItem): string | null {
  if (item.is_live || !item.filename) return null;
  const token = getAuthToken();
  return `${API_BASE_URL}/raw/thumbnails/${encodeURIComponent(item.filename)}${
    token ? `?token=${encodeURIComponent(token)}` : ""
  }`;
}

function streamUrl(item: RawFootageItem): string {
  if (item.is_live) return "";
  const token = getAuthToken();
  return `${API_BASE_URL}/raw/videos/${encodeURIComponent(item.filename)}${
    token ? `?token=${encodeURIComponent(token)}` : ""
  }`;
}

/** Modal video player size (px). Live hour uses temp R2 concat at same display size. */
const VIDEO_OVERLAY_PLAYER_W = 600;
const VIDEO_OVERLAY_PLAYER_H = 400;

/** Timestamp jump chips: explicit color/weight so labels stay deep black under page `text-white`. */
const TIMESTAMP_BTN_STYLE: React.CSSProperties = {
  color: "#050505",
  fontWeight: 900,
  WebkitFontSmoothing: "antialiased",
};

const TIMESTAMP_BTN_CLASS =
  "rounded-none bg-[#00ff88] px-4 py-2 text-sm font-black shadow-sm tracking-tight";

/** Fake “almost done” progress while waiting for raw analysis (UX only, not tied to backend). */
const ANALYSIS_PROGRESS_DURATION_MS = 120_000;
const ANALYSIS_PROGRESS_TICK_MS = 150;

/** 16:9 SVG used as the live chunk card image (no server thumbnail). */
const LIVE_CHUNK_PLACEHOLDER_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#161616"/>
          <stop offset="100%" stop-color="#0a0a0a"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#bg)"/>
      <rect x="24" y="54" width="272" height="72" rx="6" fill="none" stroke="#2a2a2a" stroke-width="2"/>
      <path d="M138 78 L138 102 L158 90 Z" fill="#404040"/>
      <circle cx="160" cy="90" r="22" fill="none" stroke="#333" stroke-width="2"/>
    </svg>`,
  );

function parseTimestamps(text: string | null): Timestamp[] {
  if (!text) return [];
  const out: Timestamp[] = [];
  const seen = new Set<number>();
  const add = (seconds: number, display: string) => {
    if (Number.isNaN(seconds) || seconds < 0 || seen.has(seconds)) return;
    seen.add(seconds);
    out.push({ seconds, display });
  };
  let m: RegExpExecArray | null;
  const hms = /(\d{1,2}):(\d{2}):(\d{2})/g;
  while ((m = hms.exec(text)) !== null) {
    add(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), m[0]);
  }
  const ms = /(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$|[^\d:])/g;
  while ((m = ms.exec(text)) !== null) {
    const minutes = Number(m[1]);
    if (minutes < 60) add(minutes * 60 + Number(m[2]), `${minutes}:${m[2]}`);
  }
  return out.sort((a, b) => a.seconds - b.seconds);
}

function cleanAnalysisLine(line: string): string {
  return line
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderAnalysisContent(content: string): React.ReactNode {
  const lines = content.split(/\r?\n/).map((line) => cleanAnalysisLine(line)).filter(Boolean);
  if (lines.length === 0) return null;

  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul
        key={`bullets-${out.length}`}
        className="my-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-gray-100"
      >
        {bullets.map((item, idx) => (
          <li key={`b-${idx}`}>{item}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of lines) {
    const bulletMatch = raw.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bulletMatch) {
      bullets.push(bulletMatch[1].trim());
      continue;
    }

    flushBullets();

    const headingMatch = raw.match(/^#{1,6}\s*(.+)$/);
    if (headingMatch) {
      out.push(
        <h4 key={`h-${out.length}`} className="mt-3 text-sm font-semibold text-[#8ef3c3]">
          {headingMatch[1]}
        </h4>,
      );
      continue;
    }

    const keyValue = raw.match(/^([A-Za-z][A-Za-z0-9 _/()-]{1,40}):\s*(.+)$/);
    if (keyValue) {
      out.push(
        <div key={`kv-${out.length}`} className="my-1 text-[14px] leading-relaxed">
          <span className="font-semibold text-[#8ef3c3]">{keyValue[1]}: </span>
          <span className="text-gray-100">{keyValue[2]}</span>
        </div>,
      );
      continue;
    }

    out.push(
      <p key={`p-${out.length}`} className="my-2 text-[14px] leading-relaxed text-gray-100">
        {raw}
      </p>,
    );
  }

  flushBullets();
  return <>{out}</>;
}

export function WebLocalChatPage() {
  const [chunks, setChunks] = useState<RawFootageItem[]>([]);
  const [chunksLoading, setChunksLoading] = useState(true);

  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>([]);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [isLocked, setIsLocked] = useState(false);

  const [cameraScopeOptions, setCameraScopeOptions] = useState<CameraScopeOption[]>([
    { id: "all", label: "All cameras" },
  ]);
  const [cameraScope, setCameraScope] = useState("all");

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisWaitUi, setAnalysisWaitUi] = useState<{
    phase: "idle" | "filling" | "overflow";
    progress: number;
  }>({ phase: "idle", progress: 0 });
  const analysisProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analysisProgressStartRef = useRef<number | null>(null);
  const [isChatMode, setIsChatMode] = useState(false);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>("");

  const [videoOverlay, setVideoOverlay] = useState<VideoOverlayState>({
    isOpen: false,
    chunkId: null,
    timestamps: [],
  });
  const [overlayMediaError, setOverlayMediaError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** Public URLs returned from raw analysis (e.g. R2 temp concat for `__live__`); not served via /raw/videos. */
  const [analysisPlaybackUrlByChunkId, setAnalysisPlaybackUrlByChunkId] = useState<
    Record<string, string>
  >({});
  /** Job ids (turns) whose multi-chunk analysis has fully finished — enables per-chunk retry. */
  const [completedAnalysisJobTurnIds, setCompletedAnalysisJobTurnIds] = useState<
    Record<string, true>
  >({});

  const [billingState, setBillingState] = useState<BillingState | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  const refreshBillingState = useCallback(async () => {
    if (!getAuthToken()) {
      setBillingState(null);
      setBillingLoading(false);
      return;
    }
    setBillingLoading(true);
    try {
      const s = await billingApi.getState();
      setBillingState(s);
    } catch {
      setBillingState(null);
    } finally {
      setBillingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChunks();
    void loadCameraScopeOptions();
    void refreshBillingState();
  }, [refreshBillingState]);

  const billingStatusEl = getAuthToken() ? (
    <div className="max-w-[11rem] shrink-0 text-right text-[11px] leading-snug text-gray-400 sm:max-w-none sm:text-xs">
      {billingLoading && !billingState ? (
        <Loader2 className="ml-auto size-4 animate-spin text-gray-500" aria-label="Loading balance" />
      ) : billingState ? (
        <>
          <div>
            Credits{" "}
            <span className="font-bold tabular-nums text-white">{billingState.query_credits}</span>
            {billingState.free_queries_remaining > 0 ? (
              <>
                {" "}
                · Free{" "}
                <span className="font-bold tabular-nums text-white">{billingState.free_queries_remaining}</span>
              </>
            ) : null}
            {billingState.subscription_status === "premium" ? (
              <span className="ml-1 font-medium text-[#00ff88]">Premium</span>
            ) : null}
          </div>
          <div className="text-gray-500">
            Autopilot{" "}
            <span className="font-bold tabular-nums text-gray-300">
              {billingState.free_autopilot_remaining}
            </span>
          </div>
        </>
      ) : (
        <span className="text-gray-600" title="Could not load billing">
          Balance unavailable
        </span>
      )}
    </div>
  ) : null;

  const stopAnalysisProgressAnim = () => {
    if (analysisProgressIntervalRef.current != null) {
      clearInterval(analysisProgressIntervalRef.current);
      analysisProgressIntervalRef.current = null;
    }
    analysisProgressStartRef.current = null;
    setAnalysisWaitUi({ phase: "idle", progress: 0 });
  };

  const startAnalysisProgressAnim = () => {
    stopAnalysisProgressAnim();
    const start = Date.now();
    analysisProgressStartRef.current = start;
    setAnalysisWaitUi({ phase: "filling", progress: 0 });
    analysisProgressIntervalRef.current = setInterval(() => {
      const t0 = analysisProgressStartRef.current;
      if (t0 == null) return;
      const elapsed = Date.now() - t0;
      if (elapsed >= ANALYSIS_PROGRESS_DURATION_MS) {
        if (analysisProgressIntervalRef.current != null) {
          clearInterval(analysisProgressIntervalRef.current);
          analysisProgressIntervalRef.current = null;
        }
        setAnalysisWaitUi({ phase: "overflow", progress: 1 });
        return;
      }
      const p = elapsed / ANALYSIS_PROGRESS_DURATION_MS;
      setAnalysisWaitUi({ phase: "filling", progress: p });
    }, ANALYSIS_PROGRESS_TICK_MS);
  };

  useEffect(() => {
    return () => stopAnalysisProgressAnim();
  }, []);

  // Only follow the bottom while the user is already near the bottom; do not tie to
  // analysis progress ticks (those caused constant smooth-scroll fights during multi-chunk jobs).
  useEffect(() => {
    if (!isChatMode) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const thresholdPx = 120;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= thresholdPx) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isChatMode]);

  useEffect(() => {
    const ta = isChatMode ? textareaRef.current : composerRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }
  }, [inputValue, isChatMode]);

  useEffect(() => {
    if (videoOverlay.isOpen) setOverlayMediaError(null);
  }, [videoOverlay.isOpen, videoOverlay.chunkId]);

  useEffect(() => {
    if (videoOverlay.isOpen && overlayVideoRef.current && videoOverlay.currentTime != null) {
      const video = overlayVideoRef.current;
      const apply = () => {
        video.currentTime = videoOverlay.currentTime as number;
        void video.play().catch(() => undefined);
      };
      if (video.readyState >= 1) apply();
      else video.addEventListener("loadedmetadata", apply, { once: true });
    }
  }, [videoOverlay.isOpen, videoOverlay.currentTime, videoOverlay.chunkId]);

  async function loadChunks() {
    setChunksLoading(true);
    try {
      const res = await rawFootageApi.list();
      setChunks(res.chunks || []);
    } catch (err) {
      console.error("Failed to load footage:", err);
      setChunks([]);
    } finally {
      setChunksLoading(false);
    }
  }

  async function loadCameraScopeOptions() {
    try {
      const res = await rawFootageApi.cameraScope();
      if (Array.isArray(res.options) && res.options.length > 0) {
        setCameraScopeOptions(res.options);
      }
    } catch (err) {
      console.debug("Failed to load camera scope options:", err);
    }
  }

  const availableChunkDates = useMemo(() => {
    const seen = new Set<string>();
    const dates: string[] = [];
    for (const c of chunks) {
      const d = (c.date || "").trim();
      if (!d || seen.has(d)) continue;
      seen.add(d);
      dates.push(d);
    }
    return dates;
  }, [chunks]);

  useEffect(() => {
    if (availableChunkDates.length === 0) {
      if (selectedDateFilter) setSelectedDateFilter("");
      return;
    }
    if (!selectedDateFilter || !availableChunkDates.includes(selectedDateFilter)) {
      setSelectedDateFilter(availableChunkDates[0]);
    }
  }, [availableChunkDates, selectedDateFilter]);

  useEffect(() => {
    if (!selectedDateFilter) return;
    const allowed = new Set(
      chunks.filter((c) => c.date === selectedDateFilter).map((c) => c.id),
    );
    setSelectedChunkIds((prev) => prev.filter((id) => allowed.has(id)));
    setActiveChunkId((prev) => (prev && allowed.has(prev) ? prev : null));
  }, [chunks, selectedDateFilter]);

  const filteredChunks = useMemo(() => {
    const dateFiltered = selectedDateFilter
      ? chunks.filter((c) => c.date === selectedDateFilter)
      : chunks;
    const q = searchFilter.trim().toLowerCase();
    if (!q) return dateFiltered;
    return dateFiltered.filter((c) =>
      [c.filename, c.date, c.time, chunkTimeIntervalLabel(c)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [chunks, searchFilter, selectedDateFilter]);

  const currentScopeLabel = useMemo(() => {
    const opt = cameraScopeOptions.find((o) => o.id === cameraScope);
    return opt?.label || "All cameras";
  }, [cameraScopeOptions, cameraScope]);

  const chunkLabelById = (id: string | null): string => {
    if (!id) return "Unknown";
    const item = chunks.find((c) => c.id === id);
    if (!item) return id;
    if (item.is_live) return `Live · ${chunkTimeIntervalLabel(item)}`;
    return `${item.date} · ${chunkTimeIntervalLabel(item)}`;
  };

  const playUrlForId = (id: string | null): string | null => {
    if (!id) return null;
    const item = chunks.find((c) => c.id === id);
    if (!item) return null;
    if (item.is_live) {
      const fromAnalysis = analysisPlaybackUrlByChunkId[id];
      if (fromAnalysis && /^https?:\/\//i.test(fromAnalysis)) return fromAnalysis;
      if (item.video_url && /^https?:\/\//i.test(item.video_url)) return item.video_url;
      return null;
    }
    const token = getAuthToken();
    if (token) return streamUrl(item);
    // No JWT in this session: local /raw/videos would 401 — use public R2 URL if present.
    if (item.video_url && /^https?:\/\//i.test(item.video_url)) return item.video_url;
    return streamUrl(item);
  };

  const cameraScopeSlots = (): number[] | null => {
    if (cameraScope === "all") return null;
    const m = cameraScope.match(/^slot-(\d)$/);
    return m ? [Number(m[1])] : null;
  };

  const resolveChunkIdFromResult = (result: AnalysisResult): string | null => {
    if (result.local_path) {
      const byId = chunks.find((c) => c.id === result.local_path);
      if (byId) return byId.id;
      const byFile = chunks.find((c) => c.filename === result.local_path);
      if (byFile) return byFile.id;
    }
    if (result.video_url) {
      try {
        const maybeFile = decodeURIComponent(result.video_url.split("/").pop() || "");
        const byFile = chunks.find((c) => c.filename === maybeFile);
        if (byFile) return byFile.id;
      } catch {
        // ignore
      }
    }
    return null;
  };

  const handleChunkClick = (chunkId: string) => {
    if (isLocked && !lockedIds.includes(chunkId)) return;
    setSelectedChunkIds((prev) =>
      prev.includes(chunkId) ? prev.filter((id) => id !== chunkId) : [...prev, chunkId],
    );
  };

  const handleChunkDoubleClick = (chunkId: string) => {
    setVideoOverlay({
      isOpen: true,
      chunkId,
      timestamps: latestTimestampsForChunk(messages, chunkId),
    });
  };

  const handleNewChat = () => {
    stopAnalysisProgressAnim();
    setMessages([]);
    setIsLocked(false);
    setLockedIds([]);
    setInputValue("");
    setIsChatMode(false);
    setVideoOverlay({ isOpen: false, chunkId: null, timestamps: [] });
    setOverlayMediaError(null);
    setAnalysisPlaybackUrlByChunkId({});
    setCompletedAnalysisJobTurnIds({});
  };

  const handleBackToMain = () => {
    handleNewChat();
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isProcessing) return;
    const chunkIdsToUse = isLocked ? lockedIds : selectedChunkIds;
    if (chunkIdsToUse.length === 0) return;

    const trimmed = inputValue.trim();
    const userMessage: UserMsg = {
      id: `user-${Date.now()}`,
      type: "user",
      content: trimmed,
      cameraScope: currentScopeLabel,
      chunkCount: chunkIdsToUse.length,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsChatMode(true);

    if (!isLocked) {
      setIsLocked(true);
      setLockedIds(chunkIdsToUse);
    }

    const systemId = `sys-${Date.now()}`;
    const systemMessage: SystemMsg = {
      id: systemId,
      type: "system",
      content: "Analyzing...",
      loading: true,
    };
    setMessages((prev) => [...prev, systemMessage]);
    setInputValue("");
    setIsProcessing(true);
    startAnalysisProgressAnim();

    const liveChunkIds = chunkIdsToUse.filter((cid) => {
      const c = chunks.find((x) => x.id === cid);
      return c?.is_live === true || cid === "__live__";
    });
    if (liveChunkIds.length > 0) {
      setAnalysisPlaybackUrlByChunkId((prev) => {
        const next = { ...prev };
        for (const cid of liveChunkIds) delete next[cid];
        return next;
      });
    }

    let currentJobTurnId: string | null = null;
    try {
      const start = await rawFootageApi.startJob(trimmed, chunkIdsToUse, cameraScopeSlots());
      currentJobTurnId = String(start.job_id);

      let done = false;
      const turnId = currentJobTurnId;
      let lastPollCompletedChunks = -1;
      while (!done) {
        const status = await rawFootageApi.getJob(start.job_id);
        const jobTerminal = status.status === "completed" || status.status === "failed";

        if (
          lastPollCompletedChunks >= 0 &&
          status.completed_chunks > lastPollCompletedChunks &&
          !jobTerminal
        ) {
          startAnalysisProgressAnim();
        }
        lastPollCompletedChunks = status.completed_chunks;

        for (const r of status.results || []) {
          const url = (r.video_url || "").trim();
          if (!url || !/^https?:\/\//i.test(url)) continue;
          const lp = r.local_path;
          if (!lp) continue;
          const isLiveResult = lp === "__live__" || !!chunks.find((c) => c.id === lp)?.is_live;
          if (isLiveResult) {
            setAnalysisPlaybackUrlByChunkId((prev) =>
              prev[lp] === url ? prev : { ...prev, [lp]: url },
            );
          }
        }

        const enrichedBots: BotMsg[] = (status.results || []).map((r, idx) => {
          const chunkId = resolveChunkIdFromResult(r);
          return {
            id: `${turnId}-bot-${idx}`,
            type: "bot",
            chunkId,
            chunkLabel: chunkLabelById(chunkId) || `Chunk ${idx + 1}`,
            content: r.analysis ?? "",
            timestamps: parseTimestamps(r.analysis),
            error: r.error ?? null,
            sourceQuery: trimmed,
            jobTurnId: turnId,
          };
        });

        const denom = Math.max(1, status.total_chunks);
        const progressLabel = `${Math.min(status.completed_chunks + 1, denom)}/${denom}`;

        setMessages((prev) => {
          let next = prev.filter((m) => !(m.type === "bot" && m.id.startsWith(`${turnId}-bot-`)));
          if (jobTerminal) {
            next = next.filter((m) => m.id !== systemId);
          } else {
            next = next.map((m) =>
              m.type === "system" && m.id === systemId && m.loading
                ? { ...m, content: `Analyzing… (${progressLabel})` }
                : m,
            );
          }
          return [...next, ...enrichedBots];
        });

        if (jobTerminal) {
          done = true;
          if (status.status === "failed") {
            setMessages((prev) => [
              ...prev,
              {
                id: `err-${Date.now()}`,
                type: "system",
                content: status.error || "Analysis job failed.",
                isError: true,
              },
            ]);
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== systemId),
        {
          id: `err-${Date.now()}`,
          type: "system",
          content: errorText,
          isError: true,
        },
      ]);
    } finally {
      stopAnalysisProgressAnim();
      setIsProcessing(false);
      if (currentJobTurnId) {
        const tid = currentJobTurnId;
        setCompletedAnalysisJobTurnIds((prev) => ({
          ...prev,
          [tid]: true,
        }));
      }
      void refreshBillingState();
    }
  };

  const handleRetryChunkAnalysis = async (stale: BotMsg) => {
    const originalTurnId =
      stale.jobTurnId ??
      (stale.id.includes("-bot-") ? stale.id.slice(0, stale.id.lastIndexOf("-bot-")) : stale.id);
    if (!stale.chunkId || !stale.sourceQuery?.trim()) return;
    if (isProcessing || !completedAnalysisJobTurnIds[originalTurnId]) return;

    const msgId = stale.id;
    const q = stale.sourceQuery.trim();
    const cid = stale.chunkId;

    setIsProcessing(true);
    startAnalysisProgressAnim();

    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.type === "bot" ? { ...m, retrying: true, error: null } : m,
      ),
    );

    let retryJobId: string | null = null;
    try {
      const start = await rawFootageApi.startJob(q, [cid], cameraScopeSlots());
      retryJobId = start.job_id;

      let done = false;
      let lastPollCompletedChunks = -1;
      while (!done) {
        const status = await rawFootageApi.getJob(start.job_id);
        const jobTerminal = status.status === "completed" || status.status === "failed";

        if (
          lastPollCompletedChunks >= 0 &&
          status.completed_chunks > lastPollCompletedChunks &&
          !jobTerminal
        ) {
          startAnalysisProgressAnim();
        }
        lastPollCompletedChunks = status.completed_chunks;

        for (const r of status.results || []) {
          const url = (r.video_url || "").trim();
          if (!url || !/^https?:\/\//i.test(url)) continue;
          const lp = r.local_path;
          if (!lp) continue;
          const isLiveResult = lp === "__live__" || !!chunks.find((c) => c.id === lp)?.is_live;
          if (isLiveResult) {
            setAnalysisPlaybackUrlByChunkId((prev) =>
              prev[lp] === url ? prev : { ...prev, [lp]: url },
            );
          }
        }

        const r0 = status.results?.[0];
        if (r0) {
          const chunkId = resolveChunkIdFromResult(r0);
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== msgId || m.type !== "bot") return m;
              return {
                ...m,
                chunkId,
                chunkLabel: chunkLabelById(chunkId) || m.chunkLabel,
                content: r0.analysis ?? "",
                timestamps: parseTimestamps(r0.analysis),
                error: r0.error ?? null,
                sourceQuery: q,
                jobTurnId: originalTurnId,
              };
            }),
          );
        }

        if (jobTerminal) {
          done = true;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.type === "bot" ? { ...m, error: " ", sourceQuery: q } : m,
        ),
      );
    } finally {
      stopAnalysisProgressAnim();
      setIsProcessing(false);
      if (retryJobId) {
        const rid = retryJobId;
        setCompletedAnalysisJobTurnIds((prev) => ({ ...prev, [rid]: true }));
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId && m.type === "bot" ? { ...m, retrying: false } : m)),
      );
      void refreshBillingState();
    }
  };

  const handleJumpToTimestamp = (
    timestamp: Timestamp,
    chunkId: string | null,
    allTimestamps: Timestamp[],
  ) => {
    setVideoOverlay({
      isOpen: true,
      chunkId: chunkId || activeChunkId,
      timestamps: allTimestamps,
      currentTime: timestamp.seconds,
    });
  };

  const handleOverlayTimestampClick = (timestamp: Timestamp) => {
    if (overlayVideoRef.current) {
      overlayVideoRef.current.currentTime = timestamp.seconds;
      void overlayVideoRef.current.play().catch(() => undefined);
    }
  };

  const closeVideoOverlay = () => {
    if (overlayVideoRef.current) {
      try {
        overlayVideoRef.current.pause();
      } catch {
        // ignore
      }
    }
    setVideoOverlay({ isOpen: false, chunkId: null, timestamps: [] });
  };

  const overlayPlayUrl = playUrlForId(videoOverlay.chunkId);
  const overlayChunk = chunks.find((c) => c.id === videoOverlay.chunkId);

  return (
    <div className="h-screen min-w-0 w-full max-w-full bg-[#070707] text-white p-4 md:p-8">
      <div className="flex h-[calc(100vh-2rem)] min-w-0 w-full max-w-full flex-col md:h-[calc(100vh-4rem)]">
        {isChatMode ? (
          /* Chat Mode - Only Messages and Composer */
          <>
            {/* Back Button Header */}
            <div className="mb-6 flex items-center justify-between gap-3">
              <button
                onClick={handleBackToMain}
                className="flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg hover:bg-[#1a1a1a] transition-colors text-gray-300"
              >
                <ArrowLeft className="size-5" />
                <span>Back</span>
              </button>
              {billingStatusEl}
            </div>

            {/* Messages Area */}
            <div
              ref={messagesScrollRef}
              className="mb-6 max-w-full min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-4"
            >
              {messages.map((message) => {
                if (message.type === "user") {
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

                if (message.type === "system") {
                  const showRing =
                    message.loading &&
                    !message.isError &&
                    analysisWaitUi.phase === "filling";
                  const showOverflowSpinner =
                    message.loading &&
                    !message.isError &&
                    analysisWaitUi.phase === "overflow";
                  const showGenericSpinner =
                    message.loading &&
                    !message.isError &&
                    analysisWaitUi.phase === "idle";
                  const ringSize = 36;
                  const ringStroke = 3;
                  const ringR = (ringSize - ringStroke) / 2;
                  const ringC = 2 * Math.PI * ringR;
                  const ringDash = analysisWaitUi.progress * ringC;
                  return (
                    <div key={message.id} className="flex justify-center">
                      <div
                        className={`flex items-center gap-2 px-4 py-2 rounded-full ${
                          message.isError
                            ? "bg-red-500/20 text-red-400"
                            : "bg-[#1a1a1a] text-gray-400"
                        }`}
                      >
                        {!message.isError && showRing && (
                          <svg
                            width={ringSize}
                            height={ringSize}
                            viewBox={`0 0 ${ringSize} ${ringSize}`}
                            className="shrink-0"
                            aria-hidden
                          >
                            <circle
                              cx={ringSize / 2}
                              cy={ringSize / 2}
                              r={ringR}
                              fill="none"
                              stroke="#2a2a2a"
                              strokeWidth={ringStroke}
                            />
                            <circle
                              cx={ringSize / 2}
                              cy={ringSize / 2}
                              r={ringR}
                              fill="none"
                              stroke="#00ff88"
                              strokeWidth={ringStroke}
                              strokeLinecap="round"
                              transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                              strokeDasharray={`${ringDash} ${ringC}`}
                            />
                          </svg>
                        )}
                        {!message.isError && (showOverflowSpinner || showGenericSpinner) && (
                          <Loader2 className="size-4 shrink-0 animate-spin" />
                        )}
                        <span className="text-sm">{message.content}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={message.id}
                    className="flex w-full min-w-0 max-w-full justify-start"
                  >
                    <div className="w-full min-w-0 max-w-[min(100%,42rem)]">
                      {(() => {
                        const botTurnId =
                          message.jobTurnId ??
                          (message.id.includes("-bot-")
                            ? message.id.slice(0, message.id.lastIndexOf("-bot-"))
                            : message.id);
                        const retryEnabled =
                          !!completedAnalysisJobTurnIds[botTurnId] &&
                          !isProcessing &&
                          !!message.sourceQuery?.trim() &&
                          !message.retrying;
                        const linkedChunk = message.chunkId
                          ? chunks.find((c) => c.id === message.chunkId) ?? null
                          : null;
                        const linkedThumb = linkedChunk ? thumbnailUrl(linkedChunk) : null;
                        return (
                          <>
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={!message.chunkId}
                                onClick={() => {
                                  if (message.chunkId) {
                                    setActiveChunkId(message.chunkId);
                                    setVideoOverlay({
                                      isOpen: true,
                                      chunkId: message.chunkId,
                                      timestamps: message.timestamps,
                                    });
                                  }
                                }}
                                className="group inline-flex min-w-[240px] items-center gap-3 rounded-xl border-2 border-[#2f7f58] bg-gradient-to-br from-[#0f1713] to-[#0b0f0d] px-3 py-2 text-left transition-all hover:border-[#00ff88]/75 hover:shadow-[0_0_0_1px_rgba(0,255,136,0.35),0_8px_20px_-10px_rgba(0,255,136,0.45)] disabled:cursor-default disabled:opacity-70"
                              >
                                <div className="relative h-10 w-[68px] shrink-0 overflow-hidden rounded-md border border-[#2b3f35] bg-[#0b0d0c]">
                                  {linkedThumb ? (
                                    <img
                                      src={linkedThumb}
                                      alt=""
                                      loading="lazy"
                                      className="absolute inset-0 h-full w-full object-cover"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  ) : null}
                                  <div className="absolute inset-0 flex items-center justify-center bg-[#0b0d0c]/70">
                                    <Film className="size-4 text-[#00ff88]" />
                                  </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13px] font-semibold text-[#dfffea]">
                                    {message.chunkLabel}
                                  </p>
                                  <p className="text-[11px] text-[#89b79f]">
                                    Tap to open footage widget
                                  </p>
                                </div>
                              </button>
                              {message.retrying && (
                                <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />
                              )}
                            </div>
                            {message.error != null && (
                              <div className="mb-3">
                                <button
                                  type="button"
                                  disabled={!retryEnabled}
                                  onClick={() => void handleRetryChunkAnalysis(message)}
                                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                                    retryEnabled
                                      ? "bg-[#00ff88] text-black hover:bg-[#00dd77]"
                                      : "cursor-not-allowed bg-[#2a2a2a] text-gray-500"
                                  }`}
                                >
                                  Retry
                                </button>
                              </div>
                            )}
                            {message.content && (
                              <div
                                className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] px-4 py-3 font-sans"
                                style={{
                                  overflowWrap: "anywhere",
                                  wordBreak: "break-word",
                                }}
                              >
                                {renderAnalysisContent(message.content)}
                              </div>
                            )}
                            {message.timestamps.length > 0 && (
                              <div
                                className="mt-3"
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 8,
                                }}
                              >
                                {message.timestamps.map((ts, i) => (
                                  <button
                                    type="button"
                                    key={`${message.id}-ts-${i}`}
                                    onClick={() =>
                                      handleJumpToTimestamp(
                                        ts,
                                        message.chunkId,
                                        message.timestamps,
                                      )
                                    }
                                    className={TIMESTAMP_BTN_CLASS}
                                    style={TIMESTAMP_BTN_STYLE}
                                  >
                                    @{ts.display}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}

              <div ref={chatEndRef} />
            </div>

            {/* Composer */}
            <div className="p-6">
              <div className="w-full max-w-3xl mx-auto">
                <div className="flex items-end gap-2 px-3 py-2 rounded-3xl bg-[#1a1a1a] border border-[#2a2a2a] focus-within:border-[#00ff88] transition-colors">
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder="Message Local Chat"
                    rows={1}
                    className="flex-1 min-w-0 bg-transparent resize-none focus:outline-none text-white placeholder:text-gray-500 px-2 py-2 leading-5"
                    style={{ maxHeight: "160px" }}
                  />
                  <button
                    onClick={() => void handleSend()}
                    disabled={!inputValue.trim() || isProcessing}
                    className="shrink-0 w-9 h-9 rounded-full bg-white hover:bg-gray-200 disabled:bg-[#2a2a2a] disabled:text-gray-600 flex items-center justify-center transition-colors"
                    aria-label="Send"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-black" />
                    ) : (
                      <Send className="w-4 h-4 text-black" />
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

              <div className="flex shrink-0 items-center gap-3">
                {billingStatusEl}
                <button
                  onClick={handleNewChat}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00ff88] text-black hover:bg-[#00ff88]/90 transition-colors"
                >
                  <Plus className="size-4" />
                  <span>New chat</span>
                </button>
              </div>
            </div>

            {/* Chunks Strip — min-w-0 so this flex subtree can shrink; inner overflow-x scrolls */}
            <div className="mb-6 min-w-0 max-w-full overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
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
                    className={`p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors ${isSearchOpen ? "bg-[#1a1a1a]" : ""}`}
                  >
                    <Search className="size-4" />
                  </button>
                  <button
                    onClick={() => setIsDateFilterOpen((prev) => !prev)}
                    className={`p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors ${isDateFilterOpen ? "bg-[#1a1a1a]" : ""}`}
                    aria-label="Filter by date"
                    title="Filter by date"
                  >
                    <CalendarDays className="size-4" />
                  </button>
                  <button
                    onClick={() => void loadChunks()}
                    className="p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors"
                  >
                    <RefreshCw className={`size-4 ${chunksLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {isSearchOpen && (
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Filter by filename, date, or time..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#070707] border border-[#1a1a1a] focus:outline-none focus:border-[#00ff88] text-sm"
                  />
                </div>
              )}

              {isDateFilterOpen && (
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="size-4 text-gray-400" />
                    <select
                      value={selectedDateFilter}
                      onChange={(e) => setSelectedDateFilter(e.target.value)}
                      className="w-full rounded-lg border border-[#1a1a1a] bg-[#070707] px-3 py-2 text-sm text-white focus:border-[#00ff88] focus:outline-none"
                      style={{ backgroundColor: "#070707", color: "#ffffff" }}
                    >
                      {availableChunkDates.length === 0 ? (
                        <option
                          value=""
                          className="bg-[#070707] text-white"
                          style={{ backgroundColor: "#070707", color: "#ffffff" }}
                        >
                          No available dates
                        </option>
                      ) : (
                        availableChunkDates.map((date) => (
                          <option
                            key={date}
                            value={date}
                            className="bg-[#070707] text-white"
                            style={{ backgroundColor: "#070707", color: "#ffffff" }}
                          >
                            {date}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              )}

              <div
                className="min-w-0 py-3"
                style={{
                  maxWidth: "100%",
                  overflowX: "auto",
                  overflowY: "hidden",
                  WebkitOverflowScrolling: "touch",
                  scrollbarWidth: "thin",
                  scrollbarColor: "#2a2a2a transparent",
                }}
              >
                {chunksLoading && filteredChunks.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 px-4 py-8 justify-center">
                    <Loader2 className="size-4 animate-spin" />
                    Loading chunks...
                  </div>
                ) : filteredChunks.length === 0 ? (
                  <div className="text-sm text-gray-500 px-4 py-8 text-center">
                    {chunks.length === 0
                      ? "No raw footage yet. Start a raw recording in Settings."
                      : "No chunks match your filter."}
                  </div>
                ) : (
                  <div
                    className="flex gap-3 px-4 pb-6 pt-2"
                    style={{
                      flexWrap: "nowrap",
                      width: "max-content",
                    }}
                  >
                    {filteredChunks.map((chunk) => {
                      const isSelected = selectedChunkIds.includes(chunk.id);
                      const selectionOrder = selectedChunkIds.indexOf(chunk.id) + 1;
                      const isDisabled = isLocked && !lockedIds.includes(chunk.id);
                      const thumb = thumbnailUrl(chunk);

                      return (
                        <div
                          key={chunk.id}
                          className={`shrink-0 rounded-xl transition-all duration-200 ease-out ${
                            isDisabled ? "cursor-not-allowed opacity-30" : ""
                          } ${
                            isSelected
                              ? "p-[3px] bg-[#00ff88] shadow-[0_0_0_2px_rgba(0,255,136,0.9),0_0_32px_rgba(0,255,136,0.55),0_0_64px_rgba(0,255,136,0.2)]"
                              : "p-px bg-[#2a2a2a] shadow-none hover:bg-[#3d3d3d]"
                          }`}
                          style={{ width: 180, minWidth: 180 }}
                        >
                          <div
                            onClick={() => handleChunkClick(chunk.id)}
                            onDoubleClick={() => handleChunkDoubleClick(chunk.id)}
                            className={`group relative cursor-pointer overflow-hidden rounded-[10px] border-2 transition-colors duration-200 ${
                              isDisabled ? "cursor-not-allowed" : ""
                            } ${
                              isSelected
                                ? "border-[#061208] bg-[#050806]"
                                : "border-[#141414] bg-[#0a0a0a] hover:border-[#333]"
                            }`}
                          >
                          <div
                            className="bg-[#0d0d0d] relative"
                            style={{ aspectRatio: "16 / 9" }}
                          >
                            {chunk.is_live ? (
                              <img
                                src={LIVE_CHUNK_PLACEHOLDER_SRC}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                                draggable={false}
                              />
                            ) : thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                loading="lazy"
                                className="absolute inset-0 h-full w-full object-cover"
                                onError={(e) =>
                                  ((e.currentTarget as HTMLImageElement).style.display = "none")
                                }
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d0d]">
                                <Film className="size-8 text-gray-600" aria-hidden />
                              </div>
                            )}

                            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />

                            {isSelected && (
                              <>
                                <div
                                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#00ff88]/45 via-[#00ff88]/12 to-transparent"
                                  aria-hidden
                                />
                                <div
                                  className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-[#00ff88]/70"
                                  aria-hidden
                                />
                              </>
                            )}

                            {chunk.is_live && (
                              <div className="absolute top-2 left-2 px-2 py-1 rounded bg-[#00ff88]/90 text-black text-xs font-medium">
                                Live
                              </div>
                            )}

                            {isSelected && selectionOrder > 0 && (
                              <div
                                className={`absolute top-2 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-[#0a0a0a] bg-[#00ff88] px-1.5 text-[11px] font-black leading-none text-[#050505] shadow-[0_2px_8px_rgba(0,0,0,0.65),0_0_14px_rgba(0,255,136,0.95)] ${
                                  chunk.is_live ? "right-2" : "left-2"
                                }`}
                              >
                                {selectionOrder}
                              </div>
                            )}
                          </div>

                          <div
                            className={`border-t p-3 transition-colors duration-200 ${
                              isSelected
                                ? "border-[#00ff88]/60 bg-gradient-to-b from-[#0c1f14] to-[#040806]"
                                : "border-transparent bg-[#0a0a0a]"
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span
                                className={
                                  isSelected
                                    ? "font-semibold text-[#00ff88]"
                                    : "text-gray-400"
                                }
                              >
                                {chunk.date}
                              </span>
                              <span
                                className={`tabular-nums ${
                                  isSelected ? "text-[#8fbcb0]" : "text-gray-500"
                                }`}
                              >
                                {chunk.is_live ? "—" : formatBytes(chunk.size_bytes)}
                              </span>
                            </div>
                            <div
                              className={`mt-2 w-full rounded-none border px-1.5 py-1.5 text-center text-[10px] font-black leading-tight tracking-tight sm:text-[11px] ${
                                isSelected
                                  ? "border-[#00cc6a]/80 bg-[#00ff88] text-[#050505] shadow-inner shadow-black/20"
                                  : "border-[#333] bg-[#141414] text-gray-300 shadow-inner shadow-black/30"
                              }`}
                              style={{ fontWeight: 900, color: isSelected ? "#050505" : undefined }}
                            >
                              {chunkTimeIntervalLabel(chunk)}
                            </div>
                          </div>
                        </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Composer */}
            <div className="flex-1 min-h-0 flex items-end p-6">
              <div className="w-full">
                <div className="flex items-end gap-2 px-3 py-2 rounded-3xl bg-[#1a1a1a] border border-[#2a2a2a] focus-within:border-[#00ff88] transition-colors">
                  <textarea
                    ref={composerRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder="Message Local Chat"
                    rows={1}
                    className="flex-1 min-w-0 bg-transparent resize-none focus:outline-none text-white placeholder:text-gray-500 px-2 py-2 leading-5"
                    style={{ maxHeight: "160px" }}
                  />
                  <button
                    onClick={() => void handleSend()}
                    disabled={!inputValue.trim() || isProcessing || selectedChunkIds.length === 0}
                    className="shrink-0 w-9 h-9 rounded-full bg-white hover:bg-gray-200 disabled:bg-[#2a2a2a] disabled:text-gray-600 flex items-center justify-center transition-colors"
                    aria-label="Send"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-black" />
                    ) : (
                      <Send className="w-4 h-4 text-black" />
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-3 mt-3 px-2">
                  <div
                    className={`text-xs ${
                      selectedChunkIds.length > 0 ? "text-[#00ff88]" : "text-gray-500"
                    }`}
                  >
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
                      {cameraScopeOptions.map((opt) => (
                        <option key={opt.id} value={opt.id} className="bg-[#1a1a1a] text-white">
                          {opt.label}
                        </option>
                      ))}
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

        {videoOverlay.isOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/55 backdrop-blur-sm"
              role="presentation"
              onClick={(e) => e.target === e.currentTarget && closeVideoOverlay()}
            >
              <div
                className="flex flex-col overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] shadow-2xl shadow-black/50"
                role="dialog"
                aria-modal="true"
                aria-labelledby="video-overlay-title"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(92vw, 680px)",
                  maxWidth: "min(92vw, 680px)",
                  maxHeight: "min(85vh, 860px)",
                  minHeight: 0,
                }}
              >
                {/* Overlay Header */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#1a1a1a] px-4 py-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span id="video-overlay-title" className="shrink-0 text-sm font-medium">
                      Video Playback
                    </span>
                    {overlayChunk && (
                      <span className="truncate text-sm text-gray-400">
                        {overlayChunk.is_live
                          ? chunkTimeIntervalLabel(overlayChunk)
                          : `${overlayChunk.date} · ${chunkTimeIntervalLabel(overlayChunk)}`}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeVideoOverlay}
                    className="shrink-0 rounded-lg p-2 transition-colors hover:bg-[#1a1a1a]"
                    aria-label="Close"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                {/* flex-1 1 0% + min-h-0: body scrolls when dialog height is capped by maxHeight */}
                <div
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-4"
                  style={{ minHeight: 0, flex: "1 1 0%" }}
                >
                  {overlayMediaError && (
                    <p className="mb-2 shrink-0 text-sm text-red-400" role="alert">
                      {overlayMediaError}
                    </p>
                  )}
                  <div
                    className="mx-auto flex w-full min-w-0 shrink-0 items-center justify-center rounded-lg bg-black"
                    style={{
                      width: `min(100%, ${VIDEO_OVERLAY_PLAYER_W}px)`,
                      height: VIDEO_OVERLAY_PLAYER_H,
                      overflow: "hidden",
                      zIndex: 0,
                    }}
                  >
                    {overlayPlayUrl ? (
                      <video
                        ref={overlayVideoRef}
                        key={overlayPlayUrl}
                        className="block h-full w-full"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                        }}
                        controls
                        autoPlay
                        playsInline
                        disablePictureInPicture
                        disableRemotePlayback
                        controlsList="noremoteplayback nodownload"
                        onError={() => {
                          const v = overlayVideoRef.current;
                          const code = v?.error?.code;
                          const map: Record<number, string> = {
                            1: "Playback aborted",
                            2: "Network error while loading video",
                            3: "Video decode failed",
                            4: "Video format not supported",
                          };
                          setOverlayMediaError(
                            (code != null && map[code]) ||
                              v?.error?.message ||
                              "Could not play this video.",
                          );
                        }}
                        onLoadedData={() => setOverlayMediaError(null)}
                        src={overlayPlayUrl}
                      />
                    ) : (
                      <div className="flex min-h-[160px] w-full items-center justify-center px-4 text-center text-sm text-gray-500">
                        No playable source for this chunk.
                      </div>
                    )}
                  </div>

                  {videoOverlay.timestamps.length > 0 && (
                    <div
                      className="relative mt-4 w-full min-w-0 shrink-0"
                      style={{ zIndex: 2 }}
                    >
                      <h3 className="mb-2 text-sm font-medium">Timestamps</h3>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        {videoOverlay.timestamps.map((ts, i) => (
                          <button
                            type="button"
                            key={`overlay-ts-${i}`}
                            onClick={() => handleOverlayTimestampClick(ts)}
                            className={TIMESTAMP_BTN_CLASS}
                            style={TIMESTAMP_BTN_STYLE}
                          >
                            @{ts.display}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}
