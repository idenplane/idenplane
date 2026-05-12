import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
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
import { SessionsService } from './sessions.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Sessions')
@Controller('admin/realms/:realmName')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'List all active sessions in the realm' })
  @ApiResponse({ status: 200, description: 'List of active sessions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getRealmSessions(@CurrentRealm() realm: Realm) {
    return this.sessionsService.getRealmSessions(realm);
  }

  @Get('users/:userId/sessions')
  @ApiOperation({ summary: 'List active sessions for a user' })
  @ApiResponse({
    status: 200,
    description: 'List of active sessions for the user',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUserSessions(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    return this.sessionsService.getUserSessions(realm, userId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  revokeSession(
    @Param('sessionId') sessionId: string,
    @Query('type') type: 'oauth' | 'sso' = 'oauth',
  ) {
    return this.sessionsService.revokeSession(sessionId, type);
  }

  @Delete('users/:userId/sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all sessions for a user' })
  @ApiResponse({ status: 204, description: 'All user sessions revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  revokeAllUserSessions(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    return this.sessionsService.revokeAllUserSessions(realm, userId);
  }
}
