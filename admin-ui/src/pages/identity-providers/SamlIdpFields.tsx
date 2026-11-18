import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { readSamlMetadata } from '../../api/identityProviders';
import type { SamlSpEndpoints } from '../../types';
import { NAMEID_FORMATS, applyMetadata, type SamlForm } from './samlForm';

const INPUT =
  'w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none';
const LABEL = 'mb-1.5 block text-sm font-medium text-muted';
const CHECKBOX = 'h-4 w-4 rounded border-line-strong text-accent focus:ring-accent';

interface Props {
  realmName: string;
  form: SamlForm;
  onChange: (form: SamlForm) => void;
  /** What to register at the IdP. */
  sp: SamlSpEndpoints;
  /** True before the provider is saved: the SP values are a preview. */
  preview?: boolean;
  disabled?: boolean;
}

function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          readOnly
          value={value}
          className="w-full rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs text-muted"
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
          className="rounded-md border border-line-strong px-3 py-2 text-sm font-medium text-muted hover:bg-hover"
          aria-label={`Copy ${label}`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * The SAML 2.0 settings of an identity provider: what to give the IdP
 * (Idenplane's SP metadata URL, entity ID and ACS URL), an IdP-metadata
 * import box, and the settings themselves.
 */
export default function SamlIdpFields({
  realmName,
  form,
  onChange,
  sp,
  preview,
  disabled,
}: Props) {
  const [metadataXml, setMetadataXml] = useState('');
  const [metadataUrl, setMetadataUrl] = useState('');
  const set = <K extends keyof SamlForm>(key: K, value: SamlForm[K]) =>
    onChange({ ...form, [key]: value });

  const importMutation = useMutation({
    mutationFn: () =>
      readSamlMetadata(
        realmName,
        metadataXml.trim() ? { xml: metadataXml } : { url: metadataUrl.trim() },
      ),
    onSuccess: (fields) => onChange(applyMetadata(form, fields)),
  });

  return (
    <div className="space-y-6">
      {/* What the IdP needs */}
      <div className="space-y-3 rounded-md border border-line bg-sunken/40 p-4">
        <h3 className="text-sm font-semibold text-fg">Register Idenplane at your identity provider</h3>
        <p className="text-xs text-subtle">
          Give the IdP this SP metadata URL, or the entity ID and ACS URL below.
          {preview && ' Shown for this console’s address; the saved provider shows the server’s values.'}
        </p>
        <CopyField id="saml-sp-metadata" label="SP metadata URL" value={sp.metadataUrl} />
        <div className="grid grid-cols-2 gap-4">
          <CopyField id="saml-sp-entity" label="SP entity ID (audience)" value={sp.entityId} />
          <CopyField id="saml-sp-acs" label="ACS URL (reply URL)" value={sp.acsUrl} />
        </div>
      </div>

      {/* Metadata import */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Import IdP metadata</h3>
        <div>
          <label htmlFor="saml-metadata-xml" className={LABEL}>
            Metadata XML
          </label>
          <textarea
            id="saml-metadata-xml"
            rows={4}
            value={metadataXml}
            onChange={(e) => setMetadataXml(e.target.value)}
            placeholder="<EntityDescriptor …>"
            className={`${INPUT} font-mono text-xs`}
            disabled={disabled}
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="saml-metadata-url" className={LABEL}>
              …or metadata URL
            </label>
            <input
              id="saml-metadata-url"
              type="url"
              value={metadataUrl}
              onChange={(e) => setMetadataUrl(e.target.value)}
              placeholder="https://login.microsoftonline.com/…/federationmetadata.xml"
              className={INPUT}
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            disabled={disabled || importMutation.isPending || (!metadataXml.trim() && !metadataUrl.trim())}
            onClick={() => importMutation.mutate()}
            className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-hover disabled:opacity-50"
          >
            {importMutation.isPending ? 'Reading…' : 'Import metadata'}
          </button>
        </div>
        {importMutation.isSuccess && (
          <p className="text-xs text-success-fg">Filled from the metadata. Review the settings below, then save.</p>
        )}
        {importMutation.isError && (
          <p role="alert" className="text-xs text-danger-fg">
            {(importMutation.error as Error)?.message || 'The metadata could not be read.'}
          </p>
        )}
      </div>

      {/* IdP settings */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-fg">Identity provider</h3>
        <div>
          <label htmlFor="saml-entityId" className={LABEL}>
            IdP entity ID *
          </label>
          <input
            id="saml-entityId"
            type="text"
            required
            value={form.entityId}
            onChange={(e) => set('entityId', e.target.value)}
            className={INPUT}
            disabled={disabled}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label htmlFor="saml-ssoUrl" className={LABEL}>
              SSO URL *
            </label>
            <input
              id="saml-ssoUrl"
              type="url"
              required
              value={form.ssoUrl}
              onChange={(e) => set('ssoUrl', e.target.value)}
              className={INPUT}
              disabled={disabled}
            />
          </div>
          <div>
            <label htmlFor="saml-ssoBinding" className={LABEL}>
              Request binding
            </label>
            <select
              id="saml-ssoBinding"
              value={form.ssoBinding}
              onChange={(e) => set('ssoBinding', e.target.value as SamlForm['ssoBinding'])}
              className={INPUT}
              disabled={disabled}
            >
              <option value="redirect">HTTP-Redirect</option>
              <option value="post">HTTP-POST</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="saml-certificates" className={LABEL}>
            IdP signing certificates *
          </label>
          <textarea
            id="saml-certificates"
            rows={5}
            required
            value={form.certificates}
            onChange={(e) => set('certificates', e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----…"
            className={`${INPUT} font-mono text-xs`}
            disabled={disabled}
          />
          <p className="mt-1 text-xs text-subtle">
            PEM, one after another. Add the IdP’s next certificate here before it rolls over: a signature by any listed certificate is accepted.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="saml-nameIdFormat" className={LABEL}>
              NameID format
            </label>
            <select
              id="saml-nameIdFormat"
              value={form.nameIdFormat}
              onChange={(e) => set('nameIdFormat', e.target.value)}
              className={INPUT}
              disabled={disabled}
            >
              {NAMEID_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="saml-clockSkew" className={LABEL}>
              Allowed clock skew (seconds)
            </label>
            <input
              id="saml-clockSkew"
              type="number"
              min={0}
              max={600}
              value={form.clockSkewSeconds}
              onChange={(e) => set('clockSkewSeconds', e.target.value)}
              className={INPUT}
              disabled={disabled}
            />
          </div>
        </div>
        <div>
          <label htmlFor="saml-sloUrl" className={LABEL}>
            Single logout URL
          </label>
          <input
            id="saml-sloUrl"
            type="url"
            value={form.sloUrl}
            onChange={(e) => set('sloUrl', e.target.value)}
            className={INPUT}
            disabled={disabled}
          />
          <p className="mt-1 text-xs text-subtle">Stored only: SAML single logout is not supported yet.</p>
        </div>
      </div>

      {/* Signatures */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">Signatures</h3>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.wantAssertionsSigned}
            onChange={(e) => set('wantAssertionsSigned', e.target.checked)}
            className={CHECKBOX}
            disabled={disabled}
          />
          <span className="text-sm text-muted">Require signed assertions</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.wantResponseSigned}
            onChange={(e) => set('wantResponseSigned', e.target.checked)}
            className={CHECKBOX}
            disabled={disabled}
          />
          <span className="text-sm text-muted">Require signed responses</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.signAuthnRequests}
            onChange={(e) => set('signAuthnRequests', e.target.checked)}
            className={CHECKBOX}
            disabled={disabled}
          />
          <span className="text-sm text-muted">Sign authentication requests (with the realm’s signing key)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.allowSha1}
            onChange={(e) => set('allowSha1', e.target.checked)}
            className={CHECKBOX}
            disabled={disabled}
          />
          <span className="text-sm text-muted">Accept SHA-1 signatures (not recommended)</span>
        </label>
        <p className="text-xs text-subtle">
          Whatever is chosen, a response is only accepted when a valid signature by a listed certificate covers the assertion. Encrypted assertions are not supported.
        </p>
      </div>

      {/* Mapping */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-fg">User mapping</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="saml-subjectAttribute" className={LABEL}>
              Subject attribute
            </label>
            <input
              id="saml-subjectAttribute"
              type="text"
              value={form.subjectAttribute}
              onChange={(e) => set('subjectAttribute', e.target.value)}
              placeholder="NameID"
              className={INPUT}
              disabled={disabled}
            />
            <p className="mt-1 text-xs text-subtle">The attribute that identifies the user; empty uses the NameID.</p>
          </div>
          <div>
            <label htmlFor="saml-usernameSource" className={LABEL}>
              Username from
            </label>
            <select
              id="saml-usernameSource"
              value={form.usernameSource}
              onChange={(e) => set('usernameSource', e.target.value as SamlForm['usernameSource'])}
              className={INPUT}
              disabled={disabled}
            >
              <option value="email">Email</option>
              <option value="nameId">NameID</option>
              <option value="attribute">Username attribute</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ['emailAttribute', 'Email attribute', 'email, mail, …/claims/emailaddress'],
              ['firstNameAttribute', 'First name attribute', 'firstName, givenName, …'],
              ['lastNameAttribute', 'Last name attribute', 'lastName, sn, surname, …'],
              ['usernameAttribute', 'Username attribute', 'uid'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <div key={key}>
              <label htmlFor={`saml-${key}`} className={LABEL}>
                {label}
              </label>
              <input
                id={`saml-${key}`}
                type="text"
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                placeholder={placeholder}
                className={INPUT}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-subtle">
          Empty attribute fields try the usual names (Okta, Google, Entra ID and ADFS claim URIs, LDAP OIDs). SAML has no “email verified” flag: email addresses count as verified only when “Trust email from provider” is on.
        </p>
      </div>
    </div>
  );
}
