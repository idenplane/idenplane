import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';
import { TlsAdminService } from './tls-admin.service.js';
import {
  CreateRevokedCertificateDto,
  UploadCertificateDto,
} from './dto/tls-admin.dto.js';

/** Certificates a client registers for `self_signed_tls_client_auth`. */
@ApiTags('Clients')
@Controller('admin/realms/:realmName/clients/:clientId/tls-certificates')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class ClientTlsCertificatesController {
  constructor(private readonly tls: TlsAdminService) {}

  @Get()
  @ApiOperation({ summary: "List a client's registered TLS certificates" })
  @ApiResponse({ status: 200, description: 'Registered certificates' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  list(@CurrentRealm() realm: Realm, @Param('clientId') clientId: string) {
    return this.tls.listClientCertificates(realm, clientId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one registered TLS certificate, with its PEM' })
  @ApiResponse({ status: 404, description: 'Not found' })
  get(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Param('id') id: string,
  ) {
    return this.tls.getClientCertificate(realm, clientId, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Register a certificate for self_signed_tls_client_auth',
    description:
      'Returns the certificate x5tS256 (RFC 8705 x5t#S256). Refuses a private key, several certificates and an expired certificate.',
  })
  @ApiResponse({ status: 201, description: 'Registered' })
  @ApiResponse({ status: 400, description: 'Not exactly one certificate' })
  @ApiResponse({ status: 409, description: 'Already registered, or too many' })
  add(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Body() dto: UploadCertificateDto,
  ) {
    return this.tls.addClientCertificate(realm, clientId, dto.certificatePem);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a registered TLS certificate' })
  @ApiResponse({ status: 204, description: 'Removed' })
  remove(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Param('id') id: string,
  ) {
    return this.tls.removeClientCertificate(realm, clientId, id);
  }
}

/** The CAs a realm trusts to issue `tls_client_auth` certificates. */
@ApiTags('Realms')
@Controller('admin/realms/:realmName/tls-trust-anchors')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class RealmTlsTrustAnchorsController {
  constructor(private readonly tls: TlsAdminService) {}

  @Get()
  @ApiOperation({ summary: "List the realm's mTLS trust anchors" })
  list(@CurrentRealm() realm: Realm) {
    return this.tls.listTrustAnchors(realm);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one trust anchor, with its PEM' })
  @ApiResponse({ status: 404, description: 'Not found' })
  get(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.tls.getTrustAnchor(realm, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a trust anchor for tls_client_auth',
    description:
      'Must be a CA certificate (basicConstraints cA, keyCertSign) without nameConstraints or unsupported critical extensions.',
  })
  @ApiResponse({ status: 201, description: 'Added' })
  @ApiResponse({ status: 400, description: 'Not a usable CA certificate' })
  @ApiResponse({ status: 409, description: 'Already present, or too many' })
  add(@CurrentRealm() realm: Realm, @Body() dto: UploadCertificateDto) {
    return this.tls.addTrustAnchor(realm, dto.certificatePem);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a trust anchor' })
  @ApiResponse({ status: 204, description: 'Removed' })
  remove(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.tls.removeTrustAnchor(realm, id);
  }
}

/** The realm's client certificate deny-list. */
@ApiTags('Realms')
@Controller('admin/realms/:realmName/tls-revoked-certificates')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class TlsRevokedCertificatesController {
  constructor(private readonly tls: TlsAdminService) {}

  @Get()
  @ApiOperation({ summary: "List the realm's revoked client certificates" })
  list(@CurrentRealm() realm: Realm) {
    return this.tls.listRevoked(realm);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one deny-list entry' })
  @ApiResponse({ status: 404, description: 'Not found' })
  get(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.tls.getRevoked(realm, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Revoke a client certificate',
    description:
      'By certificatePem, by x5tS256, or by issuerDn with serialNumber. Applies to both certificate methods and to every certificate in a tls_client_auth path. Takes effect on the next request.',
  })
  @ApiResponse({ status: 201, description: 'Listed' })
  @ApiResponse({ status: 400, description: 'No certificate named' })
  add(@CurrentRealm() realm: Realm, @Body() dto: CreateRevokedCertificateDto) {
    return this.tls.addRevoked(realm, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a deny-list entry' })
  @ApiResponse({ status: 204, description: 'Removed' })
  remove(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.tls.removeRevoked(realm, id);
  }
}
