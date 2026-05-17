import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { haversineDistance } from './risk-signals.js';

export interface GeoCoords {
  lat: number;
  lon: number;
}

/**
 * Resolves geo-coordinates for an IP address and provides impossible-travel
 * feasibility checks.
 *
 * In production you would call a real geo-IP provider (ip-api.com, MaxMind,
 * etc.).  Here we use a lightweight local lookup via ip-api's free JSON
 * endpoint (or fall back to null when offline/unavailable) so the feature works
 * without any paid subscription.
 */
@Injectable()
export class ImpossibleTravelService {
  private readonly logger = new Logger(ImpossibleTravelService.name);

  /** Simple in-process LRU-style cache to avoid repeat lookups. */
  private readonly coordsCache = new Map<string, GeoCoords | null>();
  private readonly maxCacheSize = 1_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns lat/lon for the given IP, or null if the lookup fails or the IP is
   * private/loopback.
   */
  async lookupCoords(ip: string): Promise<GeoCoords | null> {
    if (!ip || this.isPrivateIp(ip)) return null;

    if (this.coordsCache.has(ip)) {
      return this.coordsCache.get(ip) ?? null;
    }

    try {
      // ip-api.com free endpoint — no API key required, rate-limited to 45 req/min
      const response = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,lat,lon`,
        {
          signal: AbortSignal.timeout(3_000),
        },
      );

      if (!response.ok) {
        this.cacheCoords(ip, null);
        return null;
      }

      const data = (await response.json()) as {
        status: string;
        lat?: number;
        lon?: number;
      };

      if (data.status !== 'success' || data.lat == null || data.lon == null) {
        this.cacheCoords(ip, null);
        return null;
      }

      const coords: GeoCoords = { lat: data.lat, lon: data.lon };
      this.cacheCoords(ip, coords);
      return coords;
    } catch (err) {
      this.logger.debug(
        `Geo-IP lookup failed for ${ip}: ${(err as Error).message}`,
      );
      this.cacheCoords(ip, null);
      return null;
    }
  }

  /**
   * Returns a city/country display string for the IP, or null.
   */
  async lookupLocation(ip: string): Promise<string | null> {
    if (!ip || this.isPrivateIp(ip)) return null;

    try {
      const response = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,country`,
        { signal: AbortSignal.timeout(3_000) },
      );

      if (!response.ok) return null;

      const data = (await response.json()) as {
        status: string;
        city?: string;
        country?: string;
      };

      if (data.status !== 'success') return null;
      const parts = [data.city, data.country].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : null;
    } catch {
      return null;
    }
  }

  /**
   * Checks whether travelling from `prevCoords` to `currCoords` between the
   * two timestamps is physically feasible.
   *
   * Returns `{ feasible: true }` when it is, or `{ feasible: false, distanceKm,
   * elapsedHours }` when not.
   */
  checkFeasibility(
    prevCoords: GeoCoords,
    prevTimestamp: Date,
    currCoords: GeoCoords,
    currTimestamp: Date,
  ): { feasible: boolean; distanceKm: number; elapsedHours: number } {
    const distanceKm = haversineDistance(
      [prevCoords.lat, prevCoords.lon],
      [currCoords.lat, currCoords.lon],
    );
    const elapsedHours =
      (currTimestamp.getTime() - prevTimestamp.getTime()) / (1_000 * 60 * 60);

    // Max feasible speed: 900 km/h (aircraft) × 1.2 buffer
    const maxFeasibleKm = Math.max(elapsedHours * 900 * 1.2, 0);
    const feasible = distanceKm <= maxFeasibleKm;

    return { feasible, distanceKm, elapsedHours };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private cacheCoords(ip: string, coords: GeoCoords | null): void {
    if (this.coordsCache.size >= this.maxCacheSize) {
      // Evict oldest entry
      const firstKey = this.coordsCache.keys().next().value as
        | string
        | undefined;
      if (firstKey !== undefined) {
        this.coordsCache.delete(firstKey);
      }
    }
    this.coordsCache.set(ip, coords);
  }

  private isPrivateIp(ip: string): boolean {
    return (
      ip === '::1' ||
      ip === '127.0.0.1' ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') ||
      ip.startsWith('172.2') ||
      ip.startsWith('172.30.') ||
      ip.startsWith('172.31.') ||
      ip === 'localhost'
    );
  }
}
