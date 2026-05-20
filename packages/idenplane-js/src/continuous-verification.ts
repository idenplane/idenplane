/**
 * Continuous Verification SDK for Idenplane
 *
 * Provides methods for client applications to report device posture and
 * behavioral biometric signals for continuous session risk assessment.
 *
 * @example
 * ```typescript
 * import { AuthmeClient } from 'idenplane-sdk';
 * import { ContinuousVerification } from 'idenplane-sdk/continuous-verification';
 *
 * const client = new AuthmeClient(config);
 * const cv = new ContinuousVerification(client);
 *
 * // Report device posture
 * await cv.reportDevicePosture({
 *   osType: 'Windows',
 *   osVersion: '11.0.22631.2506',
 *   diskEncrypted: true,
 *   screenLockEnabled: true,
 *   antivirusEnabled: true,
 *   firewallEnabled: true,
 * });
 *
 * // Record typing pattern sample
 * await cv.recordBehavioralSample({
 *   sessionId: 'session-123',
 *   interactionType: 'typing',
 *   burstLength: 150,
 *   latency: 45,
 * });
 * ```
 */

import type { AuthmeClient } from './client.js';

// ─── Device Posture Types ────────────────────────────────────────────────────

export interface DevicePostureInput {
  /** Operating system type (e.g., "Windows", "macOS", "Linux", "iOS", "Android") */
  osType?: string;
  /** Operating system version string */
  osVersion?: string;
  /** OS build identifier (Windows-specific) */
  osBuild?: string;
  /** Security patch level / last update date (ISO date string) */
  securityPatchLevel?: string;
  /** When the OS was last updated */
  lastUpdateDate?: string;
  /** Whether full disk encryption is enabled */
  diskEncrypted?: boolean;
  /** Type of encryption (e.g., "AES-256", "FileVault", "BitLocker") */
  encryptionType?: string;
  /** Whether antivirus/EDR is active */
  antivirusEnabled?: boolean;
  /** Name of the antivirus/EDR product */
  antivirusName?: string;
  /** Whether the system firewall is enabled */
  firewallEnabled?: boolean;
  /** Whether screen lock is enabled */
  screenLockEnabled?: boolean;
  /** Screen lock timeout in seconds */
  lockTimeoutSeconds?: number;
  /** Whether the device is enrolled in MDM (Mobile Device Management) */
  managedDevice?: boolean;
  /** MDM enrollment identifier */
  mdmEnrollmentId?: string;
  /** Whether the device is jailbroken (iOS) or rooted (Android) */
  jailbroken?: boolean;
  /** Device trust tier classification */
  deviceTrustTier?: 'TRUSTED' | 'MANAGED' | 'UNKNOWN' | 'UNTRUSTED';
  /** Compliance status from MDM/EDR check */
  complianceStatus?: 'COMPLIANT' | 'NON_COMPLIANT' | 'UNKNOWN';
  /** Arbitrary compliance details from MDM (serialized object) */
  complianceDetails?: Record<string, unknown>;
}

export interface DevicePostureResponse {
  success: boolean;
  recordedAt: string;
}

// ─── Behavioral Biometrics Types ─────────────────────────────────────────────

export type InteractionType = 'typing' | 'pointer' | 'scroll' | 'keystroke';

export interface BehavioralSampleInput {
  /** Session ID for associating the sample with a session */
  sessionId: string;
  /** Type of interaction captured */
  interactionType: InteractionType;
  /** Duration of the interaction burst in milliseconds */
  burstLength?: number;
  /** Inter-key latency in milliseconds (typing only) */
  latency?: number;
  /** Pointer velocity in pixels per second (pointer only) */
  velocity?: number;
  /** Pointer movement variance (pointer only) */
  variance?: number;
  /** Scroll velocity in pixels per second (scroll only) */
  scrollVelocity?: number;
  /** Number of keystrokes / clicks / scroll events in the burst */
  eventCount?: number;
  /** Whether the interaction contained errors (typing only) */
  hasErrors?: boolean;
  /** Timestamp when the sample was collected (ISO date string) */
  collectedAt?: string;
}

export interface BehavioralSampleBatchInput {
  /** Session ID for associating the samples */
  sessionId: string;
  /** Array of individual interaction samples */
  samples: Omit<BehavioralSampleInput, 'sessionId'>[];
}

export interface BehavioralSamplesResponse {
  success: boolean;
  recordedCount: number;
  recordedAt: string;
}

// ─── Network Context Types ────────────────────────────────────────────────────

