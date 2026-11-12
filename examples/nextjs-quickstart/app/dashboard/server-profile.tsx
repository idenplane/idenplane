'use client';

import { useState } from 'react';
import { useAuth } from 'idenplane-nextjs';

interface Profile { id: string; username?: string; name?: string; email?: string }

export function ServerProfile() {
  const { user, getToken } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadProfile() {
    setError(''); setProfile(null);
    const token = getToken();
    if (!token || !user?.sub) { setError('Your session has expired. Please sign in again.'); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(user.sub)}/profile`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      if (!response.ok) {
        setError(response.status === 401 ? 'Your session has expired. Please sign in again.' : response.status === 403 ? 'You do not have permission to read this profile.' : 'The profile could not be loaded. Please try again.');
        return;
      }
      const data: { profile: Profile } = await response.json();
      setProfile(data.profile);
    } catch { setError('The profile could not be loaded. Please try again.'); }
    finally { setLoading(false); }
  }

  return (
    <section aria-labelledby="server-profile-title">
      <h2 id="server-profile-title">Server-verified profile</h2>
      <p>The server verifies your access token and allows you to read only your own profile.</p>
      <button type="button" onClick={loadProfile} disabled={loading}>
        {loading ? 'Loading profile...' : 'Load my profile'}
      </button>
      <div aria-live="polite" aria-atomic="true">
        {error && <p role="alert">{error}</p>}
        {profile && <dl><dt>Username</dt><dd>{profile.username ?? profile.id}</dd><dt>Name</dt><dd>{profile.name ?? 'Not provided'}</dd><dt>Email</dt><dd>{profile.email ?? 'Not provided'}</dd></dl>}
      </div>
    </section>
  );
}
