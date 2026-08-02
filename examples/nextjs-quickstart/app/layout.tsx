'use client';

import { AuthProvider } from 'idenplane-nextjs';
import './globals.css';

const serverUrl = process.env.NEXT_PUBLIC_IDENPLANE_SERVER_URL ?? 'http://localhost:3000';
const realm = process.env.NEXT_PUBLIC_IDENPLANE_REALM ?? 'quickstart';
const clientId = process.env.NEXT_PUBLIC_IDENPLANE_CLIENT_ID ?? 'nextjs-quickstart';
const redirectUri = process.env.NEXT_PUBLIC_IDENPLANE_REDIRECT_URI ?? 'http://localhost:3001/callback';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider
          serverUrl={serverUrl}
          realm={realm}
          clientId={clientId}
          redirectUri={redirectUri}
        >
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
