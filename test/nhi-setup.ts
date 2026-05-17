// Jest setup file for NHI module tests
// Mocks required dependencies that may not be available in test environment

// Import reflect-metadata first for decorators
import 'reflect-metadata';

// Ensure global Reflect has all required methods
if (typeof globalThis.Reflect === 'undefined') {
  Object.defineProperty(globalThis, 'Reflect', {
    value: require('reflect-metadata').Reflect,
    writable: true,
    configurable: true,
  });
}

// Mock class-validator
jest.mock('class-validator', () => {
  const actual = jest.requireActual('class-validator') as Record<string, unknown>;
  const mock = () => () => {};
  return {
    ...actual,
    IsString: mock,
    IsOptional: mock,
    IsEnum: mock,
    IsBoolean: mock,
    IsArray: mock,
    IsObject: mock,
    IsInt: mock,
    IsPositive: mock,
    IsNotEmpty: mock,
    IsDateString: mock,
    IsIn: mock,
    IsEmail: mock,
    IsUrl: mock,
    MinLength: mock,
    Min: mock,
    Max: mock,
    IsNumber: mock,
    ValidateNested: mock,
    IsDefined: mock,
    IsEmpty: mock,
    IsNotEmptyObject: mock,
    IsUUID: mock,
    IsISO8601: mock,
    IsMilitaryTime: mock,
    IsHash: mock,
    Matches: mock,
    ValidateIf: mock,
    registerDecorator: jest.fn(),
    validate: jest.fn().mockResolvedValue([]),
    validateSync: jest.fn().mockReturnValue([]),
  };
});

// Mock class-transformer
jest.mock('class-transformer', () => {
  const actual = jest.requireActual('class-transformer') as Record<string, unknown>;
  return {
    ...actual,
    Type: () => () => {},
    plainToClass: jest.fn().mockImplementation((_cls, obj) => obj),
    ClassSerializerInterceptor: class {
      intercept() { return { handle: () => ({ subscribe: () => ({}) }) }; }
    },
    Transform: () => () => {},
  };
});

// Mock Swagger decorators
jest.mock('@nestjs/swagger', () => {
  const actual = jest.requireActual('@nestjs/swagger') as Record<string, unknown>;
  const mock = (..._args: unknown[]) => () => {};
  return {
    ...actual,
    ApiTags: mock,
    ApiOperation: mock,
    ApiResponse: () => mock,
    ApiBearerAuth: mock,
    ApiSecurity: mock,
    ApiProperty: mock,
    ApiPropertyOptional: mock,
    ApiConsumes: mock,
    ApiBody: mock,
    ApiQuery: mock,
    ApiExcludeController: mock,
    ApiParam: mock,
    ApiServiceUnavailableResponse: mock,
    ApiOkResponse: mock,
    OmitType: actual.OmitType || (() => class {}),
    PartialType: actual.PartialType || (() => class {}),
    PickType: actual.PickType || (() => class {}),
    ExtendSchema: actual.ExtendSchema || (() => class {}),
    HealthCheck: mock,
  };
});

// Use real NestJS packages — critical for TestingModule to work
jest.mock('@nestjs/common', () => jest.requireActual('@nestjs/common'));
jest.mock('@nestjs/core', () => jest.requireActual('@nestjs/core'));

// Mock optional NestJS modules that aren't needed in tests
jest.mock('@nestjs/config', () => ({}));
jest.mock('@nestjs/schedule', () => ({
  ScheduleModule: class {},
  Interval: () => () => {},
  Cron: () => () => {},
}));
jest.mock('@nestjs/throttler', () => ({
  Throttle: () => () => {},
  ThrottleModule: class {},
  SkipThrottle: () => () => {},
  defaultOptions: {},
  THROTTLE_TTL: 'throttle_ttl',
  THROTTLE_LIMIT: 'throttle_limit',
  RateLimitGuard: class {},
  RateLimitByIp: () => () => {},
}));

// Mock RealmGuard
jest.mock('../src/common/guards/realm.guard.js', () => ({
  RealmGuard: class RealmGuard {
    canActivate() {
      return true;
    }
  },
}));

// Mock CurrentRealm decorator
jest.mock('../src/common/decorators/current-realm.decorator.js', () => ({
  CurrentRealm: () => (target: unknown, key?: string, index?: number) => {},
}));

// Mock @prisma/client — enum values + mock PrismaClient (no DB connection)
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    constructor() {
      Object.defineProperties(this, {
        $connect: { value: jest.fn(), writable: true },
        $disconnect: { value: jest.fn(), writable: true },
        $transaction: { value: jest.fn(), writable: true },
        $transactionAsync: { value: jest.fn(), writable: true },
        $on: { value: jest.fn(), writable: true },
        $use: { value: jest.fn(), writable: true },
      });
    }
  }
  return {
    PrismaClient: MockPrismaClient,
    NhiIdentityType: {
      MACHINE_TO_MACHINE: 'MACHINE_TO_MACHINE',
      IOT_DEVICE: 'IOT_DEVICE',
      SERVICE: 'SERVICE',
      AI_AGENT: 'AI_AGENT',
    },
    NhiLifecycleStatus: {
      PROVISIONING: 'PROVISIONING',
      ACTIVE: 'ACTIVE',
      SUSPENDED: 'SUSPENDED',
      DECOMMISSIONED: 'DECOMMISSIONED',
    },
    NhiCredentialType: {
      API_KEY: 'API_KEY',
      CERTIFICATE: 'CERTIFICATE',
      JWT: 'JWT',
      OAUTH: 'OAUTH',
      MTLS: 'MTLS',
    },
    ClientType: {
      CONFIDENTIAL: 'CONFIDENTIAL',
      PUBLIC: 'PUBLIC',
    },
    MagicLinkStatus: {
      PENDING: 'PENDING',
      COMPLETED: 'COMPLETED',
      EXPIRED: 'EXPIRED',
      CANCELLED: 'CANCELLED',
    },
  };
});