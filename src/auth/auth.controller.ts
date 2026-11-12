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
import { RateLimitGuard, RateLimitBy } from '../rate-limit/rate-limit.guard.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { parseBasicClientCredentials } from '../common/utils/basic-client-auth.util.js';

/**
 * Moves HTTP Basic client credentials (RFC 6749 §2.3.1) into the request
 * parameters the grant handlers read. A request may use only one way of
 * authenticating the client, so Basic together with a `client_secret`
 * parameter, or with a different `client_id`, is rejected.
 */
function withBasicClientCredentials(
  body: Record<string, string>,
  authorization: string | undefined,
): Record<string, string> {
  const basic = parseBasicClientCredentials(authorization);
  if (basic === null) return body;
  if (basic === 'malformed') {
    throw new OAuthTokenError(
      'invalid_client',
      'Malformed HTTP Basic client credentials',
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (body['client_secret'] !== undefined) {
    throw new OAuthTokenError(
      'invalid_request',
      'Use either HTTP Basic or client_secret, not both',
    );
  }
  if (body['client_id'] !== undefined && body['client_id'] !== basic.clientId) {
    throw new OAuthTokenError(
      'invalid_request',
      'client_id does not match the HTTP Basic credentials',
    );
  }
  return {
    ...body,
    client_id: basic.clientId,
    client_secret: basic.clientSecret,
  };
}

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
        withBasicClientCredentials(body, req.headers['authorization']),
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

  /**
   * Text a code for an `mfa_required` challenge. Answer it with the mfa_otp
   * grant and `mfa_method=sms`.
   */
  @Post('mfa/sms')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an SMS code for an MFA challenge (mfa_token)',
  })
  @ApiResponse({ status: 200, description: 'Code sent' })
  @ApiResponse({
    status: 400,
    description: 'Invalid mfa_token, or SMS not available for the user',
  })
  @ApiResponse({ status: 429, description: 'Too many codes requested' })
  @SkipThrottle()
  @UseGuards(RateLimitGuard)
  @RateLimitBy('ip', 'client')
  async mfaSms(
    @CurrentRealm() realm: Realm,
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'no-store');
    try {
      return await this.authService.sendMfaSms(
        realm,
        body,
        resolveClientIp(req),
      );
    } catch (err) {
      if (err instanceof OAuthTokenError) {
        res.status(err.httpStatus).json({
          error: err.code,
          ...(err.description ? { error_description: err.description } : {}),
        });
        return;
      }
      throw err;
    }
  }
}
