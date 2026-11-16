# idenplane-vue

Vue 3 SDK for [Idenplane](https://github.com/idenplane/idenplane) — composables, a Vue plugin, Vue Router guard, and an `AuthProvider` component.

## Installation

```bash
npm install idenplane-vue idenplane-sdk vue
```

## Quick Start

### 1. Create one client and install the plugin

Create the client in its own module, so the plugin, the router guard and your components all use the same instance (one session, one `init()`):

```typescript
// auth.ts
import { IdenplaneClient } from 'idenplane-vue';

export const idenplane = new IdenplaneClient({
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'http://localhost:5173/callback',
});
```

```typescript
// main.ts
import { createApp } from 'vue';
import { IdenplanePlugin } from 'idenplane-vue';
import App from './App.vue';
import router from './router';
import { idenplane } from './auth';

const app = createApp(App);
app.use(IdenplanePlugin, { client: idenplane });
app.use(router);
app.mount('#app');
```

The plugin provides the client to every component and starts `init()` (discovery and session restore) right away. `app.use(IdenplanePlugin, { url, realm, clientId, redirectUri })` also works when nothing outside components needs the client.

### 2. Use `useAuth` in components

```vue
<script setup lang="ts">
import { useAuth } from 'idenplane-vue';

const { isAuthenticated, user, login, logout, isLoading } = useAuth();
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else-if="isAuthenticated">
    Hello, {{ user?.name }}
    <button @click="logout">Sign out</button>
  </div>
  <div v-else>
    <button @click="login()">Sign in</button>
  </div>
</template>
```

### 3. Protect routes with the navigation guard

```typescript
// router/index.ts
import { createRouter, createWebHistory } from 'vue-router';
import { createAuthGuard } from 'idenplane-vue';
import { idenplane } from '../auth'; // the client the plugin was given

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/login', component: Login },
    {
      path: '/dashboard',
      component: Dashboard,
      meta: { requiresAuth: true },
    },
    {
      path: '/admin',
      component: Admin,
      meta: { requiresAuth: true, roles: ['admin'] },
    },
  ],
});

router.beforeEach(createAuthGuard({ loginRoute: '/login' }, idenplane));

export default router;
```

Pass the same client to the guard: a guard created at module level runs outside any component, where `inject()` cannot reach the plugin's client. (On Vue 3.3+ with vue-router 4.2+, a guard created without a client looks it up from the app when it runs, but passing it is explicit and works on every version.) Routes without `requiresAuth` or `roles`, and the login route itself, are never redirected. If no client can be found for a protected route, the guard fails closed and redirects to the login route.

### 4. AuthProvider component (scoped context)

Instead of the plugin, `AuthProvider` provides a client to a component subtree and starts its `init()`. Pass the connection props, or `:client` to share a client you created (for example with the router guard):

```vue
<!-- App.vue -->
<template>
  <AuthProvider :client="idenplane">
    <RouterView />
  </AuthProvider>
</template>

<script setup lang="ts">
import { AuthProvider } from 'idenplane-vue';
import { idenplane } from './auth';
</script>
```

```vue
<AuthProvider
  url="http://localhost:3000"
  realm="my-realm"
  client-id="my-app"
  redirect-uri="http://localhost:5173/callback"
>
  <RouterView />
</AuthProvider>
```

### 5. Permissions

```vue
<script setup lang="ts">
import { usePermissions } from 'idenplane-vue';

const { hasRole, hasPermission, roles } = usePermissions();
</script>

<template>
  <AdminPanel v-if="hasRole('admin')" />
</template>
```

## API Reference

### Plugin

- `IdenplanePlugin` — Vue plugin: `app.use(IdenplanePlugin, { client })` to provide an existing client, or `app.use(IdenplanePlugin, IdenplaneConfig)` to let the plugin create one

### Composables

- `useAuth()` — `{ isAuthenticated, user, isLoading, login, logout, getToken, client }`
- `useUser()` — `{ user, isLoading, refresh }`
- `usePermissions()` — `{ hasRole, hasPermission, roles }`

### Navigation Guard

- `createAuthGuard(options?, client?)` — returns a `NavigationGuard`. Pass the shared client as `client`.
  - `options.loginRoute` — redirect path (default: `'/login'`)
  - `options.roles` — global required roles

### Components

- `<AuthProvider>` — provides a client to a component subtree and calls its `init()`. Props: `client`, or `url`, `realm`, `client-id`, `redirect-uri` (plus optional `scopes`, `storage`, `auto-refresh`)

## License

MIT
