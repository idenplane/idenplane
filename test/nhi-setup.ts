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
  const mockFn = () => () => {};
  return {
    IsString: mockFn,
    IsOptional: mockFn,
    IsEnum: mockFn,
    IsBoolean: mockFn,
    IsArray: mockFn,
    IsObject: mockFn,
    IsInt: mockFn,
    IsPositive: mockFn,
    IsNotEmpty: mockFn,
    IsDateString: mockFn,
    IsIn: mockFn,
    IsEmail: mockFn,
    IsUrl: mockFn,
    MinLength: mockFn,
    Min: mockFn,
    Max: mockFn,
    IsNumber: mockFn,
    ValidateNested: mockFn,
    IsDefined: mockFn,
    IsEmpty: mockFn,
    IsNotEmptyObject: mockFn,
    IsUUID: mockFn,
    IsISO8601: mockFn,
    IsMilitaryTime: mockFn,
    IsHash: mockFn,
    validate: jest.fn().mockResolvedValue([]),
    validateSync: jest.fn().mockReturnValue([]),
    ValidatorOptions: {},
    ValidationOptions: {},
  };
});

// Mock class-transformer
jest.mock('class-transformer', () => ({
  Type: () => () => {},
  plainToClass: jest.fn().mockImplementation((cls, obj) => obj),
  ClassSerializerInterceptor: class {
    intercept() { return { handle: () => ({ subscribe: () => ({}) }) }; }
  },
  Transform: () => () => {},
}));

// Mock Swagger decorators
jest.mock('@nestjs/swagger', () => {
  const mockDecorator = (...args: any[]) => (target: any, key?: string, descriptor?: PropertyDescriptor) => {};
  return {
    ApiTags: mockDecorator,
    ApiOperation: mockDecorator,
    ApiResponse: () => mockDecorator,
    ApiBearerAuth: mockDecorator,
    ApiSecurity: mockDecorator,
    ApiProperty: mockDecorator,
    ApiPropertyOptional: mockDecorator,
  };
});

// Mock NestJS common decorators
jest.mock('@nestjs/common', () => {
  const mockDecorator = (...args: any[]) => (target: any, key?: string, descriptor?: PropertyDescriptor) => {};
  return {
    Controller: mockDecorator,
    Get: mockDecorator,
    Post: mockDecorator,
    Put: mockDecorator,
    Delete: mockDecorator,
    Patch: mockDecorator,
    Options: mockDecorator,
    Head: mockDecorator,
    All: mockDecorator,
    HttpCode: mockDecorator,
    HttpStatus: mockDecorator,
    Body: mockDecorator,
    Query: mockDecorator,
    Param: mockDecorator,
    Headers: mockDecorator,
    Ip: mockDecorator,
    Req: mockDecorator,
    Res: mockDecorator,
    Next: mockDecorator,
    Session: mockDecorator,
    Platform: mockDecorator,
    Render: mockDecorator,
    RawHeaders: mockDecorator,
    BodyParser: mockDecorator,
    Host: mockDecorator,
    Protocol: mockDecorator,
    Method: mockDecorator,
    Url: mockDecorator,
    Select: mockDecorator,
    UseGuards: mockDecorator,
    SetMetadata: mockDecorator,
    Injectable: mockDecorator,
    Optional: () => mockDecorator,
    Inject: () => mockDecorator,
    Scope: () => mockDecorator,
    Global: () => mockDecorator,
    UsePipes: mockDecorator,
    UseFilters: mockDecorator,
    UseInterceptors: mockDecorator,
    UseClass: mockDecorator,
    UseDecorators: mockDecorator,
    createParamDecorator: () => mockDecorator,
    // Also export the classes needed
    NotFoundException: class NotFoundException extends Error {
      constructor(message?: string) {
        super(message || 'Not found');
        this.name = 'NotFoundException';
      }
    },
    ConflictException: class ConflictException extends Error {
      constructor(message?: string) {
        super(message || 'Conflict');
        this.name = 'ConflictException';
      }
    },
    BadRequestException: class BadRequestException extends Error {
      constructor(message?: string) {
        super(message || 'Bad request');
        this.name = 'BadRequestException';
      }
    },
    UnauthorizedException: class UnauthorizedException extends Error {
      constructor(message?: string) {
        super(message || 'Unauthorized');
        this.name = 'UnauthorizedException';
      }
    },
    ForbiddenException: class ForbiddenException extends Error {
      constructor(message?: string) {
        super(message || 'Forbidden');
        this.name = 'ForbiddenException';
      }
    },
    Logger: class Logger {
      log() {}
      error() {}
      warn() {}
      debug() {}
    },
  };
});

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
  CurrentRealm: () => (target: any, key?: string, index?: number) => {},
}));

// Ensure Prisma client is properly mocked
jest.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {}
  },
  NhiIdentityType: {
    IOT_DEVICE: 'IOT_DEVICE',
    AI_AGENT: 'AI_AGENT',
    BOT: 'BOT',
    MACHINE_TO_MACHINE: 'MACHINE_TO_MACHINE',
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
    JWT_BEARER: 'JWT_BEARER',
    MTLS: 'MTLS',
  },
}));