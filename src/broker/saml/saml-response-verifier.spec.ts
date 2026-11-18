import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import {
  SamlResponseError,
  SamlStatusError,
  decodeSamlResponse,
  verifySamlResponse,
  type SamlResponseExpectations,
} from './saml-response-verifier.js';
import {
  PERSISTENT,
  assertionXml,
  encodeResponse,
  makeFakeIdp,
  newId,
  responseXml,
  signElement,
  type FakeIdp,
  type FakeResponseOptions,
} from './__mocks__/fake-saml-idp.js';

/**
 * Every rule of the ACS's response verification, each with a response that
 * breaks it, signed for real by keys made here. Where an attack keeps a
 * cryptographically valid signature (signature wrapping), the test shows
 * a bare xml-crypto check would accept it: what refuses it is the
 * verifier's own guard.
 */

const SP_ENTITY = 'https://iam.example.com/realms/r/broker/okta/saml/metadata';
const ACS = 'https://iam.example.com/realms/r/broker/okta/saml/acs';
const REQUEST_ID = '_request-1';

let idp: FakeIdp;
let otherIdp: FakeIdp;
let rolledIdp: FakeIdp;

beforeAll(async () => {
  idp = await makeFakeIdp();
  otherIdp = await makeFakeIdp();
  rolledIdp = await makeFakeIdp();
});

const expect_ = (
  over: Partial<SamlResponseExpectations> = {},
): SamlResponseExpectations => ({
  idpEntityId: idp.entityId,
  spEntityId: SP_ENTITY,
  acsUrl: ACS,
  requestId: REQUEST_ID,
  certificates: [idp.certificatePem],
  wantAssertionsSigned: true,
  wantResponseSigned: false,
  allowSha1: false,
  clockSkewSeconds: 60,
  nameIdFormat: PERSISTENT,
  ...over,
});

const response = (over: Partial<FakeResponseOptions> = {}) =>
  responseXml({
    idp,
    spEntityId: SP_ENTITY,
    acsUrl: ACS,
    requestId: REQUEST_ID,
    attributes: {
      email: ['jane@example.com'],
      firstName: ['Jane'],
    },
    ...over,
  });

/** The verifier's refusal reason (the logged one). */
function refusal(xml: string, exp = expect_()): string {
  try {
    verifySamlResponse(xml, exp);
  } catch (err) {
    expect(err).toBeInstanceOf(SamlResponseError);
    return (err as SamlResponseError).reason;
  }
  throw new Error('the response was accepted');
}

/** A bare xml-crypto check of the first Signature in `xml`. */
function bareXmlCryptoAccepts(xml: string, certificatePem: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const signature = doc.getElementsByTagNameNS(
    'http://www.w3.org/2000/09/xmldsig#',
    'Signature',
  )[0];
  const sig = new SignedXml({ publicCert: certificatePem });
  sig.loadSignature(signature);
  try {
    return sig.checkSignature(xml);
  } catch {
    return false;
  }
}

