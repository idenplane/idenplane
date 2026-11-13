import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import RealmListPage from '../RealmListPage';

describe('RealmListPage', () => {
  it('shows a loading state initially', () => {
    render(<RealmListPage />, { initialUrl: '/console/realms' });
    expect(screen.getByText(/loading realms/i)).toBeInTheDocument();
  });

  it('renders the list of realms returned from the API', async () => {
    render(<RealmListPage />, { initialUrl: '/console/realms' });

    await screen.findByText('master');
    expect(screen.getByText('test-realm')).toBeInTheDocument();
  });

  it('renders realm display names', async () => {
    render(<RealmListPage />, { initialUrl: '/console/realms' });
    await screen.findByText('Master');
    expect(screen.getByText('Test Realm')).toBeInTheDocument();
  });

  it('shows the "Create Realm" button', async () => {
    render(<RealmListPage />, { initialUrl: '/console/realms' });
    await screen.findByText('master');
    expect(screen.getByRole('button', { name: /create realm/i })).toBeInTheDocument();
  });

  it('shows the "Import Realm" button', async () => {
    render(<RealmListPage />, { initialUrl: '/console/realms' });
    await screen.findByText('master');
    expect(screen.getByRole('button', { name: /import realm/i })).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    server.use(
      http.get('/admin/realms', () => {
        return HttpResponse.json({ message: 'Server error' }, { status: 500 });
      }),
    );

    render(<RealmListPage />, { initialUrl: '/console/realms' });
    expect(await screen.findByText(/failed to load realms/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no realms', async () => {
    server.use(
      http.get('/admin/realms', () => HttpResponse.json([])),
    );

    render(<RealmListPage />, { initialUrl: '/console/realms' });
    expect(
      await screen.findByText(/no realms found/i),
    ).toBeInTheDocument();
  });

  it('shows enabled badge for enabled realms', async () => {
    render(<RealmListPage />, { initialUrl: '/console/realms' });
    await screen.findByText('master');
    // Both default realms are enabled – there should be "Yes" badges
    const yesBadges = screen.getAllByText('Yes');
    expect(yesBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the page heading', async () => {
    render(<RealmListPage />, { initialUrl: '/console/realms' });
    await screen.findByText('master');
    expect(screen.getByRole('heading', { name: /realms/i })).toBeInTheDocument();
  });

  describe('import', () => {
    const upload = async (content: unknown) => {
      const user = userEvent.setup();
      render(<RealmListPage />, { initialUrl: '/console/realms' });
      await screen.findByText('master');
      const input = screen.getByLabelText(/import realm json file/i);
      await user.upload(
        input,
        new File([JSON.stringify(content)], 'realm.json', { type: 'application/json' }),
      );
    };

    it('confirms a clean import', async () => {
      server.use(
        http.post('/admin/realms/import', () =>
          HttpResponse.json({ realmName: 'copy', version: 2, warnings: [] }, { status: 201 }),
        ),
      );
      await upload({ version: 2, realm: { name: 'copy' } });
      expect(await screen.findByText(/realm "copy" imported successfully/i)).toBeInTheDocument();
    });

    it('lists the warnings of an import', async () => {
      server.use(
        http.post('/admin/realms/import', () =>
          HttpResponse.json(
            {
              realmName: 'copy',
              version: 2,
              warnings: ['webhook https://hooks.example: imported disabled'],
            },
            { status: 201 },
          ),
        ),
      );
      await upload({ version: 2, realm: { name: 'copy' } });
      expect(await screen.findByText(/check the following/i)).toBeInTheDocument();
      expect(screen.getByText(/imported disabled/i)).toBeInTheDocument();
    });

    it('shows the problems of a rejected file', async () => {
      server.use(
        http.post('/admin/realms/import', () =>
          HttpResponse.json(
            {
              statusCode: 400,
              message: "Invalid realm import: clients[0].authFlow: no flow named 'x'",
              errors: [{ path: 'clients[0].authFlow', message: "no flow named 'x'" }],
            },
            { status: 400 },
          ),
        ),
      );
      await upload({ version: 2, realm: { name: 'copy' } });
      expect(await screen.findByText(/invalid realm import: .*authFlow: no flow named/i)).toBeInTheDocument();
    });
  });
});
