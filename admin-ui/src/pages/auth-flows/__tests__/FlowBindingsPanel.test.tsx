import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeAuthFlow, makeFlowBindings } from '../../../test/mocks/data';
import FlowBindingsPanel from '../FlowBindingsPanel';

const flows = [
  makeAuthFlow({ id: 'flow-1', name: 'Basic Login' }),
  makeAuthFlow({ id: 'flow-2', name: 'MFA Required' }),
];

function renderPanel() {
  return render(<FlowBindingsPanel realmName="test-realm" flows={flows} />, {
    initialUrl: '/console/realms/test-realm/auth-flows',
    routePattern: '/console/realms/:name/auth-flows',
  });
}

describe('FlowBindingsPanel', () => {
  it('explains the server switch while the flow runtime is off', async () => {
    renderPanel();
    const note = await screen.findByTestId('runtime-inactive-note');
    expect(note).toHaveTextContent(/flow runtime off/i);
    expect(note).toHaveTextContent('AUTH_FLOW_RUNTIME_ENABLED=true');
    expect(screen.queryByTestId('runtime-active-note')).not.toBeInTheDocument();
  });

  it('says the runtime is active when the server runs it', async () => {
    server.use(
      http.get('/admin/realms/:name/auth-flows/bindings', () =>
        HttpResponse.json(makeFlowBindings({ runtimeEnabled: true })),
      ),
    );
    renderPanel();
    expect(await screen.findByTestId('runtime-active-note')).toHaveTextContent(
      /flow runtime active/i,
    );
    expect(screen.queryByTestId('runtime-inactive-note')).not.toBeInTheDocument();
  });

  it('lists every client with an override select', async () => {
    renderPanel();
    expect(await screen.findByLabelText('Flow for client web')).toBeInTheDocument();
    expect(screen.getByLabelText('Flow for client cli')).toBeInTheDocument();
  });

  it('sends only what changed', async () => {
    let body: unknown;
    server.use(
      http.put('/admin/realms/:name/auth-flows/bindings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          makeFlowBindings({ browserFlowId: 'flow-1', authFlowsEnabled: true }),
        );
      }),
    );
    renderPanel();
    const save = await screen.findByRole('button', { name: /save bindings/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/realm browser flow/i), {
      target: { value: 'flow-1' },
    });
    fireEvent.click(screen.getByLabelText(/use custom flows in this realm/i));
    fireEvent.change(screen.getByLabelText('Flow for client cli'), {
      target: { value: 'flow-2' },
    });
    fireEvent.click(save);

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      browserFlowId: 'flow-1',
      authFlowsEnabled: true,
      clients: [{ clientId: 'cli', authFlowId: 'flow-2' }],
    });
  });

  it('shows server validation errors inline next to the field they concern', async () => {
    server.use(
      http.put('/admin/realms/:name/auth-flows/bindings', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Flow binding rejected',
            errors: [
              {
                path: 'browserFlowId',
                code: 'flow_invalid',
                message: "Flow 'Basic Login' is invalid: The first step must be required",
                flowId: 'flow-1',
              },
              {
                path: 'clients[0].authFlowId',
                code: 'flow_invalid',
                message: "Flow 'MFA Required' is invalid: bad config",
                flowId: 'flow-2',
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    renderPanel();
    fireEvent.change(await screen.findByLabelText(/realm browser flow/i), {
      target: { value: 'flow-1' },
    });
    fireEvent.change(screen.getByLabelText('Flow for client web'), {
      target: { value: 'flow-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save bindings/i }));

    expect(
      await screen.findByText(/Basic Login' is invalid: The first step must be required/),
    ).toBeInTheDocument();
    expect(screen.getByText(/MFA Required' is invalid: bad config/)).toBeInTheDocument();
    expect(screen.getByLabelText(/realm browser flow/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Flow for client web')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Flow for client cli')).toHaveAttribute('aria-invalid', 'false');
  });
});
