import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { render } from '../../test/utils';
import UpgradeStatusPage from '../upgrade/UpgradeStatusPage';

function renderUpgradeStatusPage() {
  return render(<UpgradeStatusPage />, { initialUrl: '/console/upgrade' });
}

describe('UpgradeStatusPage', () => {
  beforeAll(() => server.listen());
  afterAll(() => server.close());

  it('renders the page heading', async () => {
    renderUpgradeStatusPage();
    expect(await screen.findByRole('heading', { name: /upgrade status/i })).toBeInTheDocument();
  });

  it('shows the current status section', async () => {
    renderUpgradeStatusPage();
    expect(await screen.findByText('Current Status')).toBeInTheDocument();
  });

  it('displays upgrade status information', async () => {
    renderUpgradeStatusPage();
    await screen.findByText('Current Status');
    const completedBadges = await screen.findAllByText('COMPLETED');
    expect(completedBadges.length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText('1.0.0')).toBeInTheDocument();
    expect(await screen.findByText('1.1.0')).toBeInTheDocument();
  });

  it('shows pre-upgrade validation section', async () => {
    renderUpgradeStatusPage();
    expect(await screen.findByRole('heading', { name: /pre-upgrade validation/i })).toBeInTheDocument();
    expect(screen.getByText('Run Checks')).toBeInTheDocument();
  });

  it('shows rollback section', async () => {
    renderUpgradeStatusPage();
    expect(await screen.findByText('Rollback')).toBeInTheDocument();
  });

  it('shows upgrade history section', async () => {
    renderUpgradeStatusPage();
    expect(await screen.findByRole('heading', { name: /upgrade history/i })).toBeInTheDocument();
  });

  it('displays upgrade history entries', async () => {
    renderUpgradeStatusPage();
    await screen.findByText('Upgrade History');
    const startedHeaders = await screen.findAllByText('Started');
    expect(startedHeaders.length).toBeGreaterThanOrEqual(2);
  });

  it('shows no active upgrade message when status is null', async () => {
    server.use(
      http.get('/admin/upgrade/status', () => HttpResponse.json(null)),
    );
    renderUpgradeStatusPage();
    await screen.findByText('Current Status');
    expect(await screen.findByText(/no active or recent upgrades/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    server.use(
      http.get('/admin/upgrade/status', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json(null);
      }),
    );
    renderUpgradeStatusPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('displays failed status correctly', async () => {
    server.use(
      http.get('/admin/upgrade/status', () =>
        HttpResponse.json({
          id: 'upgrade-failed',
          fromVersion: '1.0.0',
          toVersion: '1.2.0',
          status: 'FAILED',
          startedAt: new Date('2024-01-01T10:00:00.000Z'),
          completedAt: null,
          backupId: 'backup-123',
          errorMessage: 'Migration failed due to schema conflict',
        }),
      ),
    );
    renderUpgradeStatusPage();
    await screen.findByText('Current Status');
    const failedBadges = await screen.findAllByText('FAILED');
    expect(failedBadges.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Migration failed due to schema conflict')).toBeInTheDocument();
  });

  it('shows rollback not available when canRollback is false', async () => {
    server.use(
      http.get('/admin/upgrade/rollback/capability', () =>
        HttpResponse.json({
          canRollback: false,
          reason: 'No previous successful upgrade to restore',
        }),
      ),
    );
    renderUpgradeStatusPage();
    await waitFor(() => {
      expect(screen.getByText('Not Available')).toBeInTheDocument();
    });
  });

  it('runs pre-upgrade validation checks when button is clicked', async () => {
    const preValidationSpy = vi.fn();
    server.use(
      http.get('/admin/upgrade/pre-validation', () => {
        preValidationSpy();
        return HttpResponse.json({
          canProceed: true,
          checks: [
            { name: 'Database Connection', status: 'pass', message: 'Connected' },
            { name: 'Disk Space', status: 'pass', message: '50GB available' },
          ],
          summary: { passed: 2, warnings: 0, failures: 0 },
        });
      }),
    );

    renderUpgradeStatusPage();
    const runChecksButton = await screen.findByRole('button', { name: /run checks/i });
    act(() => { runChecksButton.click(); });

    await waitFor(() => {
      expect(preValidationSpy).toHaveBeenCalled();
    });
  });

  it('shows Start New Upgrade button', async () => {
    renderUpgradeStatusPage();
    expect(await screen.findByRole('button', { name: /start new upgrade/i })).toBeInTheDocument();
  });

  it('has navigation button for starting new upgrade', async () => {
    renderUpgradeStatusPage();
    // Verify the button exists and is clickable - actual navigation tested in App integration
    const button = await screen.findByRole('button', { name: /start new upgrade/i });
    expect(button).toBeEnabled();
  });
});