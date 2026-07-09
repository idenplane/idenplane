/**
 * Integration spec: verifies that NormalizeRoleBodyPipe correctly handles
 * bare-array bodies in the full NestJS HTTP pipeline (global ValidationPipe +
 * parameter-level NormalizeRoleBodyPipe).
 *
 * This test spins up a minimal NestJS app with the global ValidationPipe
 * configured exactly as in main.ts, then sends real HTTP requests via
 * supertest to confirm the pipe ordering works correctly.
 */

import { Controller, Post, Body, ValidationPipe, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { NormalizeRoleBodyPipe } from './normalize-role-body.pipe.js';
import { AssignRolesDto } from '../dto/assign-role.dto.js';

@Controller()
class ProbeController {
  @Post('probe')
  handle(@Body() dto: AssignRolesDto): string[] {
    return dto.effectiveNames;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('NormalizeRoleBodyPipe (integration — full HTTP pipeline)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();

    app = module.createNestApplication();
    // NormalizeRoleBodyPipe is registered as a GLOBAL pipe, BEFORE ValidationPipe.
    // This is the production wiring: global pipes run in registration order,
    // and the normalizer must reshape bare-array bodies before ValidationPipe
    // rejects them with forbidNonWhitelisted: true.
    app.useGlobalPipes(
      new NormalizeRoleBodyPipe(),
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts bare array [{ name }] and normalizes to effectiveNames', async () => {
    const resp = await request(app.getHttpServer())
      .post('/probe')
      .send([{ name: 'admin' }])
      .set('Content-Type', 'application/json');

    expect(resp.status).toBe(201);
    expect(resp.body).toEqual(['admin']);
  });

  it('accepts bare array [{ id, name }] (Keycloak shape) and normalizes correctly', async () => {
    const resp = await request(app.getHttpServer())
      .post('/probe')
      .send([{ id: 'abc-123', name: 'editor' }])
      .set('Content-Type', 'application/json');

    expect(resp.status).toBe(201);
    expect(resp.body).toEqual(['editor']);
  });

  it('accepts bare array with multiple roles', async () => {
    const resp = await request(app.getHttpServer())
      .post('/probe')
      .send([{ name: 'admin' }, { name: 'editor' }])
      .set('Content-Type', 'application/json');

    expect(resp.status).toBe(201);
    expect(resp.body).toEqual(['admin', 'editor']);
  });

  it('accepts { roleNames: [...] } object body', async () => {
    const resp = await request(app.getHttpServer())
      .post('/probe')
      .send({ roleNames: ['admin'] })
      .set('Content-Type', 'application/json');

    expect(resp.status).toBe(201);
    expect(resp.body).toEqual(['admin']);
  });

  it('accepts { roles: [{ name }] } Keycloak object body', async () => {
    const resp = await request(app.getHttpServer())
      .post('/probe')
      .send({ roles: [{ name: 'admin' }] })
      .set('Content-Type', 'application/json');

    expect(resp.status).toBe(201);
    expect(resp.body).toEqual(['admin']);
  });

  it('accepts { roles: [{ id, name }] } Keycloak object body with id field', async () => {
    const resp = await request(app.getHttpServer())
      .post('/probe')
      .send({ roles: [{ id: 'abc', name: 'admin' }] })
      .set('Content-Type', 'application/json');

    expect(resp.status).toBe(201);
    expect(resp.body).toEqual(['admin']);
  });

  it('rejects empty bare array [] with 400', async () => {
    const resp = await request(app.getHttpServer())
      .post('/probe')
      .send([])
      .set('Content-Type', 'application/json');

    expect(resp.status).toBe(400);
  });

  it('rejects bare array with entries missing name with 400', async () => {
    const resp = await request(app.getHttpServer())
      .post('/probe')
      .send([{ id: 'abc' }])
      .set('Content-Type', 'application/json');

    expect(resp.status).toBe(400);
  });
});
