import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class CreateRoleInput {
  @Field()
  realmId: string;

  @Field({ nullable: true })
  clientId?: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;
}

@InputType()
export class UpdateRoleInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;
}

@InputType()
export class RoleFilterInput {
  @Field({ nullable: true })
  search?: string;

  @Field({ nullable: true })
  name?: string;
}
