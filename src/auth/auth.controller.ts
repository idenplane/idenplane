import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Realm } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { OAuthTokenError } from './oauth-token-error.js';
import { TokenRequestDto } from './dto/token-request.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
  RateLimitBy,
} from '../rate-limit/rate-limit.guard.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';

@ApiTags('Authentication')
@Controller('realms/:realmName/protocol/openid-connect')
@UseGuards(RealmGuard)
@Public()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Token endpoint (password, client_credentials, refresh_token, authorization_code)',
  })
  @ApiResponse({ status: 200, description: 'Token issued successfully' })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or unsupported grant type',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid client credentials or user credentials',
  })
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiBody({ type: TokenRequestDto })
  @SkipThrottle()
  @UseGuards(RateLimitGuard)
  @RateLimitBy('ip', 'client')
  async token(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');

    if (body['grant_type'] === 'password') {
      res.set('Deprecation', 'true');
      res.set(
        'Warning',
        '299 - "The OAuth 2.0 password grant is deprecated by OAuth 2.1 and will be removed in a future release. Migrate to authorization_code with PKCE."',
      );
    }

    try {
      return await this.authService.handleTokenRequest(
        realm,
        body,
        resolveClientIp(req),
        req.headers['user-agent'],
      );
    } catch (err) {
      // RFC 6749 §5.2: serialize token-endpoint errors as
      // `{ error: <code>, error_description? }` with the appropriate status.
      if (err instanceof OAuthTokenError) {
        if (err.code === 'invalid_client') {
          // RFC 6749 §5.2: a 401 for failed client authentication must include
          // a WWW-Authenticate header advertising the auth scheme.
          res.set(
            'WWW-Authenticate',
            `Basic realm="${realm.name}", error="invalid_client"`,
          );
        }
        res.status(err.httpStatus).json({
          error: err.code,
          ...(err.description ? { error_description: err.description } : {}),
        });
        return;
      }
      // Other HttpExceptions whose body already carries an `error` field — e.g.
      // the `mfa_required` challenge response — are passed through verbatim so
      // they keep their extra fields (such as `mfa_token`).
      if (err instanceof HttpException) {
        const responseBody = err.getResponse();
        if (
          typeof responseBody === 'object' &&
          responseBody !== null &&
          'error' in responseBody
        ) {
          res.status(err.getStatus()).json(responseBody);
          return;
        }
      }
      // Anything else is genuinely unexpected — let the global filter handle it.
      throw err;
    }
  }
}
