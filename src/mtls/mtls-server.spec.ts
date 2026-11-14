import { isMtlsAliasPath, isMtlsUpgradePath } from './mtls-server.js';

describe('isMtlsUpgradePath', () => {
  it('accepts exactly the allowed path, with or without a query', () => {
    expect(isMtlsUpgradePath('/ws/events', '/ws/events')).toBe(true);
    expect(isMtlsUpgradePath('/ws/events?token=t&realm=r', '/ws/events')).toBe(
      true,
    );
  });

  it.each([
    undefined,
    '',
    'ws/events',
    'https://idp.example/ws/events',
    '/ws/events/',
    '/ws/events/x',
    '/ws/Events',
    '/ws//events',
    '//ws/events',
    '/ws/%65vents',
    '/ws\\events',
    '/ws/./events',
    '/ws/other/../events',
    '/realms/r/protocol/openid-connect/token',
  ])('refuses %j', (url) => {
    expect(isMtlsUpgradePath(url, '/ws/events')).toBe(false);
  });

  it('is not an alias path: the alias list never admits an upgrade', () => {
    expect(isMtlsAliasPath('/ws/events')).toBe(false);
  });
});
