import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies variant colour classes', () => {
    render(<Badge variant="success">OK</Badge>);
    expect(screen.getByText('OK').className).toContain('bg-success-soft');
  });

  it('renders a pulsing dot when `dot`', () => {
    render(<Badge variant="success" dot>Live</Badge>);
    const badge = screen.getByText('Live');
    const dot = badge.querySelector('span');
    expect(dot?.className).toContain('animate-pulse-dot');
  });

  it('uses the monospace face when `mono`', () => {
    render(<Badge mono>LOGIN_SUCCESS</Badge>);
    expect(screen.getByText('LOGIN_SUCCESS').className).toContain('font-mono');
  });
});
