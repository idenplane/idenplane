import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import {
  makeProxyApplication,
  makeProxyApplicationView,
} from '../../../test/mocks/data';
import { render } from '../../../test/utils';
import ProxyApplicationDetailPage from '../ProxyApplicationDetailPage';

function renderDetail(realm = 'test-realm', slug = 'grafana') {
  return render(<ProxyApplicationDetailPage />, {
    initialUrl: `/console/realms/${realm}/proxy-applications/${slug}`,
    routePattern: '/console/realms/:name/proxy-applications/:slug',
  });
}

describe('ProxyApplicationDetailPage', () => {
  it('shows the application name and slug', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Grafana' });
    expect(screen.getByText('grafana')).toBeInTheDocument();
  });

  it('shows the forward-auth endpoint the proxy is pointed at', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Grafana' });
    expect(
      screen.getByText('/realms/test-realm/proxy/grafana/verify'),
    ).toBeInTheDocument();
  });

  it('lists the identity headers, since the proxy must be told to copy them', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Grafana' });
    expect(screen.getByText('X-Forwarded-User')).toBeInTheDocument();
    expect(screen.getByText('X-Forwarded-Groups')).toBeInTheDocument();
  });

  it('shows the allowed redirect URIs', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Grafana' });
    expect(
      screen.getByText('https://grafana.example.com/*'),
    ).toBeInTheDocument();
  });

  // The failure this page exists to prevent: a callback URL that was never
  // added to the OAuth client. It breaks login at the final redirect, long
  // after the admin has stopped looking.
  it('warns, in an alert, when the callback URL is not registered', async () => {
    server.use(
      http.get('/admin/realms/:name/proxy-applications/:slug', () =>
        HttpResponse.json(
          makeProxyApplicationView({ callbackRegistered: false }),
        ),
      ),
    );

    renderDetail();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/callback url is not registered/i);
    expect(alert).toHaveTextContent(/grafana-proxy/);
  });

  it('does not warn when the callback URL is registered', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Grafana' });
    expect(
      screen.queryByText(/callback url is not registered/i),
    ).not.toBeInTheDocument();
  });

  it('offers Disable for an enabled application', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Grafana' });
    expect(
      screen.getByRole('button', { name: /^disable$/i }),
    ).toBeInTheDocument();
  });

  it('offers Enable for a disabled application', async () => {
    server.use(
      http.get('/admin/realms/:name/proxy-applications/:slug', () =>
        HttpResponse.json(
          makeProxyApplicationView({
            application: makeProxyApplication({ enabled: false }),
          }),
        ),
      ),
    );

    renderDetail();
    expect(
      await screen.findByRole('button', { name: /^enable$/i }),
    ).toBeInTheDocument();
  });

  it('reports how many sessions were revoked', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole('heading', { name: 'Grafana' });

    await user.click(screen.getByRole('button', { name: /revoke all sessions/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/revoked 2 sessions/i);
  });
});
