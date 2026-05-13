import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UnauthorizedException,
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
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { AdminAuthService } from './admin-auth.service.js';
import { RateLimitGuard, RateLimitByIp } from '../rate-limit/rate-limit.guard.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { AdminLoginDto } from './dto/login.dto.js';

@ApiTags('Admin Auth')
@Controller('admin/auth')
@ApiSecurity('admin-api-key')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin login' })
  @ApiResponse({ status: 200, description: 'Login successful, returns token' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() body: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = resolveClientIp(req);

    const { rateLimitHeaders, ...tokenResponse } =
      await this.adminAuthService.login(body.username, body.password, ip);

    for (const [name, value] of Object.entries(rateLimitHeaders)) {
      res.setHeader(name, value);
    }

    return tokenResponse;
  }

  @Post('logout')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin logout – revoke current token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@Req() req: Request) {
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      this.adminAuthService.revokeToken(authHeader.slice(7));
    }
    return { message: 'Logged out' };
  }

  @Get('me')
  @Public()
  @ApiOperation({ summary: 'Get current admin user info' })
  @ApiResponse({ status: 200, description: 'Current admin user info' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@Req() req: Request) {
    const adminUser = (
      req as Request & { adminUser?: { userId: string; roles: string[] } }
    )['adminUser'];
    if (!adminUser) {
      throw new UnauthorizedException('Not authenticated');
    }
    return adminUser;
  }
}
