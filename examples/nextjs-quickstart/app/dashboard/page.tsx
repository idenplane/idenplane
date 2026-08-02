'use client';

import Link from 'next/link';
import { useAuth, ProtectedRoute } from 'idenplane-nextjs';

function SignedOutPrompt() {
  const { login } = useAuth();
  return (
    <main>
      <p>You need to sign in to view this page.</p>
      <button onClick={() => login()}>Sign In</button>
    </main>
  );
}

function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <main>
      <nav>
        <Link href="/">&larr; Home</Link>
        <button onClick={() => logout()}>Sign Out</button>
      </nav>
      <h1>Protected Dashboard</h1>
      <p>This page only renders for authenticated users.</p>
      <table>
        <tbody>
          <tr>
            <td style={{ paddingRight: '1rem', fontWeight: 'bold' }}>Username</td>
            <td>{user?.preferred_username ?? '—'}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: '1rem', fontWeight: 'bold' }}>Name</td>
            <td>{user?.name ?? '—'}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: '1rem', fontWeight: 'bold' }}>Email</td>
            <td>{user?.email ?? '—'}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: '1rem', fontWeight: 'bold' }}>Subject (sub)</td>
            <td>{user?.sub}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute
      fallback={
        <main>
          <p>Loading...</p>
        </main>
      }
      onUnauthorized={() => <SignedOutPrompt />}
    >
      <Dashboard />
    </ProtectedRoute>
  );
}
