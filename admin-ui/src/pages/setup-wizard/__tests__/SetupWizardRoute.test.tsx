import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { render } from '../../../test/utils';
import { server } from '../../../test/mocks/server';
import { clearCredentials, setCredentials } from '../../../api/client';
import SetupWizardRoute from '../SetupWizardRoute';
import App from '../../../App';
import { returnPath } from '../../LoginPage';

function status(overrides: Record<string, unknown> = {}) {
  return {
    isFirstRun: false,
    wizardCompleted: false,
    wizardSkipped: false,
    currentStep: 0,
    totalSteps: 6,
    steps: [],
    ...overrides,
  };
}

function mockStatus(body: Record<string, unknown>, code = 200) {
  server.use(
    http.get('/setup-wizard/status', () => HttpResponse.json(body, { status: code })),
  );
}

afterEach(() => {
  clearCredentials();
});

describe('SetupWizardRoute', () => {
  it('says setup is already complete and links to the console instead of the form', async () => {
    mockStatus(status({ wizardCompleted: true, currentStep: 6 }));
    render(<SetupWizardRoute />);

    expect(await screen.findByText('Setup is already complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to the admin console/i })).toHaveAttribute(
      'href',
      '/console',
    );
    expect(screen.queryByText('Idenplane Setup Wizard')).not.toBeInTheDocument();
  });

  it('treats a skipped wizard as complete too', async () => {
    mockStatus(status({ wizardSkipped: true }));
    render(<SetupWizardRoute />);

    expect(await screen.findByText('Setup is already complete')).toBeInTheDocument();
    expect(screen.getByText(/was skipped/i)).toBeInTheDocument();
    expect(screen.queryByText('Idenplane Setup Wizard')).not.toBeInTheDocument();
  });

  it('shows the wizard while setup is open', async () => {
    mockStatus(status());
    render(<SetupWizardRoute />);

    expect(await screen.findByText('Idenplane Setup Wizard')).toBeInTheDocument();
    expect(screen.queryByText('Setup is already complete')).not.toBeInTheDocument();
  });

  it('explains that a super-admin is required on 403', async () => {
    mockStatus({ statusCode: 403, message: 'Forbidden' }, 403);
    render(<SetupWizardRoute />);

    expect(await screen.findByText('Super-admin required')).toBeInTheDocument();
    expect(screen.queryByText('Idenplane Setup Wizard')).not.toBeInTheDocument();
  });
});

describe('/console/setup routing', () => {
  function mockAnonymousSession() {
    server.use(
      http.get('/admin/auth/refresh', () => new HttpResponse(null, { status: 401 })),
      http.get('/admin/auth/demo-info', () => HttpResponse.json({ demo: false })),
    );
  }

  it('asks for the admin login first', async () => {
    mockAnonymousSession();
    let statusCalls = 0;
    server.use(
      http.get('/setup-wizard/status', () => {
        statusCalls += 1;
        return HttpResponse.json(status());
      }),
    );

    render(<App />, { initialUrl: '/console/setup' });

    expect(await screen.findByText(/sign in with your admin credentials/i)).toBeInTheDocument();
    expect(screen.queryByText('Idenplane Setup Wizard')).not.toBeInTheDocument();
    expect(statusCalls).toBe(0);
  });

  it('sends the old /setup path through the login too', async () => {
    mockAnonymousSession();
    render(<App />, { initialUrl: '/setup' });

    expect(await screen.findByText(/sign in with your admin credentials/i)).toBeInTheDocument();
  });

  it('shows the wizard page once signed in', async () => {
    mockAnonymousSession();
    mockStatus(status({ wizardCompleted: true }));
    setCredentials({ apiKey: 'test-key' });

    render(<App />, { initialUrl: '/console/setup' });

    expect(await screen.findByText('Setup is already complete')).toBeInTheDocument();
  });
});

describe('returnPath after login', () => {
  it.each([
    [{ from: '/console/setup' }, '/console/setup'],
    [{ from: '/console/realms/acme' }, '/console/realms/acme'],
    [undefined, '/console'],
    [null, '/console'],
    [{ from: 42 }, '/console'],
    [{ from: '/console/login' }, '/console'],
    [{ from: 'https://evil.example/console/' }, '/console'],
    [{ from: '//evil.example/console/' }, '/console'],
    [{ from: '/console//evil.example' }, '/console'],
    [{ from: '/console/\\evil.example' }, '/console'],
    [{ from: '/elsewhere' }, '/console'],
  ])('%j -> %s', (state, expected) => {
    expect(returnPath(state)).toBe(expected);
  });
});
