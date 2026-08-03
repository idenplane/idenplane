// Shared client config for index.html and callback.html. In a real app these
// values would typically come from build-time env vars or a small server
// endpoint — hardcoded here since this example deliberately has no build step.
export const config = {
  url: 'http://localhost:3000',
  realm: 'quickstart',
  clientId: 'vanilla-js-quickstart',
  redirectUri: 'http://localhost:3002/callback.html',
};
