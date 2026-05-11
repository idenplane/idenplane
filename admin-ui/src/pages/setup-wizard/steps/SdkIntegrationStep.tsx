/**
 * SdkIntegrationStep — Step 5: Generate SDK integration code snippets.
 *
 * Displays the created client credentials and generates SDK integration
 * code snippets for common frameworks. Allows users to copy snippets
 * to their clipboard and mark the step as complete.
 *
 * Follows ClientDetailPage patterns for code style and structure.
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { markSdkGenerated } from '../../../api/wizard';
import { useWizard } from '../../../context/WizardContext';
import { getErrorMessage } from '../../../utils/getErrorMessage';

interface CodeSnippet {
  language: string;
  label: string;
  code: string;
}

/**
 * Generates SDK integration code snippets based on client data
 */
function generateSnippets(
  realmName: string,
  clientId: string,
  clientSecret: string,
  redirectUris: string[],
): CodeSnippet[] {
  const authServerUrl = 'http://localhost:3000';
  const firstRedirectUri = redirectUris[0] || 'http://localhost:3000/callback';

  return [
    {
      language: 'typescript',
      label: 'TypeScript / Node.js',
      code: `import AuthMe from '@authme/sdk';

// Initialize the AuthMe SDK
const auth = new AuthMe({
  issuer: '${authServerUrl}/realms/${realmName}',
  clientId: '${clientId}',
  clientSecret: '${clientSecret}',
  redirectUri: '${firstRedirectUri}',
});

// Redirect to login
await auth.login();

// Get access token after callback
const token = await auth.getToken();
console.log('Access token:', token.access_token);

// Logout
await auth.logout();`,
    },
    {
      language: 'javascript',
      label: 'JavaScript',
      code: `<script src="https://cdn.authme.example.com/authme.min.js"></script>
<script>
  const auth = new AuthMe({
    issuer: '${authServerUrl}/realms/${realmName}',
    clientId: '${clientId}',
    clientSecret: '${clientSecret}',
    redirectUri: '${firstRedirectUri}',
  });

  // Login redirect
  auth.login();

  // Handle callback
  auth.handleRedirect().then(token => {
    console.log('Token:', token.access_token);
  });
</script>`,
    },
    {
      language: 'python',
      label: 'Python',
      code: `from authme import AuthMeClient

client = AuthMeClient(
    issuer='${authServerUrl}/realms/${realmName}',
    client_id='${clientId}',
    client_secret='${clientSecret}',
    redirect_uri='${firstRedirectUri}',
)

# Get authorization URL
auth_url = client.get_auth_url()
print(f'Login at: {auth_url}')

# Exchange code for token
token = client.exchange_code(code)
print(f'Access token: {token.access_token}')`,
    },
    {
      language: 'curl',
      label: 'cURL',
      code: `# Get token using client credentials
curl -X POST ${authServerUrl}/realms/${realmName}/protocol/openid-connect/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials" \\
  -d "client_id=${clientId}" \\
  -d "client_secret=${clientSecret}"

# Authorization code flow - Step 1: Get auth code
curl -X GET "${authServerUrl}/realms/${realmName}/protocol/openid-connect/auth? \\
  client_id=${clientId}& \\
  response_type=code& \\
  redirect_uri=${encodeURIComponent(firstRedirectUri)}"

# Step 2: Exchange code for token
curl -X POST ${authServerUrl}/realms/${realmName}/protocol/openid-connect/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=authorization_code" \\
  -d "client_id=${clientId}" \\
  -d "client_secret=${clientSecret}" \\
  -d "code=YOUR_AUTH_CODE" \\
  -d "redirect_uri=${encodeURIComponent(firstRedirectUri)}"`,
    },
    {
      language: 'java',
      label: 'Java (Spring Boot)',
      code: `// Add to pom.xml or build.gradle:
// implementation 'org.authme:authme-sdk:1.0.0'

@Autowired
private AuthMeClient authMeClient;

@GetMapping("/login")
public String login(HttpSession session) {
    String authUrl = authMeClient.getAuthUrl(
        "${firstRedirectUri}",
        session.getId()
    );
    return "redirect:" + authUrl;
}

@GetMapping("/callback")
public String callback(@RequestParam String code) {
    TokenResponse token = authMeClient.exchangeCode(code);
    // Store and use token.access_token
    return "redirect:/dashboard";
}

// For Spring Security config:
// .antMatchers("/login", "/callback").permitAll()`,
    },
  ];
}

