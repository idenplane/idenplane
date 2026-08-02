import chalk from 'chalk';
import { buildUrlWithQuery, extractErrorMessage, rawRequest } from '@idenplane/http-internal';
import { requireAuth } from './config.js';
import type { CliConfig } from './types.js';

/**
 * Thin JSON HTTP client for talking to the Idenplane admin API.
 *
 * Every method resolves with the parsed JSON response body, except that a
 * `204 No Content` response resolves with `undefined` regardless of the
 * requested type `T`. A non-2xx response rejects with an `Error` whose
 * message is the chalk-red-colored string `Error <status>: <server message>`
 * (server message extracted via `extractErrorMessage`).
 */
export class HttpClient {
  private serverUrl: string;
  private headers: Record<string, string>;

  /**
   * If `config` is omitted, credentials and server URL are resolved via
   * `requireAuth()` (env vars, falling back to the saved CLI config).
   *
   * @throws {Error} If `config` is omitted and no credentials are available
   * from either environment variables or the saved config file (the error
   * message from `requireAuth()` tells the user to run `idenplane login`).
   */
  constructor(config?: { serverUrl: string; headers?: Record<string, string> }) {
    const { serverUrl, headers } = config ?? requireAuth();
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      ...headers,
    };
  }

  /** Send a `GET` request, optionally appending `query` as URL search params. */
  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', buildUrlWithQuery(this.serverUrl, path, query));
  }

  /** Send a `POST` request with a JSON `body`, optionally appending `query` as URL search params. */
  async post<T>(path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', buildUrlWithQuery(this.serverUrl, path, query), body);
  }

  /** Send a `PUT` request with a JSON `body`. */
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', buildUrlWithQuery(this.serverUrl, path), body);
  }

  /**
   * Send a `DELETE` request, optionally with a JSON `body`.
   * Resolves with `undefined` on the typical `204 No Content` response.
   */
  async delete<T>(path: string, body?: unknown): Promise<T | void> {
    return this.request<T>('DELETE', buildUrlWithQuery(this.serverUrl, path), body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await rawRequest({ method, url, headers: this.headers, body });

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      const error = new Error(`Error ${response.status}: ${extractErrorMessage(response)}`);
      error.message = chalk.red(error.message);
      throw error;
    }

    return response.json as T;
  }
}

/**
 * Build an `HttpClient` from an already-loaded `CliConfig` instead of
 * resolving credentials via `requireAuth()`. Prefers `apiKey` over
 * `accessToken` when both are present; if neither is set, the returned
 * client sends no auth header.
 */
export function createHttpClient(config: CliConfig): HttpClient {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['x-admin-api-key'] = config.apiKey;
  } else if (config.accessToken) {
    headers['Authorization'] = `Bearer ${config.accessToken}`;
  }
  return new HttpClient({ serverUrl: config.serverUrl, headers });
}

/**
 * Normalize a caught error into a chalk-red-colored `Error` and rethrow it.
 * Intended for wrapping command actions that call the HTTP client so
 * failures are reported consistently, e.g. `try { ... } catch (e) { handleApiError(e); }`.
 *
 * @throws {Error} Always — this function never returns.
 */
export function handleApiError(error: unknown): never {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  throw new Error(chalk.red(message));
}
