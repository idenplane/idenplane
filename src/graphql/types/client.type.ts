import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { ClientType } from '@prisma/client';

registerEnumType(ClientType, { name: 'ClientType' });

@ObjectType()
export class Client {
  @Field(() => ID)
  id: string;

  @Field()
  realmId: string;

  @Field()
  clientId: string;

  @Field(() => ClientType)
  clientType: ClientType;

  @Field({ nullable: true })
  name?: string | null;

  @Field({ nullable: true })
  description?: string | null;

  @Field()
  enabled: boolean;

  @Field(() => [String])
  redirectUris: string[];

  @Field(() => [String])
  webOrigins: string[];

  @Field(() => [String])
  grantTypes: string[];

  @Field()
  requireConsent: boolean;

  @Field({ nullable: true })
  backchannelLogoutUri?: string | null;

  @Field()
  backchannelLogoutSessionRequired: boolean;

  @Field({ nullable: true })
  serviceAccountUserId?: string | null;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}