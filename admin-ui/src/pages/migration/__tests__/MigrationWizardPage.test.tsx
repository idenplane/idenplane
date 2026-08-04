import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import MigrationWizardPage from '../MigrationWizardPage';

function renderPage(realm = 'test-realm') {
  return render(<MigrationWizardPage />, {
    initialUrl: `/console/realms/${realm}/migration`,
    routePattern: '/console/realms/:name/migration',
  });
}

function makeJsonFile(content: unknown, name = 'export.json') {
  return new File([JSON.stringify(content)], name, { type: 'application/json' });
}

describe('MigrationWizardPage', () => {
  it('renders the page heading and starts on the source-selection step', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /migration wizard/i })).toBeInTheDocument();
    expect(screen.getByText(/where are you migrating from/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  it('requires a source to be selected before continuing', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Keycloak'));
    expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByText(/upload your keycloak export/i)).toBeInTheDocument();
  });

  it('parses a valid JSON file and enables the preview button', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Auth0'));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    const file = makeJsonFile({ users: [{ user_id: 'u1' }] });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByText(/export.json loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview import/i })).toBeEnabled();
  });

  it('shows an error for an invalid JSON file', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Keycloak'));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    const badFile = new File(['not json'], 'bad.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, badFile);

    expect(await screen.findByText(/not valid json/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview import/i })).toBeDisabled();
  });

  it('runs a dry-run preview then a real import through the full flow', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Keycloak'));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeJsonFile({ users: [] }));
    await user.click(screen.getByRole('button', { name: /preview import/i }));

    expect(await screen.findByText(/nothing has been imported yet/i)).toBeInTheDocument();
    expect(screen.getByText(/2 created/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^run import$/i }));
    expect(screen.getByText(/run this import for real/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^yes, run import$/i }));

    expect(await screen.findByText(/import complete/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import another file/i })).toBeInTheDocument();
  });

  it('cancels the confirmation dialog without running the import', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Keycloak'));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeJsonFile({ users: [] }));
    await user.click(screen.getByRole('button', { name: /preview import/i }));
    await screen.findByText(/nothing has been imported yet/i);

    await user.click(screen.getByRole('button', { name: /^run import$/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByText(/run this import for real/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing has been imported yet/i)).toBeInTheDocument();
  });

  it('lets you download the completed migration report', async () => {
    const user = userEvent.setup();
    // Patch only these two methods (jsdom doesn't implement them) rather than
    // stubbing the whole URL global — replacing URL itself breaks `new URL()`,
    // which MSW's request matching relies on for every subsequent test.
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    try {
      renderPage();

      await user.click(screen.getByText('Keycloak'));
      await user.click(screen.getByRole('button', { name: /^next$/i }));
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, makeJsonFile({ users: [] }));
      await user.click(screen.getByRole('button', { name: /preview import/i }));
      await screen.findByText(/nothing has been imported yet/i);
      await user.click(screen.getByRole('button', { name: /^run import$/i }));
      await user.click(screen.getByRole('button', { name: /^yes, run import$/i }));
      await screen.findByText(/import complete/i);

      await user.click(screen.getByRole('button', { name: /download report/i }));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('shows warnings and errors from the migration report', async () => {
    server.use(
      http.post('/admin/migration/:source', () =>
        HttpResponse.json({
          source: 'auth0',
          dryRun: true,
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:01.000Z',
          summary: { users: { created: 1, skipped: 0, failed: 1 } },
          errors: [{ entity: 'user', name: 'bob', error: 'No email' }],
          warnings: [{ entity: 'organizations', message: '1 organization skipped' }],
        }),
      ),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Auth0'));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeJsonFile({ users: [] }));
    await user.click(screen.getByRole('button', { name: /preview import/i }));

    expect(await screen.findByText(/1 organization skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/No email/i)).toBeInTheDocument();
  });

  it('shows an error message when the API call fails', async () => {
    server.use(
      http.post('/admin/migration/:source', () =>
        HttpResponse.json({ message: 'Realm does not exist' }, { status: 400 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Keycloak'));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeJsonFile({ users: [] }));
    await user.click(screen.getByRole('button', { name: /preview import/i }));

    expect(await screen.findByText(/realm does not exist/i)).toBeInTheDocument();
  });

  it('allows going back a step', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Zitadel'));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByText(/upload your zitadel export/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText(/where are you migrating from/i)).toBeInTheDocument();
  });

  it('offers Authentik as a source and can preview an import from it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Authentik'));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByText(/upload your authentik export/i)).toBeInTheDocument();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeJsonFile({ users: [] }));
    await user.click(screen.getByRole('button', { name: /preview import/i }));

    expect(await screen.findByText(/nothing has been imported yet/i)).toBeInTheDocument();
  });
});
