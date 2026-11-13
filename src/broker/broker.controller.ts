import {
  Controller,
  ForbiddenException,
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
import { LoginFlowService } from '../login/login-flow.service.js';
import { FlowRuntimeService } from '../auth-flow/flow-runtime.service.js';

@ApiTags('Identity Broker')
@Controller('realms/:realmName/broker')
@UseGuards(RealmGuard)
@Public()
export class BrokerController {
  constructor(
    private readonly brokerService: BrokerService,
    private readonly themeRender: ThemeRenderService,
    private readonly loginFlow: LoginFlowService,
    private readonly flowRuntime: FlowRuntimeService,
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
    @Query('code_challenge') codeChallenge: string,
    @Query('code_challenge_method') codeChallengeMethod: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // The `social` step of a custom-flow login in progress in this browser.
    if (await this.flowRuntime.startSocial(realm, alias, req, res)) return;

    const redirectUrl = await this.brokerService.initiateLogin(realm, alias, {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
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
      // A sign-in a flow's social step started goes back into its login
      // transaction, in this browser only; never the built-in path.
      const brokerState = await this.brokerService.readState(
        realm,
        alias,
        typeof state === 'string' ? state : '',
      );
      if (brokerState.flow) {
        const handled = await this.flowRuntime.dispatch(
          realm,
          {
            endpoint: 'social',
            alias,
            code: typeof code === 'string' && code ? code : undefined,
            flow: brokerState.flow,
          },
          req,
          res,
        );
        if (handled) return;
        throw new ForbiddenException(
          'This sign-in can only be finished in the browser where it started. Please sign in again.',
        );
      }

      const { user, oauthParams } = await this.brokerService.handleCallback(
        realm,
        alias,
        code,
        state,
      );
      if (!user.enabled) {
        throw new ForbiddenException('This account is disabled.');
      }
      // From here a federated sign-in is finished exactly like a password
      // one: the realm's MFA policy applies, and the SSO session, login
      // event, consent screen and code all come from the same place.
      await this.loginFlow.continueAfterPrimaryAuth(
        realm,
        user,
        oauthParams,
        // The external provider's own methods are not known here.
        { primaryAmr: [] },
        req,
        res,
      );
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
        const message = response.message;
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
