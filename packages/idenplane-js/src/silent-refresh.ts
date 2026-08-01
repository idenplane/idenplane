import type { TokenResponse } from './types.js';
import type { TokenStorage } from './storage.js';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce.js';

const SILENT_REFRESH_TIMEOUT_MS = 10000;

export interface SilentRefreshDeps {
  storage: TokenStorage;
  clientId: string;
  scopes: string[];
  redirectUri: string;
  silentRedirectUri?: string;
  getOidcConfig: () => Promise<{ authorization_endpoint: string; token_endpoint: string }>;
}

/**
 * Perform a silent token refresh via a hidden iframe. Requires the server to
 * support `prompt=none` and a check-session iframe flow. The redirect-URI
 * page it targets must call `handleSilentCallback()` to post the
 * `idenplane:silent_callback` message this function listens for.
 *
 * `iframeBox` lets the caller track the current iframe across calls so a
 * stale one (from a silent refresh that didn't finish) gets torn down before
 * a new one starts.
 */
export async function performSilentRefresh(
  deps: SilentRefreshDeps,
  iframeBox: { current: HTMLIFrameElement | null },
): Promise<TokenResponse> {
  const oidcConfig = await deps.getOidcConfig();
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  const nonce = generateState();

  // Store PKCE state for callback
  deps.storage.set('silent_pkce_verifier', verifier);
  deps.storage.set('silent_auth_state', state);

  // Resolve the redirect URI for the silent-refresh iframe. A dedicated
  // silentRedirectUri (pointing at a page that calls handleSilentCallback)
  // is strongly recommended. Falling back to the main redirectUri works
  // only if that page also posts the idenplane:silent_callback message.
  let silentRedirectUri: string;
  if (deps.silentRedirectUri) {
    silentRedirectUri = deps.silentRedirectUri;
  } else {
    console.warn(
      '[idenplane] silentRedirectUri is not set. ' +
        'Falling back to redirectUri for the silent-refresh iframe. ' +
        'Set silentRedirectUri to a dedicated page that calls handleSilentCallback().',
    );
    silentRedirectUri = deps.redirectUri;
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: deps.clientId,
    redirect_uri: silentRedirectUri,
    scope: deps.scopes.join(' '),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'none',
  });

  const authUrl = `${oidcConfig.authorization_endpoint}?${params.toString()}`;

  // Remove old iframe if present
  if (iframeBox.current) {
    document.body.removeChild(iframeBox.current);
    iframeBox.current = null;
  }

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframeBox.current = iframe;

  return new Promise<TokenResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Silent refresh timed out'));
    }, SILENT_REFRESH_TIMEOUT_MS);

    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data?.type || event.data.type !== 'idenplane:silent_callback') return;

      cleanup();

      const { code, state: returnedState, error } = event.data;

      if (error) {
        reject(new Error(error));
        return;
      }

      const storedState = deps.storage.get('silent_auth_state');
      if (!storedState || returnedState !== storedState) {
        reject(new Error('Silent refresh state mismatch'));
        return;
      }

      const storedVerifier = deps.storage.get('silent_pkce_verifier');
      if (!storedVerifier || !code) {
        reject(new Error('Missing silent refresh PKCE data'));
        return;
      }

      deps.storage.remove('silent_pkce_verifier');
      deps.storage.remove('silent_auth_state');

      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: silentRedirectUri,
          client_id: deps.clientId,
          code_verifier: storedVerifier,
        });

        const response = await fetch(oidcConfig.token_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'silent_refresh_failed' }));
          reject(new Error(err.error_description ?? err.error));
          return;
        }

        const tokens: TokenResponse = await response.json();
        resolve(tokens);
      } catch (err) {
        reject(err);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (iframeBox.current) {
        try {
          document.body.removeChild(iframeBox.current);
        } catch {
          // Ignore
        }
        iframeBox.current = null;
      }
    };

    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
    iframe.src = authUrl;
  });
}
