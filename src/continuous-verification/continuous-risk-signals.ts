/**
 * continuous-risk-signals.ts
 *
 * Pure, stateless signal evaluator functions for continuous session verification.
 * Each evaluator receives only the data it needs and returns a numeric score
 * contribution (0-100) together with a human-readable reason.
 *
 * These signals are evaluated continuously during active sessions to detect
 * behavioral anomalies, device posture changes, and network context shifts.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContinuousRiskSignal {
  name: string;
  score: number; // contribution 0-100
  weight: number; // relative weight for final aggregation
  reason: string;
  triggered: boolean;
}

export interface DevicePostureData {
  osVersion: string | null;
  osBuild: string | null;
  patchLevel: string | null;
  encryptedDisk: boolean;
  screenLockEnabled: boolean;
  antivirusActive: boolean;
  firewallActive: boolean;
  jailbreakRoot: boolean;
  customFirmware: boolean;
  MDMEnrolled: boolean;
  lastSecurityScan: Date | null;
  complianceStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'UNKNOWN';
}

export interface NetworkContextData {
  ipAddress: string | null;
  isp: string | null;
  asn: string | null;
  vpnDetected: boolean;
  proxyDetected: boolean;
  torExitNode: boolean;
  datacenter: boolean;
  asnReputation: 'TRUSTED' | 'NEUTRAL' | 'SUSPICIOUS' | 'BLOCKED';
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface BehavioralBiometricData {
  typingSpeed: number | null; // chars per minute
  mouseMovementAvgSpeed: number | null; // pixels per second
  mouseMovementVariance: number | null;
  scrollSpeedAvg: number | null;
  clickFrequency: number | null; // clicks per minute
  errorRateTyping: number | null; // 0-1
  sessionDuration: number | null; // minutes
  idleTimeAvg: number | null; // seconds
}

export interface BaselineProfile {
  avgTypingSpeed: number;
  avgMouseSpeed: number;
  avgMouseVariance: number;
  avgClickFrequency: number;
  avgErrorRate: number;
  avgSessionDuration: number;
  avgIdleTime: number;
  sampleCount: number;
}

// ─── Device Posture ───────────────────────────────────────────────────────────

/**
 * Evaluates device posture compliance and security status.
 * Returns +25 for non-compliant devices, +15 for MDM missing, +10 for outdated security.
 */
