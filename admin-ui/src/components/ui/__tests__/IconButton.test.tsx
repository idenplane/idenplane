import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from '../IconButton';
import { Icons } from '../icons';

describe('IconButton', () => {
  it('exposes its label as the accessible name and title', () => {
    render(<IconButton icon={Icons.Bell} label="Notifications" />);
    const btn = screen.getByRole('button', { name: 'Notifications' });
    expect(btn).toHaveAttribute('title', 'Notifications');
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<IconButton icon={Icons.Bell} label="Notifications" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reflects the active state in its classes', () => {
    const { rerender } = render(<IconButton icon={Icons.Bell} label="Bell" />);
    expect(screen.getByRole('button').className).toContain('bg-transparent');
    rerender(<IconButton icon={Icons.Bell} label="Bell" active />);
    expect(screen.getByRole('button').className).toContain('bg-active');
  });
});
