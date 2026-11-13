import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '../../../test/utils';
import FlowStepPalette from '../FlowStepPalette';

describe('FlowStepPalette', () => {
  it('offers the email, magic-link and social steps as supported', () => {
    render(<FlowStepPalette onAddStep={() => {}} />);
    for (const type of ['email_otp', 'magic_link', 'social']) {
      const button = screen.getByTestId(`palette-step-${type}`);
      expect(within(button).queryByText('coming')).not.toBeInTheDocument();
    }
  });

  it('still marks consent, which is not a flow step', () => {
    render(<FlowStepPalette onAddStep={() => {}} />);
    const consent = screen.getByTestId('palette-step-consent');
    expect(within(consent).getByText('coming')).toBeInTheDocument();
  });

  it('adds a magic-link step on click', () => {
    const onAddStep = vi.fn();
    render(<FlowStepPalette onAddStep={onAddStep} />);
    fireEvent.click(screen.getByTestId('palette-step-magic_link'));
    expect(onAddStep).toHaveBeenCalledWith('magic_link');
  });
});
