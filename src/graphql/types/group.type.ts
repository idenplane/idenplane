import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class Group {
  @Field(() => ID)
  id: string;

  @Field()
  realmId: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description: string | null;

  @Field({ nullable: true })
  parentId: string | null;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}