import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveTheme,
  createTheme,
  deleteTheme,
  duplicateTheme,
  getThemes,
  publishTheme,
  setActiveTheme,
} from '../../../api/themes';
import { render } from '../../../test/utils';
import type { Theme } from '../../../types/theme';
import ThemeListPage from '../ThemeListPage';

vi.mock('../../../api/themes', () => ({
  archiveTheme: vi.fn(),
  createTheme: vi.fn(),
  deleteTheme: vi.fn(),
  duplicateTheme: vi.fn(),
  getThemes: vi.fn(),
  publishTheme: vi.fn(),
  setActiveTheme: vi.fn(),
}));

function makeTheme(overrides: Partial<Theme>): Theme {
  return {
    id: 'theme-1',
    realmId: 'realm-1',
    name: 'theme',
    displayName: 'Theme',
    description: null,
    themeType: 'login',
    styles: {} as Theme['styles'],
    components: [],
    assets: {} as Theme['assets'],
    settings: {} as Theme['settings'],
    version: 1,
    published: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    publishedAt: '2026-07-29T00:00:00.000Z',
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function renderPage() {
  return render(<ThemeListPage />, {
    initialUrl: '/console/realms/test-realm/themes',
    routePattern: '/console/realms/:name/themes',
  });
}

describe('ThemeListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(archiveTheme).mockResolvedValue(makeTheme({}));
    vi.mocked(createTheme).mockResolvedValue(makeTheme({}));
    vi.mocked(deleteTheme).mockResolvedValue(undefined);
    vi.mocked(duplicateTheme).mockResolvedValue(makeTheme({}));
    vi.mocked(publishTheme).mockResolvedValue(makeTheme({}));
    vi.mocked(setActiveTheme).mockResolvedValue(makeTheme({ isActive: true }));
  });

  it('shows the active theme and protects it from destructive actions', async () => {
    vi.mocked(getThemes).mockResolvedValue([
      makeTheme({
        id: 'active-theme',
        name: 'active-theme',
        displayName: 'Active Theme',
        isActive: true,
      }),
    ]);

    renderPage();

    const row = (await screen.findByText('Active Theme')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Active')).toBeInTheDocument();
    expect(
      within(row!).queryByRole('button', { name: 'Activate' }),
    ).not.toBeInTheDocument();
    expect(
      within(row!).getByRole('button', { name: 'Archive' }),
    ).toBeDisabled();
    expect(
      within(row!).getByRole('button', { name: 'Delete' }),
    ).toBeDisabled();
  });

  it('keeps activation and destructive actions available for an inactive published theme', async () => {
    vi.mocked(getThemes).mockResolvedValue([
      makeTheme({
        id: 'inactive-theme',
        name: 'inactive-theme',
        displayName: 'Inactive Theme',
        isActive: false,
      }),
    ]);

    renderPage();

    const row = (await screen.findByText('Inactive Theme')).closest('tr');
    expect(row).not.toBeNull();
    expect(
      within(row!).getByRole('button', { name: 'Activate' }),
    ).toBeEnabled();
    expect(
      within(row!).getByRole('button', { name: 'Archive' }),
    ).toBeEnabled();
    expect(
      within(row!).getByRole('button', { name: 'Delete' }),
    ).toBeEnabled();
  });
});
