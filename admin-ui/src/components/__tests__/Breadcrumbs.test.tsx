import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { render } from '@testing-library/react';
import Breadcrumbs from '../Breadcrumbs';

function renderAt(path: string, routePattern = path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePattern} element={<Breadcrumbs />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Breadcrumbs', () => {
  it('renders nothing on the dashboard root', () => {
    const { container } = renderAt('/console');
    expect(container.querySelector('nav')).not.toBeInTheDocument();
  });

  it('renders Home > Realms on /console/realms', () => {
    renderAt('/console/realms');
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('Realms')).toBeInTheDocument();
  });

  it('renders Home > Realms > realm-name on realm detail page', () => {
    renderAt('/console/realms/my-realm', '/console/realms/:name');
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Realms' })).toBeInTheDocument();
    // Last crumb is plain text (no link)
    expect(screen.getByText('my-realm')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'my-realm' })).not.toBeInTheDocument();
  });

  it('renders Home > Realms > realm > Users on users list page', () => {
    renderAt('/console/realms/my-realm/users', '/console/realms/:name/users');
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('Home');
    expect(links[1]).toHaveTextContent('Realms');
    expect(links[2]).toHaveTextContent('my-realm');
    expect(screen.getByText('Users')).toBeInTheDocument();
    // "Users" is the last crumb and should not be a link
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('renders correct breadcrumbs for user detail page', () => {
    renderAt(
      '/console/realms/my-realm/users/user-abc',
      '/console/realms/:name/users/:id',
    );
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Home', 'Realms', 'my-realm', 'Users']);
    expect(screen.getByText('user-abc')).toBeInTheDocument();
  });

  it('renders correct breadcrumbs for client list page', () => {
    renderAt('/console/realms/test/clients', '/console/realms/:name/clients');
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('Clients')).toBeInTheDocument();
  });

  it('renders correct breadcrumbs for the events page', () => {
    renderAt('/console/realms/test/events', '/console/realms/:name/events');
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it('renders correct breadcrumbs for admin-events page', () => {
    renderAt('/console/realms/test/admin-events', '/console/realms/:name/admin-events');
    expect(screen.getByText('Admin Events')).toBeInTheDocument();
  });

  it('last crumb has no link', () => {
    renderAt('/console/realms/test/sessions', '/console/realms/:name/sessions');
    // "Sessions" is last – no anchor
    expect(screen.queryByRole('link', { name: 'Sessions' })).not.toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('Home link points to /console', () => {
    renderAt('/console/realms');
    const homeLink = screen.getByRole('link', { name: 'Home' });
    expect(homeLink).toHaveAttribute('href', '/console');
  });
});
