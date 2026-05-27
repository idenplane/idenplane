import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../test/utils';
import ConsentCategoriesListPage from '../ConsentCategoriesListPage';
import ConsentStatisticsPage from '../ConsentStatisticsPage';
import ConsentCategoryDetailPage from '../ConsentCategoryDetailPage';

const REALM = 'test-realm';

describe('ConsentCategoriesListPage', () => {
  const renderPage = () =>
    render(<ConsentCategoriesListPage />, {
      initialUrl: `/console/realms/${REALM}/consent-categories`,
      routePattern: '/console/realms/:name/consent-categories',
    });

  it('renders categories by display name and key', async () => {
    renderPage();
    await screen.findByText('Marketing');
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    // keys rendered in their own column
    expect(screen.getByText('marketing')).toBeInTheDocument();
    expect(screen.getByText('analytics')).toBeInTheDocument();
  });
});

describe('ConsentStatisticsPage', () => {
  const renderPage = () =>
    render(<ConsentStatisticsPage />, {
      initialUrl: `/console/realms/${REALM}/consent-statistics`,
      routePattern: '/console/realms/:name/consent-statistics',
    });

  it('renders the action-window metrics and per-category grants', async () => {
    renderPage();
    // total consents
    await screen.findByText('42');
    // action window values (24h=8, 7d=25, 30d=60)
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    // category breakdown: name + totalGrants
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
  });
});

describe('ConsentCategoryDetailPage', () => {
  it('create mode shows editable key + display name fields', async () => {
    render(<ConsentCategoryDetailPage />, {
      initialUrl: `/console/realms/${REALM}/consent-categories/new`,
      routePattern: '/console/realms/:name/consent-categories/:categoryId',
    });
    expect(
      screen.getByRole('heading', { name: /create consent category/i }),
    ).toBeInTheDocument();
    const key = screen.getByLabelText('Key') as HTMLInputElement;
    expect(key).toBeEnabled();
    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
  });

  it('edit mode loads the category and shows usage statistics', async () => {
    render(<ConsentCategoryDetailPage />, {
      initialUrl: `/console/realms/${REALM}/consent-categories/cat-1`,
      routePattern: '/console/realms/:name/consent-categories/:categoryId',
    });
    // displayName seeded into the form
    await screen.findByDisplayValue('Marketing');
    // key field is immutable in edit mode
    const key = screen.getByLabelText('Key') as HTMLInputElement;
    expect(key).toBeDisabled();
    // per-category stats panel
    await screen.findByText('Usage');
    expect(screen.getByText('Total Grants')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
  });
});
