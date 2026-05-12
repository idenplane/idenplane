/**
 * Unit tests for the risk scoring engine.
 *
 * All evaluators are pure functions so no DI or mocking is required here.
 */

import {
  evaluateIpReputation,
  evaluateGeoAnomaly,
  evaluateImpossibleTravel,
  evaluateTimeAnomaly,
  evaluateDeviceAnomaly,
  evaluateLoginFrequency,
  evaluateFailedAttempts,
  aggregateSignals,
  scoreToRiskLevel,
  determineAction,
  haversineDistance,
  type RiskSignal,
} from './risk-signals.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const emptyProfile = {
  knownIps: [] as string[],
  knownDevices: [] as string[],
  loginTimes: new Array(24).fill(0) as number[],
  lastLocations: [] as string[],
  avgLoginFrequency: 1,
};

// ─── evaluateIpReputation ──────────────────────────────────────────────────────

describe('evaluateIpReputation', () => {
  it('returns score 0 for a known IP', () => {
    const profile = { ...emptyProfile, knownIps: ['1.2.3.4'] };
    const signal = evaluateIpReputation('1.2.3.4', profile);
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns score 20 for an unknown IP', () => {
    const profile = { ...emptyProfile, knownIps: ['5.5.5.5'] };
    const signal = evaluateIpReputation('1.2.3.4', profile);
    expect(signal.score).toBe(20);
    expect(signal.triggered).toBe(true);
  });

  it('returns score 20 when profile has no known IPs', () => {
    const signal = evaluateIpReputation('1.2.3.4', emptyProfile);
    expect(signal.score).toBe(20);
  });

  it('returns score 0 for null IP', () => {
    const signal = evaluateIpReputation(null, emptyProfile);
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });
});

// ─── evaluateGeoAnomaly ────────────────────────────────────────────────────────

describe('evaluateGeoAnomaly', () => {
  it('returns 0 when no previous locations exist', () => {
    const signal = evaluateGeoAnomaly('Cairo, Egypt', { lastLocations: [] });
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns 30 for a new country', () => {
    const profile = { lastLocations: ['Cairo, Egypt'] };
    const signal = evaluateGeoAnomaly('London, United Kingdom', profile);
    expect(signal.score).toBe(30);
    expect(signal.triggered).toBe(true);
  });

  it('returns 0 for the same country', () => {
    const profile = { lastLocations: ['Cairo, Egypt', 'Alexandria, Egypt'] };
    const signal = evaluateGeoAnomaly('Giza, Egypt', profile);
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns 0 for null location', () => {
    const signal = evaluateGeoAnomaly(null, {
      lastLocations: ['Cairo, Egypt'],
    });
    expect(signal.score).toBe(0);
  });
});

// ─── evaluateImpossibleTravel ──────────────────────────────────────────────────

describe('evaluateImpossibleTravel', () => {
  const cairo: [number, number] = [30.0444, 31.2357];
  const london: [number, number] = [51.5074, -0.1278];
  const newYork: [number, number] = [40.7128, -74.006];

  it('returns score 0 when no previous data', () => {
    const signal = evaluateImpossibleTravel(null, null, cairo, new Date());
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns score 0 for feasible travel (same city 1 hour later)', () => {
    const prev = new Date('2024-01-01T10:00:00Z');
    const curr = new Date('2024-01-01T11:00:00Z');
    const cairoSlightlyDifferent: [number, number] = [30.05, 31.24];
    const signal = evaluateImpossibleTravel(
      cairo,
      prev,
      cairoSlightlyDifferent,
      curr,
    );
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns score 40 for impossible travel (Cairo → New York in 1 minute)', () => {
    const prev = new Date('2024-01-01T10:00:00Z');
    const curr = new Date('2024-01-01T10:01:00Z'); // only 1 minute later
    const signal = evaluateImpossibleTravel(cairo, prev, newYork, curr);
    expect(signal.score).toBe(40);
    expect(signal.triggered).toBe(true);
  });

  it('returns score 0 for feasible long-haul flight (Cairo → London in 5 hours)', () => {
    const prev = new Date('2024-01-01T08:00:00Z');
    const curr = new Date('2024-01-01T13:00:00Z'); // 5 hours later
    const signal = evaluateImpossibleTravel(cairo, prev, london, curr);
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns score 40 for Cairo → London in 10 minutes', () => {
    const prev = new Date('2024-01-01T08:00:00Z');
    const curr = new Date('2024-01-01T08:10:00Z');
    const signal = evaluateImpossibleTravel(cairo, prev, london, curr);
    expect(signal.score).toBe(40);
    expect(signal.triggered).toBe(true);
  });
});

