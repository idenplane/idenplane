import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '../../../test/utils';
import ProxyApplicationListPage from '../ProxyApplicationListPage';

function renderList(realm = 'test-realm') {
  return render(<ProxyApplicationListPage />, {
    initialUrl: `/console/realms/${realm}/proxy-applications`,
    routePattern: '/console/realms/:name/proxy-applications',
  });
}

describe('ProxyApplicationListPage', () => {
  it('shows a loading state initially', () => {
    renderList();
    expect(screen.getByText(/loading proxy applications/i)).toBeInTheDocument();
  });

  it('renders a row per application', async () => {
    renderList();
    await screen.findByText('grafana');
    expect(screen.getByText('wiki')).toBeInTheDocument();
  });

  it('shows the realm in the subtitle', async () => {
    renderList();
    await screen.findByText('grafana');
    expect(screen.getByText(/test-realm/)).toBeInTheDocument();
  });

  it('renders the Add Application button', async () => {
    renderList();
    await screen.findByText('grafana');
    expect(
      screen.getByRole('button', { name: /add application/i }),
    ).toBeInTheDocument();
  });

  it('shows the cookie domain, which is the setting most likely to be wrong', async () => {
    renderList();
    await screen.findByText('grafana');
    expect(screen.getAllByText('.example.com').length).toBeGreaterThan(0);
  });

  it('distinguishes enabled from disabled applications', async () => {
    renderList();
    await screen.findByText('grafana');

    // Scoped to the rows: "Enabled" is also a column header, so an unscoped
    // query matches the <th> as well as the badge.
    const [grafanaRow, wikiRow] = screen.getAllByRole('button', {
      name: /view proxy application/i,
    });
    expect(within(grafanaRow).getByText('Enabled')).toBeInTheDocument();
    expect(within(wikiRow).getByText('Disabled')).toBeInTheDocument();
  });

  // The reason callback status is in the list at all: an unregistered callback
  // breaks login at the last step, and an admin should see it without opening
  // each application.
  it('flags an application whose callback URL is not registered', async () => {
    renderList();
    await screen.findByText('grafana');
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Not registered')).toBeInTheDocument();
  });

  it('gives each row an accessible name', async () => {
    renderList();
    await screen.findByText('grafana');
    expect(
      screen.getByRole('button', { name: /view proxy application grafana/i }),
    ).toBeInTheDocument();
  });

  it('labels the table', async () => {
    renderList();
    await screen.findByText('grafana');
    expect(
      screen.getByRole('table', { name: /proxy applications/i }),
    ).toBeInTheDocument();
  });
});
