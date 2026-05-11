import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class LoginEvent {
  @Field(() => ID)
  id: string;

  @Field()
  realmId: string;

  @Field({ nullable: true })
  userId: string | null;

  @Field({ nullable: true })
  sessionId: string | null;

  @Field()
  type: string;

  @Field({ nullable: true })
  clientId: string | null;

  @Field({ nullable: true })
  ipAddress: string | null;

  @Field({ nullable: true })
  error: string | null;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class AdminEvent {
  @Field(() => ID)
  id: string;

  @Field()
  realmId: string;

  @Field()
  adminUserId: string;

  @Field()
  operationType: string;

  @Field()
  resourceType: string;

  @Field()
  resourcePath: string;

  @Field({ nullable: true })
  ipAddress: string | null;

  @Field()
  createdAt: Date;
}