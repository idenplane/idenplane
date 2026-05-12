import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { MagicLinkService } from './magic-link.service.js';
import {
  MagicLinkRequestDto,
  MagicLinkVerifyDto,
} from './dto/magic-link-request.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { RateLimitByIp } from '../rate-limit/rate-limit.guard.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import type { Realm } from '@prisma/client';

@ApiTags('Magic Link')
@Controller('realms/:realmName/protocol/openid-connect')
@UseGuards(RealmGuard)
@Public()
@SkipThrottle()
export class MagicLinkController {
  private readonly logger = new Logger(MagicLinkController.name);

  constructor(private readonly magicLinkService: MagicLinkService) {}

  @Post('magic-link/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a magic link email' })
  @ApiResponse({ status: 200, description: 'Magic link request processed' })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or rate limit exceeded',
  })
  @RateLimitByIp()
  async requestMagicLink(
    @CurrentRealm() realm: Realm,
    @Body() dto: MagicLinkRequestDto,
    @Req() req: Request,
  ) {
    const ipAddress = resolveClientIp(req);
    const userAgent = req.headers['user-agent'];

    return this.magicLinkService.requestMagicLink(
      realm.id,
      dto.email,
      ipAddress,
      userAgent,
      dto.magicLinkUrl,
    );
  }

  @Get('magic-link/verify')
  @ApiOperation({ summary: 'Verify a magic link token' })
  @ApiResponse({ status: 200, description: 'Token is valid' })
  @ApiResponse({
    status: 400,
    description: 'Invalid, expired, or already used token',
  })
  @ApiQuery({
    name: 'token',
    required: true,
    type: String,
    description: 'The magic link token',
  })
  async verifyMagicLink(@Query() dto: MagicLinkVerifyDto) {
    if (!dto.token) {
      throw new BadRequestException('Token is required');
    }

    return this.magicLinkService.validateMagicLink(dto.token);
  }
}
