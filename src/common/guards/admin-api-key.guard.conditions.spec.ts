import {
  Controller,
  Get,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminApiKeyGuard } from './admin-api-key.guard.js';
import { Public } from '../decorators/public.decorator.js';
import { RequireAdminAuth } from '../decorators/require-admin-auth.decorator.js';

/*
 * Which requests AdminApiKeyGuard enforces, with real Nest metadata on real
 * classes. Any one of four conditions is enough; @Public() still wins.
 */

class OtherGuard {
  canActivate() {
    return true;
  }
}

@Controller('admin/things')
class AdminController {
  @Get()
  list() {}

  @Get('public')
  @Public()
  open() {}
}

@Controller(['/ADMIN/', 'other'])
class ArrayPathAdminController {
  @Get()
  list() {}
}

@Controller('realms/:realmName/things')
class RealmController {
  @Get('open')
  open() {}

  @Get('explicit')
  @UseGuards(AdminApiKeyGuard)
  explicit() {}

  @Get('instance')
  @UseGuards(Object.create(AdminApiKeyGuard.prototype) as AdminApiKeyGuard)
  instance() {}

  @Get('other-guard')
  @UseGuards(OtherGuard)
  otherGuard() {}

  @Get('explicit-public')
  @Public()
  @UseGuards(AdminApiKeyGuard)
  explicitPublic() {}
}

@Controller('setup-thing')
@UseGuards(AdminApiKeyGuard)
class GuardedController {
  @Get()
  any() {}
}

@Controller('flagged')
@RequireAdminAuth()
class FlaggedController {
  @Get()
  any() {}
}

@Controller('administrator')
class LookalikeController {
  @Get()
  any() {}
}

describe('AdminApiKeyGuard enforcement conditions', () => {
  let guard: AdminApiKeyGuard;

  beforeEach(() => {
    guard = new AdminApiKeyGuard(
      { get: jest.fn().mockReturnValue('super-secret-key') } as never,
      new Reflector(),
      {
        validateAdminToken: jest.fn().mockRejectedValue(new Error('bad')),
      } as never,
      {
        checkAdminApiKeyLimit: jest.fn().mockResolvedValue({ allowed: true }),
        computeHeaders: jest.fn().mockReturnValue({}),
      } as never,
    );
  });

  function context(
    controller: new () => object,
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ) {
    const handler = (controller.prototype as Record<string, unknown>)[method];
    return {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ headers, path }),
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    } as never;
  }

  const enforced = (ctx: never) =>
    expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  const open = (ctx: never) =>
    expect(guard.canActivate(ctx)).resolves.toBe(true);

  describe('1. the request path', () => {
    it.each(['/admin', '/admin/x', '/ADMIN/x', '/Admin', '//admin/x'])(
      'enforces %s',
      (path) => enforced(context(RealmController, 'open', path)),
    );

    it('leaves /administrator alone', () =>
      open(context(LookalikeController, 'any', '/administrator')));
  });

  describe("2. the controller's declared path", () => {
    it('enforces whatever URL reached an admin controller', () =>
      enforced(context(AdminController, 'list', '/somewhere/else')));

    it('normalises an array of paths with slashes and case', () =>
      enforced(context(ArrayPathAdminController, 'list', '/other')));
  });

  describe('3. @RequireAdminAuth()', () => {
    it('enforces a flagged controller off /admin', () =>
      enforced(context(FlaggedController, 'any', '/flagged')));
  });

  describe('4. explicit @UseGuards(AdminApiKeyGuard)', () => {
    it('enforces a handler-level guard off /admin', () =>
      enforced(
        context(RealmController, 'explicit', '/realms/r/things/explicit'),
      ));

    it('enforces a guard given as an instance', () =>
      enforced(
        context(RealmController, 'instance', '/realms/r/things/instance'),
      ));

    it('enforces a controller-level guard off /admin', () =>
      enforced(context(GuardedController, 'any', '/setup-thing')));

    it('accepts the API key there', () =>
      open(
        context(RealmController, 'explicit', '/realms/r/things/explicit', {
          'x-admin-api-key': 'super-secret-key',
        }),
      ));

    it('ignores other guards', () =>
      open(
        context(RealmController, 'otherGuard', '/realms/r/things/other-guard'),
      ));
  });

  describe('public stays public', () => {
    it('leaves a route with none of the four conditions open', () =>
      open(context(RealmController, 'open', '/realms/r/things/open')));

    it('lets @Public() win on an admin controller', () =>
      open(context(AdminController, 'open', '/admin/things/public')));

    it('lets @Public() win over an explicit guard', () =>
      open(
        context(
          RealmController,
          'explicitPublic',
          '/realms/r/things/explicit-public',
        ),
      ));
  });
});
