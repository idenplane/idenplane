import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '../../test/utils';
import { server } from '../../test/mocks/server';
import { mockMe, SignedIn } from '../../test/signedIn';
import ForbiddenNotice from '../ForbiddenNotice';
import apiClient, { announceForbidden, hasCredentials } from '../../api/client';

describe('ForbiddenNotice', () => {
  it('shows the server reason and the signed-in role, and can be dismissed', async () => {
    mockMe({ roles: ['view-only'] });
    render(
      <SignedIn>
        <ForbiddenNotice />
      </SignedIn>,
    );
    act(() => announceForbidden({ message: 'Your admin role does not allow this action' }));
    expect(await screen.findByText("You don't have permission to do that")).toBeInTheDocument();
    expect(screen.getByText('Your admin role does not allow this action')).toBeInTheDocument();
    expect(await screen.findByText('Signed in as view-only.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText("You don't have permission to do that")).not.toBeInTheDocument();
  });

  it('falls back to a generic reason', async () => {
    render(<ForbiddenNotice />);
    act(() => announceForbidden(undefined));
    expect(
      await screen.findByText('Your admin role does not allow this action'),
    ).toBeInTheDocument();
  });

  it('is raised by any 403 from the admin API, without signing out', async () => {
    mockMe({ roles: ['view-only'] });
    server.use(
      http.post('/admin/realms/acme/groups', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'Your admin role does not allow this action' },
          { status: 403 },
        ),
      ),
    );
    render(
      <SignedIn>
        <span>signed in</span>
        <ForbiddenNotice />
      </SignedIn>,
    );
    await screen.findByText('signed in');
    await expect(apiClient.post('/realms/acme/groups', { name: 'x' })).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(await screen.findByText("You don't have permission to do that")).toBeInTheDocument();
    expect(hasCredentials()).toBe(true);
  });
});
