/**
 * risk-signals.ts
 *
 * Pure, stateless signal evaluator functions for the adaptive authentication
 * risk engine. Each evaluator receives only the data it needs and returns a
 * numeric score contribution (0-100) together with a human-readable reason.
 * Keeping them pure makes them trivially unit-testable without any DI setup.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskSignal {
  name: string;
  score: number; // contribution 0-100
  weight: number; // relative weight for final aggregation
  reason: string;
  triggered: boolean;
}

export interface UserLoginProfile {
  knownIps: string[];
  knownDevices: string[];
  /** Sparse array [0..23] with login-count per hour-of-day. */
  loginTimes: number[];
  lastLocations: string[];
  avgLoginFrequency: number;
}

export interface RecentFailureInfo {
  count: number;
  withinMinutes: number;
}

// ─── IP reputation ────────────────────────────────────────────────────────────

/**
 * Returns +20 if the IP is unknown; 0 if it has been seen before.
 */
export function evaluateIpReputation(
  ip: string | null | undefined,
  profile: Pick<UserLoginProfile, 'knownIps'>,
): RiskSignal {
  const triggered = !!ip && !profile.knownIps.includes(ip);
  return {
    name: 'ip_reputation',
    score: triggered ? 20 : 0,
    weight: 1,
    reason: triggered ? `Unknown IP address: ${ip}` : 'Known IP address',
    triggered,
  };
}

// ─── Geo anomaly ──────────────────────────────────────────────────────────────

/**
 * Returns +30 when the location (country portion) differs from all previously
 * seen locations. Compares the country token (last comma-separated segment).
 */
export function evaluateGeoAnomaly(
  location: string | null | undefined,
  profile: Pick<UserLoginProfile, 'lastLocations'>,
): RiskSignal {
  if (!location || profile.lastLocations.length === 0) {
    return {
      name: 'geo_anomaly',
      score: 0,
      weight: 1.5,
      reason: 'No geo anomaly detected (insufficient data)',
      triggered: false,
    };
  }

  const currentCountry = location.split(',').pop()?.trim().toLowerCase() ?? '';
  const knownCountries = profile.lastLocations.map(
    (l) => l.split(',').pop()?.trim().toLowerCase() ?? '',
  );

  const triggered =
    currentCountry.length > 0 && !knownCountries.includes(currentCountry);
  return {
    name: 'geo_anomaly',
    score: triggered ? 30 : 0,
    weight: 1.5,
    reason: triggered
      ? `Login from new country: ${currentCountry}`
      : 'Login from known country',
    triggered,
  };
}

// ─── Impossible travel ────────────────────────────────────────────────────────

export interface TravelCheckInput {
  previousLocation: string | null | undefined;
  previousTimestamp: Date | null | undefined;
  currentLocation: string | null | undefined;
  currentTimestamp: Date;
}

/**
 * Returns +40 when the physical distance between the last known location and
 * the current one cannot be covered in the elapsed time (max 900 km/h assumed
 * for air travel).
 *
 * Locations are expected in the format produced by ip-api/similar services,
 * encoded as "lat,lon" for internal travel checks OR as the "city, country"
 * display strings (in which case this signal is skipped — lat/lon coords must
 * be provided separately via `latLon` fields).
 */
export function evaluateImpossibleTravel(
  previousLatLon: [number, number] | null,
  previousTimestamp: Date | null | undefined,
  currentLatLon: [number, number] | null,
  currentTimestamp: Date,
): RiskSignal {
  if (!previousLatLon || !currentLatLon || !previousTimestamp) {
    return {
      name: 'impossible_travel',
      score: 0,
      weight: 2,
      reason: 'Impossible travel check skipped (insufficient data)',
      triggered: false,
    };
  }

  const distanceKm = haversineDistance(previousLatLon, currentLatLon);
  const elapsedHours =
    (currentTimestamp.getTime() - previousTimestamp.getTime()) /
    (1000 * 60 * 60);

  if (elapsedHours <= 0) {
    return {
      name: 'impossible_travel',
      score: 0,
      weight: 2,
      reason: 'Impossible travel check skipped (same-instant timestamps)',
      triggered: false,
    };
  }

  // Max speed: commercial aircraft (~900 km/h) + 20% buffer
  const maxFeasibleDistanceKm = elapsedHours * 900 * 1.2;
  const triggered = distanceKm > maxFeasibleDistanceKm;

  return {
    name: 'impossible_travel',
    score: triggered ? 40 : 0,
    weight: 2,
    reason: triggered
      ? `Impossible travel: ${Math.round(distanceKm)} km in ${elapsedHours.toFixed(2)} h`
      : `Feasible travel: ${Math.round(distanceKm)} km in ${elapsedHours.toFixed(2)} h`,
    triggered,
  };
}

// ─── Time anomaly ─────────────────────────────────────────────────────────────

