/**
 * API service for mobile app
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: Update this to your Cloudflare Tunnel URL when deployed
export const API_BASE_URL = 'https://belfast-boundary-countries-strip.trycloudflare.com'; // Change to your Cloudflare Tunnel URL

const AUTH_TOKEN_KEY = 'auth_token';

/**
 * Get stored auth token
 */
export const getAuthToken = async () => {
  try {
    return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
};

/**
 * Store auth token
 */
export const setAuthToken = async (token) => {
  try {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch (error) {
    console.error('Error storing auth token:', error);
  }
};

/**
 * Remove auth token
 */
export const removeAuthToken = async () => {
  try {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (error) {
    console.error('Error removing auth token:', error);
  }
};

/**
 * Make API request with authentication
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = await getAuthToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });
  
  if (!response.ok) {
    let detail = '';
    try {
      const errorData = await response.json();
      detail = errorData.detail || '';
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail || `API request failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Auth API
 */
export const authApi = {
  /**
   * Register a new user
   */
  async register(email, password) {
    const response = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(response.access_token);
    return response;
  },

  /**
   * Login user
   */
  async login(email, password) {
    const response = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(response.access_token);
    return response;
  },

  /**
   * Get current user info
   */
  async getCurrentUser() {
    return apiRequest('/auth/me');
  },

  /**
   * Logout (remove token)
   */
  logout() {
    removeAuthToken();
  },
};

/**
 * Search API
 */
export const searchApi = {
  /**
   * Search for video clips
   */
  async searchClips(query, nResults = 5, targetDate = null) {
    return apiRequest('/search/clips', {
      method: 'POST',
      body: JSON.stringify({
        query,
        n_results: nResults,
        target_date: targetDate,
      }),
    });
  },
};

/**
 * Analysis API
 */
export const analysisApi = {
  /**
   * Analyze videos
   */
  async analyze(query, nResults = 5, targetDate = null) {
    return apiRequest('/analysis', {
      method: 'POST',
      body: JSON.stringify({
        query,
        n_results: nResults,
        target_date: targetDate,
      }),
    });
  },
};
