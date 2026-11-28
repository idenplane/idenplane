import { swaggerEnabled } from './swagger-enabled.js';

describe('swaggerEnabled', () => {
  it('is on outside production by default', () => {
    expect(swaggerEnabled({})).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
  });

  it('is off in production by default', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(
      swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'yes' }),
    ).toBe(false);
  });

  it('follows SWAGGER_ENABLED when it is true or false', () => {
    expect(
      swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }),
    ).toBe(true);
    expect(
      swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: ' TRUE ' }),
    ).toBe(true);
    expect(
      swaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }),
    ).toBe(false);
  });
});
