import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContinuousVerification } from '../continuous-verification.js';
import type { IdenplaneClient } from '../client.js';

function makeClient(token: string | null = 'test-access-token'): IdenplaneClient {
  return {
    getAccessToken: () => token,
    getConfig: () => ({ url: 'http://localhost:3000', realm: 'test-realm' }),
  } as unknown as IdenplaneClient;
}

describe('ContinuousVerification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('reportDevicePosture', () => {
    it('POSTs to the device-posture endpoint with the Bearer token and returns the response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, recordedAt: '2026-01-01T00:00:00.000Z' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const cv = new ContinuousVerification(makeClient());
      const result = await cv.reportDevicePosture({ osType: 'Windows', diskEncrypted: true });

      expect(result).toEqual({ success: true, recordedAt: '2026-01-01T00:00:00.000Z' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/realms/test-realm/continuous-verification/device-posture',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-access-token',
          }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.osType).toBe('Windows');
      expect(body.diskEncrypted).toBe(true);
      // Unset optional fields fall back to their documented defaults.
      expect(body.deviceTrustTier).toBe('UNKNOWN');
      expect(body.jailbroken).toBe(false);
    });

    it('throws without calling fetch when not authenticated', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const cv = new ContinuousVerification(makeClient(null));
      await expect(cv.reportDevicePosture({})).rejects.toThrow(
        'Not authenticated — call client.init() first',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws the server-provided message on a failed request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({ message: 'Realm not found' }),
        }),
      );

      const cv = new ContinuousVerification(makeClient());
      await expect(cv.reportDevicePosture({})).rejects.toThrow('Realm not found');
    });

    it('falls back to a default message when the error body is not JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: () => Promise.reject(new Error('not json')),
        }),
      );

      const cv = new ContinuousVerification(makeClient());
      await expect(cv.reportDevicePosture({})).rejects.toThrow('Failed to report device posture');
    });
  });

  describe('recordBehavioralSample', () => {
    it('wraps a single sample in a samples array and POSTs to the batch endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, recordedCount: 1, recordedAt: 'now' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const cv = new ContinuousVerification(makeClient());
      const result = await cv.recordBehavioralSample({
        sessionId: 'session-1',
        interactionType: 'typing',
        burstLength: 100,
      });

      expect(result).toEqual({ success: true, recordedCount: 1, recordedAt: 'now' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/realms/test-realm/continuous-verification/behavioral/samples',
        expect.anything(),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.sessionId).toBe('session-1');
      expect(body.samples).toHaveLength(1);
      expect(body.samples[0].interactionType).toBe('typing');
      expect(body.samples[0].burstLength).toBe(100);
    });

    it('throws the "Failed to record behavioral sample" default on a non-JSON error body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('x')) }),
      );

      const cv = new ContinuousVerification(makeClient());
      await expect(
        cv.recordBehavioralSample({ sessionId: 's', interactionType: 'typing' }),
      ).rejects.toThrow('Failed to record behavioral sample');
    });
  });

  describe('recordBehavioralSamplesBatch', () => {
    it('maps every sample in the batch and POSTs to the same batch endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, recordedCount: 2, recordedAt: 'now' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const cv = new ContinuousVerification(makeClient());
      const result = await cv.recordBehavioralSamplesBatch({
        sessionId: 'session-1',
        samples: [
          { interactionType: 'typing', burstLength: 80 },
          { interactionType: 'pointer', velocity: 200 },
        ],
      });

      expect(result).toEqual({ success: true, recordedCount: 2, recordedAt: 'now' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.samples).toHaveLength(2);
      expect(body.samples[1].interactionType).toBe('pointer');
      expect(body.samples[1].velocity).toBe(200);
    });

    it('throws the "Failed to record behavioral samples" default on a non-JSON error body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('x')) }),
      );

      const cv = new ContinuousVerification(makeClient());
      await expect(
        cv.recordBehavioralSamplesBatch({ sessionId: 's', samples: [] }),
      ).rejects.toThrow('Failed to record behavioral samples');
    });
  });

  describe('reportNetworkContext', () => {
    it('POSTs to the network-context endpoint and returns the response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, recordedAt: 'now' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const cv = new ContinuousVerification(makeClient());
      const result = await cv.reportNetworkContext({ ipAddress: '203.0.113.42', country: 'US' });

      expect(result).toEqual({ success: true, recordedAt: 'now' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/realms/test-realm/continuous-verification/network-context',
        expect.anything(),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.ipAddress).toBe('203.0.113.42');
      expect(body.country).toBe('US');
      expect(body.vpnDetected).toBe(false);
    });

    it('throws the "Failed to report network context" default on a non-JSON error body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('x')) }),
      );

      const cv = new ContinuousVerification(makeClient());
      await expect(cv.reportNetworkContext({})).rejects.toThrow('Failed to report network context');
    });
  });

  it('uses a custom baseUrl when provided instead of the client config URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, recordedAt: 'now' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const cv = new ContinuousVerification(makeClient(), 'https://custom.example.com');
    await cv.reportNetworkContext({});

    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom.example.com/realms/test-realm/continuous-verification/network-context',
      expect.anything(),
    );
  });
});
