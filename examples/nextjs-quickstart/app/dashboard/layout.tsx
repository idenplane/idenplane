'use client';

import type { ReactNode } from 'react';
import { useAuth } from 'idenplane-nextjs';
import { ServerProfile } from './server-profile';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  return <>{children}{isAuthenticated && <aside aria-label="Server authorization example"><ServerProfile key={user?.sub} /></aside>}</>;
}
