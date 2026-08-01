import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasswordInput from '../PasswordInput';

describe('PasswordInput', () => {
  it('renders as a password field by default', () => {
    render(<PasswordInput placeholder="Enter password" />);
    const input = screen.getByPlaceholderText('Enter password');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows a toggle button with accessible label', () => {
    render(<PasswordInput />);
    const toggleBtn = screen.getByRole('button', { name: /show password/i });
    expect(toggleBtn).toBeInTheDocument();
  });

  it('toggles to text type when the show-password button is clicked', async () => {
    const user = userEvent.setup();
    render(<PasswordInput placeholder="Enter password" />);
    const input = screen.getByPlaceholderText('Enter password');
    const toggleBtn = screen.getByRole('button', { name: /show password/i });

    await user.click(toggleBtn);

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();
  });

  it('toggles back to password type on second click', async () => {
    const user = userEvent.setup();
    render(<PasswordInput placeholder="Enter password" />);
    const input = screen.getByPlaceholderText('Enter password');
    const toggleBtn = screen.getByRole('button', { name: /show password/i });

    await user.click(toggleBtn);
    await user.click(screen.getByRole('button', { name: /hide password/i }));

    expect(input).toHaveAttribute('type', 'password');
  });

  it('forwards standard input props', () => {
    render(
      <PasswordInput
        id="my-password"
        value="secret"
        readOnly
        placeholder="Password"
      />,
    );
    const input = screen.getByPlaceholderText('Password');
    expect(input).toHaveAttribute('id', 'my-password');
    expect(input).toHaveValue('secret');
  });

  it('forwards the className onto the inner input', () => {
    render(<PasswordInput className="custom-class" placeholder="pwd" />);
    const input = screen.getByPlaceholderText('pwd');
    expect(input.className).toContain('custom-class');
  });

  it('calls onChange handler when user types', async () => {
    const user = userEvent.setup();
    let capturedValue = '';
    render(
      <PasswordInput
        placeholder="Enter password"
        onChange={(e) => {
          capturedValue = e.target.value;
        }}
      />,
    );
    const input = screen.getByPlaceholderText('Enter password');
    await user.type(input, 'mypass');
    expect(capturedValue).toBe('mypass');
  });

  it('appends pr-10 to ensure space for the toggle icon', () => {
    render(<PasswordInput className="custom" placeholder="pwd" />);
    const input = screen.getByPlaceholderText('pwd');
    expect(input.className).toContain('pr-10');
  });

  it('the toggle button does not have tabIndex -1 so it is reachable during keyboard navigation', () => {
    render(<PasswordInput />);
    const toggleBtn = screen.getByRole('button', { name: /show password/i });
    expect(toggleBtn).not.toHaveAttribute('tabIndex', '-1');
  });
});
