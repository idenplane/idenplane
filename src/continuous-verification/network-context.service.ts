import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { evaluateNetworkContext } from './continuous-risk-signals.js';
import type { NetworkContextData, ContinuousRiskSignal } from './continuous-risk-signals.js';

export interface NetworkContextRecord {
  ipAddress: string;
  geoCountry: string | null;
  geoCity: string | null;
  geoLatitude: number | null;
  geoLongitude: number | null;
  asn: string | null;
  isp: string | null;
  networkType: string | null;
  ispCategory: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  connectionType: string | null;
  ipReputation: string;
  geoVelocity: string | null;
  isDatacenter: boolean;
  geoChanged: boolean;
  capturedAt: Date;
}

export interface NetworkContextPolicies {
  allowVPNAcrossCountries: boolean;
  blockTorNodes: boolean;
  blockDatacenterIPs: boolean;
  allowedCountries: string[] | null;
  blockedASNs: string[] | null;
}

/**
 * Captures and evaluates network context for continuous session verification.
 *
 * Resolves IP addresses to geolocation, ISP, ASN, and network type information
 * using ip-api.com's free JSON endpoint (with LRU cache for repeat lookups).
 * Integrates with the Prisma NetworkContextRecord model to persist context
 * per session and detect geolocation changes.
 *
 * In production you would supplement with paid VPN/TOR/IP-reputation databases
 * (e.g., MaxMind GeoIP2, Proofpoint ET Intelligence, AbuseIPDB) for more
 * accurate detection.
 */
@Injectable()
export class NetworkContextService {
  private readonly logger = new Logger(NetworkContextService.name);

  /** LRU cache for IP lookups to avoid repeat calls to ip-api.com. */
  private readonly ipCache = new Map<string, IpLookupResult | null>();
  private readonly maxCacheSize = 1_000;

  constructor(private readonly prisma: PrismaService) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Captures the current network context for a session and persists it to the DB.
   *
   * @param sessionId - Active session identifier
   * @param realmId - Realm for the session
   * @param userId - User owning the session
   * @param ipAddress - Client IP address (may be behind a trusted proxy)
   */
  async captureNetworkContext(
    sessionId: string,
    realmId: string,
    userId: string,
    ipAddress: string,
  ): Promise<NetworkContextRecord> {
    const lookup = await this.lookupIp(ipAddress);

    const record = await this.prisma.networkContextRecord.create({
      data: {
        sessionId,
        realmId,
        userId,
        ipAddress,
        ipVersion: lookup.ipVersion,
        geoCountry: lookup.country,
        geoCity: lookup.city,
        geoLatitude: lookup.latitude,
        geoLongitude: lookup.longitude,
        asn: lookup.asn,
        isp: lookup.isp,
        networkType: lookup.networkType,
        ispCategory: lookup.ispCategory,
        isVpn: lookup.isVpn,
        isProxy: lookup.isProxy,
        isTor: lookup.isTor,
        connectionType: lookup.connectionType,
        ipReputationScore: lookup.ipReputation,
        geoVelocity: lookup.geoVelocity,
        isDatacenter: lookup.isDatacenter,
        geoChanged: false,
      },
    });

    // Check for geolocation change against most recent previous record
    const previousRecord = await this.getLastNetworkContext(sessionId);
    if (previousRecord && previousRecord.id !== record.id) {
      const changed = this.detectGeoChange(record, previousRecord);
      if (changed) {
        await this.prisma.networkContextRecord.update({
          where: { id: record.id },
          data: {
            geoChanged: true,
            geoChangeDetails: JSON.stringify({
              previousCountry: previousRecord.geoCountry,
              previousCity: previousRecord.geoCity,
              previousLatitude: previousRecord.geoLatitude,
              previousLongitude: previousRecord.geoLongitude,
              newCountry: record.geoCountry,
              newCity: record.geoCity,
              newLatitude: record.geoLatitude,
              newLongitude: record.geoLongitude,
            }),
          },
        });
        // Re-fetch to return updated record
        return (await this.prisma.networkContextRecord.findUniqueOrThrow({
          where: { id: record.id },
        })) as unknown as NetworkContextRecord;
      }
    }

    return record as unknown as NetworkContextRecord;
  }

  /**
   * Returns the most recent network context for a session.
   */
  async getLastNetworkContext(sessionId: string): Promise<NetworkContextRecord | null> {
    const record = await this.prisma.networkContextRecord.findFirst({
      where: { sessionId },
      orderBy: { capturedAt: 'desc' },
    });
    return record as unknown as NetworkContextRecord | null;
  }

