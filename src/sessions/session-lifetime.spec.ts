import {
  refreshTokenExpiresAt,
  sessionExpiresAt,
  sessionLifespanSeconds,
} from './session-lifetime.js';

describe('session lifetime', () => {
  const realm = { refreshTokenLifespan: 1800, offlineTokenLifespan: 2592000 };
  const t0 = new Date('2026-11-16T10:00:00.000Z');

  it('gives a normal session the refresh token lifespan', () => {
    expect(sessionLifespanSeconds(realm, false)).toBe(1800);
    expect(sessionExpiresAt(realm, false, t0).toISOString()).toBe(
      '2026-11-16T10:30:00.000Z',
    );
  });

  it('gives an offline session the offline lifespan, counted from sign-in', () => {
    expect(sessionLifespanSeconds(realm, true)).toBe(2592000);
    expect(sessionExpiresAt(realm, true, t0).toISOString()).toBe(
      '2026-12-16T10:00:00.000Z',
    );
  });

  it('follows the realm setting', () => {
    const short = { ...realm, offlineTokenLifespan: 86400 };
    expect(sessionExpiresAt(short, true, t0).toISOString()).toBe(
      '2026-11-17T10:00:00.000Z',
    );
  });

  it('issues a refresh token for its lifespan when the session outlives it', () => {
    const sessionEnd = sessionExpiresAt(realm, true, t0);
    const now = new Date(t0.getTime() + 3600 * 1000);
    const shortRealm = { ...realm, offlineTokenLifespan: 86400 };
    expect(
      refreshTokenExpiresAt(shortRealm, true, sessionEnd, now).toISOString(),
    ).toBe('2026-11-17T11:00:00.000Z');
  });

  it('never lets a refresh token outlive its session', () => {
    const sessionEnd = sessionExpiresAt(realm, true, t0);
    const nearEnd = new Date(sessionEnd.getTime() - 60 * 1000);
    expect(refreshTokenExpiresAt(realm, true, sessionEnd, nearEnd)).toEqual(
      sessionEnd,
    );
    const normalEnd = sessionExpiresAt(realm, false, t0);
    const later = new Date(t0.getTime() + 600 * 1000);
    expect(refreshTokenExpiresAt(realm, false, normalEnd, later)).toEqual(
      normalEnd,
    );
  });

  it('uses the token lifespan alone when there is no session expiry', () => {
    expect(refreshTokenExpiresAt(realm, false, null, t0).toISOString()).toBe(
      '2026-11-16T10:30:00.000Z',
    );
  });
});
