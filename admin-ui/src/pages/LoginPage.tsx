import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import apiClient from '../api/client';
import PasswordInput from '../components/PasswordInput';
import { Button, Icons } from '../components/ui';

const FIELD_CLASS =
  'w-full h-11 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] text-fg outline-none transition-all duration-150 placeholder:text-subtle focus:border-accent focus:shadow-[var(--shadow-focus)]';
const LABEL_CLASS = 'mb-1.5 block text-[12.5px] font-medium text-fg';

export default function LoginPage() {
  const [mode, setMode] = useState<'credentials' | 'apikey'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const { login, loginWithCredentials, clearAuthState } = useAuth();
  const navigate = useNavigate();

  // On demo deployments (DEMO_MODE=true) the server returns the demo
  // credentials so we can prefill them and let visitors sign in instantly.
  // Normal self-hosted installs return { demo: false } and nothing changes.
  useEffect(() => {
    apiClient
      .get('/auth/demo-info')
      .then(({ data }) => {
        if (data?.demo) {
          setIsDemo(true);
          setUsername(data.username ?? '');
          setPassword(data.password ?? '');
        }
      })
      .catch(() => {
        /* not a demo, or endpoint unavailable — show the normal login */
      });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    let success: boolean;
    if (mode === 'credentials') {
      success = await loginWithCredentials(username, password);
      if (!success) {
        setError('Invalid username or password. Please try again.');
      }
    } else {
      success = await login(apiKey);
      if (!success) {
        setError('Invalid API key. Please check and try again.');
      }
    }

    if (success) {
      navigate('/console');
    }
    setLoading(false);
  }

  function toggleMode() {
    setError('');
    clearAuthState();
    setMode(mode === 'credentials' ? 'apikey' : 'credentials');
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-2">
      {/* LEFT — form */}
      <div className="flex flex-col justify-between px-6 py-10 sm:px-12 lg:px-16">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <Icons.IpMark size={32} fg="var(--fg)" accent="#10b981" />
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-fg">idenplane</div>
            <div className="font-mono text-[10.5px] text-subtle">admin console</div>
          </div>
        </div>

        {/* Form */}
        <div className="mx-auto w-full max-w-[380px] py-10">
          <div className="mb-7">
            <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
              Sign in
            </div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-fg">Idenplane Admin</h1>
            <p className="mt-2 text-sm text-muted">
              {mode === 'credentials'
                ? 'Sign in with your admin credentials'
                : 'Enter your admin API key to continue'}
            </p>
          </div>

          {isDemo && mode === 'credentials' && (
            <div className="mb-5 flex gap-3 rounded-xl border border-emerald/30 bg-emerald-soft p-3.5">
              <Icons.Terminal className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald" />
              <div className="text-[13px] leading-relaxed">
                <div className="font-semibold text-fg">Demo environment</div>
                <span className="text-muted">
                  Credentials are prefilled — just click <span className="font-medium">Sign In</span>. This demo
                  resets hourly.
                </span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'credentials' ? (
              <>
                <div>
                  <label htmlFor="username" className={LABEL_CLASS}>
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="Enter your username"
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="password" className={LABEL_CLASS}>
                    Password
                  </label>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Enter your password"
                    className={FIELD_CLASS}
                  />
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="apiKey" className={LABEL_CLASS}>
                  Admin API Key
                </label>
                <PasswordInput
                  id="apiKey"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  placeholder="Enter your API key"
                  className={FIELD_CLASS}
                />
              </div>
            )}

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                className="rounded-lg border border-danger-soft bg-danger-soft p-3 text-sm text-danger-fg"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              full
              disabled={loading || (mode === 'credentials' ? !username || !password : !apiKey)}
              iconRight={loading ? undefined : Icons.ArrowR}
              className="mt-1"
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-5 border-t border-line pt-5 text-center">
            <button
              type="button"
              onClick={toggleMode}
              className="text-sm font-medium text-accent transition-colors hover:text-accent-hover"
            >
              {mode === 'credentials'
                ? 'Sign in with API key instead'
                : 'Sign in with username & password instead'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="text-[11.5px] text-subtle">
          <span>© 2026 Idenplane · AGPL-licensed</span>
        </div>
      </div>

      {/* RIGHT — showcase (decorative, hidden on small screens) */}
      <div className="relative hidden overflow-hidden border-l border-line bg-sunken lg:flex lg:flex-col lg:justify-center lg:p-16">
        <div className="mx-auto w-full max-w-[460px]">
          <div className="mb-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
            The identity control plane
          </div>
          <h2 className="text-balance text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-fg">
            Self-hosted identity that boots in <span className="text-emerald">30 seconds</span> — not afternoons.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            OAuth 2.0, OIDC, SAML, WebAuthn. Ten first-party SDKs. ~150&nbsp;MB RAM. AGPL.
          </p>

          {/* Fake terminal */}
          <div className="mt-7 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
            <div className="flex items-center gap-1.5 border-b border-line bg-sunken px-3.5 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#10b981]" />
              <span className="ml-2.5 font-mono text-[11px] text-subtle">~/idenplane</span>
            </div>
            <div className="p-4 font-mono text-[12.5px] leading-[1.7] text-fg">
              <div>
                <span className="text-accent">$</span> docker compose up -d
              </div>
              <div className="text-subtle">
                ✓ idenplane-server&nbsp;&nbsp;<span className="text-success">healthy</span>
              </div>
              <div className="text-subtle">
                ✓ idenplane-db&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-success">healthy</span>
              </div>
              <div className="text-subtle">
                ✓ idenplane-redis&nbsp;&nbsp;&nbsp;<span className="text-success">healthy</span>
              </div>
              <div className="mt-1.5 text-subtle">
                → Console: <span className="text-accent">http://localhost:8080/console</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              { v: '10', l: 'SDKs' },
              { v: '~150', l: 'MB RAM' },
              { v: '30s', l: 'cold boot' },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-line bg-surface p-3.5">
                <div className="text-2xl font-bold tracking-[-0.02em] text-fg">{s.v}</div>
                <div className="mt-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
