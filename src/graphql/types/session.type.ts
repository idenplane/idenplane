import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class Session {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field({ nullable: true })
  ipAddress: string | null;

  @Field({ nullable: true })
  userAgent: string | null;

  @Field()
  createdAt: Date;

  @Field()
  expiresAt: Date;
}