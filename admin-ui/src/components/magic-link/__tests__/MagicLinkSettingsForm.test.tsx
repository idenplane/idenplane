import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import MagicLinkSettingsForm from '../MagicLinkSettingsForm';

describe('MagicLinkSettingsForm', () => {
  it('seeds fields from the realm prop on first render (regression: was showing hardcoded defaults)', () => {
    render(
      <MagicLinkSettingsForm
        realm={makeRealm({
          magicLinkEnabled: true,
          magicLinkExpirySeconds: 600,
          magicLinkRateLimitPerEmail: 7,
          magicLinkRateLimitWindowSeconds: 1800,
          magicLinkEmailSubject: 'Your custom sign-in link',
        })}
      />,
    );

    expect(screen.getByLabelText(/enable magic link authentication/i)).toBeChecked();
    expect(screen.getByDisplayValue('600')).toBeInTheDocument();
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1800')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Your custom sign-in link')).toBeInTheDocument();
  });

  it('submits only the magic-link fields and shows a success banner', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(capturedBody));
      }),
    );

    const user = userEvent.setup();
    render(
      <MagicLinkSettingsForm
        realm={makeRealm({
          name: 'my-realm',
          magicLinkEnabled: true,
          magicLinkExpirySeconds: 600,
          magicLinkRateLimitPerEmail: 7,
          magicLinkRateLimitWindowSeconds: 1800,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Magic link settings updated successfully.')).toBeInTheDocument();
    expect(capturedBody).toEqual({
      magicLinkEnabled: true,
      magicLinkExpirySeconds: 600,
      magicLinkRateLimitPerEmail: 7,
      magicLinkRateLimitWindowSeconds: 1800,
      magicLinkEmailSubject: null,
      magicLinkEmailTemplate: null,
    });
  });
});
