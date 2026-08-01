import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import TokenSettingsForm from '../TokenSettingsForm';

describe('TokenSettingsForm', () => {
  it('seeds fields from the realm prop', () => {
    render(
      <TokenSettingsForm
        realm={makeRealm({ accessTokenLifespan: 600, refreshTokenLifespan: 3600, offlineTokenLifespan: 86400 })}
      />,
    );
    expect(screen.getByDisplayValue('600')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3600')).toBeInTheDocument();
    expect(screen.getByDisplayValue('86400')).toBeInTheDocument();
  });

  it('submits only the token fields and shows a success banner', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(capturedBody));
      }),
    );

    const user = userEvent.setup();
    render(
      <TokenSettingsForm
        realm={makeRealm({
          name: 'my-realm',
          accessTokenLifespan: 600,
          refreshTokenLifespan: 3600,
          offlineTokenLifespan: 86400,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Token settings updated successfully.')).toBeInTheDocument();
    expect(capturedBody).toEqual({
      accessTokenLifespan: 600,
      refreshTokenLifespan: 3600,
      offlineTokenLifespan: 86400,
    });
  });
});
