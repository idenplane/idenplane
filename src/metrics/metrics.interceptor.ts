import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const startTime = process.hrtime.bigint();
    const normalizedPath = this.normalizePath(request.path);

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          this.recordMetrics(
            request.method,
            normalizedPath,
            response.statusCode,
            startTime,
          );
        },
        error: (err: unknown) => {
          const errRecord = err as {
            status?: number;
            getStatus?: () => number;
          };
          const status = errRecord.status ?? errRecord.getStatus?.() ?? 500;
          this.recordMetrics(request.method, normalizedPath, status, startTime);
        },
      }),
    );
  }

  private recordMetrics(
    method: string,
    path: string,
    status: number,
    startTime: bigint,
  ): void {
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;

    this.metricsService.httpRequestsTotal.inc({
      method,
      path,
      status: String(status),
    });

    this.metricsService.httpRequestDuration.observe(
      { method, path },
      durationSeconds,
    );
  }

  private normalizePath(path: string): string {
    return path.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id',
    );
  }
}