export interface NetworkContextInput {
  /** Public IP address of the client */
  ipAddress?: string;
  /** ISP name (if available) */
  isp?: string;
  /** Autonomous System Number (for VPN/proxy detection) */
  asn?: string;
  /** Whether a VPN connection is detected */
  vpnDetected?: boolean;
  /** Whether a proxy is detected */
  proxyDetected?: boolean;
  /** Whether the IP is a known TOR exit node */
  torExitNode?: boolean;
  /** Whether the IP is from a datacenter (vs. residential) */
  datacenter?: boolean;
  /** Country code (ISO 3166-1 alpha-2) */
  country?: string;
  /** City name */
  city?: string;
  /** Geographic latitude */
  latitude?: number;
  /** Geographic longitude */
  longitude?: number;
}

// ─── SDK Class ────────────────────────────────────────────────────────────────

/**
 * ContinuousVerification SDK
 *
 * Enables client applications to report device posture, behavioral biometrics,
 * and network context signals for continuous session risk assessment.
 *
 * The SDK requires an initialized AuthmeClient for accessing auth tokens.
 */
export class ContinuousVerification {
  private readonly client: AuthmeClient;
  private readonly baseUrl: string;
  private readonly realm: string;

  constructor(client: AuthmeClient, baseUrl?: string) {
    this.client = client;
    // Derive base URL from the client's configured URL
    this.baseUrl = baseUrl ?? client.getConfig().url;
    this.realm = client.getConfig().realm;
  }

  // ─── Device Posture ─────────────────────────────────────────────────────────

  /**
   * Report device posture information for the current session.
   *
   * This data is used by the server to evaluate device compliance status
   * and adjust the session's continuous risk score.
   *
   * @param posture - Device posture data collected client-side
   * @returns Promise resolving to the server response
   *
   * @example
   * ```typescript
   * await cv.reportDevicePosture({
   *   osType: 'Windows',
   *   osVersion: '11.0.22631.2506',
   *   diskEncrypted: true,
   *   screenLockEnabled: true,
   *   antivirusEnabled: true,
   *   firewallEnabled: true,
   *   managedDevice: true,
   *   deviceTrustTier: 'TRUSTED',
   * });
   * ```
   */
  async reportDevicePosture(posture: DevicePostureInput): Promise<DevicePostureResponse> {
    const token = this.client.getAccessToken();
    if (!token) {
      throw new Error('Not authenticated — call client.init() first');
    }

    const url = `${this.baseUrl}/realms/${this.realm}/continuous-verification/device-posture`;
    const body: Record<string, unknown> = {
      osType: posture.osType ?? null,
      osVersion: posture.osVersion ?? null,
      osBuild: posture.osBuild ?? null,
      securityPatchLevel: posture.securityPatchLevel ?? null,
      lastUpdateDate: posture.lastUpdateDate ?? null,
      diskEncrypted: posture.diskEncrypted ?? null,
      encryptionType: posture.encryptionType ?? null,
      antivirusEnabled: posture.antivirusEnabled ?? null,
      antivirusName: posture.antivirusName ?? null,
      firewallEnabled: posture.firewallEnabled ?? null,
      screenLockEnabled: posture.screenLockEnabled ?? false,
      lockTimeoutSeconds: posture.lockTimeoutSeconds ?? null,
      managedDevice: posture.managedDevice ?? false,
      mdmEnrollmentId: posture.mdmEnrollmentId ?? null,
      jailbroken: posture.jailbroken ?? false,
      deviceTrustTier: posture.deviceTrustTier ?? 'UNKNOWN',
      complianceStatus: posture.complianceStatus ?? null,
      complianceDetails: posture.complianceDetails ?? null,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Failed to report device posture' }));
      throw new Error((err as { message?: string }).message ?? 'Failed to report device posture');
    }

    return response.json() as Promise<DevicePostureResponse>;
  }

  // ─── Behavioral Biometrics ───────────────────────────────────────────────────

