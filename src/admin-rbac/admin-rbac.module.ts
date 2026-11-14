import { Module } from '@nestjs/common';
import { AdminPrincipalService } from './admin-principal.service.js';
import { AdminRealmAssignmentsService } from './admin-realm-assignments.service.js';
import { AdminAccountsController } from './admin-accounts.controller.js';

/**
 * Admin authorization: who an admin is (roles and realm scope) and the API
 * a super-admin uses to assign realms to realm-admins. The guard itself is
 * AdminAuthorizationGuard, registered globally in AppModule.
 */
@Module({
  controllers: [AdminAccountsController],
  providers: [AdminPrincipalService, AdminRealmAssignmentsService],
  exports: [AdminPrincipalService],
})
export class AdminRbacModule {}
