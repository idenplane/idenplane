import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/utils';
import ProxyApplicationCreatePage from '../ProxyApplicationCreatePage';

function renderCreate(realm = 'test-realm') {
  return render(<ProxyApplicationCreatePage />, {
    initialUrl: `/console/realms/${realm}/proxy-applications/new`,
    routePattern: '/console/realms/:name/proxy-applications/new',
  });
}

describe('ProxyApplicationCreatePage', () => {
  it('renders the form fields', async () => {
    renderCreate();
    expect(screen.getByLabelText(/^slug$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/oauth client/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/allowed redirect uris/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cookie domain/i)).toBeInTheDocument();
  });

  it('previews the verify path the proxy will be pointed at', async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByLabelText(/^slug$/i), 'grafana');
    expect(
      screen.getByText(/\/realms\/test-realm\/proxy\/grafana\/verify/),
    ).toBeInTheDocument();
  });

  it('fills the cookie domain from the first redirect URI', async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(
      screen.getByLabelText(/allowed redirect uris/i),
      'https://grafana.example.com/*',
    );

    expect(screen.getByLabelText(/cookie domain/i)).toHaveValue('.example.com');
  });

  it('stops suggesting once the admin edits the cookie domain themselves', async () => {
    const user = userEvent.setup();
    renderCreate();

    const cookieDomain = screen.getByLabelText(/cookie domain/i);
    await user.type(cookieDomain, '.custom.test');
    await user.type(
      screen.getByLabelText(/allowed redirect uris/i),
      'https://grafana.example.com/*',
    );

    expect(cookieDomain).toHaveValue('.custom.test');
  });

  it('lists the realm clients to pick from', async () => {
    renderCreate();
    await screen.findByRole('option', { name: /my-app/i });
    expect(
      screen.getByRole('option', { name: /public-app/i }),
    ).toBeInTheDocument();
  });

  it('renders the submit and cancel actions', () => {
    renderCreate();
    expect(
      screen.getByRole('button', { name: /create application/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });
});
