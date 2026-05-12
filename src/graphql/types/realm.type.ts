import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class Realm {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  displayName: string | null;

  @Field()
  enabled: boolean;

  @Field(() => Int, { nullable: true })
  accessTokenLifespan: number | null;

  @Field(() => Int, { nullable: true })
  refreshTokenLifespan: number | null;

  @Field({ nullable: true })
  smtpHost: string | null;

  @Field(() => Int, { nullable: true })
  smtpPort: number | null;

  @Field({ nullable: true })
  smtpUser: string | null;

  @Field({ nullable: true })
  smtpFrom: string | null;

  @Field()
  smtpSecure: boolean;

  @Field(() => Int, { nullable: true })
  passwordMinLength: number | null;

  @Field()
  passwordRequireUppercase: boolean;

  @Field()
  passwordRequireLowercase: boolean;

  @Field()
  passwordRequireDigits: boolean;

  @Field()
  passwordRequireSpecialChars: boolean;

  @Field()
  bruteForceEnabled: boolean;

  @Field(() => Int, { nullable: true })
  maxLoginFailures: number | null;

  @Field(() => Int, { nullable: true })
  lockoutDuration: number | null;

  @Field()
  registrationAllowed: boolean;

  @Field()
  requireEmailVerification: boolean;

  @Field()
  mfaRequired: boolean;

  @Field()
  webAuthnEnabled: boolean;

  @Field({ nullable: true })
  webAuthnRpName: string | null;

  @Field({ nullable: true })
  webAuthnRpId: string | null;

  @Field()
  impersonationEnabled: boolean;

  @Field(() => Int, { nullable: true })
  impersonationMaxDuration: number | null;

  @Field()
  eventsEnabled: boolean;

  @Field(() => Int, { nullable: true })
  eventsExpiration: number | null;

  @Field()
  adminEventsEnabled: boolean;

  @Field()
  rateLimitEnabled: boolean;

  @Field(() => Int, { nullable: true })
  clientRateLimitPerMinute: number | null;

  @Field(() => Int, { nullable: true })
  clientRateLimitPerHour: number | null;

  @Field(() => Int, { nullable: true })
  userRateLimitPerMinute: number | null;

  @Field(() => Int, { nullable: true })
  userRateLimitPerHour: number | null;

  @Field()
  themeName: string;

  @Field({ nullable: true })
  loginTheme: string | null;

  @Field({ nullable: true })
  accountTheme: string | null;

  @Field({ nullable: true })
  emailTheme: string | null;

  @Field()
  defaultLocale: string;

  @Field(() => Int, { nullable: true })
  maxSessionsPerUser: number | null;

  @Field()
  adaptiveAuthEnabled: boolean;

  @Field(() => Int, { nullable: true })
  riskThresholdStepUp: number | null;

  @Field(() => Int, { nullable: true })
  riskThresholdBlock: number | null;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