  /**
   * Returns the network context history for a session.
   */
  async getNetworkContextHistory(sessionId: string): Promise<NetworkContextRecord[]> {
    const records = await this.prisma.networkContextRecord.findMany({
      where: { sessionId },
      orderBy: { capturedAt: 'desc' },
    });
    return records as unknown as NetworkContextRecord[];
  }

  /**
   * Returns all recent network context records for a user across sessions.
   */
  async getUserNetworkHistory(
    userId: string,
    since: Date,
  ): Promise<NetworkContextRecord[]> {
    const records = await this.prisma.networkContextRecord.findMany({
      where: {
        userId,
        capturedAt: { gte: since },
      },
      orderBy: { capturedAt: 'desc' },
    });
    return records as unknown as NetworkContextRecord[];
  }

  /**
   * Detects geolocation change between two network context records.
   */
  detectGeoChange(current: NetworkContextRecord, previous: NetworkContextRecord): boolean {
    if (!current.geoCountry || !previous.geoCountry) return false;
    if (current.geoCountry !== previous.geoCountry) return true;
    // City-level change within same country
    if (current.geoCity && previous.geoCity && current.geoCity !== previous.geoCity) {
      const distanceKm = this.haversineDistance(
        current.geoLatitude ?? 0,
        current.geoLongitude ?? 0,
        previous.geoLatitude ?? 0,
        previous.geoLongitude ?? 0,
      );
      // Flag as significant if > 100km apart
      return distanceKm > 100;
    }
    return false;
  }

  /**
   * Evaluates network context against configurable policies and returns a risk signal.
   */
  evaluateNetworkRisk(
    context: NetworkContextRecord,
    policies: NetworkContextPolicies = {
      allowVPNAcrossCountries: true,
      blockTorNodes: false,
      blockDatacenterIPs: false,
      allowedCountries: null,
      blockedASNs: null,
    },
  ): ContinuousRiskSignal {
    const data: NetworkContextData = {
      ipAddress: context.ipAddress,
      isp: context.isp,
      asn: context.asn,
      vpnDetected: context.isVpn,
      proxyDetected: context.isProxy,
      torExitNode: context.isTor,
      datacenter: context.isDatacenter,
      asnReputation: this.parseReputation(context.ipReputation),
      country: context.geoCountry,
      city: context.geoCity,
      latitude: context.geoLatitude ?? null,
      longitude: context.geoLongitude ?? null,
    };

    return evaluateNetworkContext(data, policies);
  }

  /**
   * Builds a NetworkContextData payload from the latest session context,
   * suitable for passing into risk signal evaluation.
   */
  async buildNetworkContextData(sessionId: string): Promise<NetworkContextData | null> {
    const record = await this.getLastNetworkContext(sessionId);
    if (!record) return null;

    return {
      ipAddress: record.ipAddress,
      isp: record.isp,
      asn: record.asn,
      vpnDetected: record.isVpn,
      proxyDetected: record.isProxy,
      torExitNode: record.isTor,
      datacenter: record.isDatacenter,
      asnReputation: this.parseReputation(record.ipReputation),
      country: record.geoCountry,
      city: record.geoCity,
      latitude: record.geoLatitude ?? null,
      longitude: record.geoLongitude ?? null,
    };
  }

  // ── IP Lookup ────────────────────────────────────────────────────────────────

