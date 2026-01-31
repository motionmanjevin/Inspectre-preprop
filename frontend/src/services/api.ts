/**
 * API service for communicating with the Inspectre backend.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * API Response types matching the backend models
 */

export interface ClipInfo {
  video_url: string;
  metadata: Record<string, any>;
  distance: number | null;
}

export interface ClipSearchResponse {
  clips: ClipInfo[];
  query: string;
}

export interface AnalysisResult {
  video_url: string;
  local_path: string | null;
  analysis: string | null;
  error: string | null;
}

export interface AnalysisResponse {
  results: AnalysisResult[];
  query: string;
}

export interface RecordingStatus {
  recording: boolean;
  rtsp_url: string | null;
}

export interface AvailableDatesResponse {
  dates: string[];
}

export interface ProcessingStatsResponse {
  chunks_processed: number;
  total_minutes: number;
  max_minutes: number;
  progress_percent: number;
}

export interface HealthResponse {
  status: string;
  version: string | null;
}

/**
 * Generic API error class
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Get stored auth token
 */
export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

/**
 * Store auth token
 */
export function setAuthToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

/**
 * Remove auth token
 */
export function removeAuthToken(): void {
  localStorage.removeItem('auth_token');
}

/**
 * Helper function to make API requests
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const token = getAuthToken();
  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errorData = await response.json();
      detail = errorData.detail || '';
    } catch {
      detail = response.statusText;
    }
    throw new ApiError(
      `API request failed: ${response.status}`,
      response.status,
      detail
    );
  }

  return response.json();
}

/**
 * Recording API
 */
export const recordingApi = {
  /**
   * Start recording from an RTSP stream
   * @param rtspUrl RTSP stream URL to record
   * @param chunkDuration Duration of each video chunk in minutes (1-60). Optional.
   */
  async start(rtspUrl: string, chunkDuration?: number): Promise<{ status: string; rtsp_url: string }> {
    return apiRequest('/recording/start', {
      method: 'POST',
      body: JSON.stringify({ 
        rtsp_url: rtspUrl,
        chunk_duration: chunkDuration || null,
      }),
    });
  },

  /**
   * Stop the current recording
   */
  async stop(): Promise<{ status: string; rtsp_url: string }> {
    return apiRequest('/recording/stop', {
      method: 'POST',
    });
  },

  /**
   * Get current recording status
   */
  async getStatus(): Promise<RecordingStatus> {
    return apiRequest('/recording/status');
  },

  /**
   * Clear ChromaDB and delete all recorded video clips
   */
  async clearDatabase(): Promise<{ status: string; rtsp_url: string | null }> {
    return apiRequest('/recording/clear-database', {
      method: 'POST',
    });
  },
};

/**
 * Search API
 */
export const searchApi = {
  /**
   * Search for video clips based on query
   * @param query Search query text
   * @param nResults Number of results to return (default: 5)
   * @param targetDate Specific date to search (YYYY-MM-DD format). If not provided, searches last 24 hours.
   */
  async searchClips(
    query: string,
    nResults: number = 5,
    targetDate?: string
  ): Promise<ClipSearchResponse> {
    return apiRequest('/search/clips', {
      method: 'POST',
      body: JSON.stringify({
        query,
        n_results: nResults,
        target_date: targetDate || null,
      }),
    });
  },

  /**
   * Get available dates that have stored video entries
   */
  async getAvailableDates(): Promise<AvailableDatesResponse> {
    return apiRequest('/search/available-dates');
  },

  /**
   * Get processing statistics for the last 24 hours
   */
  async getProcessingStats(): Promise<ProcessingStatsResponse> {
    return apiRequest('/search/stats');
  },
};

/**
 * Analysis API
 */
export const analysisApi = {
  /**
   * Analyze videos based on query using Qwen 3 VL Flash
   * @param query Analysis query text
   * @param nResults Number of videos to analyze (default: 5)
   * @param targetDate Specific date to search (YYYY-MM-DD format). If not provided, searches last 24 hours.
   */
  async analyze(
    query: string,
    nResults: number = 5,
    targetDate?: string
  ): Promise<AnalysisResponse> {
    return apiRequest('/analysis', {
      method: 'POST',
      body: JSON.stringify({
        query,
        n_results: nResults,
        target_date: targetDate || null,
      }),
    });
  },
};

/**
 * Health API
 */
export const healthApi = {
  /**
   * Check API health
   */
  async check(): Promise<HealthResponse> {
    return apiRequest('/health');
  },
};

/**
 * Alerts API
 */
export interface Alert {
  id: string;
  query: string;
  enabled: boolean;
  created_at: string;
  trigger_count: number;
}

export interface AlertHistoryEntry {
  id: string;
  alert_id: string;
  alert_query: string;
  video_url: string;
  local_path?: string;
  timestamp: string;
  analysis_snippet?: string;
}

export interface AlertListResponse {
  alerts: Alert[];
}

export interface AlertHistoryListResponse {
  history: AlertHistoryEntry[];
}

export const alertsApi = {
  async list(): Promise<AlertListResponse> {
    return apiRequest('/alerts');
  },

  async create(query: string): Promise<Alert> {
    return apiRequest('/alerts', {
      method: 'POST',
      body: JSON.stringify({ query, enabled: true }),
    });
  },

  async update(alertId: string, payload: { query?: string; enabled?: boolean }): Promise<Alert> {
    return apiRequest(`/alerts/${alertId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async remove(alertId: string): Promise<void> {
    await apiRequest(`/alerts/${alertId}`, {
      method: 'DELETE',
    });
  },

  async history(limit: number = 100): Promise<AlertHistoryListResponse> {
    return apiRequest(`/alerts/history?limit=${encodeURIComponent(String(limit))}`);
  },
};

/**
 * Auth API
 */
export interface User {
  id: number;
  email: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export const authApi = {
  /**
   * Register a new user
   */
  async register(email: string, password: string): Promise<TokenResponse> {
    const response = await apiRequest<TokenResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(response.access_token);
    return response;
  },

  /**
   * Login user
   */
  async login(email: string, password: string): Promise<TokenResponse> {
    const response = await apiRequest<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(response.access_token);
    return response;
  },

  /**
   * Get current user info
   */
  async getCurrentUser(): Promise<User> {
    return apiRequest<User>('/auth/me');
  },

  /**
   * Logout (remove token)
   */
  logout(): void {
    removeAuthToken();
  },
};

/**
 * Default export with all APIs
 */
export default {
  recording: recordingApi,
  search: searchApi,
  analysis: analysisApi,
  health: healthApi,
  alerts: alertsApi,
  auth: authApi,
};
