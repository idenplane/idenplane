import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import GeneralSettingsForm from '../GeneralSettingsForm';

describe('GeneralSettingsForm', () => {
  it('seeds fields from the realm prop', () => {
    render(
      <GeneralSettingsForm
        realm={makeRealm({ displayName: 'My Realm', enabled: false, registrationAllowed: true })}
      />,
    );
    expect(screen.getByDisplayValue('My Realm')).toBeInTheDocument();
    expect(screen.getByLabelText('Enabled')).not.toBeChecked();
    expect(screen.getByLabelText('User Registration')).toBeChecked();
  });

  it('submits only the general fields and shows a success banner', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(capturedBody));
      }),
    );

    const user = userEvent.setup();
    render(
      <GeneralSettingsForm
        realm={makeRealm({ name: 'my-realm', displayName: 'My Realm', enabled: true, registrationAllowed: false })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Realm updated successfully.')).toBeInTheDocument();
    expect(capturedBody).toEqual({
      displayName: 'My Realm',
      enabled: true,
      registrationAllowed: false,
    });
  });
});
