import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLSchemaModule } from './schema.module.js';
import { GraphQLAuthGuard } from './guards/graphql-auth.guard.js';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      playground: process.env['NODE_ENV'] !== 'production',
      introspection: true,
      context: ({ req }: { req: any }) => ({ req }),
    }),
    GraphQLSchemaModule,
  ],
  providers: [GraphQLAuthGuard],
})
export class GraphQLAdminModule {}