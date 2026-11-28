import { ImpossibleTravelService } from '../../risk-assessment/impossible-travel.service.js';
import { NetworkContextService } from '../../continuous-verification/network-context.service.js';

/** The services that look an address up send it nowhere unless GEOIP_PROVIDER says where. */
describe('geo-IP lookups', () => {
  const saved = {
    provider: process.env['GEOIP_PROVIDER'],
    key: process.env['GEOIP_API_KEY'],
  };
  let originalFetch: typeof global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 'success',
        lat: 30.04,
        lon: 31.24,
        city: 'Cairo',
        country: 'Egypt',
      }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;
    delete process.env['GEOIP_PROVIDER'];
    delete process.env['GEOIP_API_KEY'];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [name, value] of [
      ['GEOIP_PROVIDER', saved.provider],
      ['GEOIP_API_KEY', saved.key],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const travel = () => new ImpossibleTravelService({} as never);
  const network = () => new NetworkContextService({} as never);

  it('by default sends no address anywhere', async () => {
    await expect(travel().lookupCoords('203.0.113.5')).resolves.toBeNull();
    await expect(travel().lookupLocation('203.0.113.5')).resolves.toBeNull();
    const ctx = await network().lookupIp('203.0.113.5');
    expect(ctx.country).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the TLS endpoint with ip-api-pro', async () => {
    process.env['GEOIP_PROVIDER'] = 'ip-api-pro';
    process.env['GEOIP_API_KEY'] = 'test-key';

    await expect(travel().lookupCoords('203.0.113.5')).resolves.toEqual({
      lat: 30.04,
      lon: 31.24,
    });
    await expect(travel().lookupLocation('203.0.113.6')).resolves.toBe(
      'Cairo, Egypt',
    );
    await network().lookupIp('203.0.113.7');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toMatch(
        /^https:\/\/pro\.ip-api\.com\/json\/203\.0\.113\.[567]\?fields=.*&key=test-key$/,
      );
    }
  });

  it('uses the plain-HTTP free endpoint only when GEOIP_PROVIDER=ip-api', async () => {
    process.env['GEOIP_PROVIDER'] = 'ip-api';
    await travel().lookupCoords('203.0.113.5');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/ip-api\.com\/json\/203\.0\.113\.5\?/),
      expect.anything(),
    );
  });
});
