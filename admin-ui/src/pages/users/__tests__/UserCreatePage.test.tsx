import { describe, it, expect } from 'vitest';
import { screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import UserCreatePage from '../UserCreatePage';

function renderPage(realm = 'test-realm') {
  return render(<UserCreatePage />, {
    initialUrl: `/console/realms/${realm}/users/create`,
    routePattern: '/console/realms/:name/users/create',
  });
}

describe('UserCreatePage', () => {
  it('renders the page heading and realm name', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /create user/i })).toBeInTheDocument();
    expect(screen.getByText(/test-realm/)).toBeInTheDocument();
  });

  it('renders all required form fields', () => {
    renderPage();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^first name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^last name$/i)).toBeInTheDocument();
    // Password is a PasswordInput; find by id attribute since no placeholder is set
    expect(document.getElementById('password')).toBeInTheDocument();
    expect(screen.getByLabelText(/^enabled$/i)).toBeInTheDocument();
  });

  it('the Enabled checkbox is checked by default', () => {
    renderPage();
    expect(screen.getByLabelText(/^enabled$/i)).toBeChecked();
  });

  it('renders the Create User submit button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^create user$/i })).toBeInTheDocument();
  });

  it('renders the Cancel button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('allows typing into the username field', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/^username$/i), 'newuser');
    expect(screen.getByLabelText(/^username$/i)).toHaveValue('newuser');
  });

  it('submits the form successfully and shows no error', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^username$/i), 'newuser');
    // Find the password input by its id
    const passwordInput = document.getElementById('password') as HTMLInputElement;
    await user.type(passwordInput, 'secret123');
    await user.click(screen.getByRole('button', { name: /^create user$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/failed to create user/i)).not.toBeInTheDocument();
    });
  });

  it('shows an error message when the API returns an error', async () => {
    server.use(
      http.post('/admin/realms/:name/users', () =>
        HttpResponse.json({ message: 'Username already taken' }, { status: 409 }),
      ),
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^username$/i), 'taken');
    const passwordInput = document.getElementById('password') as HTMLInputElement;
    await user.type(passwordInput, 'pass');
    await user.click(screen.getByRole('button', { name: /^create user$/i }));

    expect(await screen.findByText(/username already taken/i)).toBeInTheDocument();
  });

  it('shows "Creating..." while the mutation is pending', async () => {
    server.use(
      http.post('/admin/realms/:name/users', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^username$/i), 'slowuser');
    const passwordInput = document.getElementById('password') as HTMLInputElement;
    await user.type(passwordInput, 'pass');
    await user.click(screen.getByRole('button', { name: /^create user$/i }));

    expect(await screen.findByRole('button', { name: /creating/i })).toBeInTheDocument();
    // Let the delayed 201 land before the test ends — see DashboardPage.test.tsx
    // for why an in-flight request outliving the test breaks the whole run.
    await waitForElementToBeRemoved(() => screen.queryByRole('button', { name: /creating/i }));
  });

  it('can toggle the Enabled checkbox off', async () => {
    const user = userEvent.setup();
    renderPage();
    const checkbox = screen.getByLabelText(/^enabled$/i);
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });
});