export default function SdkIntegrationStep() {
  const { client, realmSettings, setSdkGenerated } = useWizard();
  const [copiedLanguage, setCopiedLanguage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sdkMarked, setSdkMarked] = useState(false);

  const mutation = useMutation({
    mutationFn: () => markSdkGenerated(),
    onSuccess: () => {
      setSdkGenerated(true);
      setSdkMarked(true);
    },
    onError: (error) => {
      setLocalError(getErrorMessage(error, 'Failed to mark SDK step as complete.'));
    },
  });

  const copyToClipboard = useCallback(async (text: string, language: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLanguage(language);
      // Reset copied state after 2 seconds
      setTimeout(() => setCopiedLanguage(null), 2000);
    } catch {
      setLocalError('Failed to copy to clipboard. Please copy manually.');
    }
  }, []);

  // No client data - show error state
  if (!client?.clientId) {
    return (
      <div className="max-w-xl">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">SDK Integration</h2>
          <p className="mt-1 text-sm text-gray-500">
            Get integration code snippets for your application.
          </p>
        </div>

        <div className="rounded-md bg-amber-50 p-4 text-sm text-amber-700">
          No client found. Please complete Step 4 (First Client) before continuing.
        </div>
      </div>
    );
  }

  const realmName = realmSettings?.name || 'master';
  const snippets = generateSnippets(
    realmName,
    client.clientId,
    client.clientSecret || '',
    client.redirectUris || [],
  );

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">SDK Integration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Copy the integration code for your preferred language or framework.
          All snippets are pre-configured with your client credentials.
        </p>
      </div>

      {/* Client Credentials Summary */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-700">Your Client Credentials</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Client ID:</span>{' '}
            <code className="rounded bg-white px-2 py-0.5 font-mono text-gray-900">
              {client.clientId}
            </code>
          </div>
          <div>
            <span className="text-gray-500">Realm:</span>{' '}
            <code className="rounded bg-white px-2 py-0.5 font-mono text-gray-900">
              {realmName}
            </code>
          </div>
        </div>
        {client.clientSecret && (
          <div className="mt-2 text-sm">
            <span className="text-gray-500">Client Secret:</span>{' '}
            <code className="rounded bg-white px-2 py-0.5 font-mono text-gray-900">
              {'•'.repeat(32)}
            </code>
            <span className="ml-2 text-xs text-gray-400">(hidden for security)</span>
          </div>
        )}
      </div>

      {/* Code Snippets */}
      <div className="space-y-4">
        {snippets.map((snippet) => (
          <div
            key={snippet.language}
            className="rounded-lg border border-gray-200 bg-white overflow-hidden"
          >
            {/* Snippet Header */}
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
              <span className="text-sm font-medium text-gray-700">
                {snippet.label}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(snippet.code, snippet.language)}
                disabled={copiedLanguage === snippet.language}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  copiedLanguage === snippet.language
                    ? 'bg-green-100 text-green-700'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {copiedLanguage === snippet.language ? (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-4a2 2 0 00-2-2h-8a2 2 0 00-2 2v4a2 2 0 002 2z" />
                    </svg>
                    Copy Code
                  </>
                )}
              </button>
            </div>

            {/* Code Block */}
            <pre className="overflow-x-auto bg-gray-900 px-4 py-3 text-sm text-gray-100">
              <code className="font-mono">{snippet.code}</code>
            </pre>
          </div>
        ))}
      </div>

      {/* Local Error */}
      {localError && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {localError}
        </div>
      )}

      {/* API Error */}
      {mutation.isError && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {getErrorMessage(mutation.error, 'Failed to mark SDK step as complete.')}
        </div>
      )}

      {/* Success Message */}
      {sdkMarked && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
          SDK integration marked as complete. You can continue to the next step.
        </div>
      )}
    </div>
  );
}