// ─── evaluateTimeAnomaly ───────────────────────────────────────────────────────

describe('evaluateTimeAnomaly', () => {
  it('returns 0 when not enough history', () => {
    const signal = evaluateTimeAnomaly(3, {
      loginTimes: new Array(24).fill(0),
    });
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns 0 for a normal login hour', () => {
    const loginTimes = new Array(24).fill(0);
    loginTimes[9] = 50; // heavy usage at 9 AM
    loginTimes[10] = 30;
    // total > 10
    const signal = evaluateTimeAnomaly(9, { loginTimes });
    expect(signal.score).toBe(0);
  });

  it('returns 15 for an unusual login hour', () => {
    const loginTimes = new Array(24).fill(0);
    loginTimes[9] = 100; // peak at 9 AM
    // login at 3 AM (count = 0 → < 10% of 100)
    const signal = evaluateTimeAnomaly(3, { loginTimes });
    expect(signal.score).toBe(15);
    expect(signal.triggered).toBe(true);
  });
});

// ─── evaluateDeviceAnomaly ────────────────────────────────────────────────────

describe('evaluateDeviceAnomaly', () => {
  it('returns 0 for a known device', () => {
    const profile = { knownDevices: ['fp-abc123'] };
    const signal = evaluateDeviceAnomaly('fp-abc123', profile);
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns 20 for an unknown device', () => {
    const profile = { knownDevices: ['fp-abc123'] };
    const signal = evaluateDeviceAnomaly('fp-xyz999', profile);
    expect(signal.score).toBe(20);
    expect(signal.triggered).toBe(true);
  });

  it('returns 20 when device list is empty', () => {
    const signal = evaluateDeviceAnomaly('fp-xyz999', { knownDevices: [] });
    expect(signal.score).toBe(20);
  });

  it('returns 0 for null fingerprint', () => {
    const signal = evaluateDeviceAnomaly(null, { knownDevices: [] });
    expect(signal.score).toBe(0);
  });
});

// ─── evaluateLoginFrequency ───────────────────────────────────────────────────

describe('evaluateLoginFrequency', () => {
  it('returns 0 for normal frequency', () => {
    const signal = evaluateLoginFrequency(2, 1);
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns 15 for excessive frequency', () => {
    const signal = evaluateLoginFrequency(20, 2); // 20 logins vs avg 2 (threshold = 6)
    expect(signal.score).toBe(15);
    expect(signal.triggered).toBe(true);
  });

  it('uses minimum threshold of 5 when avg is very low', () => {
    const signal = evaluateLoginFrequency(6, 0.1); // threshold = max(0.3, 5) = 5
    expect(signal.score).toBe(15);
  });

  it('returns 0 when count equals threshold', () => {
    // avgFreq = 2 → threshold = 6; recentLogins = 6 triggers (> 6 is needed)
    const signal = evaluateLoginFrequency(5, 2);
    expect(signal.score).toBe(0);
  });
});

// ─── evaluateFailedAttempts ────────────────────────────────────────────────────

describe('evaluateFailedAttempts', () => {
  it('returns 0 for no failures', () => {
    const signal = evaluateFailedAttempts(0);
    expect(signal.score).toBe(0);
    expect(signal.triggered).toBe(false);
  });

  it('returns 10 for 1 failure', () => {
    expect(evaluateFailedAttempts(1).score).toBe(10);
  });

  it('returns 10 for 2 failures', () => {
    expect(evaluateFailedAttempts(2).score).toBe(10);
  });

  it('returns 20 for 3 failures', () => {
    expect(evaluateFailedAttempts(3).score).toBe(20);
  });

  it('returns 20 for 4 failures', () => {
    expect(evaluateFailedAttempts(4).score).toBe(20);
  });

  it('returns 30 for 5+ failures', () => {
    expect(evaluateFailedAttempts(5).score).toBe(30);
    expect(evaluateFailedAttempts(10).score).toBe(30);
  });
});

