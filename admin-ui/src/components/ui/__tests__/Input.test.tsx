import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../Input';

describe('Input', () => {
  it('associates the label with the input', () => {
    render(<Input label="Username" />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('honours an explicit id for label association', () => {
    render(<Input label="Email" id="email" />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('id', 'email');
  });

  it('accepts typed input', async () => {
    const user = userEvent.setup();
    render(<Input label="Name" />);
    await user.type(screen.getByLabelText('Name'), 'ada');
    expect(screen.getByLabelText('Name')).toHaveValue('ada');
  });

  it('shows an error message and hides the hint', () => {
    render(<Input label="Field" hint="A helpful hint" error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('A helpful hint')).not.toBeInTheDocument();
  });

  it('shows the hint when there is no error', () => {
    render(<Input label="Field" hint="A helpful hint" />);
    expect(screen.getByText('A helpful hint')).toBeInTheDocument();
  });

  it('renders prefix and suffix nodes', () => {
    render(<Input label="Field" prefix={<span>@</span>} suffix={<span>%</span>} />);
    expect(screen.getByText('@')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
  });
});
