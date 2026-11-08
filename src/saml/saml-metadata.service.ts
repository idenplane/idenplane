import { Injectable } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { CachedLookupsService } from '../cache/cached-lookups.service.js';

@Injectable()
export class SamlMetadataService {
  constructor(private readonly lookups: CachedLookupsService) {}

  async generateMetadata(realm: Realm, baseUrl: string): Promise<string> {
    const signingKey = await this.lookups.activeSigningKey(realm.id);

    const entityId = `${baseUrl}/realms/${realm.name}`;
    const ssoUrl = `${baseUrl}/realms/${realm.name}/protocol/saml`;

    // Extract PEM body (strip header/footer and whitespace) for the certificate
    let certBody = '';
    if (signingKey) {
      certBody = signingKey.publicKey
        .replace(/-----BEGIN [A-Z ]+-----/g, '')
        .replace(/-----END [A-Z ]+-----/g, '')
        .replace(/\s+/g, '');
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor
  xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${this.escapeXml(entityId)}">
  <IDPSSODescriptor
    WantAuthnRequestsSigned="false"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${certBody}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </KeyDescriptor>
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</NameIDFormat>
    <NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:transient</NameIDFormat>
    <SingleSignOnService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${this.escapeXml(ssoUrl)}" />
    <SingleSignOnService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="${this.escapeXml(ssoUrl)}" />
  </IDPSSODescriptor>
</EntityDescriptor>`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
