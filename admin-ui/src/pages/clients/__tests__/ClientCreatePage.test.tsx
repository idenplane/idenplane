import { describe, it, expect } from 'vitest';
import { screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import ClientCreatePage from '../ClientCreatePage';

function renderPage(realm = 'test-realm') {
  return render(<ClientCreatePage />, {
    initialUrl: `/console/realms/${realm}/clients/new`,
    routePattern: '/console/realms/:name/clients/new',
  });
}

describe('ClientCreatePage', () => {
  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /create client/i })).toBeInTheDocument();
  });

  it('renders the realm name in the subtitle', () => {
    renderPage();
    expect(screen.getByText(/test-realm/)).toBeInTheDocument();
  });

  it('renders all key form fields', () => {
    renderPage();
    expect(screen.getByLabelText(/^client id$/i)).toBeInTheDocument();
    // Avoid ambiguity: "Name" label vs. surrounding text – use getByRole + name
    expect(screen.getByRole('textbox', { name: /^name$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^description$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^client type$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^redirect uris/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^web origins/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^grant types/i)).toBeInTheDocument();
  });

  it('defaults client type to CONFIDENTIAL', () => {
    renderPage();
    expect(screen.getByLabelText(/^client type$/i)).toHaveValue('CONFIDENTIAL');
  });

  it('the Enabled checkbox is checked by default', () => {
    renderPage();
    expect(screen.getByRole('checkbox', { name: /^enabled$/i })).toBeChecked();
  });

  it('renders Create Client and Cancel buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^create client$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('allows changing the client type to PUBLIC', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText(/^client type$/i), 'PUBLIC');
    expect(screen.getByLabelText(/^client type$/i)).toHaveValue('PUBLIC');
  });

  it('shows the client secret after a successful create', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^client id$/i), 'new-client');
    await user.click(screen.getByRole('button', { name: /^create client$/i }));

    // The mock handler returns clientSecret: 'super-secret-value'
    expect(await screen.findByText('super-secret-value')).toBeInTheDocument();
    expect(screen.getByText(/client created successfully/i)).toBeInTheDocument();
  });

  it('shows a "Go to Clients" button on the success screen', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^client id$/i), 'new-client');
    await user.click(screen.getByRole('button', { name: /^create client$/i }));

    expect(await screen.findByRole('button', { name: /go to clients/i })).toBeInTheDocument();
  });

  it('shows an error message when the API returns an error', async () => {
    server.use(
      http.post('/admin/realms/:name/clients', () =>
        HttpResponse.json({ message: 'Client ID already exists' }, { status: 409 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^client id$/i), 'duplicate');
    await user.click(screen.getByRole('button', { name: /^create client$/i }));

    expect(await screen.findByText(/client id already exists/i)).toBeInTheDocument();
  });

  it('shows "Creating..." while the mutation is pending', async () => {
    server.use(
      http.post('/admin/realms/:name/clients', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^client id$/i), 'slow-client');
    await user.click(screen.getByRole('button', { name: /^create client$/i }));

    expect(await screen.findByRole('button', { name: /creating/i })).toBeInTheDocument();
    // Let the delayed 201 land before the test ends — see DashboardPage.test.tsx
    // for why an in-flight request outliving the test breaks the whole run.
    await waitForElementToBeRemoved(() => screen.queryByRole('button', { name: /creating/i }));
  });

  describe('application templates', () => {
    it('renders the template picker with no template selected by default', () => {
      renderPage();
      expect(screen.getByLabelText(/start from a template/i)).toHaveValue('');
    });

    it('prefills the form when a template is selected', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.selectOptions(screen.getByLabelText(/start from a template/i), 'grafana');

      expect(screen.getByRole('textbox', { name: /^name$/i })).toHaveValue('Grafana');
      expect(screen.getByLabelText(/^client type$/i)).toHaveValue('CONFIDENTIAL');
      expect(screen.getByLabelText(/^redirect uris/i)).toHaveValue('{baseUrl}/login/generic_oauth');
      expect(screen.getByLabelText(/^grant types/i)).toHaveValue('authorization_code, refresh_token');
    });

    it('shows setup instructions for the selected template', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.selectOptions(screen.getByLabelText(/start from a template/i), 'argocd');

      expect(screen.getByText(/setup on the argo cd side/i)).toBeInTheDocument();
      expect(screen.getByText(/argocd-cm configmap/i)).toBeInTheDocument();
    });

    it('does not overwrite a client ID the user already typed', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByLabelText(/^client id$/i), 'my-custom-id');
      await user.selectOptions(screen.getByLabelText(/start from a template/i), 'outline');

      expect(screen.getByLabelText(/^client id$/i)).toHaveValue('my-custom-id');
    });

    it('reverts to a blank state when switching back to "None"', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.selectOptions(screen.getByLabelText(/start from a template/i), 'nextcloud');
      await user.selectOptions(screen.getByLabelText(/start from a template/i), '');

      expect(screen.queryByText(/setup on the/i)).not.toBeInTheDocument();
    });
  });
});
