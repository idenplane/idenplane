import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
  AggregatorRegistry,
} from 'prom-client';
import cluster from 'node:cluster';
import { randomUUID } from 'node:crypto';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;
  readonly authLoginTotal: Counter;
  readonly authTokenIssuedTotal: Counter;
  readonly activeSessionsTotal: Gauge;
  readonly rateLimitHitsTotal: Counter;
  readonly rateLimitChecksTotal: Counter;
  readonly cacheOperationsTotal: Counter;

  constructor() {
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.authLoginTotal = new Counter({
      name: 'auth_login_total',
      help: 'Total number of login attempts',
      labelNames: ['realm', 'status'],
      registers: [this.registry],
    });

    this.authTokenIssuedTotal = new Counter({
      name: 'auth_token_issued_total',
      help: 'Total number of tokens issued',
      labelNames: ['realm', 'grant_type'],
      registers: [this.registry],
    });

    this.activeSessionsTotal = new Gauge({
      name: 'active_sessions_total',
      help: 'Number of active sessions',
      labelNames: ['realm'],
      registers: [this.registry],
    });

    this.rateLimitHitsTotal = new Counter({
      name: 'rate_limit_hits_total',
      help: 'Total number of rate limit rejections (429)',
      labelNames: ['type', 'realm'],
      registers: [this.registry],
    });

    this.rateLimitChecksTotal = new Counter({
      name: 'rate_limit_checks_total',
      help: 'Total number of rate limit checks performed',
      labelNames: ['type', 'realm'],
      registers: [this.registry],
    });

    this.cacheOperationsTotal = new Counter({
      name: 'cache_operations_total',
      help: 'Total number of cache hits and misses',
      labelNames: ['operation', 'cache'],
      registers: [this.registry],
    });
  }

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
    // In cluster mode the primary gathers every worker's registry.
    if (cluster.isWorker) {
      // Constructing one is what makes prom-client answer the primary's
      // requests (setRegistries alone does not); it then reports ours.
      new AggregatorRegistry();
      AggregatorRegistry.setRegistries([this.registry]);
    }
  }

  /**
   * The metrics to serve: this process's, or in cluster mode every worker's,
   * aggregated by the primary (a scrape lands on one worker at random, and
   * must see the whole container).
   */
  async metricsText(): Promise<string> {
    if (!cluster.isWorker || !process.send) return this.registry.metrics();
    const id = randomUUID();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        process.off('message', onMessage);
        reject(new Error('The cluster primary did not answer for metrics'));
      }, 5_000);
      const onMessage = (message: unknown) => {
        const m = message as {
          type?: string;
          id?: string;
          body?: string;
          error?: string;
        };
        if (m?.type !== 'idenplane:metrics:response' || m.id !== id) return;
        clearTimeout(timer);
        process.off('message', onMessage);
        if (m.error) reject(new Error(m.error));
        else resolve(m.body ?? '');
      };
      process.on('message', onMessage);
      process.send!({ type: 'idenplane:metrics:request', id });
    });
  }
}
