import {
  activityWriteDue,
  isIdleExpired,
  notIdleWhere,
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

  describe('idle timeout', () => {
    const idle = { ...realm, refreshTokenLifespan: 36000 };

    it('issues a normal refresh token for at most the idle timeout', () => {
      const withIdle = { ...idle, ssoSessionIdleTimeout: 900 };
      const sessionEnd = sessionExpiresAt(withIdle, false, t0);
      expect(
        refreshTokenExpiresAt(withIdle, false, sessionEnd, t0).toISOString(),
      ).toBe('2026-11-16T10:15:00.000Z');
    });

    it('still never lets the token outlive its session', () => {
      const withIdle = { ...idle, ssoSessionIdleTimeout: 900 };
      const sessionEnd = sessionExpiresAt(withIdle, false, t0);
      const nearEnd = new Date(sessionEnd.getTime() - 60 * 1000);
      expect(
        refreshTokenExpiresAt(withIdle, false, sessionEnd, nearEnd),
      ).toEqual(sessionEnd);
    });

    it('leaves offline tokens alone', () => {
      const withIdle = { ...idle, ssoSessionIdleTimeout: 900 };
      const sessionEnd = sessionExpiresAt(withIdle, true, t0);
      expect(
        refreshTokenExpiresAt(withIdle, true, sessionEnd, t0).toISOString(),
      ).toBe('2026-12-16T10:00:00.000Z');
    });

    it('changes nothing while off (0 or absent)', () => {
      for (const off of [{}, { ssoSessionIdleTimeout: 0 }]) {
        const r = { ...idle, ...off };
        expect(refreshTokenExpiresAt(r, false, null, t0).toISOString()).toBe(
          '2026-11-16T20:00:00.000Z',
        );
        expect(isIdleExpired(r, new Date(0), t0)).toBe(false);
        expect(notIdleWhere(r, t0)).toEqual({});
      }
    });

    it('tells an idle SSO session from an active one', () => {
      const r = { ssoSessionIdleTimeout: 600 };
      const at = (s: number) => new Date(t0.getTime() - s * 1000);
      expect(isIdleExpired(r, at(599), t0)).toBe(false);
      expect(isIdleExpired(r, at(601), t0)).toBe(true);
      expect(notIdleWhere(r, t0)).toEqual({
        lastActivityAt: { gte: at(600) },
      });
    });

    it('writes activity at most once a minute, more often for a short timeout', () => {
      const at = (s: number) => new Date(t0.getTime() - s * 1000);
      const r = { ssoSessionIdleTimeout: 1800 };
      expect(activityWriteDue(r, at(59), t0)).toBe(false);
      expect(activityWriteDue(r, at(60), t0)).toBe(true);
      // A 2-minute timeout is written every 30 seconds.
      const short = { ssoSessionIdleTimeout: 120 };
      expect(activityWriteDue(short, at(29), t0)).toBe(false);
      expect(activityWriteDue(short, at(30), t0)).toBe(true);
      // Off: still recorded, once a minute.
      expect(activityWriteDue({}, at(59), t0)).toBe(false);
      expect(activityWriteDue({}, at(60), t0)).toBe(true);
      expect(activityWriteDue(r, null, t0)).toBe(true);
    });
  });
});
