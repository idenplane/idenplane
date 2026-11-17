import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Realm } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { BrokerService, type ExternalIdentity } from './broker.service.js';
import type { BrokerState } from './broker.service.js';
import {
  SAML_BROKER_COOKIE,
  SamlBrokerService,
} from './saml/saml-broker.service.js';
import { ThemeRenderService } from '../theme/theme-render.service.js';
import { LoginFlowService } from '../login/login-flow.service.js';
import { FlowRuntimeService } from '../auth-flow/flow-runtime.service.js';
import { isEnforceAcrOnFreshLoginEnabled } from '../authn-core/acr-enforcement.js';

/** A single string query parameter, or undefined. */
function queryString(req: Request, name: string): string | undefined {
  const value = (req.query as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value ? value : undefined;
}

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
    private readonly samlBroker: SamlBrokerService,
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

    // With ENFORCE_ACR_ON_FRESH_LOGIN, what the request asks of `acr`
    // travels with it too, so the sign-in can be held to it.
    const acrRequest = isEnforceAcrOnFreshLoginEnabled()
      ? {
          acr_values: queryString(req, 'acr_values'),
          claims: queryString(req, 'claims'),
        }
      : {};
    const redirectUrl = await this.brokerService.initiateLogin(realm, alias, {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      ...acrRequest,
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
      this.renderBrokerError(realm, err, req, res);
    }
  }

  // ─── SAML 2.0 IDENTITY PROVIDERS ───────────────────────

  @Get(':alias/saml/metadata')
  @ApiOperation({
    summary: 'SAML service provider metadata for a SAML identity provider',
  })
  @ApiResponse({ status: 200, description: 'SP metadata (XML)' })
  @ApiResponse({ status: 404, description: 'No SAML provider by that alias' })
  async samlMetadata(
    @CurrentRealm() realm: Realm,
    @Param('alias') alias: string,
    @Res() res: Response,
  ) {
    const xml = await this.samlBroker.metadata(realm, alias);
    res.type('application/samlmetadata+xml').send(xml);
  }

  @Get(':alias/saml/start')
  @ApiOperation({
    summary:
      'Start a SAML sign-in: bind it to this browser and send the AuthnRequest',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the IdP (HTTP-Redirect binding)',
  })
  @ApiResponse({
    status: 200,
    description: 'Auto-submitting form to the IdP (HTTP-POST binding)',
  })
  async samlStart(
    @CurrentRealm() realm: Realm,
    @Param('alias') alias: string,
    @Query('h') handle: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      await this.samlBroker.start(realm, alias, handle, res);
    } catch (err) {
      this.renderBrokerError(realm, err, req, res);
    }
  }

  @Post(':alias/saml/acs')
  @ApiOperation({
    summary: 'SAML Assertion Consumer Service (HTTP-POST binding)',
  })
  @ApiResponse({
    status: 303,
    description: 'The response was verified; continue in the browser',
  })
  @ApiResponse({ status: 401, description: 'The SAML response was refused' })
  async samlAcs(
    @CurrentRealm() realm: Realm,
    @Param('alias') alias: string,
    @Body('SAMLResponse') samlResponse: unknown,
    @Body('RelayState') relayState: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const next = await this.samlBroker.acs(
        realm,
        alias,
        samlResponse,
        relayState,
      );
      // A top-level GET, so the browser's Lax cookies come along.
      res.redirect(303, next);
    } catch (err) {
      this.renderBrokerError(realm, err, req, res);
    }
  }

  @Get(':alias/saml/complete')
  @ApiOperation({
    summary: 'Finish a SAML sign-in in the browser that started it',
  })
  @ApiResponse({
    status: 302,
    description: 'Continue the login (code, MFA, consent or the next step)',
  })
  async samlComplete(
    @CurrentRealm() realm: Realm,
    @Param('alias') alias: string,
    @Query('id') id: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const cookie = (req.cookies as Record<string, unknown> | undefined)?.[
        SAML_BROKER_COOKIE
      ];
      const { state, identity } = await this.samlBroker.complete(
        realm,
        alias,
        id,
        cookie,
      );
      res.clearCookie(
        SAML_BROKER_COOKIE,
        this.samlBroker.cookieOptions(realm, alias),
      );
      await this.finishFederated(realm, alias, state, identity, req, res);
    } catch (err) {
      this.renderBrokerError(realm, err, req, res);
    }
  }

  /**
   * After a provider vouched for (or refused) a user: back into the flow
   * that started the sign-in, or the built-in federated sign-in.
   */
  private async finishFederated(
    realm: Realm,
    alias: string,
    state: BrokerState,
    identity: ExternalIdentity | null,
    req: Request,
    res: Response,
  ): Promise<void> {
    if (state.flow) {
      const handled = await this.flowRuntime.dispatch(
        realm,
        {
          endpoint: 'social',
          alias,
          verified: identity ?? undefined,
          flow: state.flow,
        },
        req,
        res,
      );
      if (handled) return;
      throw new ForbiddenException(
        'This sign-in can only be finished in the browser where it started. Please sign in again.',
      );
    }
    if (!identity) {
      throw new UnauthorizedException(
        'The identity provider did not sign you in.',
      );
    }
    const oauthParams = this.brokerService.oauthParamsOf(state);
    const user = await this.brokerService.resolveFederatedUser(realm, identity);
    if (!user.enabled) {
      throw new ForbiddenException('This account is disabled.');
    }
    await this.loginFlow.continueAfterPrimaryAuth(
      realm,
      user,
      oauthParams,
      { primaryAmr: [] },
      req,
      res,
    );
  }

  /** A broker failure as the themed error page (the user's browser is here). */
  private renderBrokerError(
    realm: Realm,
    err: unknown,
    req: Request,
    res: Response,
  ): void {
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
