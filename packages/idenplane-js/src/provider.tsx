import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IdenplaneClient as IdenplaneClientClass } from './client.js';
import type { IdenplaneClient } from './client.js';
import type { IdenplaneConfig, TokenResponse, UserInfo } from './types.js';
import { AuthContext } from './context.js';

export interface AuthProviderProps {
  /**
   * An already-constructed IdenplaneClient instance.
   * Mutually exclusive with the individual config props.
   */
  client?: IdenplaneClient;

  // Inline config props (alternative to passing a pre-built client)
  /** Idenplane server URL */
  serverUrl?: string;
  /** Realm name */
  realm?: string;
  /** OAuth2 client ID */
  clientId?: string;
  /** Redirect URI after login */
  redirectUri?: string;
  /** OAuth2 scopes */
  scope?: string[];

  children: ReactNode;

  /** If true, automatically calls handleCallback when URL has ?code= (default: true) */
  autoHandleCallback?: boolean;
  /** Called when initialization is complete */
  onReady?: (authenticated: boolean) => void;
  /** Called on successful login */
  onLogin?: (tokens: TokenResponse) => void;
  /** Called on logout */
  onLogout?: () => void;
  /** Called on authentication error */
  onError?: (error: Error) => void;
  /** Called after token refresh */
  onTokenRefresh?: (tokens: TokenResponse) => void;
}

/**
 * AuthProvider wraps your application, initializes an IdenplaneClient,
 * and provides auth state to all child components via context.
 *
 * ```tsx
 * <AuthProvider serverUrl="http://localhost:3000" realm="my-realm" clientId="my-app" redirectUri="/callback">
 *   <App />
 * </AuthProvider>
 * ```
 */
export function AuthProvider({
  client: clientProp,
  serverUrl,
  realm,
  clientId,
  redirectUri,
  scope,
  children,
  autoHandleCallback = true,
  onReady,
  onLogin,
  onLogout,
  onError,
  onTokenRefresh,
}: AuthProviderProps) {
  // Build or use the client. We hold it in a ref so we build it at most once.
  const clientRef = useRef<IdenplaneClient | null>(null);
  if (!clientRef.current) {
    if (clientProp) {
      clientRef.current = clientProp;
    } else {
      if (!serverUrl || !realm || !clientId || !redirectUri) {
        throw new Error(
          'AuthProvider requires either a `client` prop or all of: serverUrl, realm, clientId, redirectUri',
        );
      }
      const config: IdenplaneConfig = {
        url: serverUrl,
        realm,
        clientId,
        redirectUri,
        scopes: scope,
        onLogin,
        onLogout,
        onError,
        onTokenRefresh,
      };
      clientRef.current = new IdenplaneClientClass(config);
    }
  }

  const client = clientRef.current;

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    let mounted = true;

    const onLoginHandler = () => {
      if (!mounted) return;
      setIsAuthenticated(true);
      setUser(client.getUserInfo());
    };

    const onLogoutHandler = () => {
      if (!mounted) return;
      setIsAuthenticated(false);
      setUser(null);
    };

    const onTokenRefreshHandler = () => {
      if (!mounted) return;
      setUser(client.getUserInfo());
    };

    const unsubLogin = client.on('login', onLoginHandler);
    const unsubLogout = client.on('logout', onLogoutHandler);
    const unsubRefresh = client.on('tokenRefresh', onTokenRefreshHandler);

    // Also wire up the prop-based callbacks if a client was passed in externally
    let unsubOnLogin: (() => void) | undefined;
    let unsubOnLogout: (() => void) | undefined;
    let unsubOnError: (() => void) | undefined;
    let unsubOnTokenRefresh: (() => void) | undefined;

    if (clientProp) {
      if (onLogin) unsubOnLogin = client.on('login', onLogin);
      if (onLogout) unsubOnLogout = client.on('logout', onLogout as () => void);
      if (onError) unsubOnError = client.on('error', onError);
      if (onTokenRefresh) unsubOnTokenRefresh = client.on('tokenRefresh', onTokenRefresh);
    }

    async function initialize() {
      try {
        // Check if URL has authorization code
        const hasCode =
          typeof window !== 'undefined' &&
          new URL(window.location.href).searchParams.has('code');

        if (hasCode && autoHandleCallback) {
          const success = await client.handleCallback();
          if (mounted) {
            setIsAuthenticated(success);
            if (success) setUser(client.getUserInfo());
            setIsLoading(false);
            onReady?.(success);
          }
          return;
        }

        const restored = await client.init();
        if (mounted) {
          setIsAuthenticated(restored);
          if (restored) setUser(client.getUserInfo());
          setIsLoading(false);
          onReady?.(restored);
        }
      } catch {
        if (mounted) {
          setIsAuthenticated(false);
          setIsLoading(false);
          onReady?.(false);
        }
      }
    }

    initialize();

    return () => {
      mounted = false;
      unsubLogin();
      unsubLogout();
      unsubRefresh();
      unsubOnLogin?.();
      unsubOnLogout?.();
      unsubOnError?.();
      unsubOnTokenRefresh?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const login = useCallback(
    (options?: { scope?: string[] }) => client.login(options),
    [client],
  );

  const logout = useCallback(() => client.logout(), [client]);
  const getToken = useCallback(() => client.getAccessToken(), [client]);

  const value = useMemo(
    () => ({ client, isAuthenticated, isLoading, user, login, logout, getToken }),
    [client, isAuthenticated, isLoading, user, login, logout, getToken],
  );

  return createElement(AuthContext.Provider, { value }, children);
}
