import { createElement, type ReactNode } from 'react';
import type { IdenplaneClient } from './client.js';
import { AuthProvider } from './provider.js';
import { useAuthContext } from './context.js';

// ── Backward-compatible IdenplaneProvider alias ─────────────────────

/** @deprecated Use AuthProvider instead */
export interface IdenplaneProviderProps {
  client: IdenplaneClient;
  children: ReactNode;
  autoHandleCallback?: boolean;
  onReady?: (authenticated: boolean) => void;
}

/** @deprecated Use AuthProvider instead. This alias will be removed in v2. */
export function IdenplaneProvider({
  client,
  children,
  autoHandleCallback = true,
  onReady,
}: IdenplaneProviderProps) {
  return createElement(AuthProvider, { client, children, autoHandleCallback, onReady });
}

/**
 * @deprecated Use useAuth() instead.
 * Hook for authentication state and actions.
 */
export function useIdenplane() {
  const { client, isAuthenticated, isLoading, login, logout, getToken } = useAuthContext();
  const token = isAuthenticated ? getToken() : null;
  return { isAuthenticated, isLoading, login, logout, token, client };
}
