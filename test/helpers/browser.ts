import { join } from 'path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { registerHandlebarsHelpers } from '../../src/theme/handlebars-helpers.js';
import {
  createThemeViewEngine,
  type ThemeViewEngine,
} from '../../src/theme/theme-view-engine.js';

/**
 * A browser for the hosted pages. Auth cookies are `Secure`, which
 * supertest's agent will not send over http, so cookies are tracked by hand,
 * the way a browser would: `jar` holds the current values, `raw` the last
 * `Set-Cookie` line for each, so a test can check the attributes.
 */
export class Browser {
  readonly jar = new Map<string, string>();
  readonly raw = new Map<string, string>();

  constructor(private readonly app: INestApplication<App>) {}

  private header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private store(res: request.Response): request.Response {
    const cookies = res.headers['set-cookie'] as unknown as
      string[] | undefined;
    for (const cookie of cookies ?? []) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = decodeURIComponent(pair.slice(eq + 1).trim());
      const cleared = !value || /expires=thu, 01 jan 1970/i.test(cookie);
      if (cleared) this.jar.delete(name);
      else {
        this.jar.set(name, value);
        this.raw.set(name, cookie);
      }
    }
    return res;
  }

  async get(url: string) {
    return this.store(
      await request(this.app.getHttpServer())
        .get(url)
        .set('Cookie', this.header()),
    );
  }

  async post(url: string, form: Record<string, string>) {
    return this.store(
      await request(this.app.getHttpServer())
        .post(url)
        .set('Cookie', this.header())
        .type('form')
        .send(form),
    );
  }

  async postJson(url: string, body: Record<string, unknown>) {
    return this.store(
      await request(this.app.getHttpServer())
        .post(url)
        .set('Cookie', this.header())
        .send(body),
    );
  }
}

/** The CSRF token a hosted page embeds in its form. */
export function csrfFrom(html: string): string {
  const match = /name="_csrf" value="([^"]+)"/.exec(html);
  if (!match) throw new Error('no CSRF token in page');
  return match[1];
}

/** The shared test app has no view engine; the hosted pages need one. */
export function useThemeViews(app: INestApplication<App>): void {
  const express = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: string) => void;
    engine: (extension: string, engine: ThemeViewEngine) => void;
  };
  express.set('views', join(process.cwd(), 'themes'));
  express.engine('hbs', createThemeViewEngine(join(process.cwd(), 'themes')));
  express.set('view engine', 'hbs');
  registerHandlebarsHelpers();
}
