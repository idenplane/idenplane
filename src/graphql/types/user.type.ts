import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field()
  realmId: string;

  @Field()
  username: string;

  @Field({ nullable: true })
  email: string | null;

  @Field()
  emailVerified: boolean;

  @Field({ nullable: true })
  firstName: string | null;

  @Field({ nullable: true })
  lastName: string | null;

  @Field()
  enabled: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}