import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiExcludeController, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Prisma, Realm, SamlServiceProvider, User } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { SamlIdpService } from './saml-idp.service.js';
import { SamlMetadataService } from './saml-metadata.service.js';
import { LoginService } from '../login/login.service.js';
import { SAML_REQUEST_COOKIE, SESSION_COOKIE } from '../authn-core/cookies.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { FlowRuntimeService } from '../auth-flow/flow-runtime.service.js';
import { StepUpService } from '../step-up/step-up.service.js';

/** `PendingAction.type` of an AuthnRequest waiting for a sign-in. */
export const SAML_REQUEST_TYPE = 'saml_request';
/** How long an AuthnRequest waits for the user to sign in. */
const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;

/** What a pending AuthnRequest needs to be answered after the sign-in. */
interface PendingSamlRequest {
  realmId: string;
  spId: string;
  requestId: string;
  acsUrl: string;
  relayState: string;
}

@ApiExcludeController()
@Controller('realms/:realmName/protocol/saml')
@UseGuards(RealmGuard)
@Public()
export class SamlIdpController {
  private readonly logger = new Logger(SamlIdpController.name);

  constructor(
    private readonly samlIdpService: SamlIdpService,
    private readonly samlMetadataService: SamlMetadataService,
    private readonly loginService: LoginService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly flowRuntime: FlowRuntimeService,
    private readonly stepUpService: StepUpService,
  ) {}

  // ─── SSO ENDPOINT (HTTP-Redirect binding) ──────────────

  @Get()
  @ApiResponse({
    status: 302,
    description:
      'Redirect to login page, or auto-POST SAMLResponse when already authenticated',
  })
  @ApiResponse({
    status: 400,
    description: 'Missing SAMLRequest, unknown SP, or invalid ACS URL',
  })
  async ssoRedirect(
    @CurrentRealm() realm: Realm,
    @Query('SAMLRequest') samlRequest: string,
    @Query('RelayState') relayState: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handleSsoRequest(realm, samlRequest, relayState, req, res);
  }

  // ─── SSO ENDPOINT (HTTP-POST binding) ──────────────────

  @Post()
  @ApiResponse({
    status: 302,
    description:
      'Redirect to login page, or auto-POST SAMLResponse when already authenticated',
  })
  @ApiResponse({
    status: 400,
    description: 'Missing SAMLRequest, unknown SP, or invalid ACS URL',
  })
  async ssoPost(
    @CurrentRealm() realm: Realm,
    @Body('SAMLRequest') samlRequest: string,
    @Body('RelayState') relayState: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handleSsoRequest(realm, samlRequest, relayState, req, res);
  }

  // ─── RESUME AFTER SIGN-IN ──────────────────────────────

  /**
   * Where every sign-in without an OAuth client lands while an AuthnRequest
   * waits (password, second factor, MFA enrolment, passkey, a custom flow):
   * answers that request with the new session, once.
   */
  @Get('resume')
  @ApiResponse({
    status: 200,
    description: 'Auto-POST SAMLResponse for the pending AuthnRequest',
  })
  @ApiResponse({
    status: 302,
    description:
      'Back to the login page (no session yet) or the account page (nothing pending)',
  })
  async resume(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token = (req.cookies as Record<string, string | undefined>)?.[
      SAML_REQUEST_COOKIE
    ];
    const pending = token ? await this.findPending(realm, token) : null;
    if (!pending) {
      this.clearSamlCookie(realm, res);
      return res.redirect(302, `/realms/${realm.name}/account`);
    }

    const user = await this.sessionUser(realm, req);
    if (!user) {
      // Not signed in (or not strongly enough): sign in first, then back here.
      return res.redirect(302, `/realms/${realm.name}/login?saml=1`);
    }

    // The service provider and its ACS URL are checked again: either may
    // have changed while the user signed in.
    const sp = await this.prisma.samlServiceProvider.findFirst({
      where: { id: pending.data.spId, realmId: realm.id },
    });
    if (!sp || !sp.enabled || !this.acsUrlAllowed(sp, pending.data.acsUrl)) {
      await this.deletePending(pending.id);
      this.clearSamlCookie(realm, res);
      throw new BadRequestException(
        'The SAML service provider of this sign-in is no longer available',
      );
    }
    // Single use: only one request answers the AuthnRequest.
    if (!(await this.deletePending(pending.id))) {
      this.clearSamlCookie(realm, res);
      return res.redirect(302, `/realms/${realm.name}/account`);
    }
    return this.completeSamlLogin(
      realm,
      sp,
      user,
      pending.data.requestId,
      pending.data.acsUrl,
      pending.data.relayState,
      res,
    );
  }

