import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/utils';
import RealmDetailPage from '../RealmDetailPage';

function renderPage(realm = 'test-realm') {
  return render(<RealmDetailPage />, {
    initialUrl: `/console/realms/${realm}`,
    routePattern: '/console/realms/:name',
  });
}

describe('RealmDetailPage', () => {
  it('renders the realm name heading', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'test-realm' })).toBeInTheDocument();
  });

  it('renders all 9 tab buttons', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'test-realm' });
    for (const label of ['General', 'Tokens', 'Email', 'SMS', 'Security', 'Events', 'Theme', 'Magic Link', 'Locale']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('shows the General tab content by default', async () => {
    renderPage();
    expect(await screen.findByText('General Settings')).toBeInTheDocument();
  });

  it('switches to the Tokens tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('General Settings');
    await user.click(screen.getByRole('button', { name: 'Tokens' }));
    expect(await screen.findByText('Token Lifespans')).toBeInTheDocument();
  });

  it('switches to the Security tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('General Settings');
    await user.click(screen.getByRole('button', { name: 'Security' }));
    expect(await screen.findByText('Password Policy')).toBeInTheDocument();
  });

  it('switches to the Events tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('General Settings');
    await user.click(screen.getByRole('button', { name: 'Events' }));
    expect(await screen.findByText('Event Configuration')).toBeInTheDocument();
  });

  it('switches to the Theme tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('General Settings');
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    expect(await screen.findByText('Theme Settings')).toBeInTheDocument();
  });

  it('switches to the Magic Link tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('General Settings');
    await user.click(screen.getByRole('button', { name: 'Magic Link' }));
    expect(await screen.findByText('Magic Link Settings')).toBeInTheDocument();
  });

  it('switches to the Locale tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('General Settings');
    await user.click(screen.getByRole('button', { name: 'Locale' }));
    expect(await screen.findByText('Locale & Internationalization')).toBeInTheDocument();
  });

  it('opens the delete confirmation dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('General Settings');
    await user.click(screen.getByRole('button', { name: 'Delete Realm' }));
    expect(await screen.findByText(/is irreversible/i)).toBeInTheDocument();
  });
});
