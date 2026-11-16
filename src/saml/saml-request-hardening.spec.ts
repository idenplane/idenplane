import { BadRequestException } from '@nestjs/common';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { deflateRawSync } from 'zlib';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import type { Realm, SamlServiceProvider } from '@prisma/client';
import { lookupsBackedBy } from '../cache/cached-lookups.mock.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import { SamlIdpService } from './saml-idp.service.js';
import { SamlMetadataService } from './saml-metadata.service.js';
import { parseRedirectQuery } from './saml-request-verifier.js';

/**
 * AuthnRequest signature checks against XML signature wrapping (XSW) and
 * other ways of making the IdP verify one thing and act on another, with
 * requests signed for real by keys made here. Where a wrapped document
 * still carries a cryptographically valid signature, the test also shows
 * that a bare xml-crypto check accepts it: what refuses it is the IdP's own
 * guard, not a broken signature.
 */

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

const SP_ENTITY = 'https://sp.example.com';
const ACS = 'https://sp.example.com/acs';
const OTHER_ACS = 'https://sp.example.com/acs-other';
const BASE_URL = 'https://idp.example.com';
const REALM = { id: 'realm-1', name: 'test-realm' } as Realm;
const ENDPOINT = `${BASE_URL}/realms/${REALM.name}/protocol/saml`;

const NOT_SIGNED = new BadRequestException('AuthnRequest is not signed');
const SIG_FAILED = new BadRequestException(
  'AuthnRequest signature validation failed',
);

interface RequestOptions {
  id?: string;
  issuer?: string;
  acs?: string;
  issueInstant?: string | null;
  destination?: string;
  /** Children after the Issuer (and the signature), before NameIDPolicy. */
  inner?: string;
  /** Children after NameIDPolicy. */
  after?: string;
}

/** An AuthnRequest as an SP builds it. */
function authnRequest(o: RequestOptions = {}): string {
  const issueInstant =
    o.issueInstant === undefined ? new Date().toISOString() : o.issueInstant;
  return (
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"` +
    ` ID="${o.id ?? '_orig'}" Version="2.0"` +
    (issueInstant === null ? '' : ` IssueInstant="${issueInstant}"`) +
    (o.destination ? ` Destination="${o.destination}"` : '') +
    ` AssertionConsumerServiceURL="${o.acs ?? ACS}"` +
    ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">` +
    `<saml:Issuer>${o.issuer ?? SP_ENTITY}</saml:Issuer>` +
    (o.inner ?? '') +
    `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>` +
    (o.after ?? '') +
    `</samlp:AuthnRequest>`
  );
}

interface SignOptions {
  key?: string;
  signatureAlgorithm?: string;
  digestAlgorithm?: string;
  /** XPath of the signed element; the root (by ID) by default. */
  xpath?: string;
  isEmptyUri?: boolean;
}

