import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import {
  certificateToPem,
  validateSamlConfig,
} from '../../identity-providers/saml-config.js';
import {
  parseRedirectQuery,
  verifyRedirectSignature,
  spVerificationKey,
} from '../../saml/saml-request-verifier.js';
import {
  IdpMetadataError,
  buildAuthnRequest,
  buildSpMetadata,
  parseIdpMetadata,
  postBindingCsp,
  postBindingPage,
  redirectBindingUrl,
  signAuthnRequestXml,
  spEndpoints,
} from './saml-sp-messages.js';
import { spCertificatePem, pemBody } from './saml-sp-credentials.js';
import { makeFakeIdp } from './__mocks__/fake-saml-idp.js';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const realmKey = {
  kid: 'kid-1',
  algorithm: 'RS256',
  publicKey: keys.publicKey,
  privateKey: keys.privateKey,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const sp = spEndpoints('https://iam.example.com', 'acme', 'okta');

async function config() {
  const idp = await makeFakeIdp();
  const r = validateSamlConfig({
    entityId: idp.entityId,
    ssoUrl: 'https://idp.example.test/sso',
    signingCertificates: [idp.certificatePem],
  });
  if (!r.ok) throw new Error(r.errors.join());
  return r.config;
}

describe('SP endpoints', () => {
  it('are per realm and alias, and distinct from the realm IdP entity ID', () => {
    expect(sp).toEqual({
      entityId: 'https://iam.example.com/realms/acme/broker/okta/saml/metadata',
      acsUrl: 'https://iam.example.com/realms/acme/broker/okta/saml/acs',
      metadataUrl:
        'https://iam.example.com/realms/acme/broker/okta/saml/metadata',
    });
    expect(sp.entityId).not.toBe('https://iam.example.com/realms/acme');
  });
});

describe('AuthnRequest', () => {
  it('HTTP-Redirect: DEFLATE + query-string signature the IdP side verifies', async () => {
    const c = await config();
    const xml = buildAuthnRequest({
      id: '_abc',
      issueInstant: new Date(),
      sp,
      config: c,
    });
    const url = new URL(
      redirectBindingUrl(c.ssoUrl, xml, 'relay-1', keys.privateKey),
    );
    const query = parseRedirectQuery(url.search.slice(1));
    // The same verifier Idenplane's IdP uses for SPs' requests.
    expect(() =>
      verifyRedirectSignature(query, spVerificationKey(keys.publicKey)),
    ).not.toThrow();
    const inflated = inflateRawSync(
      Buffer.from(query.samlRequest!, 'base64'),
    ).toString('utf-8');
    expect(inflated).toBe(xml);
    expect(inflated).toContain(`AssertionConsumerServiceURL="${sp.acsUrl}"`);
    expect(inflated).toContain(`<saml:Issuer>${sp.entityId}</saml:Issuer>`);
    expect(inflated).toContain(
      'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
    );
    expect(query.relayState).toBe('relay-1');
  });

  it('HTTP-Redirect without signing carries no SigAlg or Signature', async () => {
    const c = await config();
    const xml = buildAuthnRequest({
      id: '_a',
      issueInstant: new Date(),
      sp,
      config: c,
    });
    const url = new URL(redirectBindingUrl(c.ssoUrl, xml, 'r', null));
    expect(url.searchParams.has('SigAlg')).toBe(false);
    expect(url.searchParams.has('Signature')).toBe(false);
  });

  it('HTTP-POST: an enveloped signature after the Issuer, verifiable', async () => {
    const c = await config();
    const xml = buildAuthnRequest({
      id: '_post1',
      issueInstant: new Date(),
      sp,
      config: c,
    });
    const signed = signAuthnRequestXml(xml, '_post1', keys.privateKey);
    expect(signed).toMatch(/<\/saml:Issuer><Signature/);
    const sig = new SignedXml({ publicCert: keys.publicKey });
    sig.loadSignature(/<Signature[\s\S]*<\/Signature>/.exec(signed)![0]);
    expect(sig.checkSignature(signed)).toBe(true);
  });

  it('the POST page escapes values and is submitted by a nonce script under a strict CSP', () => {
    const html = postBindingPage(
      'https://idp.example.test/sso?a=1&b="2"',
      '<x/>',
      'r"<',
      'NONCE',
    );
    expect(html).toContain(
      'action="https://idp.example.test/sso?a=1&amp;b=&quot;2&quot;"',
    );
    expect(html).toContain('value="r&quot;&lt;"');
    expect(html).toContain('<script nonce="NONCE">');
    expect(html).not.toMatch(/onload=/);
    const csp = postBindingCsp('https://idp.example.test/sso', 'NONCE');
    expect(csp).toContain("script-src 'nonce-NONCE'");
    expect(csp).toContain('form-action https://idp.example.test');
    expect(csp).toContain("default-src 'none'");
  });
});

describe('SP certificate and metadata', () => {
  it('is a stable self-signed certificate for the realm key', async () => {
    const a = await spCertificatePem(realmKey, 'acme');
    const b = await spCertificatePem({ ...realmKey }, 'acme');
    expect(a).toBe(b);
    const cert = new X509Certificate(a);
    expect(cert.publicKey.export({ type: 'spki', format: 'pem' })).toBe(
      keys.publicKey,
    );
    expect(cert.verify(cert.publicKey)).toBe(true);
  });

  it('refuses a non-RSA realm key', async () => {
    await expect(
      spCertificatePem({ ...realmKey, algorithm: 'ES256' }, 'acme'),
    ).rejects.toThrow(/RSA/);
  });

  it('publishes the entity ID, the POST ACS and the signing certificate only', async () => {
    const pem = await spCertificatePem(realmKey, 'acme');
    const xml = buildSpMetadata({
      sp,
      certificatePem: pem,
      config: {
        signAuthnRequests: true,
        wantAssertionsSigned: true,
        nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      },
    });
    expect(xml).toContain(`entityID="${sp.entityId}"`);
    expect(xml).toContain(`Location="${sp.acsUrl}"`);
    expect(xml).toContain('AuthnRequestsSigned="true"');
    expect(xml).toContain(pemBody(pem));
    expect(xml).toContain('<md:KeyDescriptor use="signing">');
    expect(xml).not.toContain('use="encryption"');
    expect(xml).not.toContain('SingleLogoutService');
  });
});

describe('parseIdpMetadata', () => {
  const metadata = (cert: string, extra = '') => `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://sts.windows.net/t/">
  <!-- comments are fine in metadata -->
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" WantAuthnRequestsSigned="true">
    <KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${cert}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
    <KeyDescriptor use="encryption"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>ZZZZ</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://login.example/slo"/>
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</NameIDFormat>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://login.example/post"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://login.example/redirect"/>
    ${extra}
  </IDPSSODescriptor>
</EntityDescriptor>`;

  it('reads entity ID, SSO (Redirect preferred), SLO, signing certs and NameID format', async () => {
    const idp = await makeFakeIdp();
    const body = pemBody(idp.certificatePem);
    const fields = parseIdpMetadata(metadata(body));
    expect(fields).toEqual({
      entityId: 'https://sts.windows.net/t/',
      ssoUrl: 'https://login.example/redirect',
      ssoBinding: 'redirect',
      signingCertificates: [certificateToPem(idp.certificatePem)],
      nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      sloUrl: 'https://login.example/slo',
      signAuthnRequests: true,
    });
  });

  it('refuses a DTD', () => {
    expect(() =>
      parseIdpMetadata(
        '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x/>',
      ),
    ).toThrow(IdpMetadataError);
  });

  it('refuses metadata without an IdP', () => {
    expect(() =>
      parseIdpMetadata(
        '<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x"/>',
      ),
    ).toThrow(/no SAML identity provider/);
  });
});