/**
 * Returns +15 when the current hour is unusual compared to historic patterns.
 * "Unusual" means the hour has fewer than 10% of the most active hour's logins
 * and there are at least 10 total recorded logins.
 */
export function evaluateTimeAnomaly(
  hourOfDay: number,
  profile: Pick<UserLoginProfile, 'loginTimes'>,
): RiskSignal {
  const times = profile.loginTimes;
  const totalLogins = times.reduce((a, b) => a + b, 0);

  if (totalLogins < 10) {
    return {
      name: 'time_anomaly',
      score: 0,
      weight: 0.75,
      reason: 'Time anomaly check skipped (insufficient history)',
      triggered: false,
    };
  }

  const maxCount = Math.max(...times);
  const currentCount = times[hourOfDay] ?? 0;
  const triggered = currentCount < maxCount * 0.1;

  return {
    name: 'time_anomaly',
    score: triggered ? 15 : 0,
    weight: 0.75,
    reason: triggered
      ? `Unusual login time: hour ${hourOfDay} (only ${currentCount} historical logins)`
      : `Normal login time: hour ${hourOfDay}`,
    triggered,
  };
}

// ─── Device anomaly ───────────────────────────────────────────────────────────

/**
 * Returns +20 for an unrecognised device fingerprint.
 */
export function evaluateDeviceAnomaly(
  fingerprint: string | null | undefined,
  profile: Pick<UserLoginProfile, 'knownDevices'>,
): RiskSignal {
  const triggered =
    !!fingerprint && !profile.knownDevices.includes(fingerprint);
  return {
    name: 'device_anomaly',
    score: triggered ? 20 : 0,
    weight: 1,
    reason: triggered ? 'Unrecognised device fingerprint' : 'Known device',
    triggered,
  };
}

// ─── Login frequency ─────────────────────────────────────────────────────────

/**
 * Returns +15 when recent login activity looks excessive (> 3× avg frequency).
 */
export function evaluateLoginFrequency(
  recentLoginsLast24h: number,
  avgLoginFrequency: number,
): RiskSignal {
  // avgLoginFrequency is logins-per-day; multiply by safety factor
  const threshold = Math.max(avgLoginFrequency * 3, 5);
  const triggered = recentLoginsLast24h > threshold;

  return {
    name: 'login_frequency',
    score: triggered ? 15 : 0,
    weight: 0.75,
    reason: triggered
      ? `Excessive login attempts: ${recentLoginsLast24h} in last 24 h (avg ${avgLoginFrequency.toFixed(1)}/day)`
      : `Normal login frequency: ${recentLoginsLast24h} in last 24 h`,
    triggered,
  };
}

// ─── Failed attempts ─────────────────────────────────────────────────────────

/**
 * Returns 10-30 based on recent failed login attempts for the user.
 * 1-2 failures: +10; 3-4 failures: +20; 5+ failures: +30.
 */
export function evaluateFailedAttempts(recentFailures: number): RiskSignal {
  let score = 0;
  let reason: string;

  if (recentFailures >= 5) {
    score = 30;
    reason = `High number of recent failures: ${recentFailures}`;
  } else if (recentFailures >= 3) {
    score = 20;
    reason = `Moderate recent failures: ${recentFailures}`;
  } else if (recentFailures >= 1) {
    score = 10;
    reason = `Recent login failure(s): ${recentFailures}`;
  } else {
    reason = 'No recent failed attempts';
  }

  return {
    name: 'failed_attempts',
    score,
    weight: 1,
    reason,
    triggered: recentFailures > 0,
  };
}

// ─── Score aggregation ───────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskAction = 'ALLOW' | 'STEP_UP' | 'BLOCK';

export interface RealmThresholds {
  riskThresholdStepUp: number;
  riskThresholdBlock: number;
}

/**
 * Aggregates weighted signal scores into a single 0-100 risk score.
 *
 * Weighted mean: sum(score_i * weight_i) / sum(weight_i), then capped at 100.
 */
export function aggregateSignals(signals: RiskSignal[]): number {
  if (signals.length === 0) return 0;

  const totalWeight = signals.reduce((acc, s) => acc + s.weight, 0);
  const weightedSum = signals.reduce((acc, s) => acc + s.score * s.weight, 0);

  return Math.min(100, Math.round(weightedSum / totalWeight));
}

/**
 * Maps a numeric risk score to a named risk level.
 */
export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

/**
 * Determines the authentication action based on score and realm thresholds.
 */
export function determineAction(
  score: number,
  thresholds: RealmThresholds,
): RiskAction {
  if (score >= thresholds.riskThresholdBlock) return 'BLOCK';
  if (score >= thresholds.riskThresholdStepUp) return 'STEP_UP';
  return 'ALLOW';
}

// ─── Geo math helpers ─────────────────────────────────────────────────────────

/**
 * Haversine great-circle distance in kilometres.
 */
export function haversineDistance(
  [lat1, lon1]: [number, number],
  [lat2, lon2]: [number, number],
): number {
  const R = 6371; // Earth radius km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
