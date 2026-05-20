import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type TestContext } from './setup';

describe('App bootstrap (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('should start the application without errors', () => {
    expect(app).toBeDefined();
  });

  it('GET /api-json — should return Swagger/OpenAPI JSON document', async () => {
    const res = await request(app.getHttpServer())
      .get('/api-json')
      .expect(200);

    expect(res.body).toHaveProperty('openapi');
    expect(res.body).toHaveProperty('info');
    expect(res.body.info).toHaveProperty('title', 'Idenplane');
    expect(res.body).toHaveProperty('paths');
  });
});
