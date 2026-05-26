import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Segmented } from '../Segmented';
import { Switch } from '../Switch';

const tfOptions = [
  { id: '1h', label: '1h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
];

describe('Segmented', () => {
  it('marks the active option with aria-selected', () => {
    render(<Segmented options={tfOptions} value="24h" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: '24h' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '1h' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the chosen id', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Segmented options={tfOptions} value="24h" onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: '7d' }));
    expect(onChange).toHaveBeenCalledWith('7d');
  });
});

describe('Switch', () => {
  it('exposes role="switch" with the correct aria-checked', () => {
    render(<Switch checked={false} onChange={() => {}} label="Enabled" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles via onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} label="Enabled" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not toggle when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} disabled label="Enabled" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders its label and hint', () => {
    render(<Switch checked onChange={() => {}} label="Dark mode" hint="Easier on the eyes" />);
    expect(screen.getByText('Dark mode')).toBeInTheDocument();
    expect(screen.getByText('Easier on the eyes')).toBeInTheDocument();
  });
});
