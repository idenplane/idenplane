import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeAuthFlow } from '../../../test/mocks/data';
import AuthFlowListPage from '../AuthFlowListPage';

function renderPage(realm = 'test-realm') {
  return render(<AuthFlowListPage />, {
    initialUrl: `/console/realms/${realm}/auth-flows`,
    routePattern: '/console/realms/:name/auth-flows',
  });
}

describe('AuthFlowListPage', () => {
  it('shows a loading state initially', () => {
    renderPage();
    expect(screen.getByText(/loading authentication flows/i)).toBeInTheDocument();
  });

  it('renders flow rows after data loads', async () => {
    renderPage();
    await screen.findByText('Basic Login');
    expect(screen.getByText('MFA Required')).toBeInTheDocument();
  });

  it('shows the page heading', async () => {
    renderPage();
    await screen.findByText('Basic Login');
    expect(
      screen.getByRole('heading', { name: /authentication flows/i }),
    ).toBeInTheDocument();
  });

  it('shows realm name in the subtitle', async () => {
    renderPage();
    await screen.findByText('Basic Login');
    expect(screen.getByText(/test-realm/)).toBeInTheDocument();
  });

  it('renders the Create Flow button', async () => {
    renderPage();
    await screen.findByText('Basic Login');
    expect(screen.getByRole('button', { name: /create flow/i })).toBeInTheDocument();
  });

  it('shows Default badge for the default flow, with the column marked deprecated', async () => {
    renderPage();
    await screen.findByText('Basic Login');
    expect(screen.getByText('Default (deprecated)')).toBeInTheDocument();
    const badge = screen.getAllByText('Default').find((el) => el.tagName === 'SPAN');
    expect(badge).toBeInTheDocument();
  });

  it('renders the flow bindings panel', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /flow bindings/i })).toBeInTheDocument();
  });

  it('creates new flows with a valid starter step', async () => {
    let body: { steps?: unknown[] } | undefined;
    server.use(
      http.post('/admin/realms/:name/auth-flows', async ({ request }) => {
        body = (await request.json()) as { steps?: unknown[] };
        return HttpResponse.json(makeAuthFlow({ id: 'new-flow-1' }), { status: 201 });
      }),
    );
    renderPage();
    await screen.findByText('Basic Login');
    fireEvent.click(screen.getByRole('button', { name: /create flow/i }));
    fireEvent.change(screen.getByLabelText(/flow name/i), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body?.steps).toEqual([expect.objectContaining({ type: 'password', order: 1 })]);
  });

  it('explains a 409 when deleting a bound flow', async () => {
    server.use(
      http.delete('/admin/realms/:name/auth-flows/:id', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'bound',
            bindings: [
              { kind: 'realm', realmId: 'r1', realmName: 'test-realm' },
              { kind: 'client', id: 'c1', clientId: 'web' },
            ],
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await screen.findByText('Basic Login');
    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    expect(await screen.findByText(/still bound to realm test-realm, client web/i)).toBeInTheDocument();
  });

  it('shows the step count for each flow', async () => {
    renderPage();
    await screen.findByText('Basic Login');
    // Both flows have 1 step each in the mock
    const ones = screen.getAllByText('1');
    expect(ones.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Duplicate and Delete buttons for each flow', async () => {
    renderPage();
    await screen.findByText('Basic Login');
    expect(screen.getAllByRole('button', { name: /duplicate/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /delete/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no flows exist', async () => {
    server.use(
      http.get('/admin/realms/:name/auth-flows', () => HttpResponse.json([])),
    );
    renderPage();
    expect(
      await screen.findByText(/no authentication flows found/i),
    ).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    server.use(
      http.get('/admin/realms/:name/auth-flows', () =>
        HttpResponse.json({ message: 'error' }, { status: 500 }),
      ),
    );
    renderPage();
    expect(
      await screen.findByText(/failed to load authentication flows/i),
    ).toBeInTheDocument();
  });

  it('shows flow description when present', async () => {
    server.use(
      http.get('/admin/realms/:name/auth-flows', () =>
        HttpResponse.json([
          makeAuthFlow({ id: 'flow-1', name: 'My Flow', description: 'Custom description' }),
        ]),
      ),
    );
    renderPage();
    await screen.findByText('My Flow');
    expect(screen.getByText('Custom description')).toBeInTheDocument();
  });
});
