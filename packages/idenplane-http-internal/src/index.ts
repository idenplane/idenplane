/**
 * Shared fetch-wrapper internals for idenplane-cli and idenplane-mcp. Both
 * clients need the same request plumbing (URL-with-query-params
 * construction, the 204→no-body short-circuit, the `message`/`error`/
 * statusText fallback chain for extracting an error message) but want to
 * throw their own error type (CLI: a chalk-formatted `Error`; MCP: `ApiError`)
 * so that stays in each package.
 */

export interface RequestOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface RawResponse {
  status: number;
  statusText: string;
  ok: boolean;
  /** Parsed JSON body, or `null` for a 204 response or an unparseable body. */
  json: Record<string, unknown> | null;
}

/**
 * Performs the fetch and parses the body as JSON. Never throws on a non-2xx
 * status — inspect `RawResponse.ok`/`status` and call `extractErrorMessage`
 * to build a caller-specific error.
 */
export async function rawRequest(options: RequestOptions): Promise<RawResponse> {
  const res = await fetch(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) {
    return { status: res.status, statusText: res.statusText, ok: res.ok, json: null };
  }

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, statusText: res.statusText, ok: res.ok, json };
}

/**
 * Extracts a human-readable error message from a JSON error body, falling
 * back to the HTTP status text when the body has neither `message` nor
 * `error`.
 */
export function extractErrorMessage(response: Pick<RawResponse, 'json' | 'statusText'>): string {
  const msg = response.json?.['message'] ?? response.json?.['error'] ?? response.statusText;
  return Array.isArray(msg) ? msg.join(', ') : String(msg);
}

/** Joins `baseUrl` + `path` and appends `query` as URL search params, skipping `undefined` values. */
export function buildUrlWithQuery(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}
