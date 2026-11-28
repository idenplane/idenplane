import { geoIpProvider, ipApiUrl } from './ip-api.js';

describe('ipApiUrl', () => {
  const saved = {
    provider: process.env['GEOIP_PROVIDER'],
    key: process.env['GEOIP_API_KEY'],
  };
  afterEach(() => {
    for (const [name, value] of [
      ['GEOIP_PROVIDER', saved.provider],
      ['GEOIP_API_KEY', saved.key],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('looks nothing up unless a provider is chosen', () => {
    delete process.env['GEOIP_PROVIDER'];
    expect(geoIpProvider()).toBe('none');
    expect(ipApiUrl('203.0.113.5', 'status,lat,lon')).toBeNull();
    process.env['GEOIP_PROVIDER'] = 'something-else';
    expect(ipApiUrl('203.0.113.5', 'status,lat,lon')).toBeNull();
  });

  it('uses TLS with the pro endpoint and its key', () => {
    process.env['GEOIP_PROVIDER'] = 'ip-api-pro';
    process.env['GEOIP_API_KEY'] = 'k&y';
    expect(ipApiUrl('203.0.113.5', 'status,lat,lon')).toBe(
      'https://pro.ip-api.com/json/203.0.113.5?fields=status,lat,lon&key=k%26y',
    );
  });

  it('looks nothing up with the pro endpoint and no key', () => {
    process.env['GEOIP_PROVIDER'] = 'ip-api-pro';
    delete process.env['GEOIP_API_KEY'];
    expect(ipApiUrl('203.0.113.5', 'status')).toBeNull();
  });

  it('uses the free plain-HTTP endpoint only when chosen explicitly', () => {
    process.env['GEOIP_PROVIDER'] = ' IP-API ';
    expect(ipApiUrl('2001:db8::1', 'status')).toBe(
      'http://ip-api.com/json/2001%3Adb8%3A%3A1?fields=status',
    );
  });
});