  // ─── IDP METADATA ─────────────────────────────────────

  @Get('descriptor')
  @ApiResponse({
    status: 200,
    description: 'IdP SAML metadata XML (EntityDescriptor)',
  })
  @ApiResponse({ status: 400, description: 'Realm not found' })
  async metadata(@CurrentRealm() realm: Realm, @Res() res: Response) {
    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    const xml = await this.samlMetadataService.generateMetadata(realm, baseUrl);

    res.set('Content-Type', 'application/xml');
    res.send(xml);
  }

  // ─── PRIVATE ──────────────────────────────────────────

  private async handleSsoRequest(
    realm: Realm,
    samlRequest: string | undefined,
    relayState: string | undefined,
    req: Request,
    res: Response,
  ) {
    if (!samlRequest) {
      throw new BadRequestException('Missing SAMLRequest parameter');
    }

    // Parse the AuthnRequest to extract issuer
    const parsed = await this.samlIdpService.validateAuthnRequest(samlRequest);

    // Look up the SP by issuer (entityId)
    const sp = await this.samlIdpService.findSpByEntityId(
      realm.id,
      parsed.issuer,
    );
    if (!sp || !sp.enabled) {
      throw new BadRequestException(
        `Unknown or disabled SAML service provider: ${parsed.issuer}`,
      );
    }

    // Validate signature using SP's certificate if one is registered
    if (sp.certificate) {
      await this.samlIdpService.validateSignature(samlRequest, sp.certificate);
    }

    // Validate the ACS URL supplied in the AuthnRequest against the SP's
    // registered endpoints.  An attacker could craft a malicious AuthnRequest
    // with an arbitrary acsUrl to redirect the SAML response (and the bearer
    // assertion it contains) to a server they control.  We must therefore
    // reject any URL that does not exactly match either the SP's primary
    // acsUrl or one of its explicitly registered validRedirectUris.
    if (parsed.acsUrl !== null) {
      const allowedAcsUrls: string[] = [sp.acsUrl];
      const spWithRedirectUris = sp as { validRedirectUris?: string[] };
      if (Array.isArray(spWithRedirectUris.validRedirectUris)) {
        allowedAcsUrls.push(...spWithRedirectUris.validRedirectUris);
      }
      if (!allowedAcsUrls.includes(parsed.acsUrl)) {
        throw new BadRequestException(
          'ACS URL in AuthnRequest does not match any registered endpoint for this service provider',
        );
      }
    }

    const acsUrl = parsed.acsUrl ?? sp.acsUrl;

    // An existing session that may serve this realm answers at once.
    const user = await this.sessionUser(realm, req);
    if (user) {
      this.clearSamlCookie(realm, res);
      return this.completeSamlLogin(
        realm,
        sp,
        user,
        parsed.id,
        acsUrl,
        relayState ?? '',
        res,
      );
    }

    // Otherwise the request waits server-side (the browser holds only an
    // opaque token) and the sign-in comes back to /resume.
    const token = this.crypto.generateSecret(32);
    const data: PendingSamlRequest = {
      realmId: realm.id,
      spId: sp.id,
      requestId: parsed.id,
      acsUrl,
      relayState: relayState ?? '',
    };
    await this.prisma.pendingAction.create({
      data: {
        tokenHash: this.crypto.sha256(token),
        type: SAML_REQUEST_TYPE,
        data: data as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + SAML_REQUEST_TTL_MS),
      },
    });
    res.cookie(SAML_REQUEST_COOKIE, token, {
      httpOnly: true,
      secure: true, // session/auth cookies must never traverse plain HTTP (localhost is a secure context)
      // Lax: the service provider sends the browser here from another site.
      sameSite: 'lax',
      maxAge: SAML_REQUEST_TTL_MS,
      path: `/realms/${realm.name}`,
    });

