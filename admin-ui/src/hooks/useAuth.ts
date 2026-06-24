import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { clearCredentials, setCredentials } from '../api/client';
import { getAllRealms } from '../api/realms';
import { useAuthContext } from '../context/AuthContext';

export function useAuth() {
  const navigate = useNavigate();
  const { apiKey, token, setApiKey, setToken, clearAuth } = useAuthContext();

  const isAuthenticated = apiKey !== null || token !== null;

  const clearAuthState = useCallback(() => {
    clearAuth();
    clearCredentials();
  }, [clearAuth]);

  const login = useCallback(
    async (key: string): Promise<boolean> => {
      clearAuthState();
      // Optimistically load credentials so the probe request is authenticated.
      setCredentials({ apiKey: key });
      try {
        await getAllRealms();
        // Probe succeeded — persist to React state.
        setApiKey(key);
        return true;
      } catch {
        clearCredentials();
        return false;
      }
    },
    [clearAuthState, setApiKey],
  );

  const loginWithCredentials = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      clearAuthState();
      try {
        const { data } = await apiClient.post('/auth/login', { username, password });
        if (data.access_token) {
          // The backend also sets an httpOnly IDENPLANE_ADMIN_SESSION cookie
          // for persistence across reloads. We keep the token in memory too
          // so the axios interceptor can attach it as a Bearer header (the
          // cookie alone would also work, but this is belt-and-suspenders).
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

  return { isAuthenticated, login, loginWithCredentials, logout, clearAuthState };
}
