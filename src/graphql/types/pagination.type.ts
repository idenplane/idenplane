import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class PaginationInfo {
  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  pageSize: number;

  @Field(() => Int)
  totalPages: number;

  @Field()
  hasNext: boolean;

  @Field()
  hasPrevious: boolean;
}

@ObjectType()
export class PaginatedRealms {
  @Field(() => [Realm])
  items: Realm[];

  @Field(() => PaginationInfo)
  pagination: PaginationInfo;
}

@ObjectType()
export class PaginatedUsers {
  @Field(() => [User])
  items: User[];

  @Field(() => PaginationInfo)
  pagination: PaginationInfo;
}

@ObjectType()
export class PaginatedClients {
  @Field(() => [Client])
  items: Client[];

  @Field(() => PaginationInfo)
  pagination: PaginationInfo;
}

@ObjectType()
export class PaginatedRoles {
  @Field(() => [Role])
  items: Role[];

  @Field(() => PaginationInfo)
  pagination: PaginationInfo;
}

@ObjectType()
export class PaginatedGroups {
  @Field(() => [Group])
  items: Group[];

  @Field(() => PaginationInfo)
  pagination: PaginationInfo;
}

@ObjectType()
export class PaginatedSessions {
  @Field(() => [Session])
  items: Session[];

  @Field(() => PaginationInfo)
  pagination: PaginationInfo;
}

@ObjectType()
export class PaginatedLoginEvents {
  @Field(() => [LoginEvent])
  items: LoginEvent[];

  @Field(() => PaginationInfo)
  pagination: PaginationInfo;
}

@ObjectType()
export class PaginatedOrganizations {
  @Field(() => [Organization])
  items: Organization[];

  @Field(() => PaginationInfo)
  pagination: PaginationInfo;
}

import { Realm } from './realm.type.js';
import { User } from './user.type.js';
import { Client } from './client.type.js';
import { Role } from './role.type.js';
import { Group } from './group.type.js';
import { Session } from './session.type.js';
import { LoginEvent } from './event.type.js';
import { Organization } from './organization.type.js';