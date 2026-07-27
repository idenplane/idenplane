import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { render } from '../../../test/utils';
import { server } from '../../../test/mocks/server';
import StartUpgradePage from '../StartUpgradePage';

const renderPage = () =>
  render(
    <Routes>
      <Route path="/console/upgrade/new" element={<StartUpgradePage />} />
      <Route path="/console/upgrade" element={<div>upgrade status stub</div>} />
    </Routes>,
    { initialUrl: '/console/upgrade/new' },
  );

/** Fill in the target version and advance to the preflight step. */
async function goToPreflight(user: ReturnType<typeof userEvent.setup>, version = '1.2.0') {
  await screen.findByText('1.1.0'); // current version has loaded
  await user.type(screen.getByLabelText(/target version/i), version);
  await user.click(screen.getByRole('button', { name: /^next$/i }));
}

describe('StartUpgradePage', () => {
  it('shows the current version from /system/version', async () => {
    renderPage();

    expect(await screen.findByText('1.1.0')).toBeInTheDocument();
  });

  it('warns when the database has pending migrations', async () => {
    server.use(
      http.get('/admin/system/version', () =>
        HttpResponse.json({
          version: '1.1.0',
          schemaVersion: null,
          pendingMigrations: ['20260101_add_widgets'],
          databaseUpToDate: false,
        }),
      ),
    );
    renderPage();

    expect(
      await screen.findByText(/pending migrations/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/20260101_add_widgets/)).toBeInTheDocument();
  });

  it('keeps Next disabled for a non-semver target or the running version', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('1.1.0');

    const input = screen.getByLabelText(/target version/i);
    const next = screen.getByRole('button', { name: /^next$/i });

    await user.type(input, 'not-a-version');
    expect(next).toBeDisabled();

    await user.clear(input);
    await user.type(input, '1.1.0'); // already running
    expect(next).toBeDisabled();

    await user.clear(input);
    await user.type(input, '1.2.0');
    expect(next).toBeEnabled();
  });

  it('runs both preflight checks, passing the target to config-compatibility', async () => {
    const seen: string[] = [];
    server.use(
      http.get('/admin/upgrade/config-compatibility', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('version') ?? '');
        return HttpResponse.json({
          compatible: true,
          version: '1.2.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await goToPreflight(user);

    await waitFor(() => expect(seen).toContain('1.2.0'));
  });

  // The UI mirrors the server's own gate so it never offers an action the
  // server will reject.
  it('blocks the step when pre-validation fails, until force is checked', async () => {
    server.use(
      http.get('/admin/upgrade/pre-validation', () =>
        HttpResponse.json({
          canProceed: false,
          checks: [
            {
              name: 'backup_tooling',
              status: 'fail',
              message: 'pg_dump was not found on PATH',
            },
          ],
          summary: { passed: 0, warnings: 0, failures: 1 },
        }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await goToPreflight(user);

    await screen.findByText(/pg_dump was not found/i);
    const next = screen.getByRole('button', { name: /^next$/i });
    expect(next).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /proceed anyway/i }));
    expect(next).toBeEnabled();
  });

  it('sends a dry run without a confirm field and shows the stages', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/admin/upgrade', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          upgradeId: 'upg-1',
          fromVersion: '1.1.0',
          toVersion: '1.2.0',
          stages: [
            { stage: 'PRE_VALIDATION', success: true, message: 'ok', duration: 5 },
          ],
          rollbackTriggered: false,
          duration: 5,
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await goToPreflight(user);

    await screen.findByRole('heading', { name: /preflight checks/i });
    await user.click(await screen.findByRole('button', { name: /^next$/i }));
    await user.click(await screen.findByRole('button', { name: /run dry run/i }));

    await screen.findByText(/dry run complete/i);
    expect(body).toEqual({ toVersion: '1.2.0', dryRun: true, force: false });
    expect(screen.getByText('PRE_VALIDATION')).toBeInTheDocument();
  });

  it('requires typing the version before a real upgrade can be confirmed', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/admin/upgrade', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          toVersion: '1.2.0',
          stages: [],
          rollbackTriggered: false,
          duration: 1,
        });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('1.1.0');
    await user.click(screen.getByRole('checkbox', { name: /dry run/i })); // opt out
    await user.type(screen.getByLabelText(/target version/i), '1.2.0');
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    await screen.findByRole('heading', { name: /preflight checks/i });
    await user.click(await screen.findByRole('button', { name: /^next$/i }));
    await user.click(await screen.findByRole('button', { name: /start upgrade/i }));

    // Two "Start upgrade" buttons exist once the dialog opens — the trigger on
    // the review step and the dialog's confirm. Scope to the dialog.
    const dialog = await screen.findByRole('alertdialog');
    const confirmButton = within(dialog).getByRole('button', {
      name: /^start upgrade$/i,
    });
    const typeBox = within(dialog).getByLabelText(
      /type the target version to confirm/i,
    );

    await user.type(typeBox, '1.2.');
    expect(confirmButton).toBeDisabled();

    await user.type(typeBox, '0');
    await waitFor(() => expect(confirmButton).toBeEnabled());

    await user.click(confirmButton);
    await waitFor(() =>
      expect(body).toEqual({
        toVersion: '1.2.0',
        dryRun: false,
        force: false,
        confirm: '1.2.0',
      }),
    );
  });

  it('surfaces a rollback banner when the server reports one', async () => {
    server.use(
      http.post('/admin/upgrade', () =>
        HttpResponse.json({
          success: false,
          toVersion: '1.2.0',
          stages: [
            { stage: 'POST_HEALTH_CHECK', success: false, message: 'unhealthy', duration: 9 },
          ],
          rollbackTriggered: true,
          duration: 9,
          error: 'Health check failed',
        }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await goToPreflight(user);
    await screen.findByRole('heading', { name: /preflight checks/i });
    await user.click(await screen.findByRole('button', { name: /^next$/i }));
    await user.click(await screen.findByRole('button', { name: /run dry run/i }));

    expect(await screen.findByText(/a rollback was triggered/i)).toBeInTheDocument();
    expect(screen.getByText('Health check failed')).toBeInTheDocument();
  });

  it('stays on the review step when the request itself fails', async () => {
    server.use(
      http.post('/admin/upgrade', () => HttpResponse.json({}, { status: 500 })),
    );

    const user = userEvent.setup();
    renderPage();
    await goToPreflight(user);
    await screen.findByRole('heading', { name: /preflight checks/i });
    await user.click(await screen.findByRole('button', { name: /^next$/i }));
    await user.click(await screen.findByRole('button', { name: /run dry run/i }));

    expect(await screen.findByText(/the request failed/i)).toBeInTheDocument();
    // Not navigated away, and no result view.
    expect(screen.queryByText(/dry run complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText('upgrade status stub')).not.toBeInTheDocument();
  });
});
