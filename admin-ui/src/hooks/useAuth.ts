import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import apiClient, { setCredentials, clearCredentials } from '../api/client';
import { useAuthContext } from '../context/AuthContext';

export function useAuth() {
  const navigate = useNavigate();
  const { apiKey, token, setToken, clearAuth } = useAuthContext();

  const isAuthenticated = apiKey !== null || token !== null;

  const clearAuthState = useCallback(() => {
    clearAuth();
    clearCredentials();
  }, [clearAuth]);

  const login = useCallback(
    async (key: string): Promise<boolean> => {
      clearAuthState();
      try {
        const { data } = await apiClient.post('/auth/login-with-api-key', { apiKey: key });
        if (data.access_token) {
          setCredentials({ token: data.access_token });
          setToken(data.access_token);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [clearAuthState, setToken],
  );

  const loginWithCredentials = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      clearAuthState();
      try {
        const { data } = await apiClient.post('/auth/login', { username, password });
        if (data.access_token) {
          setCredentials({ token: data.access_token });
          setToken(data.access_token);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [clearAuthState, setToken],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Best-effort: clear locally even if server call fails.
    }
    clearAuthState();
    navigate('/console/login');
  }, [clearAuthState, navigate]);

  const { bootstrapped } = useAuthContext();

  return { isAuthenticated, bootstrapped, login, loginWithCredentials, logout, clearAuthState };
}
