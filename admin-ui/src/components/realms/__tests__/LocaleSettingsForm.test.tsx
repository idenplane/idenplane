import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import LocaleSettingsForm from '../LocaleSettingsForm';

describe('LocaleSettingsForm', () => {
  it('seeds fields from the realm prop', () => {
    render(
      <LocaleSettingsForm
        realm={makeRealm({ defaultLocale: 'fr', supportedLocales: ['fr', 'de', 'ar'] })}
      />,
    );
    expect(screen.getByDisplayValue('fr')).toBeInTheDocument();
    expect(screen.getByDisplayValue('fr, de, ar')).toBeInTheDocument();
  });

  it('submits only the locale fields and shows a success banner', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(capturedBody));
      }),
    );

    const user = userEvent.setup();
    render(
      <LocaleSettingsForm
        realm={makeRealm({ name: 'my-realm', defaultLocale: 'es', supportedLocales: ['es', 'en'] })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Locale settings updated successfully.')).toBeInTheDocument();
    expect(capturedBody).toEqual({
      defaultLocale: 'es',
      supportedLocales: ['es', 'en'],
    });
  });
});
