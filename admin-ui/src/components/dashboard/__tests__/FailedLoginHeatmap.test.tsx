import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeFailedLoginHeatmap } from '../../../test/mocks/data';
import FailedLoginHeatmap from '../FailedLoginHeatmap';

const BASE = '/admin';

function renderHeatmap(realmName = 'test-realm') {
  return render(<FailedLoginHeatmap realmName={realmName} />);
}

describe('FailedLoginHeatmap', () => {
  it('renders the section heading', async () => {
    renderHeatmap();
    expect(await screen.findByRole('heading', { name: /failed logins by time of day/i })).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no failures', async () => {
    server.use(
      http.get(`${BASE}/realms/:name/stats/failed-login-heatmap`, () =>
        HttpResponse.json(makeFailedLoginHeatmap({ totalFailures: 0, windowDays: 30 })),
      ),
    );
    renderHeatmap();
    expect(await screen.findByText(/no failed logins in the last 30 days/i)).toBeInTheDocument();
  });

  it('renders a cell with the correct count for a populated bucket', async () => {
    const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    heatmap[1][9] = 5; // Monday 9am UTC
    server.use(
      http.get(`${BASE}/realms/:name/stats/failed-login-heatmap`, () =>
        HttpResponse.json(makeFailedLoginHeatmap({ totalFailures: 5, windowDays: 30, heatmap })),
      ),
    );
    renderHeatmap();

    expect(
      await screen.findByRole('img', { name: /mon 9:00 utc: 5 failed logins/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/5 failed logins in the last 30 days/i)).toBeInTheDocument();
  });
});
