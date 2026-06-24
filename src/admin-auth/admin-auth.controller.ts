import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    Res,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    ApiOperation,
    ApiResponse,
    ApiSecurity,
    ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminLoginDto } from './dto/login.dto.js';

@ApiTags('Admin Auth')
@Controller('admin/auth')
@ApiSecurity('admin-api-key')
export class AdminAuthController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('demo-info')
  @Public()
  @ApiOperation({
    summary: 'Demo-mode login hint',
    description:
      'Returns the demo credentials so the login page can prefill them, ' +
      'but only when DEMO_MODE=true. On normal self-hosted installs this ' +
      'returns { demo: false } and exposes nothing.',
  })
  @ApiResponse({ status: 200, description: 'Demo info' })
  getDemoInfo() {
    if (this.config.get<string>('DEMO_MODE') !== 'true') {
      return { demo: false };
    }
    return {
      demo: true,
      username: this.config.get<string>('ADMIN_USER', 'admin'),
      password: this.config.get<string>('ADMIN_PASSWORD', 'admin'),
    };
  }

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

    // Persist the admin session in an httpOnly cookie so that a full page
    // reload (F5) keeps the user signed in. The cookie mirrors the bearer
    // token returned in the body — the guard reads either form.
    const isSecure =
      req.protocol === 'https' ||
      req.headers['x-forwarded-proto'] === 'https';
    res.cookie('IDENPLANE_ADMIN_SESSION', tokenResponse.access_token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: tokenResponse.expires_in * 1000,
      path: '/',
    });
    // Non-sensitive marker cookie (readable from JS) so the SPA can detect
    // that a session *might* exist and trigger a restoreSession() probe.
    res.cookie('IDENPLANE_ADMIN_SESSION_MARKER', '1', {
      httpOnly: false,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: tokenResponse.expires_in * 1000,
      path: '/',
    });

    return tokenResponse;
  }

  @Post('logout')
  @Public()
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin logout – revoke current token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const authHeader = req.headers['authorization'];
    const cookieToken = req.cookies?.['IDENPLANE_ADMIN_SESSION'];
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : cookieToken;
    if (token) {
      await this.adminAuthService.revokeToken(token);
    }
    res.clearCookie('IDENPLANE_ADMIN_SESSION', { path: '/' });
    res.clearCookie('IDENPLANE_ADMIN_SESSION_MARKER', { path: '/' });
    return { message: 'Logged out' };
  }

  @Get('me')
  @Public()
  @ApiOperation({ summary: 'Get current admin user info' })
  @ApiResponse({ status: 200, description: 'Current admin user info' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@Req() req: Request) {
    // Allow the bearer token to come from the Authorization header or the
    // IDENPLANE_ADMIN_SESSION cookie (set on login). This lets the console
    // restore a session after a full page reload without a persisted token
    // in JavaScript memory.
    const authHeader = req.headers['authorization'];
    const cookieToken = req.cookies?.['IDENPLANE_ADMIN_SESSION'];
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : cookieToken;

    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    try {
      const adminUser = await this.adminAuthService.validateAdminToken(token);
      return adminUser;
    } catch {
      throw new UnauthorizedException('Not authenticated');
    }
  }
}
