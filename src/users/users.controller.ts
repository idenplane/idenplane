import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
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
  ApiQuery,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { SetPasswordDto } from './dto/set-password.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { RequireAdminRoles } from '../common/decorators/require-admin-roles.decorator.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

class ListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  get skip(): number {
    const page = this.page ?? 1;
    return (page - 1) * (this.limit ?? 20);
  }

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}

@ApiTags('Users')
@Controller('admin/realms/:realmName/users')
@UseGuards(RealmGuard, AdminApiKeyGuard, AdminRolesGuard)
@ApiSecurity('admin-api-key')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Create a user in a realm' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateUserDto) {
    return this.usersService.create(realm, dto);
  }

  @Get()
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'List users in a realm' })
  @ApiResponse({ status: 200, description: 'List of users' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Free-text search across username, email, firstName, lastName',
  })
  @ApiQuery({
    name: 'username',
    required: false,
    description: 'Filter by username (contains, case-insensitive)',
  })
  @ApiQuery({
    name: 'email',
    required: false,
    description: 'Filter by email (contains, case-insensitive)',
  })
  @ApiQuery({
    name: 'firstName',
    required: false,
    description: 'Filter by first name (contains, case-insensitive)',
  })
  @ApiQuery({
    name: 'lastName',
    required: false,
    description: 'Filter by last name (contains, case-insensitive)',
  })
  findAll(@CurrentRealm() realm: Realm, @Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(
      realm,
      query.skip ?? 0,
      query.limit ?? 20,
      {
        search: query.search,
        username: query.username,
        email: query.email,
        firstName: query.firstName,
        lastName: query.lastName,
      },
    );
  }

  @Get(':userId')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('userId') userId: string) {
    return this.usersService.findById(realm, userId);
  }

  @Put(':userId')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Update a user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(realm, userId, dto);
  }

  @Patch(':userId')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Partially update a user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  partialUpdate(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(realm, userId, dto);
  }

  @Delete(':userId')
  @RequireAdminRoles(['super-admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({ status: 204, description: 'User deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  remove(@CurrentRealm() realm: Realm, @Param('userId') userId: string) {
    return this.usersService.remove(realm, userId);
  }

  @Put(':userId/reset-password')
  @RequireAdminRoles(['super-admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a user password' })
  @ApiResponse({ status: 204, description: 'Password updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid password' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  resetPassword(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Body() dto: SetPasswordDto,
  ) {
    return this.usersService.setPassword(realm, userId, dto.password);
  }

  @Post(':userId/send-verification-email')
  @RequireAdminRoles(['super-admin', 'admin'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send or resend verification email to a user' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async sendVerificationEmail(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    // Anti-enumeration: uniform 200 + body whether the user exists, has no
    // email, or does not exist at all. This is the original closed-#582 shape
    // — a prior pass tried to surface real outcomes (#31) but that necessarily
    // leaks user existence to admin-key holders, so it was reverted.
    try {
      const user = await this.usersService.findById(realm, userId);
      if (user.email) {
        await this.usersService.sendVerificationEmail(
          realm,
          user.id,
          user.email,
        );
      }
    } catch {
      // Swallow not-found (and similar) — do not reveal existence.
    }
    return {
      message: 'If the account exists, a verification email has been sent.',
    };
  }

  @Get(':userId/offline-sessions')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'List offline sessions for a user' })
  @ApiResponse({ status: 200, description: 'List of offline sessions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getOfflineSessions(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    return this.usersService.getOfflineSessions(realm, userId);
  }

  @Delete(':userId/offline-sessions/:tokenId')
  @RequireAdminRoles(['super-admin', 'admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an offline session' })
  @ApiResponse({ status: 204, description: 'Offline session revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or session not found' })
  revokeOfflineSession(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('tokenId') tokenId: string,
  ) {
    return this.usersService.revokeOfflineSession(realm, userId, tokenId);
  }

  @Get(':userId/consents')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'List all consents for a user' })
  @ApiResponse({ status: 200, description: 'List of user consents' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUserConsents(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    return this.usersService.getUserConsents(realm, userId);
  }

  @Get(':userId/consents/history')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Get consent history for a user' })
  @ApiResponse({ status: 200, description: 'User consent history' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUserConsentHistory(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getUserConsentHistory(realm, userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Delete(':userId/consents')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({
    summary: "Revoke all of a user's stored consents (after-compromise lockout)",
  })
  @ApiResponse({ status: 200, description: 'Revoked consents count' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  revokeAllUserConsents(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    return this.usersService.revokeUserConsents(realm, userId);
  }

  @Delete(':userId/consents/:clientId')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: "Revoke a user's consent for a single client" })
  @ApiResponse({ status: 200, description: 'Revoked consent count (0 or 1)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or client not found' })
  revokeUserConsentForClient(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('clientId') clientIdOrUuid: string,
  ) {
    return this.usersService.revokeUserConsents(realm, userId, clientIdOrUuid);
  }
}
