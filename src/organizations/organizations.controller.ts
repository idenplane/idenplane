import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { OrganizationsService } from './organizations.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import { CreateSsoConnectionDto } from './dto/create-sso-connection.dto.js';
import { UpdateSsoConnectionDto } from './dto/update-sso-connection.dto.js';
import { VerifyDomainDto } from './dto/verify-domain.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Organizations')
@Controller('admin/realms/:realmName/organizations')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  // ─── Organizations CRUD ──────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create an organization in a realm' })
  @ApiResponse({ status: 201, description: 'Organization created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(realm, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all organizations in a realm' })
  @ApiResponse({ status: 200, description: 'List of organizations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.organizationsService.findAll(realm);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get an organization by slug' })
  @ApiResponse({ status: 200, description: 'Organization details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('slug') slug: string) {
    return this.organizationsService.findOne(realm, slug);
  }

  @Put(':slug')
  @ApiOperation({ summary: 'Update an organization' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(realm, slug, dto);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an organization' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@CurrentRealm() realm: Realm, @Param('slug') slug: string) {
    return this.organizationsService.remove(realm, slug);
  }

  // ─── Members ─────────────────────────────────────────────

  @Get(':slug/members')
  @ApiOperation({ summary: 'List members of an organization' })
  @ApiResponse({ status: 200, description: 'List of organization members' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  listMembers(@CurrentRealm() realm: Realm, @Param('slug') slug: string) {
    return this.organizationsService.listMembers(realm, slug);
  }

  @Post(':slug/members')
  @ApiOperation({ summary: 'Add a user to an organization' })
  @ApiResponse({ status: 201, description: 'Member added' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  addMember(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.organizationsService.addMember(realm, slug, dto);
  }

  @Put(':slug/members/:userId')
  @ApiOperation({ summary: "Update a member's role" })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  updateMemberRole(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(realm, slug, userId, dto);
  }

  @Delete(':slug/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a user from an organization' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  removeMember(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Param('userId') userId: string,
  ) {
    return this.organizationsService.removeMember(realm, slug, userId);
  }

  // ─── Invitations ─────────────────────────────────────────

  @Get(':slug/invitations')
  @ApiOperation({ summary: 'List invitations for an organization' })
  @ApiResponse({ status: 200, description: 'List of invitations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  listInvitations(@CurrentRealm() realm: Realm, @Param('slug') slug: string) {
    return this.organizationsService.listInvitations(realm, slug);
  }

  @Post(':slug/invitations')
  @ApiOperation({ summary: 'Create an invitation to an organization' })
  @ApiResponse({ status: 201, description: 'Invitation created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  createInvitation(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.organizationsService.createInvitation(realm, slug, dto);
  }

  @Post(':slug/invitations/:token/accept')
  @ApiOperation({ summary: 'Accept an invitation (supply userId in body)' })
  @ApiResponse({ status: 201, description: 'Invitation accepted' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  acceptInvitation(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Body('userId') userId: string,
  ) {
    return this.organizationsService.acceptInvitation(
      realm,
      slug,
      token,
      userId,
    );
  }

  // ─── Domain Verification ─────────────────────────────────

  @Post(':slug/verify-domain/initiate')
  @ApiOperation({
    summary: 'Get the DNS TXT record to publish for domain verification',
  })
  @ApiResponse({ status: 201, description: 'DNS TXT record token returned' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  initiateDomainVerification(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Body() dto: VerifyDomainDto,
  ) {
    return this.organizationsService.initiateDomainVerification(
      realm,
      slug,
      dto,
    );
  }

  @Post(':slug/verify-domain')
  @ApiOperation({ summary: 'Verify domain ownership via DNS TXT lookup' })
  @ApiResponse({ status: 200, description: 'Domain verified' })
  @ApiResponse({ status: 400, description: 'DNS record not found or mismatch' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  verifyDomain(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Body() dto: VerifyDomainDto,
  ) {
    return this.organizationsService.verifyDomain(realm, slug, dto);
  }

  // ─── SSO Connections ─────────────────────────────────────

  @Get(':slug/sso-connections')
  @ApiOperation({ summary: 'List SSO connections for an organization' })
  @ApiResponse({ status: 200, description: 'List of SSO connections' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  listSsoConnections(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
  ) {
    return this.organizationsService.listSsoConnections(realm, slug);
  }

  @Post(':slug/sso-connections')
  @ApiOperation({ summary: 'Create an SSO connection for an organization' })
  @ApiResponse({ status: 201, description: 'SSO connection created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  createSsoConnection(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Body() dto: CreateSsoConnectionDto,
  ) {
    return this.organizationsService.createSsoConnection(realm, slug, dto);
  }

  @Get(':slug/sso-connections/:connectionId')
  @ApiOperation({ summary: 'Get a specific SSO connection' })
  @ApiResponse({ status: 200, description: 'SSO connection details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getSsoConnection(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.organizationsService.getSsoConnection(
      realm,
      slug,
      connectionId,
    );
  }

  @Put(':slug/sso-connections/:connectionId')
  @ApiOperation({ summary: 'Update an SSO connection' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  updateSsoConnection(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Param('connectionId') connectionId: string,
    @Body() dto: UpdateSsoConnectionDto,
  ) {
    return this.organizationsService.updateSsoConnection(
      realm,
      slug,
      connectionId,
      dto,
    );
  }

  @Delete(':slug/sso-connections/:connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an SSO connection' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  deleteSsoConnection(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.organizationsService.deleteSsoConnection(
      realm,
      slug,
      connectionId,
    );
  }
}
