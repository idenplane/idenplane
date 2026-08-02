import { buildUrlWithQuery, extractErrorMessage, rawRequest } from '@idenplane/http-internal';

/** Configuration required to talk to an Idenplane admin API. */
export interface ClientConfig {
  /** Base URL of the Idenplane server (trailing slash stripped by {@link getConfig}). */
  serverUrl: string;
  /** Admin API token, sent as the `x-admin-api-key` header on every request. */
  adminToken: string;
}

/**
 * Reads and validates the `IDENPLANE_URL` and `IDENPLANE_ADMIN_TOKEN`
 * environment variables into a {@link ClientConfig}.
 *
 * @returns The resolved client configuration, with `serverUrl`'s trailing slash removed.
 * @throws {Error} If `IDENPLANE_URL` or `IDENPLANE_ADMIN_TOKEN` is not set.
 */
export function getConfig(): ClientConfig {
  const serverUrl = process.env['IDENPLANE_URL'];
  const adminToken = process.env['IDENPLANE_ADMIN_TOKEN'];

  if (!serverUrl) {
    throw new Error('IDENPLANE_URL environment variable is required');
  }
  if (!adminToken) {
    throw new Error('IDENPLANE_ADMIN_TOKEN environment variable is required');
  }

  return { serverUrl: serverUrl.replace(/\/$/, ''), adminToken };
}

/**
 * Thin HTTP client for the Idenplane admin API. Wraps `@idenplane/http-internal`'s
 * `rawRequest` to add the admin auth header, JSON content type, and
 * translation of non-ok responses into {@link ApiError}.
 */
export class IdenplaneClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  /**
   * @param config Server URL and admin token used to authenticate every request
   *   (sent as the `x-admin-api-key` header, not `Authorization`).
   */
  constructor(config: ClientConfig) {
    this.baseUrl = config.serverUrl;
    this.headers = {
      'Content-Type': 'application/json',
      'x-admin-api-key': config.adminToken,
    };
  }

  /**
   * Issues a `GET` request.
   *
   * @param path Admin API path, appended to the configured base URL.
   * @param query Optional query parameters; entries with an `undefined` value are omitted.
   * @returns The parsed JSON response body. Note: on a `204 No Content`
   *   response this resolves to `undefined` at runtime even though the
   *   return type is `Promise<T>` (the type does not reflect this case).
   * @throws {ApiError} If the response status is not ok.
   */
  async get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    return this.request<T>('GET', buildUrlWithQuery(this.baseUrl, path, query));
  }

  /**
   * Issues a `POST` request with a JSON-serialized body.
   *
   * @param path Admin API path, appended to the configured base URL.
   * @param body Optional request body, JSON-serialized.
   * @returns The parsed JSON response body. Note: on a `204 No Content`
   *   response this resolves to `undefined` at runtime even though the
   *   return type is `Promise<T>` (the type does not reflect this case).
   * @throws {ApiError} If the response status is not ok.
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', buildUrlWithQuery(this.baseUrl, path), body);
  }

  /**
   * Issues a `PUT` request with a JSON-serialized body.
   *
   * @param path Admin API path, appended to the configured base URL.
   * @param body Optional request body, JSON-serialized.
   * @returns The parsed JSON response body. Note: on a `204 No Content`
   *   response this resolves to `undefined` at runtime even though the
   *   return type is `Promise<T>` (the type does not reflect this case).
   * @throws {ApiError} If the response status is not ok.
   */
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', buildUrlWithQuery(this.baseUrl, path), body);
  }

  /**
   * Issues a `DELETE` request. Some admin endpoints (e.g. bulk role-mapping
   * removal) accept a JSON body on `DELETE`, so one can still be passed.
   *
   * @param path Admin API path, appended to the configured base URL.
   * @param body Optional request body, JSON-serialized.
   * @returns The parsed JSON response body, or `undefined` for a `204 No Content` response.
   * @throws {ApiError} If the response status is not ok.
   */
  async delete<T>(path: string, body?: unknown): Promise<T | undefined> {
    return this.request<T>('DELETE', buildUrlWithQuery(this.baseUrl, path), body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await rawRequest({ method, url, headers: this.headers, body });

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      throw new ApiError(response.status, extractErrorMessage(response));
    }

    return response.json as T;
  }
}

/** Thrown by {@link IdenplaneClient} when the admin API returns a non-ok HTTP status. */
export class ApiError extends Error {
  /**
   * @param status HTTP status code of the failed response.
   * @param message Human-readable error detail extracted from the response body
   *   (see `extractErrorMessage` in `@idenplane/http-internal`); combined with
   *   `status` into this error's `message` as `HTTP <status>: <message>`.
   */
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`HTTP ${status}: ${message}`);
    this.name = 'ApiError';
  }
}

/**
 * Converts a caught error into a plain string suitable for an MCP tool's
 * error output. `ApiError` (and any other `Error`) yields its `message`
 * (an `ApiError` message is already formatted as `HTTP <status>: <detail>`);
 * anything else falls back to a generic message.
 *
 * @param err The value caught from a tool handler, of unknown type.
 * @returns A human-readable error string.
 */
export function toToolError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    const msg = err.message;
    return msg;
  }
  return 'An unexpected error occurred';
}
