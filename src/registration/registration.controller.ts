import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CaptchaProvider } from './captcha.service.js';
import type { Realm } from '@prisma/client';
import { RegistrationService } from './registration.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import {
  RegisterDto,
  VerifyEmailDto,
  ResendVerificationDto,
  ApproveRegistrationDto,
  RejectRegistrationDto,
} from './dto/register.dto.js';
import {
  CreateRegistrationFieldDto,
  UpdateRegistrationFieldDto,
} from './dto/registration-field.dto.js';

@ApiTags('Registration')
@Controller('realms/:realmName/registration')
@UseGuards(RealmGuard)
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  // ─── Public Endpoints ───────────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or CAPTCHA failed' })
  @ApiResponse({ status: 403, description: 'Registration is disabled' })
  @ApiResponse({ status: 409, description: 'Username or email already exists' })
  async register(
    @CurrentRealm() realm: Realm,
    @Body() dto: RegisterDto,
    @Query('captchaProvider') captchaProvider?: string,
  ) {
    // Validate terms acceptance if required
    if (realm.termsOfServiceUrl && !dto.acceptTerms) {
      throw new BadRequestException('You must accept the terms of service');
    }

    const provider =
      captchaProvider !== undefined
        ? (captchaProvider as CaptchaProvider)
        : undefined;
    const result = await this.registrationService.register(
      realm,
      dto,
      provider,
    );

    return {
      message: result.requiresApproval
        ? 'Registration submitted successfully. Your account will be activated after admin approval.'
        : 'Registration successful! Please check your email to verify your account.',
      userId: result.userId,
      requiresApproval: result.requiresApproval,
      emailSent: result.emailSent,
    };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Verify email address with token' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@CurrentRealm() realm: Realm, @Body() dto: VerifyEmailDto) {
    const result = await this.registrationService.verifyEmail(realm, dto.token);

    if (!result.success) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    return {
      message: 'Email verified successfully. You can now log in.',
      userId: result.userId,
    };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Resend email verification' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  async resendVerification(
    @CurrentRealm() realm: Realm,
    @Body() dto: ResendVerificationDto,
  ) {
    const _result = await this.registrationService.resendVerificationEmail(
      realm,
      dto.email,
    );

    // Always return success to prevent email enumeration
    return {
      message:
        'If that email exists and is unverified, a verification email has been sent.',
    };
  }

  // ─── Public Registration Fields ───────────────────────────────────────

  @Get('fields')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Get enabled registration fields for a realm' })
  @ApiResponse({
    status: 200,
    description: 'List of enabled registration fields',
  })
  async getPublicRegistrationFields(@CurrentRealm() realm: Realm) {
    const fields =
      await this.registrationService.getEnabledRegistrationFields(realm);
    return fields.map((f) => ({
      name: f.name,
      displayName: f.displayName,
      type: f.type,
      required: f.required,
      placeholder: f.placeholder,
      helpText: f.helpText,
      options: f.options,
    }));
  }

  // ─── Admin Endpoints ───────────────────────────────────────

  @Get('pending')
  @UseGuards(AdminApiKeyGuard)
  @ApiOperation({ summary: 'Get pending registrations' })
  @ApiBearerAuth()
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of pending registrations' })
  async getPendingRegistrations(
    @CurrentRealm() realm: Realm,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const result = await this.registrationService.getPendingRegistrations(
      realm,
      skip ? parseInt(skip, 10) : 0,
      take ? parseInt(take, 10) : 20,
    );
    return result;
  }

  @Post('approve/:userId')
  @UseGuards(AdminApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a pending registration' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Registration approved' })
  @ApiResponse({ status: 404, description: 'Pending registration not found' })
  async approveRegistration(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Body() dto: ApproveRegistrationDto,
  ) {
    return this.registrationService.approveRegistration(realm, userId, dto);
  }

  @Post('reject/:userId')
  @UseGuards(AdminApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending registration' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Registration rejected' })
  @ApiResponse({ status: 404, description: 'Pending registration not found' })
  async rejectRegistration(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Body() dto: RejectRegistrationDto,
  ) {
    return this.registrationService.rejectRegistration(realm, userId, dto);
  }

  // ─── Admin Registration Fields CRUD ───────────────────────────────────────

  @Get('admin/fields')
  @UseGuards(AdminApiKeyGuard)
  @ApiOperation({ summary: 'Get all registration fields (admin)' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'List of all registration fields' })
  async getAllRegistrationFields(@CurrentRealm() realm: Realm) {
    return this.registrationService.getRegistrationFields(realm);
  }

  @Post('admin/fields')
  @UseGuards(AdminApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new registration field' })
  @ApiBearerAuth()
  @ApiResponse({ status: 201, description: 'Registration field created' })
  async createRegistrationField(
    @CurrentRealm() realm: Realm,
    @Body() dto: CreateRegistrationFieldDto,
  ) {
    return this.registrationService.createRegistrationField(realm, dto);
  }

  @Put('admin/fields/:fieldId')
  @UseGuards(AdminApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a registration field' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Registration field updated' })
  @ApiResponse({ status: 404, description: 'Registration field not found' })
  async updateRegistrationField(
    @CurrentRealm() realm: Realm,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateRegistrationFieldDto,
  ) {
    return this.registrationService.updateRegistrationField(
      realm,
      fieldId,
      dto,
    );
  }

  @Delete('admin/fields/:fieldId')
  @UseGuards(AdminApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a registration field' })
  @ApiBearerAuth()
  @ApiResponse({ status: 204, description: 'Registration field deleted' })
  @ApiResponse({ status: 404, description: 'Registration field not found' })
  async deleteRegistrationField(
    @CurrentRealm() realm: Realm,
    @Param('fieldId') fieldId: string,
  ) {
    await this.registrationService.deleteRegistrationField(realm, fieldId);
    return { deleted: true };
  }
}