/** Signs as an SP does: enveloped, exc-c14n, the Signature after Issuer. */
function sign(xml: string, refId: string, o: SignOptions = {}): string {
  const sig = new SignedXml({
    privateKey: o.key ?? keys.privateKey,
    signatureAlgorithm: (o.signatureAlgorithm ?? RSA_SHA256) as never,
    canonicalizationAlgorithm: EXC_C14N,
  });
  sig.addReference({
    xpath: o.xpath ?? `//*[@ID='${refId}']`,
    digestAlgorithm: (o.digestAlgorithm ?? SHA256) as never,
    transforms: [ENVELOPED, EXC_C14N],
    isEmptyUri: o.isEmptyUri,
  });
  sig.computeSignature(xml, {
    location: {
      reference: "/*/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });
  return sig.getSignedXml();
}

/** The Signature element of a signed document, as text. */
function signatureOf(signed: string): string {
  const m =
    /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*?<\/Signature>/.exec(
      signed,
    );
  if (!m) throw new Error('no signature');
  return m[0];
}

/**
 * What xml-crypto alone says about the document's (first) signature, with
 * every algorithm it supports by default: the check the IdP did before.
 */
function bareXmlCryptoAccepts(xml: string): boolean {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const sig = new SignedXml({ publicCert: keys.publicKey });
    sig.loadSignature(doc.getElementsByTagNameNS(DSIG, 'Signature')[0]!);
    return sig.checkSignature(xml);
  } catch {
    return false;
  }
}

const post = (xml: string, relayState?: string) => ({
  binding: 'post' as const,
  samlRequest: Buffer.from(xml, 'utf-8').toString('base64'),
  relayState,
});

let keys: { publicKey: string; privateKey: string };
let otherKeys: { publicKey: string; privateKey: string };

beforeAll(() => {
  const make = () =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  keys = make();
  otherKeys = make();
});

describe('SAML AuthnRequest hardening', () => {
  let service: SamlIdpService;
  let prisma: MockPrismaService;
  let leader: { isLeader: jest.Mock };
  let sp: SamlServiceProvider;

  beforeEach(() => {
    process.env['BASE_URL'] = BASE_URL;
    delete process.env['SAML_CLOCK_SKEW_SECONDS'];
    delete process.env['SAML_REQUEST_MAX_AGE_SECONDS'];
    prisma = createMockPrismaService();
    leader = { isLeader: jest.fn().mockReturnValue(true) };
    service = new SamlIdpService(
      lookupsBackedBy(prisma as any) as any,
      prisma as any,
      {} as any,
      leader as any,
    );
    sp = {
      id: 'sp-1',
      realmId: REALM.id,
      entityId: SP_ENTITY,
      name: 'SP',
      enabled: true,
      acsUrl: ACS,
      sloUrl: null,
      certificate: keys.publicKey,
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      signAssertions: true,
      signResponses: true,
      attributeStatements: {},
      validRedirectUris: [OTHER_ACS],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.samlServiceProvider.findUnique.mockImplementation(async () => sp);
  });

  afterEach(() => {
    delete process.env['BASE_URL'];
  });

  // ─── HTTP-POST: enveloped signature ───────────────────

  describe('HTTP-POST binding (enveloped signature)', () => {
    it('accepts a validly signed request and reads it from the signed bytes', async () => {
      const signed = sign(
        authnRequest({
          destination: ENDPOINT,
          after:
            '<samlp:RequestedAuthnContext Comparison="exact"><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></samlp:RequestedAuthnContext>',
        }),
        '_orig',
      );

      const accepted = await service.receiveAuthnRequest(
        REALM,
        post(signed, 'rs-1'),
      );

      expect(accepted.sp).toBe(sp);
      expect(accepted.signed).toBe(true);
      expect(accepted.relayState).toBe('rs-1');
      expect(accepted.request).toMatchObject({
        id: '_orig',
        issuer: SP_ENTITY,
        acsUrl: ACS,
        destination: ENDPOINT,
        protocolBinding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
        nameIdPolicy: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        forceAuthn: false,
        isPassive: false,
        requestedAuthnContext: {
          comparison: 'exact',
          classRefs: [
            'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport',
          ],
        },
      });
    });

    it('refuses an unsigned request when the SP has a certificate', async () => {
      await expect(
        service.receiveAuthnRequest(REALM, post(authnRequest())),
      ).rejects.toThrow(NOT_SIGNED);
    });

    it('accepts an unsigned request when the SP has no certificate', async () => {
      sp.certificate = null;
      const accepted = await service.receiveAuthnRequest(
        REALM,
        post(authnRequest()),
      );
      expect(accepted.signed).toBe(false);
      expect(accepted.request.id).toBe('_orig');
    });

    it('refuses a signature made with another key', async () => {
      const signed = sign(authnRequest(), '_orig', {
        key: otherKeys.privateKey,
      });
      await expect(
        service.receiveAuthnRequest(REALM, post(signed)),
      ).rejects.toThrow(SIG_FAILED);
    });

    it('refuses a signed request whose ACS URL was changed in place', async () => {
      const signed = sign(authnRequest(), '_orig').replace(
        `AssertionConsumerServiceURL="${ACS}"`,
        `AssertionConsumerServiceURL="${OTHER_ACS}"`,
      );
      expect(bareXmlCryptoAccepts(signed)).toBe(false);
      await expect(
        service.receiveAuthnRequest(REALM, post(signed)),
      ).rejects.toThrow(SIG_FAILED);
    });

    it('accepts the SP certificate as a bare base64 body only when it is a certificate', async () => {
      // A bare base64 body is read as an X.509 certificate; an SPKI key in
      // that form is not a certificate, so nothing verifies with it.
      sp.certificate = keys.publicKey
        .replace(/-----[A-Z ]+-----/g, '')
        .replace(/\s+/g, '');
      await expect(
        service.receiveAuthnRequest(REALM, post(sign(authnRequest(), '_orig'))),
      ).rejects.toThrow(SIG_FAILED);
    });

    describe('XML signature wrapping', () => {
      it('refuses the signed request moved under Extensions of a new root', async () => {
        const original = sign(authnRequest(), '_orig');
        const wrapped = authnRequest({
          id: '_evil',
          acs: OTHER_ACS,
          inner: `<samlp:Extensions>${original}</samlp:Extensions>`,
        });
        expect(bareXmlCryptoAccepts(wrapped)).toBe(true);

        await expect(
          service.receiveAuthnRequest(REALM, post(wrapped)),
        ).rejects.toThrow(SIG_FAILED);
      });

      it('refuses an unsigned root with another ACS URL that carries the signature, the signed original in Extensions', async () => {
        const original = sign(authnRequest(), '_orig');
        const signature = signatureOf(original);
        const unsignedOriginal = original.replace(signature, '');
        const wrapped = authnRequest({
          id: '_evil',
          acs: OTHER_ACS,
          inner: `${signature}<samlp:Extensions>${unsignedOriginal}</samlp:Extensions>`,
        });
        expect(bareXmlCryptoAccepts(wrapped)).toBe(true);

        await expect(
          service.receiveAuthnRequest(REALM, post(wrapped)),
        ).rejects.toThrow(SIG_FAILED);
      });

      it('refuses a forged root that copies the signed ID, the original in Extensions (duplicate ID)', async () => {
        const original = sign(authnRequest(), '_orig');
        const signature = signatureOf(original);
        const unsignedOriginal = original.replace(signature, '');
        const wrapped = authnRequest({
          id: '_orig',
          acs: OTHER_ACS,
          inner: `${signature}<samlp:Extensions>${unsignedOriginal}</samlp:Extensions>`,
        });

        await expect(
          service.receiveAuthnRequest(REALM, post(wrapped)),
        ).rejects.toThrow(BadRequestException);
      });

      it('refuses two signatures', async () => {
        // A copy of the valid signature on a new root, and the signed
        // original, with its own signature, under Extensions. Refused for
        // having two signatures, before any signature is computed.
        const original = sign(authnRequest(), '_orig');
        const doubled = authnRequest({
          id: '_evil',
          acs: OTHER_ACS,
          inner: `${signatureOf(original)}<samlp:Extensions>${original}</samlp:Extensions>`,
        });

        await expect(
          service.receiveAuthnRequest(REALM, post(doubled)),
        ).rejects.toThrow(SIG_FAILED);
      });

      it('refuses a signature whose Reference points at a child element', async () => {
        const xml = authnRequest({
          acs: OTHER_ACS,
          inner:
            '<samlp:Extensions><ext:Data xmlns:ext="urn:example:ext" ID="_child">signed</ext:Data></samlp:Extensions>',
        });
        const signed = sign(xml, '_child');
        expect(signed).toContain('URI="#_child"');
        expect(bareXmlCryptoAccepts(signed)).toBe(true);

        await expect(
          service.receiveAuthnRequest(REALM, post(signed)),
        ).rejects.toThrow(SIG_FAILED);
      });

      it('refuses a signature with an empty Reference URI (whole document)', async () => {
        const signed = sign(authnRequest(), '_orig', {
          xpath: '/*',
          isEmptyUri: true,
        });
        expect(signed).toContain('URI=""');

        await expect(
          service.receiveAuthnRequest(REALM, post(signed)),
        ).rejects.toThrow(SIG_FAILED);
      });

      it('refuses duplicate ID attributes', async () => {
        const signed = sign(authnRequest(), '_orig');
        const duplicated = signed.replace(
          '<samlp:NameIDPolicy',
          '<samlp:Extensions><ext:Data xmlns:ext="urn:example:ext" Id="_orig"/></samlp:Extensions><samlp:NameIDPolicy',
        );

        await expect(
          service.receiveAuthnRequest(REALM, post(duplicated)),
        ).rejects.toThrow(BadRequestException);
        // Unsigned too: nothing with two elements of one ID is read.
        sp.certificate = null;
        await expect(
          service.receiveAuthnRequest(REALM, post(duplicated)),
        ).rejects.toThrow(new BadRequestException('Invalid SAMLRequest'));
      });

      it('refuses a comment injected into the Issuer', async () => {
        const signed = sign(
          authnRequest({ issuer: 'https://sp.example.com' }),
          '_orig',
        );
        const injected = signed.replace(
          '<saml:Issuer>https://sp.example.com</saml:Issuer>',
          '<saml:Issuer>https://sp.example<!---->.com</saml:Issuer>',
        );
        // Exclusive c14n drops comments: the signature still verifies.
        expect(bareXmlCryptoAccepts(injected)).toBe(true);

        await expect(
          service.receiveAuthnRequest(REALM, post(injected)),
        ).rejects.toThrow(new BadRequestException('Invalid SAMLRequest'));
      });

      it('refuses a comment injected into a NameID', async () => {
        const signed = sign(
          authnRequest({
            inner:
              '<saml:Subject><saml:NameID>admin@example.com.attacker.test</saml:NameID></saml:Subject>',
          }),
          '_orig',
        );
        const injected = signed.replace(
          'admin@example.com.attacker.test',
          'admin@example.com<!---->.attacker.test',
        );
        expect(bareXmlCryptoAccepts(injected)).toBe(true);

        await expect(
          service.receiveAuthnRequest(REALM, post(injected)),
        ).rejects.toThrow(new BadRequestException('Invalid SAMLRequest'));
      });

      it('refuses a document with a DTD', async () => {
        const signed = sign(authnRequest(), '_orig');
        const withDtd =
          '<?xml version="1.0"?><!DOCTYPE samlp:AuthnRequest [<!ENTITY sp "https://sp.example.com">]>' +
          signed;

        await expect(
          service.receiveAuthnRequest(REALM, post(withDtd)),
        ).rejects.toThrow(new BadRequestException('Invalid SAMLRequest'));
      });

      it('accepts an XML declaration', async () => {
        const signed =
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          sign(authnRequest(), '_orig');
        await expect(
          service.receiveAuthnRequest(REALM, post(signed)),
        ).resolves.toMatchObject({ signed: true });
      });

      it('refuses a processing instruction', async () => {
        const signed = sign(authnRequest(), '_orig').replace(
          '<samlp:NameIDPolicy',
          '<?evil data?><samlp:NameIDPolicy',
        );
        await expect(
          service.receiveAuthnRequest(REALM, post(signed)),
        ).rejects.toThrow(new BadRequestException('Invalid SAMLRequest'));
      });

      it('refuses an element the AuthnRequest schema does not have', async () => {
        const signed = sign(
          authnRequest({ inner: '<ext:Data xmlns:ext="urn:example:ext"/>' }),
          '_orig',
        );
        await expect(
          service.receiveAuthnRequest(REALM, post(signed)),
        ).rejects.toThrow(new BadRequestException('Invalid SAMLRequest'));
      });
    });

    describe('algorithms', () => {
      it('refuses RSA-SHA1 with a SHA-1 digest', async () => {
        const signed = sign(authnRequest(), '_orig', {
          signatureAlgorithm: RSA_SHA1,
          digestAlgorithm: SHA1,
        });
        expect(bareXmlCryptoAccepts(signed)).toBe(true);

        await expect(
          service.receiveAuthnRequest(REALM, post(signed)),
        ).rejects.toThrow(SIG_FAILED);
      });

      it('refuses RSA-SHA256 over a SHA-1 digest', async () => {
        const signed = sign(authnRequest(), '_orig', {
          digestAlgorithm: SHA1,
        });
        expect(bareXmlCryptoAccepts(signed)).toBe(true);

        await expect(
          service.receiveAuthnRequest(REALM, post(signed)),
        ).rejects.toThrow(SIG_FAILED);
      });

      it('accepts RSA-SHA512', async () => {
        const signed = sign(authnRequest(), '_orig', {
          signatureAlgorithm:
            'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
          digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha512',
        });
        await expect(
          service.receiveAuthnRequest(REALM, post(signed)),
        ).resolves.toMatchObject({ signed: true });
      });
    });
  });

  // ─── HTTP-Redirect: query-string signature ────────────

  describe('HTTP-Redirect binding (query-string signature)', () => {
    /**
     * Builds the query string as an SP does. `relayStateRaw` is put in the
     * URL as given (already encoded), the way the SP's own encoder wrote it.
     */
    const redirectQuery = (
      o: {
        xml?: string;
        relayStateRaw?: string;
        sigAlg?: string;
        digest?: string;
        key?: string;
      } = {},
    ) => {
      const samlRequest = encodeURIComponent(
        deflateRawSync(Buffer.from(o.xml ?? authnRequest())).toString('base64'),
      );
      let octets = `SAMLRequest=${samlRequest}`;
      if (o.relayStateRaw !== undefined) {
        octets += `&RelayState=${o.relayStateRaw}`;
      }
      octets += `&SigAlg=${encodeURIComponent(o.sigAlg ?? RSA_SHA256)}`;
      const signature = cryptoSign(
        o.digest ?? 'sha256',
        Buffer.from(octets, 'utf-8'),
        o.key ?? keys.privateKey,
      ).toString('base64');
      return `${octets}&Signature=${encodeURIComponent(signature)}`;
    };
    const redirect = (rawQuery: string) => ({
      binding: 'redirect' as const,
      query: parseRedirectQuery(rawQuery),
    });

    it('accepts a valid signature over the raw query bytes, RelayState from those bytes', async () => {
      // An SP's encoder that writes lowercase hex and "+" for spaces:
      // re-encoding the decoded value would give different bytes.
      const qs = redirectQuery({ relayStateRaw: 'a%2fb+c%3Fd' });
      const accepted = await service.receiveAuthnRequest(REALM, redirect(qs));
      expect(accepted.signed).toBe(true);
      expect(accepted.relayState).toBe('a/b c?d');
      expect(accepted.request.id).toBe('_orig');
    });

    it('accepts the parameters in any order', async () => {
      const qs = redirectQuery({ relayStateRaw: 'rs' });
      const params = qs.split('&').reverse().join('&');
      await expect(
        service.receiveAuthnRequest(REALM, redirect(params)),
      ).resolves.toMatchObject({ relayState: 'rs' });
    });

    it('refuses a tampered RelayState', async () => {
      const qs = redirectQuery({ relayStateRaw: 'rs-good' }).replace(
        'RelayState=rs-good',
        'RelayState=rs-evil',
      );
      await expect(
        service.receiveAuthnRequest(REALM, redirect(qs)),
      ).rejects.toThrow(SIG_FAILED);
    });

    it('refuses an added RelayState', async () => {
      const qs = `${redirectQuery()}&RelayState=added`;
      await expect(
        service.receiveAuthnRequest(REALM, redirect(qs)),
      ).rejects.toThrow(SIG_FAILED);
    });

    it('refuses a RelayState that differs only in its encoding', async () => {
      const qs = redirectQuery({ relayStateRaw: 'a%2fb' }).replace(
        'RelayState=a%2fb',
        'RelayState=a%2Fb',
      );
      await expect(
        service.receiveAuthnRequest(REALM, redirect(qs)),
      ).rejects.toThrow(SIG_FAILED);
    });

    it('refuses a swapped SAMLRequest', async () => {
      const qs = redirectQuery();
      const other = encodeURIComponent(
        deflateRawSync(
          Buffer.from(authnRequest({ id: '_other', acs: OTHER_ACS })),
        ).toString('base64'),
      );
      const swapped = qs.replace(/SAMLRequest=[^&]*/, `SAMLRequest=${other}`);
      await expect(
        service.receiveAuthnRequest(REALM, redirect(swapped)),
      ).rejects.toThrow(SIG_FAILED);
    });

    it('refuses a request without a signature', async () => {
      const qs = redirectQuery().replace(/&Signature=[^&]*/, '');
      await expect(
        service.receiveAuthnRequest(REALM, redirect(qs)),
      ).rejects.toThrow(NOT_SIGNED);
    });

    it('refuses a signature made with another key', async () => {
      const qs = redirectQuery({ key: otherKeys.privateKey });
      await expect(
        service.receiveAuthnRequest(REALM, redirect(qs)),
      ).rejects.toThrow(SIG_FAILED);
    });

    it('refuses RSA-SHA1', async () => {
      const qs = redirectQuery({ sigAlg: RSA_SHA1, digest: 'sha1' });
      await expect(
        service.receiveAuthnRequest(REALM, redirect(qs)),
      ).rejects.toThrow(SIG_FAILED);
    });

    it('refuses a parameter that appears twice', () => {
      const qs = redirectQuery();
      expect(() => parseRedirectQuery(`${qs}&SAMLRequest=x`)).toThrow();
      expect(() => parseRedirectQuery(`${qs}&SigAlg=x`)).toThrow();
    });

    it('refuses an XML signature inside a Redirect-binding request', async () => {
      const qs = redirectQuery({ xml: sign(authnRequest(), '_orig') });
      await expect(
        service.receiveAuthnRequest(REALM, redirect(qs)),
      ).rejects.toThrow(new BadRequestException('Invalid SAMLRequest'));
    });

    it('accepts an unsigned request when the SP has no certificate', async () => {
      sp.certificate = null;
      const samlRequest = encodeURIComponent(
        deflateRawSync(Buffer.from(authnRequest())).toString('base64'),
      );
      await expect(
        service.receiveAuthnRequest(
          REALM,
          redirect(`SAMLRequest=${samlRequest}&RelayState=x+y`),
        ),
      ).resolves.toMatchObject({ signed: false, relayState: 'x y' });
    });
  });

  // ─── IssueInstant and Destination ─────────────────────

  describe('IssueInstant and Destination', () => {
    const unsigned = (o: RequestOptions) => {
      sp.certificate = null;
      return service.receiveAuthnRequest(REALM, post(authnRequest(o)));
    };
    const at = (offsetSeconds: number) =>
      new Date(Date.now() + offsetSeconds * 1000).toISOString();

    it('refuses a request issued more than the maximum age (plus skew) ago', async () => {
      await expect(unsigned({ issueInstant: at(-9 * 60) })).rejects.toThrow(
        new BadRequestException('AuthnRequest has expired or is not yet valid'),
      );
    });

    it('refuses a request issued beyond the clock skew in the future', async () => {
      await expect(unsigned({ issueInstant: at(4 * 60) })).rejects.toThrow(
        new BadRequestException('AuthnRequest has expired or is not yet valid'),
      );
    });

    it('accepts a request within the window and the skew', async () => {
      await expect(
        unsigned({ issueInstant: at(-7 * 60) }),
      ).resolves.toBeTruthy();
      await expect(
        unsigned({ issueInstant: at(2 * 60) }),
      ).resolves.toBeTruthy();
    });

    it('follows SAML_REQUEST_MAX_AGE_SECONDS and SAML_CLOCK_SKEW_SECONDS', async () => {
      process.env['SAML_REQUEST_MAX_AGE_SECONDS'] = '60';
      process.env['SAML_CLOCK_SKEW_SECONDS'] = '0';
      await expect(unsigned({ issueInstant: at(-90) })).rejects.toThrow(
        BadRequestException,
      );
      await expect(unsigned({ issueInstant: at(-30) })).resolves.toBeTruthy();
    });

    it('refuses a request without IssueInstant, or with a malformed one', async () => {
      const invalid = new BadRequestException(
        'AuthnRequest IssueInstant is missing or invalid',
      );
      await expect(unsigned({ issueInstant: null })).rejects.toThrow(invalid);
      await expect(unsigned({ issueInstant: 'yesterday' })).rejects.toThrow(
        invalid,
      );
    });

    it('refuses a Destination other than this endpoint', async () => {
      await expect(
        unsigned({
          destination: 'https://other-idp.example.com/realms/x/protocol/saml',
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'AuthnRequest Destination does not match this endpoint',
        ),
      );
    });

    it('accepts the Location the metadata publishes, whatever BASE_URL looks like', async () => {
      process.env['BASE_URL'] = 'https://idp.example.com/';
      const metadata = await new SamlMetadataService(
        lookupsBackedBy(prisma as any) as any,
      ).generateMetadata(REALM, process.env['BASE_URL']);
      const location = /Location="([^"]+)"/.exec(metadata)?.[1];
      expect(location).toBe(
        'https://idp.example.com//realms/test-realm/protocol/saml',
      );
      await expect(unsigned({ destination: location })).resolves.toBeTruthy();
    });

    it('accepts this endpoint as Destination, and no Destination', async () => {
      await expect(unsigned({ destination: ENDPOINT })).resolves.toBeTruthy();
      await expect(unsigned({})).resolves.toBeTruthy();
    });
  });

  // ─── Replay ───────────────────────────────────────────

  describe('claimRequestId', () => {
    const request = (issueInstant: string) => ({
      id: '_req-1',
      issuer: SP_ENTITY,
      issueInstant,
      destination: null,
      acsUrl: null,
      protocolBinding: null,
      nameIdPolicy: null,
      forceAuthn: false,
      isPassive: false,
      requestedAuthnContext: null,
    });
    const duplicate = Object.assign(new Error('unique'), { code: 'P2002' });

    it('records the ID until the request could no longer pass the time check', async () => {
      const issued = new Date('2026-11-16T10:00:00.000Z');
      prisma.samlRequestId.create.mockResolvedValue({});
      await service.claimRequestId(sp, request(issued.toISOString()));
      expect(prisma.samlRequestId.create).toHaveBeenCalledWith({
        data: {
          spId: sp.id,
          requestId: '_req-1',
          // 300 s maximum age + 180 s skew.
          expiresAt: new Date(issued.getTime() + 480_000),
        },
      });
    });

    it('refuses an ID already used', async () => {
      prisma.samlRequestId.create.mockRejectedValue(duplicate);
      prisma.samlRequestId.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.claimRequestId(sp, request(new Date().toISOString())),
      ).rejects.toThrow(
        new BadRequestException('AuthnRequest has already been used'),
      );
    });

    it('takes over a record whose window has passed', async () => {
      prisma.samlRequestId.create.mockRejectedValue(duplicate);
      prisma.samlRequestId.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        service.claimRequestId(sp, request(new Date().toISOString())),
      ).resolves.toBeUndefined();
      expect(prisma.samlRequestId.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            spId: sp.id,
            requestId: '_req-1',
            expiresAt: { lte: expect.any(Date) },
          }),
        }),
      );
    });

    it('passes on any other database error', async () => {
      prisma.samlRequestId.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.claimRequestId(sp, request(new Date().toISOString())),
      ).rejects.toThrow('db down');
    });
  });

  describe('cleanupExpiredRequestIds', () => {
    it('deletes expired IDs on the leader', async () => {
      prisma.samlRequestId.deleteMany.mockResolvedValue({ count: 2 });
      await service.cleanupExpiredRequestIds();
      expect(prisma.samlRequestId.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('does nothing on another process', async () => {
      leader.isLeader.mockReturnValue(false);
      await service.cleanupExpiredRequestIds();
      expect(prisma.samlRequestId.deleteMany).not.toHaveBeenCalled();
    });
  });
});
