# idenplane-vue

Vue 3 SDK for [Idenplane](https://github.com/Islamawad132/Authme) — composables, a Vue plugin, Vue Router guard, and an `AuthProvider` component.

## Installation

```bash
npm install idenplane-vue idenplane-sdk vue
```

## Quick Start

### 1. Install the plugin

```typescript
// main.ts
import { createApp } from 'vue';
import { AuthmePlugin } from 'idenplane-vue';
import App from './App.vue';

const app = createApp(App);

app.use(AuthmePlugin, {
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'http://localhost:5173/callback',
});

app.mount('#app');
```

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
import { AuthmeClient } from 'idenplane-sdk';

const authClient = new AuthmeClient({
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'http://localhost:5173/callback',
});

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
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

router.beforeEach(createAuthGuard({ loginRoute: '/login' }, authClient));

export default router;
```

### 4. AuthProvider component (scoped context)

```vue
<!-- App.vue -->
<template>
  <AuthProvider
    url="http://localhost:3000"
    realm="my-realm"
    client-id="my-app"
    redirect-uri="http://localhost:5173/callback"
  >
    <RouterView />
  </AuthProvider>
</template>

<script setup lang="ts">
import { AuthProvider } from 'idenplane-vue';
</script>
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

- `AuthmePlugin` — Vue plugin, call `app.use(AuthmePlugin, AuthmeConfig)`

### Composables

- `useAuth()` — `{ isAuthenticated, user, isLoading, login, logout, getToken, client }`
- `useUser()` — `{ user, isLoading, refresh }`
- `usePermissions()` — `{ hasRole, hasPermission, roles }`

### Navigation Guard

- `createAuthGuard(options?, client?)` — returns a `NavigationGuard`
  - `options.loginRoute` — redirect path (default: `'/login'`)
  - `options.roles` — global required roles

### Components

- `<AuthProvider>` — provides auth context to a component subtree

## License

MIT
