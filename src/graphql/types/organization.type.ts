import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class Organization {
  @Field(() => ID)
  id: string;

  @Field()
  realmId: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field({ nullable: true })
  displayName: string | null;

  @Field({ nullable: true })
  description: string | null;

  @Field()
  enabled: boolean;

  @Field({ nullable: true })
  logoUrl: string | null;

  @Field({ nullable: true })
  primaryColor: string | null;

  @Field()
  requireMfa: boolean;

  @Field(() => [String])
  verifiedDomains: string[];

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}