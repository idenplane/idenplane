/**
 * Plugin & Extension System Interfaces
 *
 * All plugins must implement AuthMePlugin as the base interface.
 * Additional capability interfaces extend AuthMePlugin.
 */

// ─── Context ──────────────────────────────────────────────────────────────────

export interface PluginContext {
  /** PrismaClient instance for database access */
  prisma: any;
  /** NestJS Logger instance scoped to the plugin name */
  logger: any;
  /** Plugin-specific configuration stored in the database */
  config: Record<string, any>;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface PluginEvent {
  /** The event type identifier, e.g. "user.login" */
  type: string;
  /** ISO timestamp when the event occurred */
  timestamp: string;
  realmId?: string;
  userId?: string;
  sessionId?: string;
  clientId?: string;
  ipAddress?: string;
  error?: string;
  details?: Record<string, unknown>;
}

// ─── Auth Results ─────────────────────────────────────────────────────────────

export interface AuthResult {
  success: boolean;
  userId?: string;
  claims?: Record<string, unknown>;
  error?: string;
}

// ─── Plugin Types ─────────────────────────────────────────────────────────────

export type PluginType =
  | 'auth-provider'
  | 'event-listener'
  | 'token-enrichment'
  | 'theme';

// ─── Base Plugin ──────────────────────────────────────────────────────────────

export interface AuthMePlugin {
  name: string;
  version: string;
  description?: string;
  /** The plugin type — used to route plugin to the correct extension point. */
  type: PluginType;

  onInstall?(context: PluginContext): Promise<void>;
  onEnable?(context: PluginContext): Promise<void>;
  onDisable?(context: PluginContext): Promise<void>;
  onUninstall?(context: PluginContext): Promise<void>;
}

// ─── Capability Extensions ────────────────────────────────────────────────────

export interface AuthProviderPlugin extends AuthMePlugin {
  type: 'auth-provider';
  authenticate(credentials: any, realm: string): Promise<AuthResult>;
  validateToken?(token: string): Promise<boolean>;
}

export interface EventListenerPlugin extends AuthMePlugin {
  type: 'event-listener';
  onEvent(event: PluginEvent): Promise<void>;
  subscribedEvents: string[];
}

export interface TokenEnrichmentPlugin extends AuthMePlugin {
  type: 'token-enrichment';
  enrichToken(token: any, user: any, realm: string): Promise<any>;
}

export interface ThemePlugin extends AuthMePlugin {
  type: 'theme';
  themeName: string;
  getTemplates(): Record<string, string>;
  getStyles(): string;
}

// ─── Type Guards ──────────────────────────────────────────────────────────────

export function isAuthProviderPlugin(p: AuthMePlugin): p is AuthProviderPlugin {
  return p.type === 'auth-provider';
}

export function isEventListenerPlugin(
  p: AuthMePlugin,
): p is EventListenerPlugin {
  return p.type === 'event-listener';
}

export function isTokenEnrichmentPlugin(
  p: AuthMePlugin,
): p is TokenEnrichmentPlugin {
  return p.type === 'token-enrichment';
}

export function isThemePlugin(p: AuthMePlugin): p is ThemePlugin {
  return p.type === 'theme';
}
