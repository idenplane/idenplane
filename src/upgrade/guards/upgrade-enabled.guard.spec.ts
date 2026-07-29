import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpgradeEnabledGuard } from './upgrade-enabled.guard.js';

describe('UpgradeEnabledGuard', () => {
  const guardWith = (value: unknown) =>
    new UpgradeEnabledGuard({
      get: jest.fn().mockReturnValue(value),
    } as unknown as ConfigService);

  it('allows the request when UPGRADE_API_ENABLED is exactly "true"', () => {
    expect(guardWith('true').canActivate()).toBe(true);
  });

  // Default-off is the whole point: an operator who has never heard of this
  // flag must not be able to trigger `prisma migrate deploy` or a pg_restore
  // over the live database.
  it.each([
    [undefined, 'unset'],
    ['', 'empty'],
    ['false', 'false'],
    ['1', 'truthy-but-not-true'],
    ['yes', 'yes'],
    ['TRUE', 'wrong case'],
    [true, 'boolean true rather than the string'],
  ])('rejects when the flag is %s (%s)', (value) => {
    expect(() => guardWith(value).canActivate()).toThrow(
      ServiceUnavailableException,
    );
  });

  it('names the env var in the error so the 503 is actionable', () => {
    expect(() => guardWith(undefined).canActivate()).toThrow(
      /UPGRADE_API_ENABLED/,
    );
  });
});
