/**
 * SCIM Module
 * Implements RFC 7644 - System for Cross-domain Identity Management
 *
 * This module provides:
 * - SCIM 2.0 protocol endpoints for User and Group provisioning
 * - Bearer token authentication for IdP integration (Okta, Azure AD, OneLogin)
 * - Service provider configuration discovery
 * - Schema and resource type discovery
 * - Bulk operations support
 * - Admin API for token management
 */

import { Module, Global } from '@nestjs/common';
import { ScimController } from './scim.controller.js';
import { ScimProvisioningController } from './scim-provisioning.controller.js';
import { ScimServiceProviderConfigService } from './service-provider-config.service.js';
import { ScimUsersService } from './scim-users.service.js';
import { ScimGroupsService } from './scim-groups.service.js';
import { ScimBulkService } from './scim-bulk.service.js';
import { ScimTokensService } from './scim-tokens.service.js';
import { ScimAuthGuard } from './guards/scim-auth.guard.js';
import { ScimFilterParserService } from './filter-parser.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';

@Global()
@Module({
  imports: [PrismaModule, EventsModule, CryptoModule],
  controllers: [ScimController, ScimProvisioningController],
  providers: [
    ScimServiceProviderConfigService,
    ScimUsersService,
    ScimGroupsService,
    ScimBulkService,
    ScimTokensService,
    ScimAuthGuard,
    ScimFilterParserService,
  ],
  exports: [
    ScimUsersService,
    ScimGroupsService,
    ScimTokensService,
    ScimAuthGuard,
  ],
})
export class ScimModule {}
