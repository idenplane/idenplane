import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminScope } from '../common/decorators/admin-access.decorator.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { AdminRealmAssignmentsService } from './admin-realm-assignments.service.js';
import { SetAdminRealmsDto } from './dto/set-admin-realms.dto.js';

/**
 * Admin accounts and the realms each realm-admin manages. Server-wide:
 * super-admin (or the admin API key) only. Realms go in the body, never in
 * the path, so no route here looks realm-scoped.
 */
@ApiTags('Admin Accounts')
@ApiSecurity('admin-api-key')
@ApiBearerAuth()
@Controller('admin/admin-accounts')
@AdminScope('global')
@ApiResponse({ status: 403, description: 'The super-admin role is required' })
export class AdminAccountsController {
  constructor(private readonly assignments: AdminRealmAssignmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List admin accounts with their roles and realm assignments',
  })
  list() {
    return this.assignments.listAdmins();
  }

  @Get(':userId/realms')
  @ApiOperation({ summary: 'Realms a realm-admin manages' })
  @ApiResponse({ status: 404, description: 'Admin account not found' })
  getRealms(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.assignments.getRealms(userId);
  }

  @Put(':userId/realms')
  @ApiOperation({
    summary: 'Replace the realms a realm-admin manages',
    description:
      'The admin must hold the realm-admin role. The master realm cannot be assigned.',
  })
  @ApiResponse({ status: 400, description: 'Unknown realm or master realm' })
  @ApiResponse({ status: 404, description: 'Admin account not found' })
  @ApiResponse({ status: 409, description: 'The admin is not a realm-admin' })
  setRealms(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetAdminRealmsDto,
    @Req() req: Request & { adminUser?: { userId: string } },
  ) {
    return this.assignments.setRealms(userId, dto.realms, {
      userId: req.adminUser?.userId ?? 'unknown',
      ipAddress: resolveClientIp(req),
    });
  }
}
