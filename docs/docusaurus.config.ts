import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// AuthMe brand colors from themes/authme/theme.json
const authmeColors = {
  primaryColor: '#2563eb',
  backgroundColor: '#f0f2f5',
};

const config: Config = {
  title: 'AuthMe',
  tagline: 'Open-source authentication made simple',
  favicon: 'img/icon.svg',

  url: 'https://authme.dev',
  baseUrl: '/',
  organizationName: 'authme-project',
  projectName: 'authme-docs',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/authme-project/authme/tree/main/docs',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [],

  themeConfig: {
    image: 'img/social-card.png',

    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },

    navbar: {
      title: 'AuthMe',
      logo: {
        alt: 'AuthMe Logo',
        src: 'img/logo.svg',
        srcDark: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'mainSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          to: '/api',
          label: 'API Reference',
          position: 'left',
        },
        {
          href: 'https://github.com/authme-project/authme',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://discord.gg/authme',
          label: 'Discord',
          position: 'right',
        },
      ],
    },

    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Quickstart',
              to: '/quickstart',
            },
            {
              label: 'Installation',
              to: '/getting-started/installation',
            },
            {
              label: 'Configuration',
              to: '/getting-started/configuration',
            },
          ],
        },
        {
          title: 'SDKs',
          items: [
            {
              label: 'React',
              to: '/guides/sdks/react-sdk',
            },
            {
              label: 'Next.js',
              to: '/guides/sdks/nextjs-sdk',
            },
            {
              label: 'Vue',
              to: '/guides/sdks/vue-sdk',
            },
          ],
        },
        {
          title: 'Resources',
          items: [
            {
              label: 'API Reference',
              to: '/api',
            },
            {
              label: 'Deployment',
              to: '/deployment/docker',
            },
            {
              label: 'Migration',
              to: '/migration/keycloak',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/authme-project/authme',
            },
            {
              label: 'Discord',
              href: 'https://discord.gg/authme',
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/authme',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AuthMe. Built with Docusaurus.`,
    },

    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'yaml', 'json', 'typescript', 'javascript', 'kotlin', 'swift'],
    },

    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },

    announcementBar: {
      id: 'support_us',
      content: '⭐️ If you like AuthMe, give it a star on <a href="https://github.com/authme-project/authme" target="_blank" rel="noopener noreferrer">GitHub</a>!',
      backgroundColor: authmeColors.primaryColor,
      textColor: '#ffffff',
      isCloseable: true,
    },
  } satisfies Config['themeConfig'],
};

export default config;