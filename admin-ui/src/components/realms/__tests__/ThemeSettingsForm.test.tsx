import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import ThemeSettingsForm from '../ThemeSettingsForm';

const THEMES = [
  { name: 'idenplane', displayName: 'Idenplane' },
  { name: 'midnight', displayName: 'Midnight' },
];

function mockThemes() {
  server.use(http.get('/admin/realms/themes', () => HttpResponse.json(THEMES)));
}

describe('ThemeSettingsForm', () => {
  it('seeds fields from the realm prop', async () => {
    mockThemes();
    render(
      <ThemeSettingsForm
        realm={makeRealm({ themeName: 'midnight', loginTheme: 'midnight', accountTheme: 'midnight', emailTheme: 'midnight' })}
      />,
    );

    const selects = await screen.findAllByRole('combobox');
    expect(selects).toHaveLength(3);
    for (const select of selects) {
      expect(select).toHaveValue('midnight');
    }
  });

  it('submits only the theme fields and shows a success banner', async () => {
    mockThemes();
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(capturedBody));
      }),
    );

    const user = userEvent.setup();
    render(<ThemeSettingsForm realm={makeRealm({ name: 'my-realm' })} />);

    await user.click(await screen.findByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Theme settings updated successfully.')).toBeInTheDocument();
    expect(capturedBody).toEqual({
      themeName: 'default',
      loginTheme: 'default',
      accountTheme: 'default',
      emailTheme: 'default',
    });
  });
});
