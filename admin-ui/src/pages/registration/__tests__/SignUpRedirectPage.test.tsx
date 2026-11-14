import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../../../test/utils';
import SignUpRedirectPage from '../SignUpRedirectPage';

describe('SignUpRedirectPage (/console/register/:realm)', () => {
  const replace = vi.fn();
  const original = window.location;

  beforeEach(() => {
    replace.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, replace },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('hands over to the hosted sign-up page, keeping the query', async () => {
    render(<SignUpRedirectPage />, {
      initialUrl: '/console/register/acme?client_id=web',
      routePattern: '/console/register/:realm',
    });
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/realms/acme/register?client_id=web'),
    );
    expect(screen.getByRole('link', { name: 'continue to sign up' })).toHaveAttribute(
      'href',
      '/realms/acme/register?client_id=web',
    );
  });

  it('renders no sign-up form or script of its own', () => {
    const { container } = render(<SignUpRedirectPage />, {
      initialUrl: '/console/register/acme',
      routePattern: '/console/register/:realm',
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('does not redirect for a name that cannot be a realm', () => {
    render(<SignUpRedirectPage />, {
      initialUrl: '/console/register/..',
      routePattern: '/console/register/:realm',
    });
    expect(screen.getByRole('heading', { name: 'Invalid sign-up link' })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
