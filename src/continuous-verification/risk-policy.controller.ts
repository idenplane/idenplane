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
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { RiskPolicyService } from './risk-policy.service.js';
import type {
  CreateContinuousRiskPolicyDto,
  UpdateContinuousRiskPolicyDto,
} from './risk-policy.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Continuous Verification (Risk Policies)')
@Controller('admin/realms/:realmName/risk-policies')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class RiskPolicyController {
  constructor(private readonly riskPolicyService: RiskPolicyService) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a continuous risk policy in a realm' })
  @ApiResponse({ status: 201, description: 'Policy created' })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — policy with same name already exists',
  })
  create(
    @CurrentRealm() realm: Realm,
    @Body() dto: CreateContinuousRiskPolicyDto,
  ) {
    return this.riskPolicyService.createPolicy(realm, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all continuous risk policies in a realm' })
  @ApiResponse({
    status: 200,
    description: 'Array of continuous risk policies',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  findAll(@CurrentRealm() realm: Realm) {
    return this.riskPolicyService.findAllPolicies(realm);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single continuous risk policy by ID' })
  @ApiResponse({ status: 200, description: 'Continuous risk policy details' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.riskPolicyService.findPolicyById(realm, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a continuous risk policy' })
  @ApiResponse({ status: 200, description: 'Policy updated' })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: UpdateContinuousRiskPolicyDto,
  ) {
    return this.riskPolicyService.updatePolicy(realm, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a continuous risk policy' })
  @ApiResponse({ status: 204, description: 'Policy deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  remove(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.riskPolicyService.deletePolicy(realm, id);
  }

  // ─── Toggle & Reorder ───────────────────────────────────────────────────

  @Patch(':id/toggle')
  @ApiOperation({
    summary: 'Enable or disable a continuous risk policy',
    description: 'Toggles the enabled state of the specified policy.',
  })
  @ApiResponse({
    status: 200,
    description: 'Policy updated with new enabled state',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  toggle(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.riskPolicyService.togglePolicy(realm, id, body.enabled);
  }

  @Patch(':id/priority')
  @ApiOperation({
    summary: 'Reorder a continuous risk policy by changing its priority',
    description: 'Updates the priority value of the specified policy.',
  })
  @ApiResponse({ status: 200, description: 'Policy updated with new priority' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  reorder(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() body: { priority: number },
  ) {
    return this.riskPolicyService.reorderPolicy(realm, id, body.priority);
  }
}
