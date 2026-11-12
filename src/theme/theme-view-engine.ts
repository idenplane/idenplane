import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { themeHandlebars } from './theme-handlebars.js';
import type { RuntimeOptions } from 'handlebars';

export interface ThemeLayout {
  readonly filename: string;
}

// Express shallow-copies render locals. Object identity survives that copy,
// while a request body/query cannot manufacture a registered layout object.
const trustedLayouts = new WeakSet<object>();

export function createThemeLayout(filename: string): ThemeLayout {
  const layout = Object.freeze({ filename });
  trustedLayouts.add(layout);
  return layout;
}

export type ThemeViewEngine = (
  filename: string,
  locals: Record<string, unknown>,
  callback: (error: Error | null, html?: string) => void,
) => void;

interface EngineConfig {
  cache?: boolean;
  maxCacheEntries?: number;
}

const runtimeOptions: RuntimeOptions = Object.freeze({
  allowProtoMethodsByDefault: false,
  allowProtoPropertiesByDefault: false,
  allowCallsToHelperMissing: false,
});
const reservedLocals = new Set([
  'layout',
  'settings',
  '_locals',
  'cache',
  '__proto__',
  'constructor',
  'prototype',
  'body',
]);

function within(root: string, filename: string): void {
  const path = relative(root, filename);
  if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) {
    throw new Error(
      'Theme template must remain inside the configured themes directory',
    );
  }
}

/** Express adapter with server-owned file resolution and fixed compiler options. */
export function createThemeViewEngine(
  themesDirectory: string,
  config: EngineConfig = {},
): ThemeViewEngine {
  const root = resolve(themesDirectory);
  const useCache = config.cache ?? process.env['NODE_ENV'] === 'production';
  const maxEntries = config.maxCacheEntries ?? 128;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1024) {
    throw new Error('Invalid theme template cache limit');
  }
  const cache = new Map<
    string,
    { signature: string; template: HandlebarsTemplateDelegate }
  >();

  async function load(filename: string): Promise<HandlebarsTemplateDelegate> {
    const selected = resolve(root, filename);
    within(root, selected);
    if (extname(selected).toLowerCase() !== '.hbs') {
      throw new Error('Only Handlebars theme templates can be rendered');
    }
    const [realRoot, realFile] = await Promise.all([
      realpath(root),
      realpath(selected),
    ]);
    within(realRoot, realFile);
    if (extname(realFile).toLowerCase() !== '.hbs') {
      throw new Error('Only Handlebars theme templates can be rendered');
    }
    const metadata = await stat(realFile);
    if (!metadata.isFile()) throw new Error('Theme template is not a file');
    const signature = `${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.size}:${metadata.ino}`;
    const cached = useCache ? cache.get(realFile) : undefined;
    if (cached?.signature === signature) {
      cache.delete(realFile);
      cache.set(realFile, cached);
      return cached.template;
    }
    const source = await readFile(realFile, 'utf8');
    const template = themeHandlebars.compile(source, { noEscape: false });
    if (useCache) {
      cache.delete(realFile);
      cache.set(realFile, { signature, template });
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    }
    return template;
  }

  async function render(
    filename: string,
    locals: Record<string, unknown>,
  ): Promise<string> {
    const layout = Object.getOwnPropertyDescriptor(locals, 'layout')
      ?.value as unknown;
    if (
      layout !== undefined &&
      layout !== null &&
      layout !== false &&
      (typeof layout !== 'object' || !trustedLayouts.has(layout))
    ) {
      throw new Error('Layout selection must be created by the theme service');
    }
    const data: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const [name, value] of Object.entries(locals)) {
      if (!reservedLocals.has(name)) data[name] = value;
    }
    const template = await load(filename);
    const body = template(data, runtimeOptions);
    if (!layout) return body;
    const outer = await load((layout as ThemeLayout).filename);
    // Only HTML produced by the selected template becomes layout body.
    return outer({ ...data, body }, runtimeOptions);
  }

  return (filename, locals, callback) => {
    void render(filename, locals).then(
      (html) => callback(null, html),
      (error: unknown) =>
        callback(
          error instanceof Error ? error : new Error('Theme rendering failed'),
        ),
    );
  };
}
