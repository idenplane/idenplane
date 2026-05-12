import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { render } from '../../test/utils';
import DashboardPage from '../DashboardPage';
import { makeStats } from '../../test/mocks/data';

function renderDashboard() {
  return render(<DashboardPage />, { initialUrl: '/console' });
}

describe('DashboardPage', () => {
  it('renders the page heading', async () => {
    renderDashboard();
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('shows realm count stat cards', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: /dashboard/i });
    // Default mock returns 2 realms
    expect(await screen.findByText('Total Realms')).toBeInTheDocument();
    expect(screen.getByText('Enabled Realms')).toBeInTheDocument();
    expect(screen.getByText('Disabled Realms')).toBeInTheDocument();
  });

  it('shows realm list', async () => {
    renderDashboard();
    // The mock handlers return "master" and "test-realm"
    expect(await screen.findByText('Master')).toBeInTheDocument();
    expect(screen.getByText('Test Realm')).toBeInTheDocument();
  });

  it('shows stats cards for the first realm', async () => {
    renderDashboard();
    expect(await screen.findByText('Active Users (24h)')).toBeInTheDocument();
    expect(screen.getByText('Active Users (7d)')).toBeInTheDocument();
    expect(screen.getByText('Active Users (30d)')).toBeInTheDocument();
    expect(screen.getByText('Login Successes (24h)')).toBeInTheDocument();
    expect(screen.getByText('Login Failures (24h)')).toBeInTheDocument();
    expect(screen.getByText('Active Sessions')).toBeInTheDocument();
  });

  it('displays stat values from the API', async () => {
    server.use(
      http.get('/admin/realms/:name/stats', () =>
        HttpResponse.json(
          makeStats({
            activeUsers24h: 7,
            activeUsers7d: 33,
            activeUsers30d: 120,
            loginSuccessCount: 99,
            loginFailureCount: 4,
            activeSessionCount: 17,
          }),
        ),
      ),
    );

    renderDashboard();
    await screen.findByText('Active Users (24h)');

    // Values are rendered as text nodes next to the labels
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(await screen.findByText('33')).toBeInTheDocument();
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(await screen.findByText('99')).toBeInTheDocument();
    expect(await screen.findByText('4')).toBeInTheDocument();
    expect(await screen.findByText('17')).toBeInTheDocument();
  });

  it('shows an error message when stats fail to load', async () => {
    server.use(
      http.get('/admin/realms/:name/stats', () =>
        HttpResponse.json({ message: 'stats unavailable' }, { status: 500 }),
      ),
    );

    renderDashboard();

    expect(await screen.findByText(/failed to load stats\. please try again\./i)).toBeInTheDocument();
    expect(screen.queryByText('Active Users (24h)')).not.toBeInTheDocument();
  });

  it('displays system health status', async () => {
    renderDashboard();
    expect(await screen.findByText('System')).toBeInTheDocument();
    expect(await screen.findByText('Healthy')).toBeInTheDocument();
  });

  it('shows degraded health when health check fails', async () => {
    server.use(
      http.get('/health/ready', () =>
        HttpResponse.json(
          { status: 'error', error: { database: { status: 'down' } } },
          { status: 503 },
        ),
      ),
    );

    renderDashboard();
    await screen.findByText('System');
    // Health status shows "Degraded" when status is not "ok"
    await waitFor(() => {
      expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    });
  });

  it('shows the recent events feed', async () => {
    renderDashboard();
    expect(await screen.findByText('Recent Events')).toBeInTheDocument();
    // From mock: LOGIN and LOGIN_ERROR events
    await waitFor(() => {
      expect(screen.getByText('LOGIN')).toBeInTheDocument();
      expect(screen.getByText('LOGIN_ERROR')).toBeInTheDocument();
    });
  });

  it('renders quick action buttons', async () => {
    renderDashboard();
    expect(await screen.findByText('Create User')).toBeInTheDocument();
    expect(screen.getByText('Create Client')).toBeInTheDocument();
    expect(screen.getByText('View Logs')).toBeInTheDocument();
  });

  it('shows loading state when realms are loading', () => {
    // Delay the response
    server.use(
      http.get('/admin/realms', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json([]);
      }),
    );
    renderDashboard();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows empty state when no realms exist', async () => {
    server.use(
      http.get('/admin/realms', () => HttpResponse.json([])),
    );
    renderDashboard();
    expect(await screen.findByText(/no realms yet/i)).toBeInTheDocument();
    expect(screen.getByText(/create your first realm/i)).toBeInTheDocument();
  });

  it('does not show per-realm stats when there are no realms', async () => {
    server.use(
      http.get('/admin/realms', () => HttpResponse.json([])),
    );
    renderDashboard();
    await screen.findByText(/no realms yet/i);
    expect(screen.queryByText('Active Users (24h)')).not.toBeInTheDocument();
  });
});