  /**
   * Record a single behavioral biometric sample for the current session.
   *
   * Samples are aggregated server-side to build a per-user behavioral baseline
   * and to detect deviations during active sessions.
   *
   * @param sample - A single interaction sample
   * @returns Promise resolving to the server response
   *
   * @example
   * ```typescript
   * // Record typing pattern
   * await cv.recordBehavioralSample({
   *   sessionId: 'session-abc-123',
   *   interactionType: 'typing',
   *   burstLength: 120,
   *   latency: 38,
   *   hasErrors: false,
   * });
   *
   * // Record mouse movement
   * await cv.recordBehavioralSample({
   *   sessionId: 'session-abc-123',
   *   interactionType: 'pointer',
   *   velocity: 245,
   *   variance: 0.12,
   * });
   * ```
   */
  async recordBehavioralSample(
    sample: BehavioralSampleInput,
  ): Promise<BehavioralSamplesResponse> {
    const token = this.client.getAccessToken();
    if (!token) {
      throw new Error('Not authenticated — call client.init() first');
    }

    const url = `${this.baseUrl}/realms/${this.realm}/continuous-verification/behavioral/samples`;
    const body: Record<string, unknown> = {
      sessionId: sample.sessionId,
      samples: [
        {
          interactionType: sample.interactionType,
          burstLength: sample.burstLength ?? null,
          latency: sample.latency ?? null,
          velocity: sample.velocity ?? null,
          variance: sample.variance ?? null,
          scrollVelocity: sample.scrollVelocity ?? null,
          eventCount: sample.eventCount ?? null,
          hasErrors: sample.hasErrors ?? false,
          collectedAt: sample.collectedAt ?? new Date().toISOString(),
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Failed to record behavioral sample' }));
      throw new Error((err as { message?: string }).message ?? 'Failed to record behavioral sample');
    }

    return response.json() as Promise<BehavioralSamplesResponse>;
  }

  /**
   * Record multiple behavioral biometric samples in a single batch request.
   *
   * More efficient than calling recordBehavioralSample() repeatedly when
   * collecting samples from the client.
   *
   * @param batch - Batch containing session ID and samples array
   * @returns Promise resolving to the server response
   *
   * @example
   * ```typescript
   * await cv.recordBehavioralSamplesBatch({
   *   sessionId: 'session-abc-123',
   *   samples: [
   *     { interactionType: 'typing', burstLength: 80, latency: 42, hasErrors: false },
   *     { interactionType: 'pointer', velocity: 198, variance: 0.08 },
   *     { interactionType: 'scroll', scrollVelocity: 320, eventCount: 15 },
   *   ],
   * });
   * ```
   */
  async recordBehavioralSamplesBatch(
    batch: BehavioralSampleBatchInput,
  ): Promise<BehavioralSamplesResponse> {
    const token = this.client.getAccessToken();
    if (!token) {
      throw new Error('Not authenticated — call client.init() first');
    }

    const url = `${this.baseUrl}/realms/${this.realm}/continuous-verification/behavioral/samples`;
    const body: Record<string, unknown> = {
      sessionId: batch.sessionId,
      samples: batch.samples.map((s) => ({
        interactionType: s.interactionType,
        burstLength: s.burstLength ?? null,
        latency: s.latency ?? null,
        velocity: s.velocity ?? null,
        variance: s.variance ?? null,
        scrollVelocity: s.scrollVelocity ?? null,
        eventCount: s.eventCount ?? null,
        hasErrors: s.hasErrors ?? false,
        collectedAt: s.collectedAt ?? new Date().toISOString(),
      })),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Failed to record behavioral samples' }));
      throw new Error((err as { message?: string }).message ?? 'Failed to record behavioral samples');
    }

    return response.json() as Promise<BehavioralSamplesResponse>;
  }

  // ─── Network Context ─────────────────────────────────────────────────────────

  /**
   * Report network context information for the current session.
   *
   * This data is used to detect VPN/proxy usage, geographic anomalies,
   * and other network-level risk signals.
   *
   * @param context - Network context data
   * @returns Promise resolving to the server response
   *
   * @example
   * ```typescript
   * await cv.reportNetworkContext({
   *   ipAddress: '203.0.113.42',
   *   country: 'US',
   *   city: 'New York',
   *   vpnDetected: false,
   *   proxyDetected: false,
   * });
   * ```
   */
  async reportNetworkContext(context: NetworkContextInput): Promise<{ success: boolean; recordedAt: string }> {
    const token = this.client.getAccessToken();
    if (!token) {
      throw new Error('Not authenticated — call client.init() first');
    }

    const url = `${this.baseUrl}/realms/${this.realm}/continuous-verification/network-context`;
    const body: Record<string, unknown> = {
      ipAddress: context.ipAddress ?? null,
      isp: context.isp ?? null,
      asn: context.asn ?? null,
      vpnDetected: context.vpnDetected ?? false,
      proxyDetected: context.proxyDetected ?? false,
      torExitNode: context.torExitNode ?? false,
      datacenter: context.datacenter ?? false,
      country: context.country ?? null,
      city: context.city ?? null,
      latitude: context.latitude ?? null,
      longitude: context.longitude ?? null,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Failed to report network context' }));
      throw new Error((err as { message?: string }).message ?? 'Failed to report network context');
    }

    return response.json() as Promise<{ success: boolean; recordedAt: string }>;
  }
}
