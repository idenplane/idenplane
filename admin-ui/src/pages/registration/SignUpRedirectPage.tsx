import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router';
import { hostedSignUpUrl } from '../../utils/signUp';

/**
 * `/console/register/:realm`: a public entry that hands over to the hosted,
 * themed sign-up page (`GET /realms/{realm}/register`). That page is the one
 * sign-up implementation: CAPTCHA, terms, custom attributes and a CSP that
 * admits the CAPTCHA provider on that page only.
 */
export default function SignUpRedirectPage() {
  const { realm } = useParams<{ realm: string }>();
  const { search } = useLocation();
  const target = hostedSignUpUrl(realm, search);

  useEffect(() => {
    if (target) window.location.replace(target);
  }, [target]);

  if (!target) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sunken px-4">
        <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-fg">Invalid sign-up link</h1>
          <p className="mt-2 text-sm text-subtle">This link does not name a realm.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-sunken px-4">
      <p className="text-sm text-subtle" role="status">
        Opening the sign-up page… If nothing happens,{' '}
        <a className="text-accent underline" href={target}>
          continue to sign up
        </a>
        .
      </p>
    </div>
  );
}
