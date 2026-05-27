import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAllRealms } from '../api/realms';
import { useAuth } from '../hooks/useAuth';
import Breadcrumbs from './Breadcrumbs';
import { Icons, cn } from './ui';
import type { IconProps } from './ui';

type NavItem = { to: string; label: string; icon: (p: IconProps) => React.JSX.Element; end?: boolean };

export default function Layout() {
  const { name: routeRealm } = useParams<{ name: string }>();
  const location = useLocation();
  // The in-Layout 404 catch-all (`*`) doesn't match the `:name` param, so fall
  // back to the realm in the URL. This keeps the realm sidebar present on a
  // realm-scoped 404 (F-15); the `realms.some(...)` guard below still rejects
  // non-realm segments such as `/console/realms/create`.
  const currentRealm =
    routeRealm ?? location.pathname.match(/^\/console\/realms\/([^/]+)/)?.[1];
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [realmDropdownOpen, setRealmDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: realms } = useQuery({
    queryKey: ['realms'],
    queryFn: getAllRealms,
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setRealmDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems: NavItem[] = currentRealm
    ? [
        { to: `/console/realms/${currentRealm}`, label: 'Overview', icon: Icons.Activity },
        { to: `/console/realms/${currentRealm}/users`, label: 'Users', icon: Icons.Users },
        { to: `/console/realms/${currentRealm}/clients`, label: 'Clients', icon: Icons.Clients },
        { to: `/console/realms/${currentRealm}/roles`, label: 'Roles', icon: Icons.Roles },
        { to: `/console/realms/${currentRealm}/groups`, label: 'Groups', icon: Icons.Groups },
        { to: `/console/realms/${currentRealm}/client-scopes`, label: 'Client Scopes', icon: Icons.Code },
        { to: `/console/realms/${currentRealm}/consent-categories`, label: 'Consent Categories', icon: Icons.ShieldCheck },
        { to: `/console/realms/${currentRealm}/consent-statistics`, label: 'Consent Statistics', icon: Icons.Trend },
        { to: `/console/realms/${currentRealm}/sessions`, label: 'Sessions', icon: Icons.Sessions },
        { to: `/console/realms/${currentRealm}/events`, label: 'Events', icon: Icons.Events },
        { to: `/console/realms/${currentRealm}/admin-events`, label: 'Admin Events', icon: Icons.Clock },
        { to: `/console/realms/${currentRealm}/user-federation`, label: 'User Federation', icon: Icons.Database },
        { to: `/console/realms/${currentRealm}/identity-providers`, label: 'Identity Providers', icon: Icons.Idp },
        { to: `/console/realms/${currentRealm}/saml-providers`, label: 'SAML Providers', icon: Icons.Globe },
        { to: `/console/realms/${currentRealm}/auth-flows`, label: 'Auth Flows', icon: Icons.Build },
      ]
    : [];

  const globalNav: NavItem[] = [
    { to: '/console', label: 'Dashboard', icon: Icons.Dashboard, end: true },
    { to: '/console/realms', label: 'Realms', icon: Icons.Realms, end: false },
  ];

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
      isActive
        ? 'bg-sidebar-active font-medium text-white'
        : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white',
    );

  const activeBar = (
    <span className="absolute -left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-emerald shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
  );

  return (
    <div className="flex h-screen bg-canvas">
      {/* Skip navigation link — visible on focus for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-sidebar-line bg-sidebar text-sidebar-fg transition-transform duration-200 md:relative md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Sidebar"
      >
        <div className="flex h-16 shrink-0 items-center border-b border-sidebar-line px-6">
          {/* Dark-background wordmark; the image already includes the
              "idenplane" text, so no separate label span is needed. */}
          <img src="/console/idenplane-logo-dark.png" alt="Idenplane" className="h-9 w-auto" />
        </div>

        {/* Realm switcher */}
        <div className="relative px-3 pt-3" ref={dropdownRef}>
          <button
            onClick={() => setRealmDropdownOpen(!realmDropdownOpen)}
            aria-haspopup="listbox"
            aria-expanded={realmDropdownOpen}
            aria-label={currentRealm ? `Current realm: ${currentRealm}. Switch realm` : 'Select realm'}
            className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-gradient-to-br from-cyan-500 to-violet-600 text-[10px] font-bold text-white">
              {(currentRealm || 'R')[0].toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[9.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted">Realm</span>
              <span className="block truncate font-mono text-[12.5px] font-medium text-white">
                {currentRealm || 'Select Realm'}
              </span>
            </span>
            <Icons.ChevronD className="h-3.5 w-3.5 text-sidebar-muted" />
          </button>

          {realmDropdownOpen && realms && (
            <ul
              role="listbox"
              aria-label="Realms"
              className="absolute left-3 right-3 z-50 mt-1 animate-fade-up rounded-xl border border-line bg-surface p-1 shadow-float"
            >
              {realms.map((realm) => (
                <li key={realm.id} role="option" aria-selected={realm.name === currentRealm}>
                  <button
                    onClick={() => {
                      navigate(`/console/realms/${realm.name}`);
                      setRealmDropdownOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-[7px] text-left font-mono text-[12.5px] transition-colors',
                      realm.name === currentRealm
                        ? 'bg-accent-soft font-semibold text-accent-strong'
                        : 'text-fg hover:bg-hover',
                    )}
                  >
                    <span className="flex-1 truncate">{realm.displayName || realm.name}</span>
                    {realm.name === currentRealm && <Icons.Check className="h-3.5 w-3.5" />}
                  </button>
                </li>
              ))}
              {realms.length === 0 && <li className="px-3 py-2 text-sm text-subtle">No realms found</li>}
            </ul>
          )}
        </div>

        {/* Nav */}
        <nav aria-label="Main navigation" className="mt-3 flex-1 overflow-y-auto px-3 pb-4">
          <div className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-muted">
            Global
          </div>
          {globalNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setSidebarOpen(false)} className={navLinkClass}>
                {({ isActive }) => (
                  <>
                    {isActive && activeBar}
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}

          {currentRealm && realms?.some((r) => r.name === currentRealm) && (
            <div className="mt-3">
              <div
                className="px-2.5 pb-1 pt-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-muted"
                aria-hidden="true"
              >
                {currentRealm}
              </div>
              <nav aria-label={`${currentRealm} realm navigation`}>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.to} to={item.to} end onClick={() => setSidebarOpen(false)} className={navLinkClass}>
                      {({ isActive }) => (
                        <>
                          {isActive && activeBar}
                          <Icon className="h-4 w-4 shrink-0" />
                          <span>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </nav>
            </div>
          )}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between border-b border-line bg-topbar px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={sidebarOpen}
              className="text-muted hover:text-fg md:hidden"
            >
              <Icons.Menu className="h-6 w-6" />
            </button>
            {currentRealm && (
              <span className="hidden font-mono text-xs text-subtle md:inline">{currentRealm}</span>
            )}
          </div>

          <button
            onClick={logout}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-[13.5px] font-medium text-fg shadow-soft transition-all duration-150 hover:border-subtle hover:bg-hover focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            <Icons.Logout className="h-4 w-4" />
            Logout
          </button>
        </header>

        {/* Page content */}
        <main id="main-content" className="flex-1 overflow-y-auto p-4 sm:p-6" tabIndex={-1}>
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
