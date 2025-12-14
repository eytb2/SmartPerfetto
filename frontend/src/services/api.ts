import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    // Try to get token from zustand store first, then fallback to localStorage
    const authStore = useAuthStore.getState();
    const token = authStore.token || localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized
      const authStore = useAuthStore.getState();
      authStore.logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// SQL Generation API
export const sqlAPI = {
  generate: async (query: string, context?: string) => {
    const response = await api.post('/sql/generate', { query, context });
    return response.data;
  },

  getTablesSchema: async () => {
    const response = await api.get('/sql/tables');
    return response.data;
  },
};

// Trace Analysis API
export const traceAPI = {
  upload: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/trace/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  analyze: async (fileId: string, query?: string, analysisType?: string) => {
    const response = await api.post('/trace/analyze', { fileId, query, analysisType });
    return response.data;
  },

  getInfo: async (fileId: string) => {
    const response = await api.get(`/trace/${fileId}`);
    return response.data;
  },

  delete: async (fileId: string) => {
    const response = await api.delete(`/trace/${fileId}`);
    return response.data;
  },
};

export default api;