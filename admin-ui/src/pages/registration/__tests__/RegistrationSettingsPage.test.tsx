import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import RegistrationSettingsPage from '../RegistrationSettingsPage';

function serveRealm(registrationAllowed: boolean) {
  server.use(
    http.get('/admin/realms/:name', ({ params }) =>
      HttpResponse.json(makeRealm({ name: params.name as string, registrationAllowed })),
    ),
  );
}

function renderPage() {
  render(<RegistrationSettingsPage />, {
    initialUrl: '/console/realms/acme/registration-settings',
    routePattern: '/console/realms/:name/registration-settings',
  });
}

describe('RegistrationSettingsPage sign-up link', () => {
  it('links to the public sign-up entry when self-registration is on', async () => {
    serveRealm(true);
    renderPage();
    const link = await screen.findByRole('link', { name: '/console/register/acme' });
    expect(link).toHaveAttribute('href', '/console/register/acme');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows no sign-up link when self-registration is off', async () => {
    serveRealm(false);
    renderPage();
    await screen.findByRole('heading', { name: 'Registration Settings' });
    expect(screen.queryByRole('link', { name: /console\/register/ })).toBeNull();
  });
});
