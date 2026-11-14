jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { SetupWizardController } from './setup-wizard.controller.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { REQUIRE_ADMIN_AUTH_KEY } from '../common/decorators/require-admin-auth.decorator.js';
import { REQUIRED_ADMIN_ROLES_KEY } from '../common/decorators/require-admin-roles.decorator.js';

/**
 * The wizard's access rule is "super-admin on every endpoint, no
 * exceptions". This spec walks every route handler on the controller, so an
 * endpoint added later without the decorators fails here.
 */
describe('SetupWizardController access metadata', () => {
  const proto = SetupWizardController.prototype as unknown as Record<
    string,
    unknown
  >;
  const handlers = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => [name, proto[name]] as const)
    .filter(
      ([, fn]) =>
        typeof fn === 'function' &&
        Reflect.getMetadata(METHOD_METADATA, fn) !== undefined,
    );

  it('finds every route handler', () => {
    expect(handlers.map(([name]) => name).sort()).toEqual(
      [
        'completeWizard',
        'getState',
        'getStatus',
        'markSdkGenerated',
        'resetWizard',
        'saveAdminAccount',
        'saveClient',
        'saveRealmSettings',
        'saveSmtpConfig',
        'skipWizard',
        'testSmtp',
      ].sort(),
    );
  });

  it('demands admin credentials on the whole controller', () => {
    expect(
      Reflect.getMetadata(REQUIRE_ADMIN_AUTH_KEY, SetupWizardController),
    ).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SetupWizardController)).toBe(
      undefined,
    );
    const guards = Reflect.getMetadata(GUARDS_METADATA, SetupWizardController);
    expect(guards).toEqual([AdminApiKeyGuard, AdminRolesGuard]);
  });

  it.each(handlers)('%s requires super-admin and is not public', (_n, fn) => {
    expect(Reflect.getMetadata(REQUIRED_ADMIN_ROLES_KEY, fn as object)).toEqual(
      { roles: ['super-admin'], requireAll: false },
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn as object)).toBe(undefined);
  });
});