    // Redirect to login page
    const loginUrl = `/realms/${realm.name}/login?saml=1`;
    res.redirect(302, loginUrl);
  }

  /**
   * The user of the browser's SSO session, if it may serve a SAML request
   * of this realm. Where the realm is bound to a custom flow, the session
   * must be as strong as that flow requires of its user (as for an OAuth
   * client), and a misconfigured binding serves no one.
   */
  private async sessionUser(realm: Realm, req: Request): Promise<User | null> {
    const sessionToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!sessionToken) return null;
    const user = await this.loginService.validateLoginSession(
      realm,
      sessionToken,
    );
    if (!user) return null;
    const binding = await this.flowRuntime.resolveBinding(realm, null);
    if (binding.kind === 'legacy') return user;
    if (binding.kind === 'misconfigured') return null;
    const loginSession = await this.loginService.findLoginSession(sessionToken);
    if (!loginSession) return null;
    const sessionAcr =
      await this.stepUpService.getLoginSessionAcr(loginSession);
    const required = await this.flowRuntime.ssoRequiredAcr(
      realm,
      binding.flow,
      user,
      '',
    );
    return this.stepUpService.satisfiesAcr(sessionAcr, required) ? user : null;
  }

  private async findPending(
    realm: Realm,
    token: string,
  ): Promise<{ id: string; data: PendingSamlRequest } | null> {
    const row = await this.prisma.pendingAction.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
    });
    if (!row || row.type !== SAML_REQUEST_TYPE) return null;
    const data = row.data as unknown as PendingSamlRequest;
    if (data.realmId !== realm.id || row.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return { id: row.id, data };
  }

  private async deletePending(id: string): Promise<boolean> {
    const { count } = await this.prisma.pendingAction.deleteMany({
      where: { id, type: SAML_REQUEST_TYPE },
    });
    return count === 1;
  }

  private acsUrlAllowed(sp: SamlServiceProvider, acsUrl: string): boolean {
    return (
      acsUrl === sp.acsUrl || (sp.validRedirectUris ?? []).includes(acsUrl)
    );
  }

  private clearSamlCookie(realm: Realm, res: Response): void {
    res.clearCookie(SAML_REQUEST_COOKIE, { path: `/realms/${realm.name}` });
  }

  /**
   * After a successful login, call this to send the SAML Response
   * back to the SP via auto-submitting POST form.
   */
  private async completeSamlLogin(
    realm: Realm,
    sp: SamlServiceProvider,
    user: User,
    inResponseTo: string,
    acsUrl: string,
    relayState: string,
    res: Response,
  ) {
    const samlResponse = await this.samlIdpService.createSamlResponse(
      realm,
      sp,
      user,
      inResponseTo,
      acsUrl,
    );

    // Clear the SAML request cookie
    this.clearSamlCookie(realm, res);

    // Send an auto-submitting HTML form (POST binding)
    const html = `<!DOCTYPE html>
<html>
<head><title>SAML SSO</title></head>
<body onload="document.forms[0].submit()">
  <noscript><p>Completing SAML sign-in, please click Submit.</p></noscript>
  <form method="POST" action="${this.escapeHtml(acsUrl)}">
    <input type="hidden" name="SAMLResponse" value="${samlResponse}" />
    <input type="hidden" name="RelayState" value="${this.escapeHtml(relayState)}" />
    <noscript><button type="submit">Submit</button></noscript>
  </form>
</body>
</html>`;

    res.set('Content-Type', 'text/html');
    res.send(html);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
