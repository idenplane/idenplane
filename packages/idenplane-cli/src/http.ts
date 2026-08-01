import chalk from 'chalk';
import { buildUrlWithQuery, extractErrorMessage, rawRequest } from '@idenplane/http-internal';
import { requireAuth } from './config.js';
import type { CliConfig } from './types.js';

export class HttpClient {
  private serverUrl: string;
  private headers: Record<string, string>;

  constructor(config?: { serverUrl: string; headers?: Record<string, string> }) {
    const { serverUrl, headers } = config ?? requireAuth();
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      ...headers,
    };
  }

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', buildUrlWithQuery(this.serverUrl, path, query));
  }

  async post<T>(path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', buildUrlWithQuery(this.serverUrl, path, query), body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', buildUrlWithQuery(this.serverUrl, path), body);
  }

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
