import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MutationStatusBanner } from '../MutationStatusBanner';

describe('MutationStatusBanner', () => {
  it('renders nothing when the mutation is idle', () => {
    const { container } = render(
      <MutationStatusBanner
        mutation={{ isSuccess: false, isError: false, error: null }}
        successMessage="Saved!"
        errorFallback="Failed."
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the success message with role="status" on success', () => {
    render(
      <MutationStatusBanner
        mutation={{ isSuccess: true, isError: false, error: null }}
        successMessage="Settings saved successfully."
        errorFallback="Failed to save."
      />,
    );
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Settings saved successfully.');
  });

  it('renders the error fallback with role="alert" when the error has no message', () => {
    render(
      <MutationStatusBanner
        mutation={{ isSuccess: false, isError: true, error: null }}
        successMessage="Saved!"
        errorFallback="Failed to save settings."
      />,
    );
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Failed to save settings.');
  });

  it("prefers the error's own message over the fallback", () => {
    render(
      <MutationStatusBanner
        mutation={{ isSuccess: false, isError: true, error: new Error('Specific failure') }}
        successMessage="Saved!"
        errorFallback="Generic fallback."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Specific failure');
  });
});
