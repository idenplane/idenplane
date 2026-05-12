import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { render } from '../../test/utils';
import MigrationHistoryPage from '../upgrade/MigrationHistoryPage';

function renderMigrationHistoryPage() {
  return render(<MigrationHistoryPage />, { initialUrl: '/console/upgrade/history' });
}

describe('MigrationHistoryPage', () => {
  beforeAll(() => server.listen());
  afterAll(() => server.close());

  it('renders the page heading', async () => {
    renderMigrationHistoryPage();
    expect(await screen.findByRole('heading', { name: /migration history/i })).toBeInTheDocument();
  });

  it('shows the back button to upgrade status', async () => {
    renderMigrationHistoryPage();
    expect(await screen.findByRole('button', { name: /back to upgrade/i })).toBeInTheDocument();
  });

  it('shows migration history table', async () => {
    renderMigrationHistoryPage();
    expect(await screen.findByText('Migration History'));
    expect(await screen.findByText('Started')).toBeInTheDocument();
  });

  it('displays upgrade entries with status badges', async () => {
    renderMigrationHistoryPage();
    await waitFor(() => {
      expect(screen.getAllByText('COMPLETED')).toHaveLength(2);
    });
    const versions = screen.getAllByText('1.0.0');
    expect(versions.length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.1.0')).toHaveLength(1);
  });

  it('shows stats summary when data is loaded', async () => {
    renderMigrationHistoryPage();
    await waitFor(() => {
      expect(screen.getByText('Total Migrations')).toBeInTheDocument();
      expect(screen.getByText('Successful')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });
  });

  it('shows failed migration status', async () => {
    renderMigrationHistoryPage();
    await waitFor(() => {
      expect(screen.getByText('FAILED')).toBeInTheDocument();
    });
  });

  it('shows View Details button for each entry', async () => {
    renderMigrationHistoryPage();
    await waitFor(() => {
      const viewDetailsButtons = screen.getAllByRole('button', { name: /view details/i });
      expect(viewDetailsButtons.length).toBeGreaterThan(0);
    });
  });

  it('opens detail modal when View Details is clicked', async () => {
    renderMigrationHistoryPage();
    await waitFor(() => {
      const viewDetailsButton = screen.getAllByRole('button', { name: /view details/i })[0];
      viewDetailsButton.click();
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /migration details/i })).toBeInTheDocument();
    });
  });

  it('closes detail modal when Close is clicked', async () => {
    renderMigrationHistoryPage();
    await waitFor(() => {
      const viewDetailsButton = screen.getAllByRole('button', { name: /view details/i })[0];
      viewDetailsButton.click();
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /migration details/i })).toBeInTheDocument();
    });
    const closeButton = screen.getByTestId('modal-close-button');
    closeButton.click();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /migration details/i })).not.toBeInTheDocument();
    });
  });

  it('shows empty state when no history is available', async () => {
    server.use(
      http.get('/admin/upgrade/history', () => HttpResponse.json([])),
    );
    renderMigrationHistoryPage();
    await waitFor(() => {
      expect(screen.getByText(/no migration history/i)).toBeInTheDocument();
    });
  });

  it('shows loading state', () => {
    server.use(
      http.get('/admin/upgrade/history', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json([]);
      }),
    );
    renderMigrationHistoryPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    server.use(
      http.get('/admin/upgrade/history', () => HttpResponse.json({}, { status: 500 })),
    );
    renderMigrationHistoryPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load migration history/i)).toBeInTheDocument();
    });
  });

  it('displays pagination controls when there are more entries', async () => {
    server.use(
      http.get('/admin/upgrade/history', ({ request }) => {
        const entries = Array.from({ length: 15 }, (_, i) => ({
          id: `upgrade-${i}`,
          fromVersion: '1.0.0',
          toVersion: `${i + 1}.0.0`,
          status: 'COMPLETED',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          backupId: null,
          errorMessage: null,
        }));
        return HttpResponse.json(entries);
      }),
    );
    renderMigrationHistoryPage();
    await waitFor(() => {
      // Pagination should show when entries exceed PAGE_SIZE (10)
      expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
  });

  it('navigates to previous page when Previous is clicked', async () => {
    server.use(
      http.get('/admin/upgrade/history', ({ request }) => {
        const entries = Array.from({ length: 15 }, (_, i) => ({
          id: `upgrade-${i}`,
          fromVersion: '1.0.0',
          toVersion: `${i + 1}.0.0`,
          status: 'COMPLETED',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          backupId: null,
          errorMessage: null,
        }));
        return HttpResponse.json(entries);
      }),
    );
    renderMigrationHistoryPage();
    await waitFor(() => {
      expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    });
    const nextButton = screen.getByRole('button', { name: /next/i });
    nextButton.click();
    await waitFor(() => {
      expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument();
    });
    const prevButton = screen.getByRole('button', { name: /previous/i });
    prevButton.click();
    await waitFor(() => {
      expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    });
  });

  it('displays error message in detail modal for failed upgrades', async () => {
    server.use(
      http.get('/admin/upgrade/history', () =>
        HttpResponse.json([
          {
            id: 'upgrade-3',
            fromVersion: '1.0.0',
            toVersion: '1.2.0',
            status: 'FAILED',
            startedAt: new Date('2024-01-01T10:00:00.000Z').toISOString(),
            completedAt: new Date('2024-01-01T10:05:00.000Z').toISOString(),
            backupId: 'backup-123',
            errorMessage: 'Database migration failed due to schema conflict',
          },
        ]),
      ),
    );
    renderMigrationHistoryPage();
    const viewDetailsButton = await screen.findByRole('button', { name: /view details/i });
    viewDetailsButton.click();
    await waitFor(() => {
      expect(screen.getByText('Database migration failed due to schema conflict')).toBeInTheDocument();
    });
  });
});