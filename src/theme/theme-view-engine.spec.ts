import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import express from 'express';
import request from 'supertest';
import {
  createThemeLayout,
  createThemeViewEngine,
  type ThemeViewEngine,
} from './theme-view-engine.js';
import { registerHandlebarsHelpers } from './handlebars-helpers.js';
import { themeHandlebars } from './theme-handlebars.js';

describe('Theme view engine filesystem and configuration boundary', () => {
  let base: string, root: string, outside: string, engine: ThemeViewEngine;
  const render = (
    filename: string,
    data: Record<string, unknown> = {},
    selected = engine,
  ) =>
    new Promise<string>((resolve, reject) =>
      selected(filename, data, (error, html) =>
        error ? reject(error) : resolve(html!),
      ),
    );
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'idenplane-view-engine-'));
    root = join(base, 'themes');
    outside = join(base, 'outside');
    mkdirSync(join(root, 'layouts'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(
      join(root, 'page.hbs'),
      '<h1>{{msg "title"}}</h1><p>{{username}}</p>{{#if_eq state "ready"}}ready{{/if_eq}}',
    );
    writeFileSync(
      join(root, 'layouts/main.hbs'),
      '<html lang="{{locale}}"><body>{{{body}}}</body></html>',
    );
    writeFileSync(join(outside, 'secret.hbs'), 'OUTSIDE_PRIVATE_CONTENT');
    engine = createThemeViewEngine(root);
    registerHandlebarsHelpers();
  });
  afterEach(() => {
    const actual = realpathSync(base);
    expect(dirname(actual).toLowerCase()).toBe(
      realpathSync(tmpdir()).toLowerCase(),
    );
    expect(basename(actual)).toMatch(/^idenplane-view-engine-/);
    rmSync(actual, { recursive: true });
  });

  it('preserves server-selected layouts, translation, helpers and HTML escaping', async () => {
    const html = await render('page.hbs', {
      username: '<script>alert(1)</script>',
      state: 'ready',
      locale: 'ar',
      _messages: { title: 'تسجيل الدخول' },
      layout: createThemeLayout('layouts/main.hbs'),
      body: 'FORGED_BODY',
    });
    expect(html).toContain('<html lang="ar">');
    expect(html).toContain('<h1>تسجيل الدخول</h1>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('ready');
    expect(html).not.toContain('FORGED_BODY');
  });
  it.each([
    '../../outside/secret.hbs',
    '/etc/passwd',
    { filename: 'layouts/main.hbs' },
  ])('rejects a request-controlled layout: %p', async (layout) => {
    await expect(render('page.hbs', { layout })).rejects.toThrow(
      'Layout selection must be created',
    );
  });
  it('does not trust a JSON copy or inherited copy of a server layout marker', async () => {
    const trusted = createThemeLayout('layouts/main.hbs');
    await expect(
      render('page.hbs', { layout: JSON.parse(JSON.stringify(trusted)) }),
    ).rejects.toThrow('Layout selection');
    await expect(
      render('page.hbs', { layout: Object.create(trusted) }),
    ).rejects.toThrow('Layout selection');
  });
  it('bounds the primary template and even server-selected layouts to the themes root', async () => {
    await expect(render(join(outside, 'secret.hbs'))).rejects.toThrow(
      'inside the configured themes directory',
    );
    await expect(render('../outside/secret.hbs')).rejects.toThrow(
      'inside the configured themes directory',
    );
    await expect(
      render('page.hbs', {
        layout: createThemeLayout(join(outside, 'secret.hbs')),
      }),
    ).rejects.toThrow('inside the configured themes directory');
  });
  it('rejects symlinks and junctions escaping the themes root', async () => {
    symlinkSync(outside, join(root, 'linked'), 'junction');
    await expect(render('linked/secret.hbs')).rejects.toThrow(
      'inside the configured themes directory',
    );
    await expect(
      render('page.hbs', { layout: createThemeLayout('linked/secret.hbs') }),
    ).rejects.toThrow('inside the configured themes directory');
  });
  it('does not render non-template files', async () => {
    writeFileSync(join(root, 'private.txt'), 'PRIVATE_TEXT');
    await expect(render('private.txt')).rejects.toThrow('Only Handlebars');
  });
  it('does not use page data as compiler, helper, partial or prototype-access configuration', async () => {
    themeHandlebars.registerPartial('engine_known', '<b>{{value}}</b>');
    try {
      writeFileSync(
        join(root, 'options.hbs'),
        '{{msg "title"}}|{{value}}|{{actor.inherited}}|{{inherited}}|{{> engine_known}}',
      );
      const data = JSON.parse(
        '{"__proto__":{"inherited":"PROTOTYPE_LEAK"},"constructor":"FORGED"}',
      ) as Record<string, unknown>;
      const html = await render('options.hbs', {
        ...data,
        value: '<img>',
        actor: Object.create({ inherited: 'PROTOTYPE_LEAK' }),
        _messages: { title: 'Real message' },
        helpers: { msg: () => 'FORGED_HELPER' },
        partials: { engine_known: 'FORGED_PARTIAL' },
        data: { root: { _messages: { title: 'FORGED_MESSAGE' } } },
        compileOptions: { noEscape: true },
        allowProtoPropertiesByDefault: true,
        allowProtoMethodsByDefault: true,
        settings: { views: outside },
      });
      expect(html).toBe('Real message|&lt;img&gt;|||<b>&lt;img&gt;</b>');
      expect(Object.prototype).not.toHaveProperty('inherited');
    } finally {
      themeHandlebars.unregisterPartial('engine_known');
    }
  });
  it('cannot enable calls to forbidden helperMissing from page data', async () => {
    writeFileSync(join(root, 'forbidden.hbs'), '{{helperMissing}}');
    await expect(
      render('forbidden.hbs', { allowCallsToHelperMissing: true }),
    ).rejects.toThrow();
  });
  it('keeps messages isolated between concurrent requests using the same cached view', async () => {
    const cached = createThemeViewEngine(root, {
      cache: true,
      maxCacheEntries: 2,
    });
    const results = await Promise.all(
      ['One', 'اثنان'].map((title) =>
        render('page.hbs', { _messages: { title } }, cached),
      ),
    );
    expect(results[0]).toContain('<h1>One</h1>');
    expect(results[0]).not.toContain('اثنان');
    expect(results[1]).toContain('<h1>اثنان</h1>');
  });
  it('observes template changes with a bounded server-owned production cache', async () => {
    const cached = createThemeViewEngine(root, {
      cache: true,
      maxCacheEntries: 1,
    });
    writeFileSync(join(root, 'editable.hbs'), 'Original {{value}}');
    expect(
      await render('editable.hbs', { value: '<x>', cache: true }, cached),
    ).toBe('Original &lt;x&gt;');
    writeFileSync(
      join(root, 'editable.hbs'),
      'Updated theme content {{value}}',
    );
    expect(
      await render('editable.hbs', { value: '<x>', cache: false }, cached),
    ).toBe('Updated theme content &lt;x&gt;');
  });
  it('reports asynchronous read errors exactly once', async () => {
    let calls = 0;
    await new Promise<void>((resolve, reject) =>
      engine('missing.hbs', {}, (error) => {
        calls++;
        if (!error) reject(new Error('Expected a render error'));
        setImmediate(resolve);
      }),
    );
    expect(calls).toBe(1);
  });
  it('survives the Express locals merge without accepting forged layouts or settings', async () => {
    const app = express();
    app.use(express.json());
    app.set('views', root);
    app.engine('hbs', engine);
    app.set('view engine', 'hbs');
    app.post('/safe', (req, res) =>
      res.render('page', {
        username: req.body.username as string,
        _messages: { title: 'Trusted' },
        layout: createThemeLayout('layouts/main.hbs'),
      }),
    );
    app.post('/direct', (req, res) =>
      res.render('page', req.body as Record<string, unknown>),
    );
    app.use(
      (
        _error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).send('Render rejected');
      },
    );
    const safe = await request(app)
      .post('/safe')
      .send({
        username: '<script>',
        layout: '../../outside/secret.hbs',
        settings: { views: outside },
      });
    expect(safe.status).toBe(200);
    expect(safe.text).toContain('<html');
    expect(safe.text).toContain('&lt;script&gt;');
    const unsafe = await request(app)
      .post('/direct')
      .send({
        layout: { filename: join(outside, 'secret.hbs') },
        settings: { views: outside },
      });
    expect(unsafe.status).toBe(500);
    expect(unsafe.text).not.toContain('OUTSIDE_PRIVATE_CONTENT');
    const settings = await request(app)
      .post('/direct')
      .send({ settings: { views: outside }, _messages: { title: 'Own view' } });
    expect(settings.status).toBe(200);
    expect(settings.text).toContain('Own view');
    expect(settings.text).not.toContain('OUTSIDE_PRIVATE_CONTENT');
  });
});
