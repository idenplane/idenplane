import { describe, it, expect } from 'vitest';
import {
  applyMetadata,
  emptySamlForm,
  previewSpEndpoints,
  samlConfigFromForm,
  samlFormFromConfig,
  splitCertificates,
} from '../samlForm';

const PEM_A = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';
const PEM_B = '-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----';

describe('samlForm', () => {
  it('splits PEM certificates, and blank-line-separated base64 bodies', () => {
    expect(splitCertificates(`${PEM_A}\n${PEM_B}`)).toEqual([PEM_A, PEM_B]);
    expect(splitCertificates('AAAA\nAAAA\n\nBBBB')).toEqual(['AAAAAAAA', 'BBBB']);
    expect(splitCertificates('  ')).toEqual([]);
  });

  it('round-trips a config through the form', () => {
    const config = {
      entityId: 'https://idp',
      ssoUrl: 'https://idp/sso',
      ssoBinding: 'post' as const,
      signingCertificates: [PEM_A, PEM_B],
      nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      signAuthnRequests: true,
      wantAssertionsSigned: true,
      wantResponseSigned: false,
      allowSha1: false,
      sloUrl: null,
      clockSkewSeconds: 90,
      subjectAttribute: 'objectId',
      usernameSource: 'attribute' as const,
      attributes: { email: 'mail', username: 'uid' },
    };
    expect(samlConfigFromForm(samlFormFromConfig(config))).toEqual({
      ...config,
      attributes: { email: 'mail', firstName: null, lastName: null, username: 'uid' },
    });
  });

  it('fills the IdP fields from metadata and keeps the rest', () => {
    const form = { ...emptySamlForm(), emailAttribute: 'mail' };
    const filled = applyMetadata(form, {
      entityId: 'https://sts.windows.net/t/',
      ssoUrl: 'https://login/sso',
      ssoBinding: 'redirect',
      signingCertificates: [PEM_A],
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      sloUrl: null,
    });
    expect(filled).toMatchObject({
      entityId: 'https://sts.windows.net/t/',
      certificates: PEM_A,
      emailAttribute: 'mail',
    });
  });

  it('previews the SP endpoints per realm and alias', () => {
    expect(previewSpEndpoints('https://iam.example.com', 'acme', 'okta')).toEqual({
      entityId: 'https://iam.example.com/realms/acme/broker/okta/saml/metadata',
      acsUrl: 'https://iam.example.com/realms/acme/broker/okta/saml/acs',
      metadataUrl: 'https://iam.example.com/realms/acme/broker/okta/saml/metadata',
    });
    expect(previewSpEndpoints('https://x', 'r', '').acsUrl).toBe(
      'https://x/realms/r/broker/{alias}/saml/acs',
    );
  });
});
