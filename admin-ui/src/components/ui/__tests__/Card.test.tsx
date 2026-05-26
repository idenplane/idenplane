import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card } from '../Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Body</Card>);
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('applies the default (md) padding', () => {
    render(<Card>X</Card>);
    expect(screen.getByText('X').className).toContain('p-5');
  });

  it('supports padding="none"', () => {
    render(<Card padding="none">X</Card>);
    expect(screen.getByText('X').className).toContain('p-0');
  });

  it('adds a hover-lift class when `hover`', () => {
    render(<Card hover>X</Card>);
    expect(screen.getByText('X').className).toContain('hover:shadow-lift');
  });

  it('is clickable when given onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Card onClick={onClick}>Tap</Card>);
    const el = screen.getByText('Tap');
    expect(el.className).toContain('cursor-pointer');
    await user.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
