import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../test/utils';
import UserConsentPanel from '../UserConsentPanel';

describe('UserConsentPanel', () => {
  const renderPanel = () =>
    render(
      <UserConsentPanel realmName="test-realm" userId="user-1" username="alice" />,
    );

  it('renders current consents with client name and scopes', async () => {
    renderPanel();
    await screen.findByText('Test Client');
    // scopes render as chips
    expect(screen.getByText('openid')).toBeInTheDocument();
    expect(screen.getByText('profile')).toBeInTheDocument();
    // no fictional "Invalid Date" / "undefined" leaks
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it('renders consent history with action, client and scopes', async () => {
    renderPanel();
    // switch to the history tab
    const historyTab = await screen.findByRole('button', { name: /consent history/i });
    historyTab.click();
    await screen.findByText('Granted');
    expect(screen.getByText('openid, profile')).toBeInTheDocument();
    // pagination summary uses the real total
    expect(screen.getByText(/of 1 entries/i)).toBeInTheDocument();
  });
});
