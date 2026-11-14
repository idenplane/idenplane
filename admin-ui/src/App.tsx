import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router';
import { lazy, Suspense, useEffect } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import { hasCredentials, refreshSession } from './api/client';
import { useAuthContext } from './context/AuthContext';
import PageFallback from './components/PageFallback';
import { RequireRealmWrite, RequireSuperAdmin } from './components/PermissionGate';

// Each page is its own chunk, loaded when first visited.
const RealmListPage = lazy(() => import('./pages/realms/RealmListPage'));
const RealmCreatePage = lazy(() => import('./pages/realms/RealmCreatePage'));
const RealmDetailPage = lazy(() => import('./pages/realms/RealmDetailPage'));
const UserListPage = lazy(() => import('./pages/users/UserListPage'));
const UserCreatePage = lazy(() => import('./pages/users/UserCreatePage'));
const UserDetailPage = lazy(() => import('./pages/users/UserDetailPage'));
const ClientListPage = lazy(() => import('./pages/clients/ClientListPage'));
const ClientCreatePage = lazy(() => import('./pages/clients/ClientCreatePage'));
const ClientDetailPage = lazy(() => import('./pages/clients/ClientDetailPage'));
const ProxyApplicationListPage = lazy(() => import('./pages/proxy-applications/ProxyApplicationListPage'));
const ProxyApplicationCreatePage = lazy(() => import('./pages/proxy-applications/ProxyApplicationCreatePage'));
const ProxyApplicationDetailPage = lazy(() => import('./pages/proxy-applications/ProxyApplicationDetailPage'));
const RoleListPage = lazy(() => import('./pages/roles/RoleListPage'));
const GroupListPage = lazy(() => import('./pages/groups/GroupListPage'));
const GroupCreatePage = lazy(() => import('./pages/groups/GroupCreatePage'));
const GroupDetailPage = lazy(() => import('./pages/groups/GroupDetailPage'));
const SessionListPage = lazy(() => import('./pages/sessions/SessionListPage'));
const IdpListPage = lazy(() => import('./pages/identity-providers/IdpListPage'));
const IdpCreatePage = lazy(() => import('./pages/identity-providers/IdpCreatePage'));
const IdpDetailPage = lazy(() => import('./pages/identity-providers/IdpDetailPage'));
const ClientScopeListPage = lazy(() => import('./pages/client-scopes/ClientScopeListPage'));
const ClientScopeCreatePage = lazy(() => import('./pages/client-scopes/ClientScopeCreatePage'));
const ClientScopeDetailPage = lazy(() => import('./pages/client-scopes/ClientScopeDetailPage'));
const ConsentCategoriesListPage = lazy(() => import('./pages/consent/ConsentCategoriesListPage'));
const ConsentCategoryDetailPage = lazy(() => import('./pages/consent/ConsentCategoryDetailPage'));
const ConsentStatisticsPage = lazy(() => import('./pages/consent/ConsentStatisticsPage'));
const FederationListPage = lazy(() => import('./pages/user-federation/FederationListPage'));
const FederationCreatePage = lazy(() => import('./pages/user-federation/FederationCreatePage'));
const FederationDetailPage = lazy(() => import('./pages/user-federation/FederationDetailPage'));
const SamlSpListPage = lazy(() => import('./pages/saml/SamlSpListPage'));
const SamlSpCreatePage = lazy(() => import('./pages/saml/SamlSpCreatePage'));
const SamlSpDetailPage = lazy(() => import('./pages/saml/SamlSpDetailPage'));
const LoginEventsPage = lazy(() => import('./pages/events/LoginEventsPage'));
const AdminEventsPage = lazy(() => import('./pages/events/AdminEventsPage'));
const AuthFlowListPage = lazy(() => import('./pages/auth-flows/AuthFlowListPage'));
const AuthFlowEditorPage = lazy(() => import('./pages/auth-flows/AuthFlowEditorPage'));
const SetupWizardRoute = lazy(() => import('./pages/setup-wizard/SetupWizardRoute'));
const MigrationWizardPage = lazy(() => import('./pages/migration/MigrationWizardPage'));
const PendingRegistrationsPage = lazy(() => import('./pages/registration/PendingRegistrationsPage'));
const RegistrationFieldsPage = lazy(() => import('./pages/registration/RegistrationFieldsPage'));
const RegistrationSettingsPage = lazy(() => import('./pages/registration/RegistrationSettingsPage'));
const SignUpRedirectPage = lazy(() => import('./pages/registration/SignUpRedirectPage'));
const ContinuousRiskDashboard = lazy(() => import('./pages/continuous-verification/ContinuousRiskDashboard'));
const RiskPolicyListPage = lazy(() => import('./pages/continuous-verification/RiskPolicyListPage'));
const SessionRiskDetailPage = lazy(() => import('./pages/continuous-verification/SessionRiskDetailPage'));
const OrganizationListPage = lazy(() => import('./pages/organizations/OrganizationListPage'));
const OrganizationCreatePage = lazy(() => import('./pages/organizations/OrganizationCreatePage'));
const OrganizationDetailPage = lazy(() => import('./pages/organizations/OrganizationDetailPage'));
const WebhookListPage = lazy(() => import('./pages/webhooks/WebhookListPage'));
const WebhookCreatePage = lazy(() => import('./pages/webhooks/WebhookCreatePage'));
const WebhookDetailPage = lazy(() => import('./pages/webhooks/WebhookDetailPage'));
const ServiceAccountListPage = lazy(() => import('./pages/service-accounts/ServiceAccountListPage'));
const ServiceAccountCreatePage = lazy(() => import('./pages/service-accounts/ServiceAccountCreatePage'));
const ServiceAccountDetailPage = lazy(() => import('./pages/service-accounts/ServiceAccountDetailPage'));
const CustomAttributesPage = lazy(() => import('./pages/custom-attributes/CustomAttributesPage'));
const ScimConfigPage = lazy(() => import('./pages/scim/ScimConfigPage'));
const PolicyListPage = lazy(() => import('./pages/authorization/PolicyListPage'));
const PolicyCreatePage = lazy(() => import('./pages/authorization/PolicyCreatePage'));
const PolicyDetailPage = lazy(() => import('./pages/authorization/PolicyDetailPage'));
const ThemeBuilderPage = lazy(() => import('./pages/theme-builder/ThemeBuilderPage'));
const NhiListPage = lazy(() => import('./pages/nhi/NhiListPage'));
const NhiCreatePage = lazy(() => import('./pages/nhi/NhiCreatePage'));
const NhiDetailPage = lazy(() => import('./pages/nhi/NhiDetailPage'));
const NhiAnalyticsPage = lazy(() => import('./pages/nhi/NhiAnalyticsPage'));
const PluginsPage = lazy(() => import('./pages/plugins/PluginsPage'));
const SystemStatusPage = lazy(() => import('./pages/system/SystemStatusPage'));
const UpgradeStatusPage = lazy(() => import('./pages/upgrade/UpgradeStatusPage'));
const StartUpgradePage = lazy(() => import('./pages/upgrade/StartUpgradePage'));
const MigrationHistoryPage = lazy(() => import('./pages/upgrade/MigrationHistoryPage'));
const AdminAccountsPage = lazy(() => import('./pages/admin-accounts/AdminAccountsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function ProtectedRoute() {
  const { bootstrapped } = useAuthContext();
  const location = useLocation();
  // Wait for the bootstrap refresh call to complete before deciding to redirect.
  // Without this, a page reload would always redirect to login even when a valid
  // admin_rt cookie exists (fixes #1095).
  if (!bootstrapped) {
    return null;
  }
  if (!hasCredentials()) {
    // Remember where the admin was going, so signing in returns there
    // (for example to /console/setup).
    return <Navigate to="/console/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

function SessionBootstrap() {
  const { setBootstrapped, setToken } = useAuthContext();

  useEffect(() => {
    let cancelled = false;
    refreshSession().then((token) => {
      if (cancelled) return;
      if (token) {
        setToken(token);
      }
      setBootstrapped(true);
    });
    return () => { cancelled = true; };
  }, [setBootstrapped, setToken]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
    <SessionBootstrap />
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/console/login" element={<LoginPage />} />
      {/* Public: hands over to the hosted sign-up page of the realm. */}
      <Route path="/console/register/:realm" element={<SignUpRedirectPage />} />

      <Route element={<ProtectedRoute />}>
        {/* The setup wizard is super-admin only: sign in first, then the
            page checks with the server whether setup is still open. Full
            screen, so outside Layout. */}
        <Route path="/console/setup" element={<SetupWizardRoute />} />
        <Route path="/setup" element={<Navigate to="/console/setup" replace />} />
        <Route element={<Layout />}>
          <Route path="/console" element={<DashboardPage />} />
          <Route path="/console/realms" element={<RealmListPage />} />
          <Route path="/console/realms/create" element={<RequireSuperAdmin><RealmCreatePage /></RequireSuperAdmin>} />
          <Route path="/console/realms/:name" element={<RealmDetailPage />} />
          <Route path="/console/realms/:name/users" element={<UserListPage />} />
          <Route path="/console/realms/:name/users/create" element={<RequireRealmWrite><UserCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/users/:id" element={<UserDetailPage />} />
          <Route path="/console/realms/:name/clients" element={<ClientListPage />} />
          <Route path="/console/realms/:name/clients/new" element={<RequireRealmWrite><ClientCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/clients/:id" element={<ClientDetailPage />} />
          <Route path="/console/realms/:name/proxy-applications" element={<ProxyApplicationListPage />} />
          <Route path="/console/realms/:name/proxy-applications/new" element={<RequireRealmWrite><ProxyApplicationCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/proxy-applications/:slug" element={<ProxyApplicationDetailPage />} />
          <Route path="/console/realms/:name/migration" element={<RequireSuperAdmin><MigrationWizardPage /></RequireSuperAdmin>} />
          <Route path="/console/realms/:name/roles" element={<RoleListPage />} />
          <Route path="/console/realms/:name/groups" element={<GroupListPage />} />
          <Route path="/console/realms/:name/groups/create" element={<RequireRealmWrite><GroupCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/groups/:groupId" element={<GroupDetailPage />} />
          <Route path="/console/realms/:name/sessions" element={<SessionListPage />} />
          <Route path="/console/realms/:name/client-scopes" element={<ClientScopeListPage />} />
          <Route path="/console/realms/:name/client-scopes/create" element={<RequireRealmWrite><ClientScopeCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/client-scopes/:scopeId" element={<ClientScopeDetailPage />} />
          <Route path="/console/realms/:name/consent-categories" element={<ConsentCategoriesListPage />} />
          <Route path="/console/realms/:name/consent-categories/new" element={<RequireRealmWrite><ConsentCategoryDetailPage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/consent-categories/:categoryId" element={<ConsentCategoryDetailPage />} />
          <Route path="/console/realms/:name/consent-statistics" element={<ConsentStatisticsPage />} />
          <Route path="/console/realms/:name/events" element={<LoginEventsPage />} />
          <Route path="/console/realms/:name/admin-events" element={<AdminEventsPage />} />
          <Route path="/console/realms/:name/user-federation" element={<FederationListPage />} />
          <Route path="/console/realms/:name/user-federation/create" element={<RequireRealmWrite><FederationCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/user-federation/:id" element={<FederationDetailPage />} />
          <Route path="/console/realms/:name/identity-providers" element={<IdpListPage />} />
          <Route path="/console/realms/:name/identity-providers/create" element={<RequireRealmWrite><IdpCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/identity-providers/:alias" element={<IdpDetailPage />} />
          <Route path="/console/realms/:name/saml-providers" element={<SamlSpListPage />} />
          <Route path="/console/realms/:name/saml-providers/create" element={<RequireRealmWrite><SamlSpCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/saml-providers/:id" element={<SamlSpDetailPage />} />
          <Route path="/console/realms/:name/auth-flows" element={<AuthFlowListPage />} />
          <Route path="/console/realms/:name/auth-flows/:flowId" element={<AuthFlowEditorPage />} />
          <Route path="/console/realms/:name/registration-approvals" element={<PendingRegistrationsPage />} />
          <Route path="/console/realms/:name/registration-fields" element={<RegistrationFieldsPage />} />
          <Route path="/console/realms/:name/registration-settings" element={<RegistrationSettingsPage />} />
          <Route path="/console/realms/:name/risk-dashboard" element={<ContinuousRiskDashboard />} />
          <Route path="/console/realms/:name/risk-policies" element={<RiskPolicyListPage />} />
          <Route path="/console/realms/:name/risk-sessions/:sessionId" element={<SessionRiskDetailPage />} />
          <Route path="/console/realms/:name/organizations" element={<OrganizationListPage />} />
          <Route path="/console/realms/:name/organizations/new" element={<RequireRealmWrite><OrganizationCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/organizations/:slug" element={<OrganizationDetailPage />} />
          <Route path="/console/realms/:name/webhooks" element={<WebhookListPage />} />
          <Route path="/console/realms/:name/webhooks/new" element={<RequireRealmWrite><WebhookCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/webhooks/:webhookId" element={<WebhookDetailPage />} />
          <Route path="/console/realms/:name/service-accounts" element={<ServiceAccountListPage />} />
          <Route path="/console/realms/:name/service-accounts/new" element={<RequireRealmWrite><ServiceAccountCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/service-accounts/:accountId" element={<ServiceAccountDetailPage />} />
          <Route path="/console/realms/:name/custom-attributes" element={<CustomAttributesPage />} />
          <Route path="/console/realms/:name/scim" element={<ScimConfigPage />} />
          <Route path="/console/realms/:name/authorization-policies" element={<PolicyListPage />} />
          <Route path="/console/realms/:name/authorization-policies/new" element={<RequireRealmWrite><PolicyCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/authorization-policies/:policyId" element={<PolicyDetailPage />} />
          <Route path="/console/realms/:name/theme-builder" element={<ThemeBuilderPage />} />
          <Route path="/console/realms/:name/nhi" element={<NhiListPage />} />
          <Route path="/console/realms/:name/nhi/new" element={<RequireRealmWrite><NhiCreatePage /></RequireRealmWrite>} />
          <Route path="/console/realms/:name/nhi/:id" element={<NhiDetailPage />} />
          <Route path="/console/realms/:name/nhi-analytics" element={<NhiAnalyticsPage />} />
          <Route path="/console/admin-accounts" element={<RequireSuperAdmin><AdminAccountsPage /></RequireSuperAdmin>} />
          <Route path="/console/plugins" element={<RequireSuperAdmin><PluginsPage /></RequireSuperAdmin>} />
          <Route path="/console/system-status" element={<RequireSuperAdmin><SystemStatusPage /></RequireSuperAdmin>} />
          <Route path="/console/upgrade" element={<RequireSuperAdmin><UpgradeStatusPage /></RequireSuperAdmin>} />
          <Route path="/console/upgrade/new" element={<RequireSuperAdmin><StartUpgradePage /></RequireSuperAdmin>} />
          <Route path="/console/upgrade/history" element={<RequireSuperAdmin><MigrationHistoryPage /></RequireSuperAdmin>} />
          {/* Catch-all for unknown /console/... paths — rendered inside the Layout shell */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      {/* Catch-all for every other URL (e.g. bare / or unknown top-level paths) */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
