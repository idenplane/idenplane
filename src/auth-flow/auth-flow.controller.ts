import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
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
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AuthFlowService } from './auth-flow.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateAuthFlowDto,
  UpdateAuthFlowDto,
  AssignFlowToClientDto,
} from './auth-flow.dto.js';

@ApiTags('Authentication Flows')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('admin/realms/:realm/auth-flows')
export class AuthFlowController {
  constructor(
    private readonly authFlowService: AuthFlowService,
    private readonly prisma: PrismaService,
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

  // ── Create ───────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new authentication flow for a realm' })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiResponse({ status: 201, description: 'Flow created' })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
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
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    return this.authFlowService.create(realmId, dto);
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

  // ── Update ───────────────────────────────────────────────

  @Put(':id')
  @ApiOperation({ summary: 'Update an authentication flow' })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 200, description: 'Authentication flow updated' })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  async update(
    @Param('realm') realmParam: string,
    @Param('id') id: string,
    @Body() dto: UpdateAuthFlowDto,
  ) {
    const realmId = await this.resolveRealmId(realmParam);
    return this.authFlowService.update(realmId, id, dto);
  }

  // ── Delete ───────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an authentication flow' })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  async remove(@Param('realm') realmParam: string, @Param('id') id: string) {
    const realmId = await this.resolveRealmId(realmParam);
    await this.authFlowService.remove(realmId, id);
  }

  // ── Assign flow to client ────────────────────────────────

  @Put(':id/assign-client/:clientId')
  @ApiOperation({
    summary: 'Assign an authentication flow to a specific client',
  })
  @ApiParam({ name: 'realm', description: 'Realm name or ID' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiParam({ name: 'clientId', description: 'Client ID (primary key)' })
  @ApiResponse({ status: 200, description: 'Flow assigned to client' })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Client or flow not found' })
  assignToClient(
    @Param('id') _flowId: string,
    @Param('clientId') clientId: string,
    @Body() dto: AssignFlowToClientDto,
  ) {
    return this.prisma.client.update({
      where: { id: clientId },
      data: { authFlowId: dto.authFlowId ?? null },
      select: { id: true, clientId: true, authFlowId: true },
    });
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
  async seedDefaults(@Param('realm') realmParam: string) {
    const realmId = await this.resolveRealmId(realmParam);
    await this.authFlowService.seedDefaultFlows(realmId);
  }
}
