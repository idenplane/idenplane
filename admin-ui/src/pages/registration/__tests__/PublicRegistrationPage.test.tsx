import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import type { Realm } from '../../../types';
import PublicRegistrationPage from '../PublicRegistrationPage';
import { resetCaptchaScriptsForTests } from '../../../components/registration/captcha';

/** What the page POSTed to the registration API, per request. */
let posts: { url: string; body: Record<string, unknown> }[];
/** Script URLs the page asked the browser to load. */
let scripts: string[];
/** Make the next provider script fail to load. */
let failScripts: boolean;

const hcaptcha = {
  render: vi.fn(),
  reset: vi.fn(),
};
const grecaptcha = {
  ready: vi.fn((cb: () => void) => cb()),
  execute: vi.fn(() => Promise.resolve('rc-token')),
};

function serveRealm(overrides: Partial<Realm>) {
  server.use(
    http.get('/admin/realms/:name', ({ params }) =>
      HttpResponse.json(makeRealm({ name: params.name as string, ...overrides })),
    ),
    http.get('/realms/:name/registration/fields', () => HttpResponse.json([])),
    http.post('/realms/:name/registration/register', async ({ request }) => {
      posts.push({
        url: request.url,
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json(
        { message: 'Registration successful!', userId: 'u1' },
        { status: 201 },
      );
    }),
  );
}

async function renderPage() {
  render(<PublicRegistrationPage />, {
    initialUrl: '/register/test-realm',
    routePattern: '/register/:realm',
  });
  await screen.findByRole('heading', { name: 'Create Account' });
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('Choose a username'), 'jane');
  await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@example.com');
  await user.type(screen.getByPlaceholderText('Create a password'), 'Str0ng!Passw0rd');
  await user.click(screen.getByRole('button', { name: /create account|register|sign up/i }));
}

beforeEach(() => {
  posts = [];
  scripts = [];
  failScripts = false;
  resetCaptchaScriptsForTests();
  hcaptcha.render.mockReset().mockReturnValue('widget-1');
  hcaptcha.reset.mockReset();
  grecaptcha.execute.mockClear();
  grecaptcha.ready.mockClear();
  // The provider scripts never load in jsdom: record them and "load" them.
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) {
      scripts.push(node.src);
      queueMicrotask(() => {
        if (failScripts) {
          node.onerror?.(new Event('error'));
          return;
        }
        window.hcaptcha = hcaptcha;
        window.grecaptcha = grecaptcha;
        node.onload?.(new Event('load'));
      });
      return node;
    }
    return append(node);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.hcaptcha;
  delete window.grecaptcha;
});

describe('PublicRegistrationPage CAPTCHA', () => {
  it('renders the hCaptcha widget and sends its token as captchaToken', async () => {
    serveRealm({
      captchaEnabled: true,
      captchaProvider: 'hcaptcha',
      hcaptchaSiteKey: 'hc-site',
      // A reCAPTCHA key must not be picked for an hCaptcha realm.
      recaptchaSiteKey: 'rc-site',
    });
    await renderPage();

    await waitFor(() => expect(hcaptcha.render).toHaveBeenCalled());
    expect(scripts).toEqual(['https://js.hcaptcha.com/1/api.js?render=explicit']);
    const [, options] = hcaptcha.render.mock.calls[0];
    expect(options.sitekey).toBe('hc-site');

    options.callback('hc-token');
    await fillAndSubmit();

    await waitFor(() => expect(posts).toHaveLength(1));
    const [post] = posts;
    expect(new URL(post.url).pathname).toBe('/realms/test-realm/registration/register');
    expect(new URL(post.url).search).toBe('');
    expect(post.body.captchaToken).toBe('hc-token');
    expect(post.body).not.toHaveProperty('captchaProvider');
    expect(await screen.findByText('Registration successful!')).toBeInTheDocument();
    // A token works once.
    expect(hcaptcha.reset).toHaveBeenCalledWith('widget-1');
  });

  it('refuses to submit before the hCaptcha challenge is solved', async () => {
    serveRealm({
      captchaEnabled: true,
      captchaProvider: 'hcaptcha',
      hcaptchaSiteKey: 'hc-site',
    });
    await renderPage();
    await waitFor(() => expect(hcaptcha.render).toHaveBeenCalled());

    await fillAndSubmit();

    expect(await screen.findByText('Please complete the CAPTCHA challenge.')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('runs reCAPTCHA v3 with the register action on submit', async () => {
    serveRealm({
      captchaEnabled: true,
      captchaProvider: 'recaptcha',
      recaptchaSiteKey: 'rc site',
      hcaptchaSiteKey: 'hc-site',
    });
    await renderPage();
    await waitFor(() =>
      expect(scripts).toEqual(['https://www.google.com/recaptcha/api.js?render=rc%20site']),
    );
    expect(grecaptcha.execute).not.toHaveBeenCalled();

    await fillAndSubmit();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(grecaptcha.execute).toHaveBeenCalledWith('rc site', { action: 'register' });
    expect(posts[0].body.captchaToken).toBe('rc-token');
  });

  it('shows an error when the provider script cannot load', async () => {
    failScripts = true;
    serveRealm({
      captchaEnabled: true,
      captchaProvider: 'hcaptcha',
      hcaptchaSiteKey: 'hc-site',
    });
    await renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('The CAPTCHA could not be loaded.');
  });

  it('loads no provider and sends no token when CAPTCHA is off', async () => {
    serveRealm({ captchaEnabled: false, captchaProvider: 'hcaptcha', hcaptchaSiteKey: 'hc-site' });
    await renderPage();

    await fillAndSubmit();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(scripts).toHaveLength(0);
    expect(posts[0].body).not.toHaveProperty('captchaToken');
  });

  it('shows the server error when the token is refused', async () => {
    serveRealm({ captchaEnabled: true, captchaProvider: 'recaptcha', recaptchaSiteKey: 'rc' });
    server.use(
      http.post('/realms/:name/registration/register', () =>
        HttpResponse.json({ message: 'CAPTCHA verification failed' }, { status: 400 }),
      ),
    );
    await renderPage();
    await waitFor(() => expect(scripts).toHaveLength(1));

    await fillAndSubmit();

    expect(await screen.findByText('CAPTCHA verification failed')).toBeInTheDocument();
  });
});
