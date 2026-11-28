import * as safeHttp from '../../src/common/security/safe-http-client';

/**
 * Routes the SSRF-safe client (`safePost` / `safeGet`) through
 * `global.fetch` until the mocks are restored, so a `global.fetch` mock can
 * stand in for an external provider on a made-up host
 * (`https://idp.example.test`) that DNS would never resolve.
 *
 * The SSRF policy itself (refused addresses, DNS pinning, redirects) is
 * covered by `src/common/security/safe-http-client.spec.ts` against a real
 * server; these e2e tests are about what the broker and the audit streams do
 * with a provider's answers. Restored by `jest.restoreAllMocks()`, or by
 * calling the returned function.
 */
export function routeSafeHttpThroughFetch(): () => void {
  const viaFetch = async (url: string, init: RequestInit) => {
    const res = await fetch(url, init);
    return { statusCode: res.status, body: await res.text() };
  };
  const post = jest
    .spyOn(safeHttp, 'safePost')
    .mockImplementation((url, body, headers) =>
      viaFetch(url, { method: 'POST', headers, body }),
    );
  const get = jest
    .spyOn(safeHttp, 'safeGet')
    .mockImplementation((url, headers) => viaFetch(url, { headers }));
  return () => {
    post.mockRestore();
    get.mockRestore();
  };
}
