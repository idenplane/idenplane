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

  describe('test email', () => {
    const smtpRealm = () =>
      makeRealm({
        name: 'my-realm',
        emailProvider: 'smtp',
        smtpHost: 'smtp.example.com',
        smtpFrom: 'noreply@example.com',
      });
    const FAILURE =
      'The test email could not be sent: the email provider rejected the credentials. Check the username and password, or the API key.';

    it('shows the server’s reason when sending fails, not a success', async () => {
      server.use(
        http.post('/admin/realms/:name/email/test', () =>
          HttpResponse.json(
            { statusCode: 502, message: FAILURE },
            { status: 502 },
          ),
        ),
      );
      const user = userEvent.setup();
      render(<EmailProviderForm realm={smtpRealm()} />);

      await user.type(
        screen.getByPlaceholderText('you@example.com'),
        'me@example.com',
      );
      await user.click(screen.getByRole('button', { name: /send test/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE);
      expect(
        screen.queryByText(/test email sent successfully/i),
      ).not.toBeInTheDocument();
    });

    it('confirms a sent test email', async () => {
      let body: unknown = null;
      server.use(
        http.post('/admin/realms/:name/email/test', async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({
            success: true,
            message: 'Test email sent successfully',
          });
        }),
      );
      const user = userEvent.setup();
      render(<EmailProviderForm realm={smtpRealm()} />);

      await user.type(
        screen.getByPlaceholderText('you@example.com'),
        'me@example.com',
      );
      await user.click(screen.getByRole('button', { name: /send test/i }));

      expect(
        await screen.findByText(/test email sent successfully/i),
      ).toBeInTheDocument();
      expect(body).toEqual({ to: 'me@example.com' });
    });

    it('shows the server’s reason when the connection test fails', async () => {
      server.use(
        http.post('/admin/realms/:name/smtp/test', () =>
          HttpResponse.json(
            { statusCode: 502, message: FAILURE },
            { status: 502 },
          ),
        ),
      );
      const user = userEvent.setup();
      render(<EmailProviderForm realm={smtpRealm()} />);

      await user.click(screen.getByRole('button', { name: /test connection/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(FAILURE);
      expect(
        screen.queryByText(/connection successful/i),
      ).not.toBeInTheDocument();
    });
  });
});
