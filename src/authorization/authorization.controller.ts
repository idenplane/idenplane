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
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { AuthorizationService } from './authorization.service.js';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  EvaluatePolicyDto,
  TestPolicyDto,
} from './authorization.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Authorization (ABAC Policies)')
@Controller('admin/realms/:realmName/policies')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class AuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  // ─── CRUD ─────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create an ABAC policy in a realm' })
  @ApiResponse({ status: 201, description: 'Policy created' })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreatePolicyDto) {
    return this.authorizationService.createPolicy(realm, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all ABAC policies in a realm' })
  @ApiResponse({ status: 200, description: 'Array of ABAC policies' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  findAll(@CurrentRealm() realm: Realm) {
    return this.authorizationService.findAllPolicies(realm);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single ABAC policy by ID' })
  @ApiResponse({ status: 200, description: 'ABAC policy details' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.authorizationService.findPolicyById(realm, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an ABAC policy' })
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
    @Body() dto: UpdatePolicyDto,
  ) {
    return this.authorizationService.updatePolicy(realm, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an ABAC policy' })
  @ApiResponse({ status: 204, description: 'Policy deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  remove(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.authorizationService.deletePolicy(realm, id);
  }

  // ─── Evaluation ────────────────────────────────────────────

  @Post('evaluate')
  @ApiOperation({
    summary: 'Evaluate all realm policies for a given request',
    description:
      'Evaluates all enabled policies in the realm and returns a final ALLOW/DENY ' +
      'decision together with reasoning (which policies matched and why).',
  })
  @ApiResponse({
    status: 201,
    description:
      'Evaluation result with ALLOW/DENY decision and matched policies',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid evaluation context DTO',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  evaluate(@CurrentRealm() realm: Realm, @Body() dto: EvaluatePolicyDto) {
    return this.authorizationService.evaluate(realm, dto);
  }

  @Post(':id/test')
  @ApiOperation({
    summary: 'Test a single policy against a request',
    description:
      'Evaluates only the specified policy and returns detailed condition results. ' +
      'Useful for debugging policy logic without considering other realm policies.',
  })
  @ApiResponse({
    status: 201,
    description: 'Single-policy test result with per-condition breakdown',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid test context DTO',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  test(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: TestPolicyDto,
  ) {
    return this.authorizationService.testPolicy(realm, id, dto);
  }
}
