import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

// ─── Feature Card ─────────────────────────────────────────────────────────────

interface FeatureProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  link?: string;
}

function Feature({ title, description, icon, link }: FeatureProps) {
  const content = (
    <div className={clsx('col', styles.featureCard)}>
      <div className="text-4xl mb-4">{icon}</div>
      <Heading as="h3" className={styles.featureTitle}>
        {title}
      </Heading>
      <p className={styles.featureDescription}>{description}</p>
    </div>
  );

  if (link) {
    return (
      <Link to={link} className={clsx(styles.featureLink, 'clean-url')}>
        {content}
      </Link>
    );
  }

  return content;
}

// ─── Feature icons as SVG components ─────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-8 h-8 text-blue-600"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-8 h-8 text-blue-600"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
      />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-8 h-8 text-blue-600"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
      />
    </svg>
  );
}

function PuzzleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-8 h-8 text-blue-600"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.644.644 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-8 h-8 text-blue-600"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-8 h-8 text-blue-600"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
      />
    </svg>
  );
}

// ─── Main Page Component ───────────────────────────────────────────────────────

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();

  return (
    <Layout
      title="Open-source authentication made simple"
      description="AuthMe is a secure, scalable authentication server with OAuth 2.0, SAML, LDAP support and multi-factor authentication."
    >
      <main>
        {/* Hero Section */}
        <section className={styles.heroSection}>
          <div className={styles.heroContainer}>
            <div className={styles.heroBadge}>
              <span className={styles.badgeDot} />
              Open Source & Self-hostable
            </div>
            <h1 className={styles.heroTitle}>
              Authentication made
              <span className={styles.heroHighlight}> simple</span>
            </h1>
            <p className={styles.heroSubtitle}>
              {siteConfig.tagline}. Secure, scalable, and ready for your enterprise
              with OAuth 2.0, SAML, LDAP support, and multi-factor authentication.
            </p>
            <div className={styles.heroCta}>
              <Link
                className={clsx('button', styles.ctaPrimary)}
                to="/quickstart"
              >
                Quick Start
                <svg
                  className={styles.ctaIcon}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </Link>
              <Link
                className={clsx('button', styles.ctaSecondary)}
                to="/getting-started/installation"
              >
                View Installation Guide
              </Link>
            </div>
            <div className={styles.heroStats}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>100%</span>
                <span className={styles.statLabel}>Open Source</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <span className={styles.statValue}>SOC2</span>
                <span className={styles.statLabel}>Ready</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <span className={styles.statValue}>500+</span>
                <span className={styles.statLabel}>Enterprise Users</span>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className={styles.featuresSection}>
          <div className={styles.featuresContainer}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Everything you need</h2>
              <p className={styles.sectionSubtitle}>
                From quick setup to enterprise-scale deployments, AuthMe has you covered.
              </p>
            </div>
            <div className={styles.featuresGrid}>
              <Feature
                title="Enterprise Security"
                description="Multi-factor authentication, brute-force protection, and password policies out of the box."
                icon={<ShieldIcon />}
                link="/guides/mfa"
              />
              <Feature
                title="Modern Protocols"
                description="Support for OAuth 2.0, OpenID Connect, SAML 2.0, and LDAP for seamless integration."
                icon={<CodeIcon />}
                link="/getting-started/configuration"
              />
              <Feature
                title="Cloud Native"
                description="Container-ready with Docker and Kubernetes. Deploy anywhere with high availability."
                icon={<CloudIcon />}
                link="/deployment/docker"
              />
              <Feature
                title="SDKs & Integrations"
                description="Official SDKs for React, Next.js, Vue, Angular, and native mobile platforms."
                icon={<PuzzleIcon />}
                link="/guides/sdks/react-sdk"
              />
              <Feature
                title="User Management"
                description="Built-in user federation, identity brokering, and social login providers."
                icon={<UsersIcon />}
                link="/getting-started/configuration"
              />
              <Feature
                title="Blazing Fast"
                description="Optimized for performance with sub-millisecond authentication latencies."
                icon={<BoltIcon />}
              />
            </div>
          </div>
        </section>

        {/* Quick Links Section */}
        <section className={styles.quickLinksSection}>
          <div className={styles.quickLinksContainer}>
            <h2 className={styles.quickLinksTitle}>Jump right in</h2>
            <div className={styles.quickLinksGrid}>
              <Link to="/quickstart" className={styles.quickLinkCard}>
                <div className={styles.quickLinkIcon}>
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                </div>
                <div>
                  <h3>Quickstart Guide</h3>
                  <p>Get up and running in 5 minutes</p>
                </div>
              </Link>
              <Link to="/getting-started/installation" className={styles.quickLinkCard}>
                <div className={styles.quickLinkIcon}>
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-3.182 5.511" />
                  </svg>
                </div>
                <div>
                  <h3>Installation</h3>
                  <p>Docker, Kubernetes, or bare metal</p>
                </div>
              </Link>
              <Link to="/api" className={styles.quickLinkCard}>
                <div className={styles.quickLinkIcon}>
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                </div>
                <div>
                  <h3>API Reference</h3>
                  <p>Complete REST API documentation</p>
                </div>
              </Link>
              <Link to="/migration/keycloak" className={styles.quickLinkCard}>
                <div className={styles.quickLinkIcon}>
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                </div>
                <div>
                  <h3>Migration Guide</h3>
                  <p>Coming from KeyCloak or Auth0?</p>
                </div>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}