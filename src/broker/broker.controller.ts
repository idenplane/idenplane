import {
  Controller,
  Get,
  HttpException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Realm } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { BrokerService } from './broker.service.js';
import { ThemeRenderService } from '../theme/theme-render.service.js';

@ApiTags('Identity Broker')
@Controller('realms/:realmName/broker')
@UseGuards(RealmGuard)
@Public()
export class BrokerController {
  constructor(
    private readonly brokerService: BrokerService,
    private readonly themeRender: ThemeRenderService,
  ) {}

  @Get(':alias/login')
  @ApiOperation({ summary: 'Initiate social login with an external provider' })
  @ApiResponse({
    status: 302,
    description:
      'Redirect to external identity provider authorization endpoint',
  })
  @ApiResponse({
    status: 400,
    description: 'Unknown provider alias or missing required OAuth parameters',
  })
  async login(
    @CurrentRealm() realm: Realm,
    @Param('alias') alias: string,
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('scope') scope: string,
    @Query('state') state: string,
    @Query('nonce') nonce: string,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.brokerService.initiateLogin(realm, alias, {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      nonce,
    });

    res.redirect(302, redirectUrl);
  }

  @Get(':alias/callback')
  @ApiOperation({ summary: 'Handle callback from external identity provider' })
  @ApiResponse({
    status: 302,
    description:
      'Redirect to client redirect_uri with authorization code after successful federation',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid state, missing code, or provider token exchange failed',
  })
  async callback(
    @CurrentRealm() realm: Realm,
    @Param('alias') alias: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const result = await this.brokerService.handleCallback(
        realm,
        alias,
        code,
        state,
      );
      res.redirect(302, result.redirectUrl);
    } catch (err) {
      // A broker callback is reached by the end-user's browser, so failures
      // (link-only, token-exchange, invalid/expired state) must render a themed
      // error page rather than leak a raw JSON exception to the user.
      const status = err instanceof HttpException ? err.getStatus() : 400;
      res.status(status);
      this.themeRender.render(
        res,
        realm,
        'login',
        'error',
        {
          pageTitle: 'Sign-in failed',
          errorTitle: 'Sign-in failed',
          errorMessage: this.describeBrokerError(err),
        },
        req,
      );
    }
  }

  private describeBrokerError(err: unknown): string {
    if (err instanceof HttpException) {
      const response = err.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message: unknown }).message;
        if (typeof message === 'string') {
          return message;
        }
        if (Array.isArray(message)) {
          return message.join(', ');
        }
      }
      return err.message;
    }
    return 'Sign-in could not be completed. Please try again.';
  }
}
