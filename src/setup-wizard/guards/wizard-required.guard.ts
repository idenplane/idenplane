import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SetupWizardService } from '../setup-wizard.service.js';

/**
 * Guard that redirects to the setup wizard when no realms exist.
 * Use this on routes that should only be accessible after initial setup.
 */
@Injectable()
export class WizardRequiredGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wizardService: SetupWizardService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Allow access to wizard endpoints
    if (request.path.startsWith('/setup-wizard')) {
      return true;
    }

    // Check if wizard is required (no realms exist and wizard not completed/skipped)
    const wizardStatus = await this.wizardService.getWizardStatus();

    if (
      wizardStatus.isFirstRun &&
      !wizardStatus.wizardCompleted &&
      !wizardStatus.wizardSkipped
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Initial setup required',
        redirectTo: '/setup-wizard',
        code: 'WIZARD_REQUIRED',
      });
    }

    return true;
  }
}
