import { InputType, Field } from '@nestjs/graphql';
import { ClientType } from '@prisma/client';

@InputType()
export class CreateClientInput {
  @Field()
  realmId: string;

  @Field()
  clientId: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ defaultValue: true })
  enabled?: boolean;

  @Field(() => [String], { nullable: true })
  redirectUris?: string[];

  @Field(() => [String], { nullable: true })
  webOrigins?: string[];

  @Field(() => [String], { nullable: true })
  grantTypes?: string[];

  @Field({ defaultValue: false })
  requireConsent?: boolean;

  @Field({ nullable: true })
  clientType?: ClientType;

  @Field({ nullable: true })
  backchannelLogoutUri?: string;

  @Field({ defaultValue: true })
  backchannelLogoutSessionRequired?: boolean;
}

@InputType()
export class UpdateClientInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  enabled?: boolean;

  @Field(() => [String], { nullable: true })
  redirectUris?: string[];

  @Field(() => [String], { nullable: true })
  webOrigins?: string[];

  @Field(() => [String], { nullable: true })
  grantTypes?: string[];

  @Field({ nullable: true })
  requireConsent?: boolean;

  @Field({ nullable: true })
  clientType?: ClientType;

  @Field({ nullable: true })
  backchannelLogoutUri?: string;

  @Field({ nullable: true })
  backchannelLogoutSessionRequired?: boolean;
}

@InputType()
export class ClientFilterInput {
  @Field({ nullable: true })
  search?: string;

  @Field({ nullable: true })
  clientId?: string;

  @Field({ nullable: true })
  name?: string;
}
