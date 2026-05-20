import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  mainSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: 'Introduction',
    },
    {
      type: 'doc',
      id: 'quickstart',
      label: 'Quickstart',
    },
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        {
          type: 'doc',
          id: 'getting-started/installation',
          label: 'Installation',
        },
        {
          type: 'doc',
          id: 'getting-started/configuration',
          label: 'Configuration',
        },
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      link: {
        type: 'generated-index',
        title: 'API Reference',
        description: 'Complete API documentation for Idenplane',
        slug: '/api',
      },
      items: [
        {
          type: 'doc',
          id: 'api/authentication',
          label: 'Authentication',
        },
        {
          type: 'doc',
          id: 'api/oauth',
          label: 'OAuth',
        },
        {
          type: 'doc',
          id: 'api/users',
          label: 'Users',
        },
        {
          type: 'doc',
          id: 'api/clients',
          label: 'Clients',
        },
        {
          type: 'doc',
          id: 'api/realms',
          label: 'Realms',
        },
      ],
    },
    {
      type: 'category',
      label: 'SDK Guides',
      items: [
        {
          type: 'doc',
          id: 'guides/sdks/react-sdk',
          label: 'React',
        },
        {
          type: 'doc',
          id: 'guides/sdks/nextjs-sdk',
          label: 'Next.js',
        },
        {
          type: 'doc',
          id: 'guides/sdks/angular-sdk',
          label: 'Angular',
        },
        {
          type: 'doc',
          id: 'guides/sdks/vue-sdk',
          label: 'Vue',
        },
        {
          type: 'doc',
          id: 'guides/sdks/android-sdk',
          label: 'Android',
        },
        {
          type: 'doc',
          id: 'guides/sdks/ios-sdk',
          label: 'iOS',
        },
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        {
          type: 'doc',
          id: 'guides/authentication',
          label: 'Authentication',
        },
        {
          type: 'doc',
          id: 'guides/authorization',
          label: 'Authorization',
        },
        {
          type: 'doc',
          id: 'guides/mfa',
          label: 'Multi-Factor Authentication',
        },
      ],
    },
    {
      type: 'category',
      label: 'Configuration',
      items: [
        {
          type: 'doc',
          id: 'configuration/environment-variables',
          label: 'Environment Variables',
        },
        {
          type: 'doc',
          id: 'configuration/options',
          label: 'Configuration Options',
        },
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      items: [
        {
          type: 'doc',
          id: 'deployment/docker',
          label: 'Docker',
        },
        {
          type: 'doc',
          id: 'deployment/kubernetes',
          label: 'Kubernetes',
        },
        {
          type: 'doc',
          id: 'deployment/bare-metal',
          label: 'Bare Metal',
        },
      ],
    },
    {
      type: 'category',
      label: 'Migration',
      items: [
        {
          type: 'doc',
          id: 'migration/keycloak',
          label: 'From Keycloak',
        },
        {
          type: 'doc',
          id: 'migration/auth0',
          label: 'From Auth0',
        },
      ],
    },
  ],
};

export default sidebars;