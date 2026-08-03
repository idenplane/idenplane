# idenplane-sdk — Vanilla JS Quickstart

The simplest possible integration: no React, no bundler, no build step. A
plain `<script type="module">` and a browser [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) resolve `idenplane-sdk` straight from
`node_modules`, the same way a bundler normally would for you.

## Run it with Docker (fastest)

```bash
docker compose up
```

This starts Idenplane + Postgres, seeds a `quickstart` realm with a
`vanilla-js-quickstart` public client and a `demo` / `Demo1234!` user, then
serves this site at **http://localhost:3002**.

## Run it without Docker

You'll need an already-running Idenplane server (see the [root README](../../README.md)
or `docker compose up db idenplane` from the repo root) with a realm and a
**public** client registered with:

- Redirect URI: `http://localhost:3002/callback.html`
- Post-logout redirect URI: `http://localhost:3002/index.html`
- Web origin: `http://localhost:3002`

Then:

```bash
npm install
npm start
```

Edit [`config.js`](./config.js) if your server URL, realm, or client ID
differ from the defaults.

## How it works

- **`index.html` / `main.js`** — `client.init()` restores an existing session
  from storage on load; `client.login()` redirects to Idenplane's hosted
  login page; `client.getUserInfo()` reads the cached ID token claims once
  authenticated.
- **`callback.html` / `callback.js`** — the page your redirect URI points at.
  `client.handleCallback()` exchanges the authorization code for tokens (PKCE,
  no client secret needed since this is a public client), then this page
  bounces back to `index.html`.
- **`config.js`** — the one file you'd change per environment. There's no
  build step to inject env vars into, so it's just a plain exported object.

## Why an import map instead of a CDN link

You could instead import `idenplane-sdk` from a CDN like `esm.sh` with zero
local setup at all — but pinning to what's actually in your own
`node_modules` (via `npm install`) means you get the exact version your
`package.json` declares, offline-capable local development, and no
third-party CDN in your trust chain for a security library.
