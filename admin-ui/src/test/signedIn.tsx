/* eslint-disable react-refresh/only-export-components -- test-only helpers; Fast Refresh does not apply. */
import { useEffect, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { clearCredentials, setCredentials } from '../api/client';
import { useAuthContext } from '../context/AuthContext';
import type { AdminMe } from '../api/adminAccess';

const SAMPLE_TOKEN = 'sample-token';

/** Answers GET /admin/auth/me with this admin for the current test. */
export function mockMe(overrides: Partial<AdminMe>) {
  const me: AdminMe = {
    userId: 'sample-user',
    username: 'sample-admin',
    kind: 'user',
    roles: ['view-only'],
    superAdmin: false,
    readAllRealms: true,
    writeAllRealms: false,
    managedRealms: [],
    ...overrides,
  };
  server.use(http.get('/admin/auth/me', () => HttpResponse.json(me)));
  return me;
}

/** Signs a sample token in before rendering its children. */
export function SignedIn({ children }: { children: ReactNode }) {
  const { token, setToken } = useAuthContext();
  useEffect(() => {
    setCredentials({ token: SAMPLE_TOKEN });
    setToken(SAMPLE_TOKEN);
    return () => clearCredentials();
  }, [setToken]);
  return token === SAMPLE_TOKEN ? <>{children}</> : null;
}
