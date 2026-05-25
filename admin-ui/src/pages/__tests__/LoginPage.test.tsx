import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../test/utils';
import { server } from '../../test/mocks/server';
import LoginPage from '../LoginPage';

// LoginPage uses useNavigate – the custom render helper provides MemoryRouter.
// Credentials are stored in-memory (module-level variables in api/client.ts),
// so no sessionStorage cleanup is needed between tests.

describe('LoginPage – credentials mode', () => {
  it('renders the login form with username and password fields', () => {
    render(<LoginPage />);
    expect(screen.getByText('Idenplane Admin')).toBeInTheDocument();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    // Use getByPlaceholderText to avoid ambiguity with "Show password" button
    expect(screen.getByPlaceholderText(/enter your password/i)).toBeInTheDocument();
  });

  it('shows subtitle text for credentials mode', () => {
    render(<LoginPage />);
    expect(screen.getByText(/sign in with your admin credentials/i)).toBeInTheDocument();
  });

  it('disables the Sign In button when fields are empty', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
  });

  it('enables Sign In button once both fields have values', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/^username$/i), 'admin');
    await user.type(screen.getByPlaceholderText(/enter your password/i), 'password');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
  });

  it('shows "Verifying..." while the request is in-flight', async () => {
    // Delay the response to keep loading state visible
    server.use(
      http.post('/admin/auth/login', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ access_token: 'tok' });
      }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/^username$/i), 'admin');
    await user.type(screen.getByPlaceholderText(/enter your password/i), 'password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('button', { name: /verifying/i })).toBeInTheDocument();
  });

  it('shows an error message when credentials are wrong', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/^username$/i), 'wrong');
    await user.type(screen.getByPlaceholderText(/enter your password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(
      await screen.findByText(/invalid username or password/i),
    ).toBeInTheDocument();
  });

  it('does NOT show an error message initially', () => {
    render(<LoginPage />);
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
  });
});

describe('LoginPage – API key mode', () => {
  it('switches to API key mode when the toggle link is clicked', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /sign in with api key/i }));

    expect(screen.getByText(/enter your admin api key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/admin api key/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^username$/i)).not.toBeInTheDocument();
  });

  it('shows the "Sign in with username & password" toggle in API key mode', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /sign in with api key/i }));

    expect(
      screen.getByRole('button', { name: /sign in with username & password/i }),
    ).toBeInTheDocument();
  });

  it('disables Sign In when api key field is empty', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /sign in with api key/i }));

    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
  });

  it('shows an error for an invalid API key', async () => {
    // Override handler to reject any API key (401 on /realms which is the validation call)
    server.use(
      http.get('/admin/realms', () => {
        return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /sign in with api key/i }));
    await user.type(screen.getByPlaceholderText(/enter your api key/i), 'bad-key');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(
      await screen.findByText(/invalid api key/i),
    ).toBeInTheDocument();
  });

  it('clears the error message when switching modes', async () => {
    server.use(
      http.get('/admin/realms', () => {
        return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /sign in with api key/i }));
    await user.type(screen.getByPlaceholderText(/enter your api key/i), 'bad-key');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await screen.findByText(/invalid api key/i);

    // Switch modes – error should clear
    await user.click(screen.getByRole('button', { name: /sign in with username & password/i }));
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
  });
});
