import chalk from 'chalk';
import { requireAuth } from './config.js';
import type { CliConfig } from './types.js';

export class HttpClient {
  private serverUrl: string;
  private headers: Record<string, string>;

  constructor(config?: { serverUrl: string; headers?: Record<string, string> }) {
    if (config) {
      this.serverUrl = config.serverUrl.replace(/\/$/, '');
      this.headers = {
        'Content-Type': 'application/json',
        ...config.headers,
      };
    } else {
      const auth = requireAuth();
      this.serverUrl = auth.serverUrl.replace(/\/$/, '');
      this.headers = {
        'Content-Type': 'application/json',
        ...auth.headers,
      };
    }
  }

  private url(path: string): string {
    return `${this.serverUrl}${path}`;
  }

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(this.url(path));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }
    return this.request<T>('GET', url.toString());
  }

  async post<T>(path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    let fullUrl = this.url(path);
    if (query) {
      const url = new URL(fullUrl);
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
      fullUrl = url.toString();
    }
    return this.request<T>('POST', fullUrl, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', this.url(path), body);
  }

  async delete<T>(path: string, body?: unknown): Promise<T | void> {
    return this.request<T>('DELETE', this.url(path), body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return undefined as T;

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (!res.ok) {
      const msg = (json?.message ?? json?.error ?? res.statusText) as unknown;
      const display = Array.isArray(msg) ? msg.join(', ') : msg;
      const error = new Error(`Error ${res.status}: ${display}`);
      error.message = chalk.red(error.message);
      throw error;
    }

    return json as T;
  }
}

export function createHttpClient(config: CliConfig): HttpClient {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['x-admin-api-key'] = config.apiKey;
  } else if (config.accessToken) {
    headers['Authorization'] = `Bearer ${config.accessToken}`;
  }
  return new HttpClient({ serverUrl: config.serverUrl, headers });
}

export function handleApiError(error: unknown): never {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  throw new Error(chalk.red(message));
}
