'use client';

import Link from 'next/link';
import { useAuth } from 'idenplane-nextjs';

export default function HomePage() {
  const { isAuthenticated, isLoading, user, login, logout } = useAuth();

  return (
    <main>
      <nav>
        <strong>Idenplane + Next.js Quickstart</strong>
      </nav>

      {isLoading ? (
        <p>Loading...</p>
      ) : isAuthenticated ? (
        <>
          <p>
            Signed in as <strong>{user?.name ?? user?.email ?? 'unknown user'}</strong>.
          </p>
          <p>
            <Link href="/dashboard">Go to the protected dashboard &rarr;</Link>
          </p>
          <button onClick={() => logout()}>Sign Out</button>
        </>
      ) : (
        <>
          <p>You&apos;re signed out. Sign in to view the protected dashboard.</p>
          <button onClick={() => login()}>Sign In</button>
        </>
      )}
    </main>
  );
}
