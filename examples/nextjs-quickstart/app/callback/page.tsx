'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from 'idenplane-nextjs';

export default function CallbackPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isAuthenticated ? '/dashboard' : '/');
  }, [isAuthenticated, isLoading, router]);

  return (
    <main>
      <p>Signing you in...</p>
    </main>
  );
}
