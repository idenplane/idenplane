import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import EmailProviderForm from '../EmailProviderForm';

// What the API returns in place of a stored secret (and accepts back as "keep").
const PLACEHOLDER = '••••••';

describe('EmailProviderForm', () => {
  it('sends a saved API key back as the placeholder so the server keeps it', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(body));
      }),
    );

    const user = userEvent.setup();
    render(
      <EmailProviderForm
        realm={makeRealm({
          name: 'my-realm',
          emailProvider: 'sendgrid',
          emailProviderConfig: {
            sendgrid: { apiKey: PLACEHOLDER, from: 'noreply@x.test' },
          },
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      await screen.findByText('Email settings saved successfully.'),
    ).toBeInTheDocument();
    expect(body).toMatchObject({
      emailProvider: 'sendgrid',
      emailProviderConfig: {
        sendgrid: { apiKey: PLACEHOLDER, from: 'noreply@x.test' },
      },
    });
  });
});
