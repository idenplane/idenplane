import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import EventSettingsForm from '../EventSettingsForm';

describe('EventSettingsForm', () => {
  it('seeds fields from the realm prop', () => {
    render(
      <EventSettingsForm
        realm={makeRealm({
          eventsEnabled: true,
          eventsExpiration: 1209600,
          adminEventsEnabled: true,
          loginEventRetentionDays: 45,
          adminEventRetentionDays: 120,
          deletionGracePeriodDays: 7,
        })}
      />,
    );
    expect(screen.getByLabelText('Enable login events')).toBeChecked();
    expect(screen.getByLabelText('Enable admin events')).toBeChecked();
    expect(screen.getByDisplayValue('1209600')).toBeInTheDocument();
    expect(screen.getByDisplayValue('45')).toBeInTheDocument();
    expect(screen.getByDisplayValue('120')).toBeInTheDocument();
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
  });

  it('submits only the event fields and shows a success banner', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(capturedBody));
      }),
    );

    const user = userEvent.setup();
    render(
      <EventSettingsForm
        realm={makeRealm({
          name: 'my-realm',
          eventsEnabled: true,
          eventsExpiration: 1209600,
          adminEventsEnabled: false,
          loginEventRetentionDays: 45,
          adminEventRetentionDays: 120,
          deletionGracePeriodDays: 7,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Event settings updated successfully.')).toBeInTheDocument();
    expect(capturedBody).toEqual({
      eventsEnabled: true,
      eventsExpiration: 1209600,
      adminEventsEnabled: false,
      loginEventRetentionDays: 45,
      adminEventRetentionDays: 120,
      deletionGracePeriodDays: 7,
    });
  });
});
