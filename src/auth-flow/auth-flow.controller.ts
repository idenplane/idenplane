import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AuthFlowService } from './auth-flow.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { OperationType, ResourceType } from '../events/event-types.js';
import type { OperationTypeValue } from '../events/event-types.js';
import {
  CreateAuthFlowDto,
  UpdateAuthFlowDto,
  AssignFlowToClientDto,
  UpdateFlowBindingsDto,
} from './auth-flow.dto.js';
import { AdminRealmParam } from '../common/decorators/admin-access.decorator.js';

type AdminRequest = Request & {
  adminUser?: { userId?: string; id?: string };
};

@ApiTags('Authentication Flows')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('admin/realms/:realm/auth-flows')
@AdminRealmParam('realm', 'id-or-name')
export class AuthFlowController {
  constructor(
    private readonly authFlowService: AuthFlowService,
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Resolve the `:realm` route parameter (name or ID) to a realm UUID.
   * Tries UUID lookup first, falls back to name lookup.
   */
  private async resolveRealmId(realmParam: string): Promise<string> {
    // Try as UUID first
    const byId = await this.prisma.realm.findUnique({
      where: { id: realmParam },
      select: { id: true },
    });
    if (byId) return byId.id;

    // Fall back to name lookup
    const byName = await this.prisma.realm.findUnique({
      where: { name: realmParam },
      select: { id: true },
    });
    if (byName) return byName.id;

    throw new NotFoundException(`Realm '${realmParam}' not found`);
  }

  /**
   * Record an admin event (the realm's audit trail). The global
   * AdminEventInterceptor only records requests that RealmGuard resolved a
   * realm for; this controller resolves `:realm` itself (name or id), so it
   * records its writes explicitly, like ImpersonationService and SCIM do.
   */
  private audit(
    req: AdminRequest,
    realmId: string,
    operationType: OperationTypeValue,
    representation?: Record<string, unknown>,
  ): void {
    void this.events.recordAdminEvent({
      realmId,
      adminUserId: req.adminUser?.userId ?? req.adminUser?.id ?? 'api-key',
      operationType,
      resourceType: ResourceType.AUTH_FLOW,
      resourcePath: req.path,
      representation,
      ipAddress: req.ip,
    });
  }

  // ── Create ───────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new authentication flow for a realm' })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiResponse({ status: 201, description: 'Flow created' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid DTO, or the flow fails validation (body has `errors: [{path, code, message}]`)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 409,
    description: 'Flow with that name already exists',
  })
  async create(
    @Param('realm') realmParam: string,
    @Body() dto: CreateAuthFlowDto,
    @Req() req: AdminRequest,
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    const flow = await this.authFlowService.create(realmId, dto);
    this.audit(req, realmId, OperationType.CREATE, {
      id: flow.id,
      name: flow.name,
      version: flow.version,
      steps: flow.steps,
    });
    return flow;
  }

  // ── List ─────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all authentication flows for a realm' })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiResponse({ status: 200, description: 'Array of authentication flows' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async findAll(@Param('realm') realmParam: string) {
    const realmId = await this.resolveRealmId(realmParam);
    return this.authFlowService.findAll(realmId);
  }

  // ── Bindings (declared before `:id` so "bindings" is not a flow id) ──

  @Get('bindings')
  @ApiOperation({
    summary: "Get the realm's flow bindings",
    description:
      'Returns `{runtimeEnabled, authFlowsEnabled, browserFlowId, clients:[{id, clientId, name, authFlowId}]}`. `runtimeEnabled` reflects the AUTH_FLOW_RUNTIME_ENABLED server flag; while it is false, bindings are stored but login ignores them.',
  })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiResponse({ status: 200, description: 'Current bindings' })
  async getBindings(@Param('realm') realmParam: string) {
    const realmId = await this.resolveRealmId(realmParam);
    return this.authFlowService.getBindings(realmId);
  }

  @Put('bindings')
  @ApiOperation({
    summary: "Update the realm's flow bindings",
    description:
      'Partial update. Omitted fields are unchanged; `clients` patches only the listed clients (by OAuth client_id; `authFlowId: null` removes an override). Every bound flow must belong to the realm and pass validation; with `authFlowsEnabled` true, every effective binding is checked.',
  })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiResponse({ status: 200, description: 'Updated bindings' })
  @ApiResponse({
    status: 400,
    description:
      'Unknown client or flow, or a flow fails validation (body has `errors`)',
  })
  async updateBindings(
    @Param('realm') realmParam: string,
    @Body() dto: UpdateFlowBindingsDto,
    @Req() req: AdminRequest,
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    const { bindings, changed } = await this.authFlowService.updateBindings(
      realmId,
      dto,
    );
    this.audit(req, realmId, OperationType.UPDATE, { bindings: changed });
    return bindings;
  }

  // ── Get one ──────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get a single authentication flow by ID' })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 200, description: 'Authentication flow details' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  async findOne(@Param('realm') realmParam: string, @Param('id') id: string) {
    const realmId = await this.resolveRealmId(realmParam);
    return this.authFlowService.findOne(realmId, id);
  }

  // ── Validate ─────────────────────────────────────────────

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a stored authentication flow',
    description:
      'Returns `{valid, errors:[{path, code, message}]}`. Read-only; useful for flows saved before the stricter rules.',
  })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  async validate(@Param('realm') realmParam: string, @Param('id') id: string) {
    const realmId = await this.resolveRealmId(realmParam);
    return this.authFlowService.validateFlow(realmId, id);
  }

  // ── Update ───────────────────────────────────────────────

  @Put(':id')
  @ApiOperation({
    summary: 'Update an authentication flow (increments its version)',
  })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 200, description: 'Authentication flow updated' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid DTO, or the flow fails validation (body has `errors: [{path, code, message}]`)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  async update(
    @Param('realm') realmParam: string,
    @Param('id') id: string,
    @Body() dto: UpdateAuthFlowDto,
    @Req() req: AdminRequest,
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    const flow = await this.authFlowService.update(realmId, id, dto);
    this.audit(req, realmId, OperationType.UPDATE, {
      id: flow.id,
      name: flow.name,
      version: flow.version,
      ...(dto.steps !== undefined && { steps: flow.steps }),
    });
    return flow;
  }

  // ── Delete ───────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an authentication flow' })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  @ApiResponse({
    status: 409,
    description:
      'Flow is bound to the realm or to clients (body has `bindings`)',
  })
  async remove(
    @Param('realm') realmParam: string,
    @Param('id') id: string,
    @Req() req: AdminRequest,
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    await this.authFlowService.remove(realmId, id);
    this.audit(req, realmId, OperationType.DELETE);
  }

  // ── Assign flow to client ────────────────────────────────

  @Put(':id/assign-client/:clientId')
  @ApiOperation({
    summary: 'Bind the flow in the path to one client (per-client override)',
    description:
      'The flow is the `:id` path parameter. A body `authFlowId`, if sent, must equal it. Flow and client must both belong to the realm, and the flow must pass validation.',
  })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiParam({ name: 'clientId', description: 'Client ID (primary key)' })
  @ApiResponse({ status: 200, description: 'Flow assigned to client' })
  @ApiResponse({
    status: 400,
    description: 'Body names another flow, or the flow fails validation',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Client or flow not in realm' })
  async assignToClient(
    @Param('realm') realmParam: string,
    @Param('id') flowId: string,
    @Param('clientId') clientId: string,
    @Body() dto: AssignFlowToClientDto,
    @Req() req: AdminRequest,
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    const { previousAuthFlowId, ...result } =
      await this.authFlowService.assignToClient(
        realmId,
        flowId,
        clientId,
        dto?.authFlowId,
      );
    this.audit(req, realmId, OperationType.UPDATE, {
      clientId: result.clientId,
      from: previousAuthFlowId,
      to: result.authFlowId,
    });
    return result;
  }

  @Delete(':id/assign-client/:clientId')
  @ApiOperation({ summary: "Remove a client's binding to this flow" })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiParam({ name: 'clientId', description: 'Client ID (primary key)' })
  @ApiResponse({ status: 200, description: 'Assignment removed' })
  @ApiResponse({
    status: 404,
    description: 'Flow or client not in realm, or client not bound to it',
  })
  async unassignFromClient(
    @Param('realm') realmParam: string,
    @Param('id') flowId: string,
    @Param('clientId') clientId: string,
    @Req() req: AdminRequest,
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    const result = await this.authFlowService.unassignFromClient(
      realmId,
      flowId,
      clientId,
    );
    this.audit(req, realmId, OperationType.DELETE, {
      clientId: result.clientId,
      from: flowId,
      to: null,
    });
    return result;
  }

  // ── Seed defaults ────────────────────────────────────────

  @Post('seed-defaults')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Seed the three built-in default flows for this realm',
  })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiResponse({ status: 204, description: 'Default flows seeded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async seedDefaults(
    @Param('realm') realmParam: string,
    @Req() req: AdminRequest,
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    await this.authFlowService.seedDefaultFlows(realmId);
    this.audit(req, realmId, OperationType.CREATE, { seedDefaults: true });
  }
}
