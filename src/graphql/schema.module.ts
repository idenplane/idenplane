import { Module } from '@nestjs/common';
import { RealmResolver } from './resolvers/realm.resolver.js';
import { ClientResolver } from './resolvers/client.resolver.js';
import { UserResolver } from './resolvers/user.resolver.js';
import { RoleResolver } from './resolvers/role.resolver.js';
import { GroupResolver } from './resolvers/group.resolver.js';
import { SessionResolver } from './resolvers/session.resolver.js';
import { EventResolver } from './resolvers/event.resolver.js';
import { OrganizationResolver } from './resolvers/organization.resolver.js';
import { MutationResolver } from './resolvers/mutation.resolver.js';
import { RealmsModule } from '../realms/realms.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { UsersModule } from '../users/users.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { EventsModule } from '../events/events.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';

@Module({
  imports: [
    RealmsModule,
    ClientsModule,
    UsersModule,
    RolesModule,
    GroupsModule,
    SessionsModule,
    EventsModule,
    OrganizationsModule,
  ],
  providers: [
    RealmResolver,
    ClientResolver,
    UserResolver,
    RoleResolver,
    GroupResolver,
    SessionResolver,
    EventResolver,
    OrganizationResolver,
    MutationResolver,
  ],
  exports: [],
})
export class GraphQLSchemaModule {}