describe('verifySamlResponse', () => {
  describe('accepts', () => {
    it('a response whose assertion is signed, read from the signed bytes', () => {
      const result = verifySamlResponse(response(), expect_());
      expect(result.nameId).toBe('user-123');
      expect(result.issuer).toBe(idp.entityId);
      expect(result.attributes['email']).toEqual(['jane@example.com']);
      expect(result.signed).toEqual({ response: false, assertion: true });
    });

    it('a response signed only on the Response, when assertions need not be signed', () => {
      const xml = response({ signAssertion: false, signResponse: true });
      const result = verifySamlResponse(
        xml,
        expect_({ wantAssertionsSigned: false, wantResponseSigned: true }),
      );
      expect(result.signed).toEqual({ response: true, assertion: false });
    });

    it('a response with both the Response and the Assertion signed', () => {
      const xml = response({ signResponse: true });
      const result = verifySamlResponse(
        xml,
        expect_({ wantResponseSigned: true }),
      );
      expect(result.signed).toEqual({ response: true, assertion: true });
    });

    it('a signature by any configured certificate (rollover)', () => {
      const xml = response({ signingKeyPem: rolledIdp.privateKeyPem });
      expect(() =>
        verifySamlResponse(
          xml,
          expect_({
            certificates: [idp.certificatePem, rolledIdp.certificatePem],
          }),
        ),
      ).not.toThrow();
    });

    it('times off by less than the allowed clock skew', () => {
      const now = Date.now();
      const xml = response({
        notBefore: new Date(now + 30_000),
        issueInstant: new Date(now + 30_000),
      });
      expect(() =>
        verifySamlResponse(xml, expect_({ clockSkewSeconds: 60 })),
      ).not.toThrow();
    });

    it('SHA-1 signatures only when explicitly allowed', () => {
      const xml = response({ sha1: true });
      expect(() =>
        verifySamlResponse(xml, expect_({ allowSha1: true })),
      ).not.toThrow();
    });
  });

  describe('Issuer, Audience, Destination, Recipient', () => {
    it('refuses an assertion from another issuer', () => {
      expect(refusal(response({ issuer: 'https://evil.example' }))).toMatch(
        /Assertion Issuer .* is not the identity provider/,
      );
    });

    it('refuses a Response Issuer that is not the IdP', () => {
      expect(
        refusal(response({ responseIssuer: 'https://evil.example' })),
      ).toMatch(/Response Issuer .* is not the identity provider/);
    });

    it('refuses an assertion for another audience', () => {
      expect(
        refusal(response({ audience: 'https://other-sp.example/metadata' })),
      ).toMatch(/the assertion is for .*, not/);
    });

    it('refuses a response for another destination', () => {
      expect(
        refusal(response({ destination: 'https://other-sp.example/acs' })),
      ).toMatch(/Destination .* is not/);
    });

    it('refuses a response without a Destination', () => {
      expect(refusal(response({ destination: null }))).toMatch(
        /Destination "" is not|Destination null|Destination/,
      );
    });

    it('refuses a bearer confirmation for another recipient', () => {
      expect(
        refusal(response({ recipient: 'https://other-sp.example/acs' })),
      ).toMatch(/Recipient .* is not/);
    });
  });

  describe('time', () => {
    it('refuses an expired assertion (Conditions NotOnOrAfter)', () => {
      const past = new Date(Date.now() - 10 * 60_000);
      expect(
        refusal(
          response({
            issueInstant: new Date(Date.now() - 20 * 60_000),
            notOnOrAfter: past,
          }),
        ),
      ).toMatch(/the assertion has expired/);
    });

    it('refuses an expired subject confirmation', () => {
      expect(
        refusal(
          response({
            confirmationNotOnOrAfter: new Date(Date.now() - 5 * 60_000),
          }),
        ),
      ).toMatch(/subject confirmation has expired/);
    });

    it('refuses an assertion not yet valid (beyond the skew)', () => {
      expect(
        refusal(response({ notBefore: new Date(Date.now() + 10 * 60_000) })),
      ).toMatch(/not yet valid/);
    });

    it('refuses a response issued in the future (beyond the skew)', () => {
      expect(
        refusal(response({ issueInstant: new Date(Date.now() + 10 * 60_000) })),
      ).toMatch(/issued in the future/);
    });
  });

  describe('InResponseTo', () => {
    it('refuses a response to another request', () => {
      expect(
        refusal(
          response({
            inResponseTo: '_other-request',
            confirmationInResponseTo: '_other-request',
          }),
        ),
      ).toMatch(/InResponseTo .* is not the request/);
    });

    it('refuses a signed assertion confirming another request, even if the unsigned Response names ours', () => {
      expect(
        refusal(response({ confirmationInResponseTo: '_other-request' })),
      ).toMatch(/SubjectConfirmationData InResponseTo/);
    });

    it('refuses an unsolicited (IdP-initiated) response', () => {
      expect(refusal(response({ inResponseTo: null }))).toMatch(
        /no InResponseTo/,
      );
    });
  });

  describe('signatures', () => {
    it('refuses an unsigned assertion when signed assertions are required', () => {
      const xml = response({ signAssertion: false, signResponse: true });
      expect(refusal(xml)).toMatch(/Assertion is not signed/);
    });

    it('refuses an unsigned Response when a signed Response is required', () => {
      expect(
        refusal(response(), expect_({ wantResponseSigned: true })),
      ).toMatch(/Response is not signed/);
    });

    it('refuses a response with no signature at all, whatever the settings', () => {
      const xml = response({ signAssertion: false });
      expect(
        refusal(
          xml,
          expect_({ wantAssertionsSigned: false, wantResponseSigned: false }),
        ),
      ).toMatch(/neither the Response nor the Assertion is signed/);
    });

    it('refuses a signature by a certificate that is not configured', () => {
      const xml = response({ signingKeyPem: otherIdp.privateKeyPem });
      expect(refusal(xml)).toMatch(/does not verify with any configured/);
    });

    it('refuses a Response signature by another key even when the assertion is signed correctly', () => {
      // Response signed by an attacker, assertion by the IdP.
      const assertionId = newId();
      const responseId = newId();
      let assertion = assertionXml({
        idp,
        spEntityId: SP_ENTITY,
        acsUrl: ACS,
        requestId: REQUEST_ID,
        assertionId,
      });
      assertion = signElement(assertion, assertionId, idp.privateKeyPem);
      const unsigned =
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${responseId}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${ACS}" InResponseTo="${REQUEST_ID}">` +
        `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${idp.entityId}</saml:Issuer>` +
        `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
        assertion +
        `</samlp:Response>`;
      const xml = signElement(unsigned, responseId, otherIdp.privateKeyPem);
      expect(refusal(xml)).toMatch(/Response signature does not verify/);
    });

    it('refuses a signed assertion whose content was changed', () => {
      const xml = response().replace('user-123', 'admin');
      expect(refusal(xml)).toMatch(/does not verify/);
    });

    it('ignores a certificate in KeyInfo: only configured certificates count', () => {
      // The attacker signs with their own key; xml-crypto puts their
      // certificate in KeyInfo. It must not be used.
      const xml = response({ signingKeyPem: otherIdp.privateKeyPem });
      expect(refusal(xml)).toMatch(/does not verify/);
    });
  });

  describe('SHA-1', () => {
    it('refuses an RSA-SHA1 signature unless allowed', () => {
      const xml = response({ sha1: true });
      try {
        verifySamlResponse(xml, expect_());
        throw new Error('accepted');
      } catch (err) {
        expect(err).toBeInstanceOf(SamlResponseError);
        expect((err as SamlResponseError).reason).toMatch(
          /signature algorithm .*rsa-sha1.* is not allowed/,
        );
        expect((err as SamlResponseError).publicMessage).toMatch(/SHA-1/);
      }
    });

    it('refuses an HMAC signature algorithm (public key as HMAC secret)', () => {
      const xml = response().replace(
        'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        'http://www.w3.org/2000/09/xmldsig#hmac-sha1',
      );
      expect(refusal(xml)).toMatch(/hmac-sha1.* is not allowed/);
    });
  });

  describe('XML signature wrapping (XSW)', () => {
    it('refuses an evil assertion presented with the signed one hidden in Extensions', () => {
      const good = response();
      const doc = new DOMParser().parseFromString(good, 'text/xml');
      const root = doc.documentElement;
      const signedAssertion = root.getElementsByTagNameNS(
        'urn:oasis:names:tc:SAML:2.0:assertion',
        'Assertion',
      )[0];
      // Move the signed assertion into samlp:Extensions...
      const ext = doc.createElementNS(
        'urn:oasis:names:tc:SAML:2.0:protocol',
        'samlp:Extensions',
      );
      root.removeChild(signedAssertion);
      ext.appendChild(signedAssertion);
      const status = root.getElementsByTagNameNS(
        'urn:oasis:names:tc:SAML:2.0:protocol',
        'Status',
      )[0];
      root.insertBefore(ext, status);
      // ...and present an unsigned one naming the attacker's choice.
      const evil = new DOMParser().parseFromString(
        assertionXml({
          idp,
          spEntityId: SP_ENTITY,
          acsUrl: ACS,
          requestId: REQUEST_ID,
          assertionId: newId(),
          nameId: 'admin',
        }),
        'text/xml',
      ).documentElement;
      root.appendChild(doc.importNode(evil, true));
      const wrapped = new XMLSerializer().serializeToString(doc);
      // The signature itself is still valid:
      expect(bareXmlCryptoAccepts(wrapped, idp.certificatePem)).toBe(true);
      expect(refusal(wrapped)).toMatch(
        /signature on an element other than the Response or the Assertion/,
      );
    });

    it('refuses an evil assertion carrying a signature that references the hidden signed one', () => {
      // XSW variant: the presented assertion has a Signature moved from the
      // genuine assertion (which now sits in Advice), its Reference still
      // pointing at the genuine one.
      const goodId = newId();
      const good = signElement(
        assertionXml({
          idp,
          spEntityId: SP_ENTITY,
          acsUrl: ACS,
          requestId: REQUEST_ID,
          assertionId: goodId,
        }),
        goodId,
        idp.privateKeyPem,
      );
      const goodDoc = new DOMParser().parseFromString(good, 'text/xml');
      const sigEl = goodDoc.getElementsByTagNameNS(
        'http://www.w3.org/2000/09/xmldsig#',
        'Signature',
      )[0];
      goodDoc.documentElement.removeChild(sigEl);
      const goodNoSig = new XMLSerializer().serializeToString(goodDoc);
      const evilId = newId();
      const evil = assertionXml({
        idp,
        spEntityId: SP_ENTITY,
        acsUrl: ACS,
        requestId: REQUEST_ID,
        assertionId: evilId,
        nameId: 'admin',
      });
      const evilDoc = new DOMParser().parseFromString(evil, 'text/xml');
      const issuer = evilDoc.getElementsByTagNameNS(
        'urn:oasis:names:tc:SAML:2.0:assertion',
        'Issuer',
      )[0];
      evilDoc.documentElement.insertBefore(
        evilDoc.importNode(sigEl, true),
        issuer.nextSibling,
      );
      const conditions = evilDoc.getElementsByTagNameNS(
        'urn:oasis:names:tc:SAML:2.0:assertion',
        'Conditions',
      )[0];
      const advice = evilDoc.createElementNS(
        'urn:oasis:names:tc:SAML:2.0:assertion',
        'saml:Advice',
      );
      advice.appendChild(
        evilDoc.importNode(
          new DOMParser().parseFromString(goodNoSig, 'text/xml')
            .documentElement,
          true,
        ),
      );
      conditions.parentNode!.insertBefore(advice, conditions.nextSibling);
      const wrappedAssertion = new XMLSerializer().serializeToString(evilDoc);
      const wrapped =
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${newId()}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${ACS}" InResponseTo="${REQUEST_ID}">` +
        `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
        wrappedAssertion +
        `</samlp:Response>`;
      expect(bareXmlCryptoAccepts(wrapped, idp.certificatePem)).toBe(true);
      expect(refusal(wrapped)).toMatch(/references .*, not the Assertion/);
    });

    it('refuses a second assertion next to the signed one', () => {
      const good = response({ signAssertion: false, signResponse: true });
      const extra = assertionXml({
        idp,
        spEntityId: SP_ENTITY,
        acsUrl: ACS,
        requestId: REQUEST_ID,
        assertionId: newId(),
        nameId: 'admin',
      });
      const wrapped = good.replace(
        '</samlp:Response>',
        `${extra}</samlp:Response>`,
      );
      expect(
        refusal(
          wrapped,
          expect_({ wantAssertionsSigned: false, wantResponseSigned: true }),
        ),
      ).toMatch(/"Assertion" is repeated in Response/);
    });

    it('refuses a duplicated ID (the signed and the presented element sharing it)', () => {
      const good = response();
      const id = /<saml:Assertion [^>]*ID="([^"]+)"/.exec(good)![1];
      const evil = assertionXml({
        idp,
        spEntityId: SP_ENTITY,
        acsUrl: ACS,
        requestId: REQUEST_ID,
        assertionId: id,
        nameId: 'admin',
      });
      const wrapped = good.replace(
        '<samlp:Status>',
        `<samlp:Extensions>${evil}</samlp:Extensions><samlp:Status>`,
      );
      expect(refusal(wrapped)).toMatch(/is used more than once/);
    });
  });

  describe('other refusals', () => {
    it('refuses an encrypted assertion with a clear message', () => {
      const xml = response().replace(
        /<saml:Assertion [\s\S]*<\/saml:Assertion>/,
        '<saml:EncryptedAssertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"><xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#"/></saml:EncryptedAssertion>',
      );
      try {
        verifySamlResponse(xml, expect_());
        throw new Error('accepted');
      } catch (err) {
        expect((err as SamlResponseError).publicMessage).toMatch(
          /does not support encrypted assertions/,
        );
      }
    });

    it('reports a non-Success status as a status error', () => {
      const xml = response({
        status: 'urn:oasis:names:tc:SAML:2.0:status:Responder',
        signAssertion: false,
      });
      expect(() => verifySamlResponse(xml, expect_())).toThrow(SamlStatusError);
    });

    it('refuses a DTD (no XXE)', () => {
      const xml =
        '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
        response();
      expect(refusal(xml)).toMatch(/DTD/);
    });

    it('refuses comments (NameID comment truncation)', () => {
      const xml = response({ nameId: 'user-123' }).replace(
        'user-123</saml:NameID>',
        'user<!---->-123</saml:NameID>',
      );
      expect(refusal(xml)).toMatch(/comment/);
    });

    it('refuses a NameID in another format than configured', () => {
      const xml = response({
        nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      });
      expect(refusal(xml)).toMatch(/NameID Format .* is not the configured/);
    });

    it('refuses an assertion without an AudienceRestriction', () => {
      expect(refusal(response({ audience: null }))).toMatch(
        /Conditions has no AudienceRestriction/,
      );
    });

    it('refuses a SAMLResponse that is not base64', () => {
      expect(() => decodeSamlResponse('<xml/>')).toThrow(SamlResponseError);
      expect(() => decodeSamlResponse(undefined)).toThrow(SamlResponseError);
    });

    it('decodes base64 with line breaks', () => {
      const xml = '<a/>';
      const b64 = encodeResponse(xml);
      expect(decodeSamlResponse(`${b64}\r\n`)).toBe(xml);
    });
  });
});
