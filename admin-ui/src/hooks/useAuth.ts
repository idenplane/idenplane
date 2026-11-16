import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import apiClient, { setCredentials, clearCredentials } from '../api/client';
import { useAuthContext } from '../context/AuthContext';
import type { AdminMfaMethod, LoginResult } from '../api/adminMfa';

/** What the first (password) step of a console sign-in came to. */
export type LoginOutcome =
  /** Signed in. `enrolmentRequired`: only MFA enrolment is open for now. */
  | { kind: 'signed-in'; enrolmentRequired: boolean }
  /** The admin has a second factor: answer it with `mfaToken`. */
  | { kind: 'mfa'; mfaToken: string; methods: AdminMfaMethod[] }
  | { kind: 'failed'; status?: number };

export function useAuth() {
  const navigate = useNavigate();
  const { apiKey, token, setToken, clearAuth } = useAuthContext();

  const isAuthenticated = apiKey !== null || token !== null;

  const clearAuthState = useCallback(() => {
    clearAuth();
    clearCredentials();
  }, [clearAuth]);

  /** Keeps a token the server issued (sign-in, step-up, enrolment). */
  const keepToken = useCallback(
    (next: string) => {
      setCredentials({ token: next });
      setToken(next);
    },
    [setToken],
  );

  const login = useCallback(
    async (key: string): Promise<boolean> => {
      clearAuthState();
      try {
        const { data } = await apiClient.post('/auth/login-with-api-key', { apiKey: key });
        if (data.access_token) {
          keepToken(data.access_token);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [clearAuthState, keepToken],
  );

  const loginWithCredentials = useCallback(
    async (username: string, password: string): Promise<LoginOutcome> => {
      clearAuthState();
      try {
        const { data } = await apiClient.post<LoginResult>('/auth/login', {
          username,
          password,
        });
        if ('mfa_required' in data && data.mfa_required) {
          return { kind: 'mfa', mfaToken: data.mfa_token, methods: data.methods };
        }
        if ('access_token' in data && data.access_token) {
          keepToken(data.access_token);
          return {
            kind: 'signed-in',
            enrolmentRequired: data.mfa_enrolment_required === true,
          };
        }
        return { kind: 'failed' };
      } catch (error) {
        return {
          kind: 'failed',
          status: (error as { response?: { status?: number } }).response?.status,
        };
      }
    },
    [clearAuthState, keepToken],
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

  return {
    isAuthenticated,
    bootstrapped,
    login,
    loginWithCredentials,
    keepToken,
    logout,
    clearAuthState,
  };
}
