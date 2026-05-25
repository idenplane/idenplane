import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';

interface WrapperOptions {
  /** Initial URL for the in-memory router, e.g. "/console/realms/test-realm/users" */
  initialUrl?: string;
  /**
   * When a component reads URL params via useParams, supply the route pattern so
   * the params are correctly parsed, e.g. "/console/realms/:name/users".
   * If omitted the component is rendered at the root "/" route.
   */
  routePattern?: string;
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Disable retries so tests fail fast on errors
        retry: false,
        // Disable stale time so queries always refetch in tests
        staleTime: 0,
        // Don't garbage collect during tests
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function renderWithProviders(
  ui: React.ReactElement,
  {
    initialUrl = '/',
    routePattern,
    ...renderOptions
  }: WrapperOptions & Omit<RenderOptions, 'wrapper'> = {},
) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: React.ReactNode }) {
    const content = routePattern ? (
      <Routes>
        <Route path={routePattern} element={children} />
      </Routes>
    ) : (
      children
    );

    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[initialUrl]}>{content}</MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}

// Re-export everything from @testing-library/react for convenience.
// eslint-disable-next-line react-refresh/only-export-components -- test-only helper module; Fast Refresh does not apply.
export * from '@testing-library/react';
export { renderWithProviders as render };