  /**
   * Resolves an IP address to geolocation, ASN, ISP, and network-type data.
   * Uses ip-api.com's free endpoint with LRU caching.
   */
  async lookupIp(ip: string): Promise<IpLookupResult> {
    if (!ip || this.isPrivateIp(ip)) {
      return this.privateIpResult(ip);
    }

    if (this.ipCache.has(ip)) {
      return this.ipCache.get(ip) ?? this.privateIpResult(ip);
    }

    try {
      const response = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,city,lat,lon,asn,isp,org,hosting,proxy,vpn,tor`,
        { signal: AbortSignal.timeout(3_000) },
      );

      if (!response.ok) {
        const result = this.unknownResult(ip);
        this.cacheIp(ip, result);
        return result;
      }

      const data = (await response.json()) as IpApiResponse;

      if (data.status === 'fail') {
        const result = this.unknownResult(ip);
        this.cacheIp(ip, result);
        return result;
      }

      const result: IpLookupResult = {
        ipAddress: ip,
        ipVersion: ip.includes('.') ? 4 : 6,
        country: data.country ?? null,
        city: data.city ?? null,
        latitude: data.lat ?? null,
        longitude: data.lon ?? null,
        asn: data.asn ?? null,
        isp: data.isp ?? null,
        networkType: this.inferNetworkType(data),
        ispCategory: this.inferIspCategory(data),
        isVpn: data.vpn === true,
        isProxy: data.proxy === true,
        isTor: data.tor === true,
        connectionType: null, // Not available from ip-api.com
        ipReputation: this.inferReputation(data),
        geoVelocity: null,
        isDatacenter: data.hosting === true,
      };

      this.cacheIp(ip, result);
      return result;
    } catch (err) {
      this.logger.debug(`IP lookup failed for ${ip}: ${(err as Error).message}`);
      const result = this.unknownResult(ip);
      this.cacheIp(ip, result);
      return result;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private cacheIp(ip: string, result: IpLookupResult): void {
    if (this.ipCache.size >= this.maxCacheSize) {
      const firstKey = this.ipCache.keys().next().value;
      if (firstKey !== undefined) {
        this.ipCache.delete(firstKey);
      }
    }
    this.ipCache.set(ip, result);
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

  private inferNetworkType(data: IpApiResponse): string | null {
    if (data.vpn) return 'VPN';
    if (data.tor) return 'TOR';
    if (data.proxy) return 'PROXY';
    if (data.hosting) return 'DATACENTER';
    return null;
  }

  private inferIspCategory(data: IpApiResponse): string | null {
    if (!data.isp) return null;
    const isp = data.isp.toLowerCase();
    if (isp.includes('university') || isp.includes('college') || isp.includes('school')) {
      return 'EDUCATIONAL';
    }
    if (isp.includes('government') || isp.includes('gov')) return 'GOVERNMENT';
    if (isp.includes('enterprise') || isp.includes('business')) return 'ENTERPRISE';
    return 'ISP';
  }

  private inferReputation(data: IpApiResponse): string {
    if (data.vpn || data.tor || data.proxy) return 'SUSPICIOUS';
    if (data.hosting) return 'NEUTRAL';
    return 'GOOD';
  }

  private parseReputation(value: string): 'TRUSTED' | 'NEUTRAL' | 'SUSPICIOUS' | 'BLOCKED' {
    const upper = value.toUpperCase();
    if (upper === 'GOOD' || upper === 'TRUSTED') return 'TRUSTED';
    if (upper === 'BAD') return 'BLOCKED';
    if (upper === 'SUSPICIOUS') return 'SUSPICIOUS';
    return 'NEUTRAL';
  }

  private privateIpResult(ip: string): IpLookupResult {
    return {
      ipAddress: ip,
      ipVersion: ip.includes('.') ? 4 : 6,
      country: null,
      city: null,
      latitude: null,
      longitude: null,
      asn: null,
      isp: null,
      networkType: 'PRIVATE',
      ispCategory: null,
      isVpn: false,
      isProxy: false,
      isTor: false,
      connectionType: null,
      ipReputation: 'GOOD',
      geoVelocity: null,
      isDatacenter: false,
    };
  }

  private unknownResult(ip: string): IpLookupResult {
    return {
      ipAddress: ip,
      ipVersion: ip.includes('.') ? 4 : 6,
      country: null,
      city: null,
      latitude: null,
      longitude: null,
      asn: null,
      isp: null,
      networkType: null,
      ispCategory: null,
      isVpn: false,
      isProxy: false,
      isTor: false,
      connectionType: null,
      ipReputation: 'UNKNOWN',
      geoVelocity: null,
      isDatacenter: false,
    };
  }

  /**
   * Haversine distance between two lat/lon pairs in km.
   */
  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}

// ─── Types for IP lookup ──────────────────────────────────────────────────────

interface IpLookupResult {
  ipAddress: string;
  ipVersion: number | null;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  asn: string | null;
  isp: string | null;
  networkType: string | null;
  ispCategory: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  connectionType: string | null;
  ipReputation: string;
  geoVelocity: string | null;
  isDatacenter: boolean;
}

interface IpApiResponse {
  status: string;
  message?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  lat?: number;
  lon?: number;
  asn?: string;
  isp?: string;
  org?: string;
  hosting?: boolean;
  proxy?: boolean;
  vpn?: boolean;
  tor?: boolean;
}