export function evaluateDevicePosture(
  posture: DevicePostureData,
  requireMDM: boolean = false,
  securityPolicies: {
    minDaysSinceScan: number;
    requireEncryption: boolean;
    requireLockScreen: boolean;
  } = {
    minDaysSinceScan: 7,
    requireEncryption: true,
    requireLockScreen: true,
  },
): ContinuousRiskSignal {
  // Critical security violations
  if (posture.jailbreakRoot || posture.customFirmware) {
    return {
      name: 'device_posture',
      score: 50,
      weight: 2.5,
      reason: 'Device is jailbroken or has custom firmware',
      triggered: true,
    };
  }

  // Missing encryption when required
  if (securityPolicies.requireEncryption && !posture.encryptedDisk) {
    return {
      name: 'device_posture',
      score: 25,
      weight: 2,
      reason: 'Disk encryption not enabled',
      triggered: true,
    };
  }

  // Screen lock disabled when required
  if (securityPolicies.requireLockScreen && !posture.screenLockEnabled) {
    return {
      name: 'device_posture',
      score: 20,
      weight: 2,
      reason: 'Screen lock not enabled',
      triggered: true,
    };
  }

  // MDM not enrolled when required
  if (requireMDM && !posture.MDMEnrolled) {
    return {
      name: 'device_posture',
      score: 15,
      weight: 1.5,
      reason: 'Device not enrolled in MDM',
      triggered: true,
    };
  }

  // Security scan outdated
  if (posture.lastSecurityScan) {
    const daysSinceScan = Math.floor(
      (Date.now() - posture.lastSecurityScan.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceScan > securityPolicies.minDaysSinceScan) {
      return {
        name: 'device_posture',
        score: 10,
        weight: 1,
        reason: `Security scan outdated (${daysSinceScan} days ago)`,
        triggered: true,
      };
    }
  }

  // Antivirus or firewall inactive
  if (!posture.antivirusActive || !posture.firewallActive) {
    return {
      name: 'device_posture',
      score: 15,
      weight: 1.5,
      reason: !posture.antivirusActive
        ? 'Antivirus not active'
        : 'Firewall not active',
      triggered: true,
    };
  }

  // Non-compliant status from posture check
  if (posture.complianceStatus === 'NON_COMPLIANT') {
    return {
      name: 'device_posture',
      score: 20,
      weight: 2,
      reason: 'Device failed compliance check',
      triggered: true,
    };
  }

  return {
    name: 'device_posture',
    score: 0,
    weight: 1,
    reason: 'Device posture is compliant',
    triggered: false,
  };
}

// ─── Network Context ──────────────────────────────────────────────────────────

/**
 * Evaluates network context for suspicious indicators.
 * Returns points for VPN/proxy in restricted environments, TOR, datacenter IPs, etc.
 */
export function evaluateNetworkContext(
  context: NetworkContextData,
  policies: {
    allowVPNAcrossCountries: boolean;
    blockTorNodes: boolean;
    blockDatacenterIPs: boolean;
    allowedCountries: string[] | null;
    blockedASNs: string[] | null;
  } = {
    allowVPNAcrossCountries: true,
    blockTorNodes: false,
    blockDatacenterIPs: false,
    allowedCountries: null,
    blockedASNs: null,
  },
): ContinuousRiskSignal {
  let score = 0;
  const reasonParts: string[] = [];

  // Blocked ASN
  if (
    policies.blockedASNs &&
    context.asn &&
    policies.blockedASNs.includes(context.asn)
  ) {
    score += 30;
    reasonParts.push('Blocked ASN detected');
  }

  // TOR exit node
  if (context.torExitNode) {
    if (policies.blockTorNodes) {
      return {
        name: 'network_context',
        score: 50,
        weight: 2,
        reason: 'TOR exit node detected (blocked by policy)',
        triggered: true,
      };
    }
    score += 15;
    reasonParts.push('TOR exit node');
  }

  // Datacenter IP
  if (context.datacenter) {
    if (policies.blockDatacenterIPs) {
      return {
        name: 'network_context',
        score: 40,
        weight: 2,
        reason: 'Datacenter IP detected (blocked by policy)',
        triggered: true,
      };
    }
    score += 10;
    reasonParts.push('Datacenter IP');
  }

  // VPN in restricted country scenario
  if (
    context.vpnDetected &&
    !policies.allowVPNAcrossCountries &&
    context.country
  ) {
    score += 15;
    reasonParts.push('VPN detected in restricted context');
  }

  // Proxy detected
  if (context.proxyDetected) {
    score += 10;
    reasonParts.push('Proxy detected');
  }

  // ASN reputation check
  if (context.asnReputation === 'BLOCKED') {
    score += 40;
    reasonParts.push('Blocked ASN reputation');
  } else if (context.asnReputation === 'SUSPICIOUS') {
    score += 20;
    reasonParts.push('Suspicious ASN reputation');
  }

  // Country restriction
  if (policies.allowedCountries && context.country) {
    if (!policies.allowedCountries.includes(context.country)) {
      score += 20;
      reasonParts.push(`Country not allowed: ${context.country}`);
    }
  }

  if (score > 0) {
    return {
      name: 'network_context',
      score: Math.min(100, score),
      weight: 1.5,
      reason: reasonParts.join('; '),
      triggered: true,
    };
  }

  return {
    name: 'network_context',
    score: 0,
    weight: 1,
    reason: 'Network context is normal',
    triggered: false,
  };
}

// ─── Behavioral Biometrics ─────────────────────────────────────────────────────

/**
 * Evaluates behavioral biometrics against baseline profile.
 * Deviation from established patterns increases risk score.
 *
 * @param current - Current behavioral data
 * @param baseline - User's established behavioral baseline
 * @param sensitivity - How strict the deviation detection should be (0-1, default 0.7)
 */
export function evaluateBehavioralBiometrics(
  current: BehavioralBiometricData,
  baseline: BaselineProfile,
  sensitivity: number = 0.7,
): ContinuousRiskSignal {
  // Not enough baseline data
  if (baseline.sampleCount < 5) {
    return {
      name: 'behavioral_biometrics',
      score: 0,
      weight: 1,
      reason: 'Insufficient behavioral baseline data',
      triggered: false,
    };
  }

  let score = 0;
  const reasonParts: string[] = [];

  // Typing speed deviation
  if (current.typingSpeed !== null && baseline.avgTypingSpeed > 0) {
    const deviation =
      Math.abs(current.typingSpeed - baseline.avgTypingSpeed) /
      baseline.avgTypingSpeed;
    if (deviation > sensitivity) {
      const deviationPercent = Math.round(deviation * 100);
      score += Math.min(25, deviation * 20);
      reasonParts.push(
        `Typing speed deviation: ${deviationPercent}% from baseline`,
      );
    }
  }

  // Mouse movement speed deviation
  if (current.mouseMovementAvgSpeed !== null && baseline.avgMouseSpeed > 0) {
    const deviation =
      Math.abs(current.mouseMovementAvgSpeed - baseline.avgMouseSpeed) /
      baseline.avgMouseSpeed;
    if (deviation > sensitivity) {
      const deviationPercent = Math.round(deviation * 100);
      score += Math.min(20, deviation * 15);
      reasonParts.push(
        `Mouse speed deviation: ${deviationPercent}% from baseline`,
      );
    }
  }

  // Mouse movement variance deviation (indicates different motor control)
  if (current.mouseMovementVariance !== null && baseline.avgMouseVariance > 0) {
    const deviation =
      Math.abs(current.mouseMovementVariance - baseline.avgMouseVariance) /
      baseline.avgMouseVariance;
    if (deviation > sensitivity) {
      score += 15;
      reasonParts.push('Mouse movement pattern variance anomaly');
    }
  }

  // Click frequency deviation
  if (current.clickFrequency !== null && baseline.avgClickFrequency > 0) {
    const deviation =
      Math.abs(current.clickFrequency - baseline.avgClickFrequency) /
      baseline.avgClickFrequency;
    if (deviation > sensitivity) {
      score += 10;
      reasonParts.push('Click frequency deviation from baseline');
    }
  }

  // Error rate deviation (higher than normal may indicate different user)
  if (current.errorRateTyping !== null && baseline.avgErrorRate !== null) {
    if (current.errorRateTyping > baseline.avgErrorRate * 2) {
      score += 20;
      reasonParts.push('Typing error rate significantly higher than baseline');
    }
  }

  // Session duration anomaly (very short sessions may indicate suspicious activity)
  if (current.sessionDuration !== null && baseline.avgSessionDuration > 0) {
    // Session too short compared to baseline
    if (current.sessionDuration < baseline.avgSessionDuration * 0.2) {
      score += 15;
      reasonParts.push('Session duration unusually short');
    }
    // Session unusually long
    if (current.sessionDuration > baseline.avgSessionDuration * 3) {
      score += 10;
      reasonParts.push('Session duration unusually long');
    }
  }

  // Idle time deviation
  if (current.idleTimeAvg !== null && baseline.avgIdleTime > 0) {
    const deviation =
      Math.abs(current.idleTimeAvg - baseline.avgIdleTime) /
      baseline.avgIdleTime;
    if (deviation > sensitivity * 1.5) {
      score += 10;
      reasonParts.push('Idle time pattern deviation');
    }
  }

  // Check if multiple signals triggered (more suspicious)
  if (reasonParts.length >= 3) {
    score = Math.min(100, score + 10); // Bonus for multiple anomalies
  }

  if (score > 0) {
    return {
      name: 'behavioral_biometrics',
      score: Math.min(100, Math.round(score)),
      weight: 1.25,
      reason:
        reasonParts.slice(0, 3).join('; ') ||
        'Behavioral pattern anomaly detected',
      triggered: true,
    };
  }

  return {
    name: 'behavioral_biometrics',
    score: 0,
    weight: 1,
    reason: 'Behavioral patterns match baseline',
    triggered: false,
  };
}

// ─── Score aggregation helpers ────────────────────────────────────────────────

/**
 * Aggregates weighted continuous risk signals into a single 0-100 risk score.
 */
export function aggregateContinuousSignals(
  signals: ContinuousRiskSignal[],
): number {
  if (signals.length === 0) return 0;

  const totalWeight = signals.reduce((acc, s) => acc + s.weight, 0);
  const weightedSum = signals.reduce((acc, s) => acc + s.score * s.weight, 0);

  return Math.min(100, Math.round(weightedSum / totalWeight));
}

/**
 * Determines the action based on continuous risk score and thresholds.
 */
export interface ContinuousRiskThresholds {
  alertThreshold: number; // Score to generate alert
  stepUpThreshold: number; // Score to trigger step-up
  blockThreshold: number; // Score to block/terminate session
}

export type ContinuousRiskAction =
  | 'MONITOR'
  | 'ALERT'
  | 'STEP_UP'
  | 'TERMINATE';

export function determineContinuousAction(
  score: number,
  thresholds: ContinuousRiskThresholds,
): ContinuousRiskAction {
  if (score >= thresholds.blockThreshold) return 'TERMINATE';
  if (score >= thresholds.stepUpThreshold) return 'STEP_UP';
  if (score >= thresholds.alertThreshold) return 'ALERT';
  return 'MONITOR';
}