// ─── aggregateSignals ─────────────────────────────────────────────────────────

describe('aggregateSignals', () => {
  it('returns 0 for an empty signal list', () => {
    expect(aggregateSignals([])).toBe(0);
  });

  it('computes weighted mean correctly', () => {
    const signals: RiskSignal[] = [
      { name: 'a', score: 20, weight: 1, reason: '', triggered: true },
      { name: 'b', score: 40, weight: 1, reason: '', triggered: true },
    ];
    // (20*1 + 40*1) / (1+1) = 30
    expect(aggregateSignals(signals)).toBe(30);
  });

  it('respects weights', () => {
    const signals: RiskSignal[] = [
      { name: 'a', score: 0, weight: 1, reason: '', triggered: false },
      { name: 'b', score: 100, weight: 3, reason: '', triggered: true },
    ];
    // (0*1 + 100*3) / (1+3) = 75
    expect(aggregateSignals(signals)).toBe(75);
  });

  it('caps at 100', () => {
    const signals: RiskSignal[] = [
      { name: 'a', score: 100, weight: 1, reason: '', triggered: true },
      { name: 'b', score: 100, weight: 1, reason: '', triggered: true },
    ];
    expect(aggregateSignals(signals)).toBe(100);
  });
});

// ─── scoreToRiskLevel ─────────────────────────────────────────────────────────

describe('scoreToRiskLevel', () => {
  it('maps 0-34 to LOW', () => {
    expect(scoreToRiskLevel(0)).toBe('LOW');
    expect(scoreToRiskLevel(34)).toBe('LOW');
  });

  it('maps 35-59 to MEDIUM', () => {
    expect(scoreToRiskLevel(35)).toBe('MEDIUM');
    expect(scoreToRiskLevel(59)).toBe('MEDIUM');
  });

  it('maps 60-79 to HIGH', () => {
    expect(scoreToRiskLevel(60)).toBe('HIGH');
    expect(scoreToRiskLevel(79)).toBe('HIGH');
  });

  it('maps 80-100 to CRITICAL', () => {
    expect(scoreToRiskLevel(80)).toBe('CRITICAL');
    expect(scoreToRiskLevel(100)).toBe('CRITICAL');
  });
});

// ─── determineAction ──────────────────────────────────────────────────────────

describe('determineAction', () => {
  const thresholds = { riskThresholdStepUp: 50, riskThresholdBlock: 80 };

  it('returns ALLOW for low risk', () => {
    expect(determineAction(20, thresholds)).toBe('ALLOW');
    expect(determineAction(49, thresholds)).toBe('ALLOW');
  });

  it('returns STEP_UP at the step-up threshold', () => {
    expect(determineAction(50, thresholds)).toBe('STEP_UP');
    expect(determineAction(79, thresholds)).toBe('STEP_UP');
  });

  it('returns BLOCK at the block threshold', () => {
    expect(determineAction(80, thresholds)).toBe('BLOCK');
    expect(determineAction(100, thresholds)).toBe('BLOCK');
  });

  it('returns BLOCK when block threshold is lower than step-up (misconfigured)', () => {
    const weird = { riskThresholdStepUp: 80, riskThresholdBlock: 40 };
    // score 50: >= 40 (block) → BLOCK
    expect(determineAction(50, weird)).toBe('BLOCK');
  });
});

// ─── haversineDistance ────────────────────────────────────────────────────────

describe('haversineDistance', () => {
  it('returns 0 for same point', () => {
    expect(haversineDistance([30, 31], [30, 31])).toBe(0);
  });

  it('calculates Cairo → London distance (~3500 km)', () => {
    const d = haversineDistance([30.0444, 31.2357], [51.5074, -0.1278]);
    expect(d).toBeGreaterThan(3400);
    expect(d).toBeLessThan(3600);
  });

  it('calculates Cairo → New York distance (~9000 km)', () => {
    const d = haversineDistance([30.0444, 31.2357], [40.7128, -74.006]);
    expect(d).toBeGreaterThan(8900);
    expect(d).toBeLessThan(9200);
  });
});
