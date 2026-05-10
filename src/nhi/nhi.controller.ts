import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse } from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { NhiService } from './nhi.service.js';
import { NhiAuditService } from './nhi-audit.service.js';
import { CreateNhiIdentityDto } from './dto/create-nhi.dto.js';
import { UpdateNhiIdentityDto } from './dto/update-nhi.dto.js';
import { CreateNhiCredentialDto } from './dto/create-nhi-credential.dto.js';
import { GenerateCertificateDto, SetCertificateDto } from './dto/certificate.dto.js';
import { CreateNhiCredentialPolicyDto } from './dto/create-nhi-credential-policy.dto.js';
import { UpdateNhiCredentialPolicyDto } from './dto/update-nhi-credential-policy.dto.js';
import { BulkRegistrationDto } from './dto/bulk-registration.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('NHI Identities')
@Controller('admin/realms/:realmName/nhi')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class NhiController {
  constructor(
    private readonly nhiService: NhiService,
    private readonly nhiAuditService: NhiAuditService,
  ) {}

  // ── NHI Identity endpoints ───────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create an NHI identity in a realm' })
  @ApiResponse({ status: 201, description: 'NHI identity created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'NHI identity already exists' })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateNhiIdentityDto) {
    return this.nhiService.create(realm, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List NHI identities in a realm' })
  @ApiResponse({ status: 200, description: 'List of NHI identities' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.nhiService.findAll(realm);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an NHI identity by ID' })
  @ApiResponse({ status: 200, description: 'NHI identity details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.nhiService.findById(realm, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an NHI identity' })
  @ApiResponse({ status: 200, description: 'NHI identity updated' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  @ApiResponse({ status: 409, description: 'NHI identity name already taken' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: UpdateNhiIdentityDto,
  ) {
    return this.nhiService.update(realm, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an NHI identity' })
  @ApiResponse({ status: 204, description: 'NHI identity deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  remove(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.nhiService.remove(realm, id);
  }

  // ── Lifecycle endpoints ─────────────────────────────────────────────────────

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an NHI identity' })
  @ApiResponse({ status: 200, description: 'NHI identity suspended' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  suspend(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.nhiService.suspend(realm, id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a suspended NHI identity' })
  @ApiResponse({ status: 200, description: 'NHI identity reactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  @ApiResponse({ status: 409, description: 'Identity is not suspended' })
  reactivate(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.nhiService.reactivate(realm, id);
  }

  @Post(':id/decommission')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decommission an NHI identity (revokes all credentials)' })
  @ApiResponse({ status: 200, description: 'NHI identity decommissioned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  decommission(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.nhiService.decommission(realm, id);
  }

  // ── Credential endpoints ────────────────────────────────────────────────────

  @Post(':id/credentials')
  @ApiOperation({ summary: 'Create a credential for an NHI identity' })
  @ApiResponse({ status: 201, description: 'Credential created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  createCredential(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: CreateNhiCredentialDto,
  ) {
    return this.nhiService.createCredential(realm, id, dto);
  }

  @Get(':id/credentials')
  @ApiOperation({ summary: 'List credentials for an NHI identity' })
  @ApiResponse({ status: 200, description: 'List of credentials' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  listCredentials(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.nhiService.listCredentials(realm, id);
  }

  @Post(':id/credentials/:credentialId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a credential' })
  @ApiResponse({ status: 200, description: 'Credential revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity or credential not found' })
  revokeCredential(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
  ) {
    return this.nhiService.revokeCredential(realm, id, credentialId);
  }

  @Post(':id/credentials/:credentialId/rotate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a credential (creates new key, keeps old active for grace period)' })
  @ApiResponse({ status: 200, description: 'Credential rotated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity or credential not found' })
  @ApiResponse({ status: 409, description: 'Only API_KEY credentials can be rotated' })
  rotateCredential(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
  ) {
    return this.nhiService.rotateCredential(realm, id, credentialId);
  }

  // ── Bulk registration ───────────────────────────────────────────────────────

  @Post('devices/bulk-register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bulk register devices for fleet management' })
  @ApiResponse({ status: 201, description: 'Bulk registration completed' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  bulkRegistration(
    @CurrentRealm() realm: Realm,
    @Body() dto: BulkRegistrationDto,
  ) {
    return this.nhiService.bulkRegistration(realm, dto);
  }

  // ── Certificate generation ────────────────────────────────────────────────

  @Post('device-certificates')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a device certificate (self-signed)' })
  @ApiResponse({ status: 201, description: 'Certificate generated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  generateDeviceCertificate(
    @CurrentRealm() realm: Realm,
    @Body() dto: GenerateCertificateDto,
  ) {
    return this.nhiService.generateDeviceCertificate(realm, dto);
  }

  // ── Certificate management ─────────────────────────────────────────────────

  @Post(':id/certificate')
  @ApiOperation({ summary: 'Set certificate for an NHI identity' })
  @ApiResponse({ status: 200, description: 'Certificate set' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  setCertificate(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: SetCertificateDto,
  ) {
    return this.nhiService.setCertificate(realm, id, dto);
  }

  // ── Usage statistics ────────────────────────────────────────────────────────

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get usage statistics for an NHI identity' })
  @ApiResponse({ status: 200, description: 'NHI identity usage statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'NHI identity not found' })
  getUsageStats(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.nhiService.getUsageStats(realm, id);
  }

  // ── Rotation policy management ─────────────────────────────────────────────

  @Post('credential-policies')
  @ApiOperation({ summary: 'Create a credential rotation policy' })
  @ApiResponse({ status: 201, description: 'Credential policy created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Credential policy already exists' })
  createPolicy(@CurrentRealm() realm: Realm, @Body() dto: CreateNhiCredentialPolicyDto) {
    return this.nhiService.createPolicy(realm, dto);
  }

  @Get('credential-policies')
  @ApiOperation({ summary: 'List credential rotation policies in a realm' })
  @ApiResponse({ status: 200, description: 'List of credential policies' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listPolicies(@CurrentRealm() realm: Realm) {
    return this.nhiService.listPolicies(realm);
  }

  @Get('credential-policies/:policyId')
  @ApiOperation({ summary: 'Get a credential rotation policy by ID' })
  @ApiResponse({ status: 200, description: 'Credential policy details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Credential policy not found' })
  getPolicy(@CurrentRealm() realm: Realm, @Param('policyId') policyId: string) {
    return this.nhiService.findPolicyById(realm, policyId);
  }

  @Put('credential-policies/:policyId')
  @ApiOperation({ summary: 'Update a credential rotation policy' })
  @ApiResponse({ status: 200, description: 'Credential policy updated' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Credential policy not found' })
  @ApiResponse({ status: 409, description: 'Credential policy name already taken' })
  updatePolicy(
    @CurrentRealm() realm: Realm,
    @Param('policyId') policyId: string,
    @Body() dto: UpdateNhiCredentialPolicyDto,
  ) {
    return this.nhiService.updatePolicy(realm, policyId, dto);
  }

  @Delete('credential-policies/:policyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a credential rotation policy' })
  @ApiResponse({ status: 204, description: 'Credential policy deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Credential policy not found' })
  deletePolicy(@CurrentRealm() realm: Realm, @Param('policyId') policyId: string) {
    return this.nhiService.removePolicy(realm, policyId);
  }

  @Get('credential-policies/:policyId/rotation-status')
  @ApiOperation({ summary: 'Get rotation status for all credentials under a policy' })
  @ApiResponse({ status: 200, description: 'Rotation status for policy credentials' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Credential policy not found' })
  getPolicyRotationStatus(@CurrentRealm() realm: Realm, @Param('policyId') policyId: string) {
    return this.nhiService.getPolicyRotationStatus(realm, policyId);
  }

  @Get('rotation-status')
  @ApiOperation({ summary: 'Get summary of all credentials requiring rotation in the realm' })
  @ApiResponse({ status: 200, description: 'Credentials requiring rotation summary' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getRotationStatusSummary(@CurrentRealm() realm: Realm) {
    return this.nhiService.getRotationStatusSummary(realm);
  }

  // ── Audit log endpoints ─────────────────────────────────────────────────────

  @Get('audit-logs')
  @ApiOperation({ summary: 'Query NHI audit logs' })
  @ApiResponse({ status: 200, description: 'List of NHI audit logs' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  queryAuditLogs(
    @CurrentRealm() realm: Realm,
    @Query('nhiIdentityId') nhiIdentityId?: string,
    @Query('action') action?: string,
    @Query('success') success?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('first') first?: string,
    @Query('max') max?: string,
  ) {
    return this.nhiAuditService.queryAuditLogs({
      realmId: realm.id,
      nhiIdentityId,
      action,
      success: success !== undefined ? success === 'true' : undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      first: first ? parseInt(first, 10) : undefined,
      max: max ? parseInt(max, 10) : undefined,
    });
  }

  @Delete('audit-logs')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear NHI audit logs' })
  @ApiResponse({ status: 204, description: 'NHI audit logs cleared' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  clearAuditLogs(
    @CurrentRealm() realm: Realm,
    @Query('nhiIdentityId') nhiIdentityId?: string,
  ) {
    return this.nhiAuditService.clearAuditLogs(realm.id, nhiIdentityId);
  }
}
