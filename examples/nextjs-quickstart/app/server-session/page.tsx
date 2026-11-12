'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Profile { id: string; username?: string; name?: string; email?: string }
export default function ServerSessionPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/session/profile', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (new URL(window.location.href).searchParams.has('error')) setError('Sign-in could not be completed. Please try again.');
        if (response.status === 401) return;
        if (!response.ok) throw new Error('unavailable');
        const data: { profile: Profile } = await response.json();setProfile(data.profile);
      }).catch(() => { if (!controller.signal.aborted) { setError('Server sessions are temporarily unavailable. Please try again later.');setUnavailable(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return <main>
    <nav><Link href="/">Browser SDK example</Link></nav>
    <h1>Server session</h1>
    <p>Your access and refresh tokens stay on the server. This page uses an HttpOnly session cookie.</p>
    {loading ? <p>Checking session...</p> : <>
      {error && <p role="alert">{error}</p>}
      {profile ? <><h2>Signed in securely</h2><dl><dt>Username</dt><dd>{profile.username ?? profile.id}</dd><dt>Name</dt><dd>{profile.name ?? 'Not provided'}</dd><dt>Email</dt><dd>{profile.email ?? 'Not provided'}</dd></dl><form method="post" action="/api/session/logout"><button type="submit">Sign Out</button></form></> : <form method="post" action="/api/session/login"><button type="submit" disabled={unavailable}>Sign in securely</button></form>}
    </>}
  </main>;
}
