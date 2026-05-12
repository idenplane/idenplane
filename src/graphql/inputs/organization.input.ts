import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class CreateOrganizationInput {
  @Field()
  realmId: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field({ nullable: true })
  displayName?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ defaultValue: true })
  enabled?: boolean;

  @Field({ nullable: true })
  logoUrl?: string;

  @Field({ nullable: true })
  primaryColor?: string;

  @Field({ defaultValue: false })
  requireMfa?: boolean;

  @Field(() => [String], { nullable: true })
  verifiedDomains?: string[];
}

@InputType()
export class UpdateOrganizationInput {
  @Field({ nullable: true })
  displayName?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  enabled?: boolean;

  @Field({ nullable: true })
  logoUrl?: string;

  @Field({ nullable: true })
  primaryColor?: string;

  @Field({ nullable: true })
  requireMfa?: boolean;

  @Field(() => [String], { nullable: true })
  verifiedDomains?: string[];
}

@InputType()
export class OrganizationFilterInput {
  @Field({ nullable: true })
  search?: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  slug?: string;
}
