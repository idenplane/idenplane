import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from '../Avatar';
import { SectionHeader } from '../SectionHeader';
import { Kbd } from '../Kbd';
import { EmptyState } from '../EmptyState';
import { Sparkline } from '../Sparkline';
import { Tooltip } from '../Tooltip';
import { Icons } from '../icons';

describe('Avatar', () => {
  it('derives two-letter initials from the name', () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('applies the requested pixel size', () => {
    render(<Avatar name="Ada Lovelace" size={48} />);
    expect(screen.getByText('AL')).toHaveStyle({ width: '48px', height: '48px' });
  });
});

describe('SectionHeader', () => {
  it('renders title, eyebrow, hint and action', () => {
    render(
      <SectionHeader
        title="Recent events"
        eyebrow="Audit"
        hint="auto-refresh"
        action={<button>View all</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Recent events' })).toBeInTheDocument();
    expect(screen.getByText('Audit')).toBeInTheDocument();
    expect(screen.getByText('auto-refresh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View all' })).toBeInTheDocument();
  });
});

describe('Kbd', () => {
  it('renders inside a <kbd> element', () => {
    render(<Kbd>⌘K</Kbd>);
    const el = screen.getByText('⌘K');
    expect(el.tagName).toBe('KBD');
  });
});

describe('EmptyState', () => {
  it('renders icon, title, hint and action', () => {
    render(
      <EmptyState
        icon={Icons.Users}
        title="No users"
        hint="Invite someone"
        action={<button>Invite</button>}
      />,
    );
    expect(screen.getByText('No users')).toBeInTheDocument();
    expect(screen.getByText('Invite someone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('renders an svg with a path for the supplied data', () => {
    const { container } = render(<Sparkline data={[1, 4, 2, 8, 5]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('renders nothing for empty data', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});

describe('Tooltip', () => {
  it('renders the trigger and the tooltip content', () => {
    render(
      <Tooltip content="More info">
        <button>Hover me</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'Hover me' })).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('More info');
  });
});
