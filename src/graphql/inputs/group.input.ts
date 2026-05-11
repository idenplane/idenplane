import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class CreateGroupInput {
  @Field()
  realmId: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  parentId?: string;
}

@InputType()
export class UpdateGroupInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  parentId?: string;
}

@InputType()
export class GroupFilterInput {
  @Field({ nullable: true })
  search?: string;

  @Field({ nullable: true })
  name?: string;
}