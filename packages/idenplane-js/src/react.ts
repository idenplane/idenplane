import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AuthmeClient as AuthmeClientClass } from './client.js';
import type { AuthmeClient } from './client.js';
import type { AuthmeConfig, TokenResponse, UserInfo } from './types.js';

// Re-export core for convenience
export { AuthmeClient } from './client.js';
export type {
  AuthmeConfig,
  AuthmeEventMap,
  TokenClaims,
  TokenResponse,
  UserInfo,
} from './types.js';

// ── Context ─────────────────────────────────────────────────────

interface AuthContextValue {
  client: AuthmeClient;
  isAuthenticated: boolean;
  isLoading: boolean;
  user: UserInfo | null;
  login: (options?: { scope?: string[] }) => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── AuthProvider ─────────────────────────────────────────────────

export interface AuthProviderProps {
  /**
   * An already-constructed AuthmeClient instance.
   * Mutually exclusive with the individual config props.
   */
  client?: AuthmeClient;

  // Inline config props (alternative to passing a pre-built client)
  /** AuthMe server URL */
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
 * AuthProvider wraps your application, initializes an AuthmeClient,
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
  const clientRef = useRef<AuthmeClient | null>(null);
  if (!clientRef.current) {
    if (clientProp) {
      clientRef.current = clientProp;
    } else {
      if (!serverUrl || !realm || !clientId || !redirectUri) {
        throw new Error(
          'AuthProvider requires either a `client` prop or all of: serverUrl, realm, clientId, redirectUri',
        );
      }
      const config: AuthmeConfig = {
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
      clientRef.current = new AuthmeClientClass(config);
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

// ── Backward-compatible AuthmeProvider alias ─────────────────────

/** @deprecated Use AuthProvider instead */
export interface AuthmeProviderProps {
  client: AuthmeClient;
  children: ReactNode;
  autoHandleCallback?: boolean;
  onReady?: (authenticated: boolean) => void;
}

/** @deprecated Use AuthProvider instead. This alias will be removed in v2. */
export function AuthmeProvider({
  client,
  children,
  autoHandleCallback = true,
  onReady,
}: AuthmeProviderProps) {
  return createElement(AuthProvider, { client, children, autoHandleCallback, onReady });
}

// ── Context accessor ─────────────────────────────────────────────

function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('Auth hooks must be used within an <AuthProvider>');
  }
  return ctx;
}

// ── Hooks ────────────────────────────────────────────────────────

/**
 * Primary auth hook — returns auth state and actions.
 *
 * ```tsx
 * const { isAuthenticated, isLoading, login, logout, getToken, user } = useAuth();
 * ```
 */
export function useAuth() {
  const { client, isAuthenticated, isLoading, user, login, logout, getToken } = useAuthContext();
  return { isAuthenticated, isLoading, login, logout, getToken, user, client };
}

/**
 * @deprecated Use useAuth() instead.
 * Hook for authentication state and actions.
 */
export function useAuthme() {
  const { client, isAuthenticated, isLoading, login, logout, getToken } = useAuthContext();
  const token = isAuthenticated ? getToken() : null;
  return { isAuthenticated, isLoading, login, logout, token, client };
}

/**
 * Hook for user information from the ID token or userinfo endpoint.
 * Automatically refreshes when the auth state changes.
 *
 * ```tsx
 * const user = useUser();
 * // user?.name, user?.email, user?.sub, etc.
 * ```
 */
export function useUser(): UserInfo | null {
  const { user } = useAuthContext();
  return user;
}

/**
 * Hook for permissions and role-checking helpers.
 *
 * ```tsx
 * const { hasRole, hasPermission, roles } = usePermissions();
 * if (hasRole('admin')) { ... }
 * if (hasPermission('read:reports')) { ... }
 * ```
 */
export function usePermissions() {
  const { client, isAuthenticated } = useAuthContext();

  const hasRole = useCallback(
    (role: string) => (isAuthenticated ? client.hasRealmRole(role) : false),
    [client, isAuthenticated],
  );

  const hasPermission = useCallback(
    (permission: string) => (isAuthenticated ? client.hasPermission(permission) : false),
    [client, isAuthenticated],
  );

  const roles = useMemo(
    () => (isAuthenticated ? client.getRealmRoles() : []),
    [client, isAuthenticated],
  );

  return { hasRole, hasPermission, roles };
}

/**
 * @deprecated Use usePermissions() instead.
 * Hook for role-checking helpers.
 */
export function useRoles() {
  const { client, isAuthenticated } = useAuthContext();

  const hasRealmRole = useCallback(
    (role: string) => (isAuthenticated ? client.hasRealmRole(role) : false),
    [client, isAuthenticated],
  );

  const hasClientRole = useCallback(
    (clientId: string, role: string) =>
      isAuthenticated ? client.hasClientRole(clientId, role) : false,
    [client, isAuthenticated],
  );

  const realmRoles = useMemo(
    () => (isAuthenticated ? client.getRealmRoles() : []),
    [client, isAuthenticated],
  );

  const getClientRoles = useCallback(
    (clientId: string) => (isAuthenticated ? client.getClientRoles(clientId) : []),
    [client, isAuthenticated],
  );

  return { hasRealmRole, hasClientRole, realmRoles, getClientRoles };
}

// ── ProtectedRoute ────────────────────────────────────────────────

export interface ProtectedRouteProps {
  children: ReactNode;
  /**
   * Required realm roles. The user must have ALL of these roles.
   * If empty or not set, only authentication is required.
   */
  roles?: string[];
  /**
   * Component to render while auth state is loading.
   * Defaults to null (render nothing).
   */
  fallback?: ReactNode;
  /**
   * Called when the user is not authenticated.
   * Use this to perform a redirect or render a login button.
   * If not provided, renders null when unauthenticated.
   */
  onUnauthorized?: () => ReactNode | null;
  /**
   * Called when the user lacks the required roles.
   * If not provided, renders null when unauthorized.
   */
  onForbidden?: () => ReactNode | null;
}

/**
 * Wraps content that requires authentication (and optionally specific roles).
 * Renders children when the user is authenticated and has required roles.
 *
 * ```tsx
 * <ProtectedRoute roles={['admin']}>
 *   <AdminPanel />
 * </ProtectedRoute>
 * ```
 */
export function ProtectedRoute({
  children,
  roles = [],
  fallback = null,
  onUnauthorized,
  onForbidden,
}: ProtectedRouteProps): ReactNode {
  const { isAuthenticated, isLoading, client } = useAuthContext();

  if (isLoading) {
    return fallback;
  }

  if (!isAuthenticated) {
    return onUnauthorized ? onUnauthorized() : null;
  }

  if (roles.length > 0) {
    const hasAllRoles = roles.every((role) => client.hasRealmRole(role));
    if (!hasAllRoles) {
      return onForbidden ? onForbidden() : null;
    }
  }

  return children;
}
