// Jest setup file to mock class-validator decorators
// This is needed because DTOs use @IsEnum decorator with Prisma enums
// and those enums are not defined in the test environment

// Mock class-validator to prevent errors when decorators try to use undefined validators
jest.mock('class-validator', () => {
  const validators: Record<string, Function> = {
    IsString: () => () => {},
    IsOptional: () => () => {},
    IsEnum: () => () => {},
    IsBoolean: () => () => {},
    IsArray: () => () => {},
    IsObject: () => () => {},
    IsInt: () => () => {},
    IsPositive: () => () => {},
    IsNotEmpty: () => () => {},
    IsDateString: () => () => {},
    IsIn: () => () => {},
    IsEmail: () => () => {},
    IsUrl: () => () => {},
    MinLength: () => () => {},
    Min: () => () => {},
    Max: () => () => {},
    IsNumber: () => () => {},
    ValidateNested: () => () => {},
  };
  return {
    ...validators,
    validate: jest.fn().mockResolvedValue([]),
    validateSync: jest.fn().mockReturnValue([]),
    ValidatorOptions: {},
    ValidationOptions: {},
  };
});

// Mock class-transformer
jest.mock('class-transformer', () => ({
  plainToClass: jest.fn().mockImplementation((cls, obj) => obj),
  ClassSerializerInterceptor: class {
    intercept() { return { handle: () => ({ subscribe: () => ({}) }) }; }
  },
  Transform: () => () => {},
}));

// Mock Swagger decorators
jest.mock('@nestjs/swagger', () => ({
  ApiTags: () => () => {},
  ApiOperation: () => () => {},
  ApiResponse: () => () => {},
  ApiBearerAuth: () => () => {},
  ApiProperty: () => () => {},
  ApiPropertyOptional: () => () => {},
}));

// Mock specific NHI enums in @prisma/client
// These are imported by DTOs but may not exist in test environment
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
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
  };
}, { virtual: true });