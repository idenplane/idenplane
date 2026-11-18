import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import IdpCreatePage from '../IdpCreatePage';
import IdpDetailPage from '../IdpDetailPage';

const PEM = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';

const samlIdp = {
  id: 'idp-1',
  realmId: 'r1',
  alias: 'okta',
  displayName: 'Okta',
  enabled: true,
  providerType: 'saml',
  clientId: '',
  clientSecret: '••••••',
  authorizationUrl: '',
  tokenUrl: '',
  userinfoUrl: null,
  jwksUrl: null,
  issuer: null,
  defaultScopes: '',
  trustEmail: false,
  linkOnly: false,
  syncUserProfile: true,
  samlConfig: {
    entityId: 'https://okta.example/saml',
    ssoUrl: 'https://okta.example/sso',
    ssoBinding: 'redirect',
    signingCertificates: [PEM],
    nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    signAuthnRequests: false,
    wantAssertionsSigned: true,
    wantResponseSigned: false,
    allowSha1: false,
    sloUrl: null,
    clockSkewSeconds: 60,
    subjectAttribute: null,
    usernameSource: 'email',
    attributes: {},
  },
  samlSp: {
    entityId: 'https://iam.example.com/realms/test-realm/broker/okta/saml/metadata',
    acsUrl: 'https://iam.example.com/realms/test-realm/broker/okta/saml/acs',
    metadataUrl: 'https://iam.example.com/realms/test-realm/broker/okta/saml/metadata',
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('SAML identity providers in the admin console', () => {
  it('the create form has a SAML variant: metadata import fills it, the OIDC fields go away, samlConfig is sent', async () => {
    let created: Record<string, unknown> | null = null;
    server.use(
      http.post('/admin/realms/:name/identity-providers/saml-metadata', async ({ request }) => {
        const body = (await request.json()) as { xml?: string };
        expect(body.xml).toContain('EntityDescriptor');
        return HttpResponse.json({
          entityId: 'https://sts.windows.net/tenant/',
          ssoUrl: 'https://login.microsoftonline.com/tenant/saml2',
          ssoBinding: 'redirect',
          signingCertificates: [PEM],
          nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
          sloUrl: null,
        });
      }),
      http.post('/admin/realms/:name/identity-providers', async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...samlIdp, alias: 'entra' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<IdpCreatePage />, {
      initialUrl: '/console/realms/test-realm/identity-providers/create',
      routePattern: '/console/realms/:name/identity-providers/create',
    });

    await user.type(screen.getByLabelText(/^alias/i), 'entra');
    await user.selectOptions(screen.getByLabelText(/provider type/i), 'saml');

    expect(screen.queryByLabelText(/client id/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^ACS URL/i)).toHaveValue(
      `${window.location.origin}/realms/test-realm/broker/entra/saml/acs`,
    );

    await user.click(screen.getByLabelText(/metadata xml/i));
    await user.paste('<EntityDescriptor entityID="x"/>');
    await user.click(screen.getByRole('button', { name: /import metadata/i }));
    expect(await screen.findByText(/filled from the metadata/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/idp entity id/i)).toHaveValue('https://sts.windows.net/tenant/');

    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created).toMatchObject({
      alias: 'entra',
      providerType: 'saml',
      samlConfig: {
        entityId: 'https://sts.windows.net/tenant/',
        ssoUrl: 'https://login.microsoftonline.com/tenant/saml2',
        signingCertificates: [PEM],
        wantAssertionsSigned: true,
        allowSha1: false,
      },
    });
    expect(created).not.toHaveProperty('clientId');
  });

  it('a SAML provider shows its SP metadata URL to copy, and no "not supported" label', async () => {
    server.use(
      http.get('/admin/realms/:name/identity-providers/:alias', () => HttpResponse.json(samlIdp)),
    );
    render(<IdpDetailPage />, {
      initialUrl: '/console/realms/test-realm/identity-providers/okta',
      routePattern: '/console/realms/:name/identity-providers/:alias',
    });
    expect(await screen.findByLabelText(/^sp metadata url$/i)).toHaveValue(samlIdp.samlSp.metadataUrl);
    expect(screen.getByRole('button', { name: /copy sp metadata url/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/provider type/i)).toHaveValue('saml');
    expect(screen.queryByText(/not supported\)/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/idp signing certificates/i)).toHaveValue(PEM);
  });
});

