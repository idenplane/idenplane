import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from '../Alert';

describe('Alert', () => {
  it('renders children', () => {
    render(<Alert>Something went wrong</Alert>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('defaults to the danger variant', () => {
    render(<Alert>Error</Alert>);
    expect(screen.getByRole('alert').className).toContain('bg-danger-soft');
    expect(screen.getByRole('alert').className).toContain('text-danger-fg');
  });

  it('applies variant colour classes', () => {
    render(<Alert variant="success">Saved</Alert>);
    expect(screen.getByRole('alert').className).toContain('bg-success-soft');
    expect(screen.getByRole('alert').className).toContain('text-success-fg');
  });

  it('applies warning variant colour classes', () => {
    render(<Alert variant="warning">Careful</Alert>);
    expect(screen.getByRole('alert').className).toContain('bg-warning-soft');
    expect(screen.getByRole('alert').className).toContain('text-warning-fg');
  });

  it('applies info variant colour classes', () => {
    render(<Alert variant="info">FYI</Alert>);
    expect(screen.getByRole('alert').className).toContain('bg-info-soft');
    expect(screen.getByRole('alert').className).toContain('text-info-fg');
  });

  it('renders an optional title above the body content', () => {
    render(<Alert title="Heads up">Details here</Alert>);
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Details here')).toBeInTheDocument();
  });

  it('renders a variant icon by default', () => {
    render(<Alert>Error</Alert>);
    expect(screen.getByRole('alert').querySelector('svg')).toBeInTheDocument();
  });

  it('omits the icon when icon={null}', () => {
    render(<Alert icon={null}>Error</Alert>);
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeInTheDocument();
  });

  it('forwards a custom className alongside variant classes', () => {
    render(<Alert className="mt-4">Error</Alert>);
    const el = screen.getByRole('alert');
    expect(el.className).toContain('mt-4');
    expect(el.className).toContain('bg-danger-soft');
  });

  it('forwards additional props such as data-testid', () => {
    render(<Alert data-testid="my-alert">Error</Alert>);
    expect(screen.getByTestId('my-alert')).toBeInTheDocument();
  });

  it('allows overriding the ARIA role', () => {
    render(<Alert role="status">Status update</Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
