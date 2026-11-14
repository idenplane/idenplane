import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/utils';
import OrganizationDetailPage from '../OrganizationDetailPage';

const ORG = '/admin/realms/test-realm/organizations/acme';

function mockOrganization() {
  server.use(
    http.get(ORG, () =>
      HttpResponse.json({
        id: 'org-1',
        realmId: 'realm-1',
        slug: 'acme',
        name: 'Acme',
        displayName: null,
        description: null,
        enabled: true,
        logoUrl: null,
        primaryColor: null,
        requireMfa: false,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      }),
    ),
    http.get(`${ORG}/members`, () => HttpResponse.json([])),
    http.get(`${ORG}/invitations`, () => HttpResponse.json([])),
  );
}

describe('OrganizationDetailPage invitations', () => {
  it('shows the created invitation token once, with how to accept it', async () => {
    mockOrganization();
    let sent: unknown;
    server.use(
      http.post(`${ORG}/invitations`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          { token: 'dummy-invite-token-123', expiresAt: '2026-11-17T10:00:00.000Z' },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<OrganizationDetailPage />, {
      initialUrl: '/console/realms/test-realm/organizations/acme',
      routePattern: '/console/realms/:name/organizations/:slug',
    });

    fireEvent.change(await screen.findByLabelText('Email', { selector: '#field-invite-email' }), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create invitation/i }));

    const panel = await screen.findByTestId('created-invitation');
    expect(sent).toEqual({ email: 'new@example.com', role: 'member' });
    expect(panel).toHaveTextContent('Invitation created for new@example.com');
    expect(panel).toHaveTextContent(/shown only once/i);
    expect(panel).toHaveTextContent('/invitations/<token>/accept');
    expect(screen.getByLabelText('Invitation token')).toHaveValue('dummy-invite-token-123');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('created-invitation')).not.toBeInTheDocument();
  });

  it('reports a failed invitation without showing a token', async () => {
    mockOrganization();
    server.use(
      http.post(`${ORG}/invitations`, () =>
        HttpResponse.json({ message: 'nope' }, { status: 400 }),
      ),
    );

    renderWithProviders(<OrganizationDetailPage />, {
      initialUrl: '/console/realms/test-realm/organizations/acme',
      routePattern: '/console/realms/:name/organizations/:slug',
    });

    fireEvent.change(await screen.findByLabelText('Email', { selector: '#field-invite-email' }), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create invitation/i }));

    expect(await screen.findByText('Failed to create the invitation.')).toBeInTheDocument();
    expect(screen.queryByTestId('created-invitation')).not.toBeInTheDocument();
  });
});
