import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderSelectorGrid } from '../ProviderSelectorGrid';
import type { ProviderOption } from '../ProviderSelectorGrid';

type TestProvider = 'none' | 'a' | 'b';

const OPTIONS: ProviderOption<TestProvider>[] = [
  { value: 'none', label: 'Disabled', description: 'Turned off.', icon: <span>x</span> },
  { value: 'a', label: 'Provider A', description: 'First provider.', badge: 'Popular', icon: <span>a</span> },
  { value: 'b', label: 'Provider B', description: 'Second provider.', icon: <span>b</span> },
];

describe('ProviderSelectorGrid', () => {
  it('renders a button for each option with its label and description', () => {
    render(<ProviderSelectorGrid options={OPTIONS} value="none" onChange={() => {}} />);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Provider A')).toBeInTheDocument();
    expect(screen.getByText('First provider.')).toBeInTheDocument();
    expect(screen.getByText('Provider B')).toBeInTheDocument();
  });

  it('marks the selected option as pressed and others as not', () => {
    render(<ProviderSelectorGrid options={OPTIONS} value="a" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /provider a/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /disabled/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /provider b/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders a badge when present', () => {
    render(<ProviderSelectorGrid options={OPTIONS} value="none" onChange={() => {}} />);
    expect(screen.getByText('Popular')).toBeInTheDocument();
  });

  it('calls onChange with the clicked option value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProviderSelectorGrid options={OPTIONS} value="none" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /provider b/i }));

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('defaults to a 3-column grid when columnsClassName is not provided', () => {
    const { container } = render(
      <ProviderSelectorGrid options={OPTIONS} value="none" onChange={() => {}} />,
    );
    expect(container.firstElementChild?.className).toContain('grid-cols-3');
  });

  it('applies a custom columnsClassName', () => {
    const { container } = render(
      <ProviderSelectorGrid
        options={OPTIONS}
        value="none"
        onChange={() => {}}
        columnsClassName="grid-cols-3 sm:grid-cols-5"
      />,
    );
    expect(container.firstElementChild?.className).toContain('sm:grid-cols-5');
  });
});
