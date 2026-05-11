import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class Role {
  @Field(() => ID)
  id: string;

  @Field()
  realmId: string;

  @Field({ nullable: true })
  clientId: string | null;

  @Field()
  name: string;

  @Field({ nullable: true })
  description: string | null;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}