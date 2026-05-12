import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Realm } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { BrokerService } from './broker.service.js';

@ApiTags('Identity Broker')
@Controller('realms/:realmName/broker')
@UseGuards(RealmGuard)
@Public()
export class BrokerController {
  constructor(private readonly brokerService: BrokerService) {}

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
    @Res() res: Response,
  ) {
    const result = await this.brokerService.handleCallback(
      realm,
      alias,
      code,
      state,
    );
    res.redirect(302, result.redirectUrl);
  }
}
