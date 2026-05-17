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
import type { Realm, SamlServiceProvider, User } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { SamlIdpService } from './saml-idp.service.js';
import { SamlMetadataService } from './saml-metadata.service.js';
import { LoginService } from '../login/login.service.js';

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

    // Store SAML request info in a cookie so we can resume after login
    const samlSessionData = JSON.stringify({
      requestId: parsed.id,
      issuer: parsed.issuer,
      acsUrl: parsed.acsUrl ?? sp.acsUrl,
      relayState: relayState ?? '',
      spId: sp.id,
    });

    res.cookie(
      'AUTHME_SAML_REQUEST',
      Buffer.from(samlSessionData).toString('base64'),
      {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutes
        path: `/realms/${realm.name}`,
      },
    );

    // Check if the user already has an active login session
    const sessionToken = req.cookies?.['AUTHME_SESSION'] as string | undefined;
    if (sessionToken) {
      const user = await this.loginService.validateLoginSession(
        realm,
        sessionToken,
      );
      if (user) {
        // User is already logged in - produce SAML response directly
        return this.completeSamlLogin(
          realm,
          sp,
          user,
          parsed.id,
          parsed.acsUrl ?? sp.acsUrl,
          relayState ?? '',
          res,
        );
      }
    }

    // Redirect to login page
    const loginUrl = `/realms/${realm.name}/login?saml=1`;
    res.redirect(302, loginUrl);
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
    );

    // Clear the SAML request cookie
    res.clearCookie('AUTHME_SAML_REQUEST', { path: `/realms/${realm.name}` });

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
