import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import NhiOAuthClientPanel from '../NhiOAuthClientPanel';

const BASE = '/admin/realms/test-realm/nhi/nhi-1/oauth-client';

function renderPanel(readOnly = false) {
  return render(<NhiOAuthClientPanel realmName="test-realm" identityId="nhi-1" readOnly={readOnly} />);
}

describe('NhiOAuthClientPanel', () => {
  it('offers to create the client when the identity has none', async () => {
    renderPanel();
    await screen.findByText(/has no OAuth client/i);
    expect(screen.getByRole('button', { name: /create oauth client/i })).toBeInTheDocument();
  });

  it('creates the client with the chosen method and shows it', async () => {
    let sent: unknown;
    server.use(
      http.post(BASE, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          {
            id: 'c-1',
            clientId: 'nhi-nhi-1',
            name: 'sensor',
            enabled: true,
            clientType: 'CONFIDENTIAL',
            grantTypes: ['client_credentials'],
            tokenEndpointAuthMethod: 'tls_client_auth',
            tlsClientCertificateBoundAccessTokens: true,
            nhiIdentityId: 'nhi-1',
            tokenEndpoint: '/realms/test-realm/protocol/openid-connect/token',
            mtlsClientAuthEnabled: false,
            createdAt: '2026-11-13T00:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );
    renderPanel();
    await screen.findByText(/has no OAuth client/i);
    fireEvent.change(screen.getByLabelText(/authentication/i), {
      target: { value: 'tls_client_auth' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create oauth client/i }));

    await screen.findByText('nhi-nhi-1');
    expect(sent).toEqual({ tokenEndpointAuthMethod: 'tls_client_auth' });
    expect(screen.getByText(/CA-issued certificate/)).toBeInTheDocument();
    expect(screen.getByText(/always bound to the certificate/i)).toBeInTheDocument();
    // The realm flag is off: the panel says why the device cannot get tokens.
    expect(screen.getByRole('status')).toHaveTextContent(/certificate authentication is off/i);
  });

  it("shows the server's reason when creation fails", async () => {
    server.use(
      http.post(BASE, () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'The identity has no certificate credential with a tlsAuthMode; pass tokenEndpointAuthMethod',
          },
          { status: 400 },
        ),
      ),
    );
    renderPanel();
    await screen.findByText(/has no OAuth client/i);
    fireEvent.click(screen.getByRole('button', { name: /create oauth client/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/pass tokenEndpointAuthMethod/);
  });

  it('shows an existing client and lets you delete it', async () => {
    let deleted = false;
    server.use(
      http.get(BASE, () =>
        HttpResponse.json({
          id: 'c-1',
          clientId: 'nhi-existing',
          name: 'sensor',
          enabled: true,
          clientType: 'CONFIDENTIAL',
          grantTypes: ['client_credentials'],
          tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
          tlsClientCertificateBoundAccessTokens: true,
          nhiIdentityId: 'nhi-1',
          tokenEndpoint: '/realms/test-realm/protocol/openid-connect/token',
          mtlsClientAuthEnabled: true,
          createdAt: '2026-11-13T00:00:00.000Z',
        }),
      ),
      http.delete(BASE, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPanel();
    await screen.findByText('nhi-existing');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete oauth client/i }));
    const confirm = await screen.findAllByRole('button', { name: /confirm|delete/i });
    fireEvent.click(confirm[confirm.length - 1]);
    await screen.findByText(/has no OAuth client/i);
    expect(deleted).toBe(true);
  });

  it('is read-only for a decommissioned identity', async () => {
    renderPanel(true);
    await screen.findByText(/has no OAuth client/i);
    expect(screen.queryByRole('button', { name: /create oauth client/i })).not.toBeInTheDocument();
  });
});
