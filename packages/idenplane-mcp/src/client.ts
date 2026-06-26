export interface ClientConfig {
  serverUrl: string;
  adminToken: string;
}

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

export class IdenplaneClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: ClientConfig) {
    this.baseUrl = config.serverUrl;
    this.headers = {
      'Content-Type': 'application/json',
      'x-admin-api-key': config.adminToken,
    };
  }

  async get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }
    return this.request<T>('GET', url.toString());
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', `${this.baseUrl}${path}`, body);
  }

  async delete<T>(path: string, body?: unknown): Promise<T | undefined> {
    return this.request<T>('DELETE', `${this.baseUrl}${path}`, body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return undefined as T;

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (!res.ok) {
      const msg = json?.['message'] ?? json?.['error'] ?? res.statusText;
      const display = Array.isArray(msg) ? (msg as unknown[]).join(', ') : String(msg);
      throw new ApiError(res.status, display);
    }

    return json as T;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`HTTP ${status}: ${message}`);
    this.name = 'ApiError';
  }
}

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
