'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { AuthProvider as SdkAuthProvider, IdenplaneClient } from 'idenplane-nextjs';

interface Props {
  serverUrl: string;
  realm: string;
  clientId: string;
  redirectUri: string;
  children: ReactNode;
}

function BrowserSdkProvider({ serverUrl, realm, clientId, redirectUri, children }: Props) {
  // Explicit demo opt-in: OAuth state and tokens survive redirects/reloads in
  // this tab. A client belongs to this mounted provider, never a global request.
  const [client] = useState(() => new IdenplaneClient({
    url: serverUrl,
    realm,
    clientId,
    redirectUri,
    postLogoutRedirectUri: new URL(redirectUri).origin,
    storage: 'sessionStorage',
  }));

  return <SdkAuthProvider client={client}>{children}<nav aria-label="Authentication examples"><Link href="/server-session">Server-session example</Link></nav></SdkAuthProvider>;
}

export function AuthProvider(props: Props) {
  const pathname = usePathname();
  // The server-session mode never initializes the browser-token SDK.
  return pathname === '/server-session' ? props.children : <BrowserSdkProvider {...props} />;
}
