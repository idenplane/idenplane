import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import RealmListPage from './pages/realms/RealmListPage';
import RealmCreatePage from './pages/realms/RealmCreatePage';
import RealmDetailPage from './pages/realms/RealmDetailPage';
import UserListPage from './pages/users/UserListPage';
import UserCreatePage from './pages/users/UserCreatePage';
import UserDetailPage from './pages/users/UserDetailPage';
import ClientListPage from './pages/clients/ClientListPage';
import ClientCreatePage from './pages/clients/ClientCreatePage';
import ClientDetailPage from './pages/clients/ClientDetailPage';
import RoleListPage from './pages/roles/RoleListPage';
import GroupListPage from './pages/groups/GroupListPage';
import GroupCreatePage from './pages/groups/GroupCreatePage';
import GroupDetailPage from './pages/groups/GroupDetailPage';
import SessionListPage from './pages/sessions/SessionListPage';
import IdpListPage from './pages/identity-providers/IdpListPage';
import IdpCreatePage from './pages/identity-providers/IdpCreatePage';
import IdpDetailPage from './pages/identity-providers/IdpDetailPage';
import ClientScopeListPage from './pages/client-scopes/ClientScopeListPage';
import ClientScopeCreatePage from './pages/client-scopes/ClientScopeCreatePage';
import ClientScopeDetailPage from './pages/client-scopes/ClientScopeDetailPage';
import ConsentCategoriesListPage from './pages/consent/ConsentCategoriesListPage';
import ConsentCategoryDetailPage from './pages/consent/ConsentCategoryDetailPage';
import ConsentStatisticsPage from './pages/consent/ConsentStatisticsPage';
import FederationListPage from './pages/user-federation/FederationListPage';
import FederationCreatePage from './pages/user-federation/FederationCreatePage';
import FederationDetailPage from './pages/user-federation/FederationDetailPage';
import SamlSpListPage from './pages/saml/SamlSpListPage';
import SamlSpCreatePage from './pages/saml/SamlSpCreatePage';
import SamlSpDetailPage from './pages/saml/SamlSpDetailPage';
import LoginEventsPage from './pages/events/LoginEventsPage';
import AdminEventsPage from './pages/events/AdminEventsPage';
import AuthFlowListPage from './pages/auth-flows/AuthFlowListPage';
import AuthFlowEditorPage from './pages/auth-flows/AuthFlowEditorPage';
import SetupWizardPage from './pages/setup-wizard/SetupWizardPage';
import PendingRegistrationsPage from './pages/registration/PendingRegistrationsPage';
import RegistrationFieldsPage from './pages/registration/RegistrationFieldsPage';
import RegistrationSettingsPage from './pages/registration/RegistrationSettingsPage';
import ContinuousRiskDashboard from './pages/continuous-verification/ContinuousRiskDashboard';
import RiskPolicyListPage from './pages/continuous-verification/RiskPolicyListPage';
import SessionRiskDetailPage from './pages/continuous-verification/SessionRiskDetailPage';
import OrganizationListPage from './pages/organizations/OrganizationListPage';
import OrganizationCreatePage from './pages/organizations/OrganizationCreatePage';
import OrganizationDetailPage from './pages/organizations/OrganizationDetailPage';
import WebhookListPage from './pages/webhooks/WebhookListPage';
import WebhookCreatePage from './pages/webhooks/WebhookCreatePage';
import WebhookDetailPage from './pages/webhooks/WebhookDetailPage';
import ServiceAccountListPage from './pages/service-accounts/ServiceAccountListPage';
import ServiceAccountCreatePage from './pages/service-accounts/ServiceAccountCreatePage';
import ServiceAccountDetailPage from './pages/service-accounts/ServiceAccountDetailPage';
import CustomAttributesPage from './pages/custom-attributes/CustomAttributesPage';
import ScimConfigPage from './pages/scim/ScimConfigPage';
import PolicyListPage from './pages/authorization/PolicyListPage';
import PolicyCreatePage from './pages/authorization/PolicyCreatePage';
import PolicyDetailPage from './pages/authorization/PolicyDetailPage';
import PluginsPage from './pages/plugins/PluginsPage';
import NotFoundPage from './pages/NotFoundPage';
import { hasCredentials } from './api/client';

function ProtectedRoute() {
  // hasCredentials() reads from the in-memory module-level store — no
  // sessionStorage involved (see issue #330 fix).
  if (!hasCredentials()) {
    return <Navigate to="/console/login" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/console/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupWizardPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/console" element={<DashboardPage />} />
          <Route path="/console/realms" element={<RealmListPage />} />
          <Route path="/console/realms/create" element={<RealmCreatePage />} />
          <Route path="/console/realms/:name" element={<RealmDetailPage />} />
          <Route path="/console/realms/:name/users" element={<UserListPage />} />
          <Route path="/console/realms/:name/users/create" element={<UserCreatePage />} />
          <Route path="/console/realms/:name/users/:id" element={<UserDetailPage />} />
          <Route path="/console/realms/:name/clients" element={<ClientListPage />} />
          <Route path="/console/realms/:name/clients/new" element={<ClientCreatePage />} />
          <Route path="/console/realms/:name/clients/:id" element={<ClientDetailPage />} />
          <Route path="/console/realms/:name/roles" element={<RoleListPage />} />
          <Route path="/console/realms/:name/groups" element={<GroupListPage />} />
          <Route path="/console/realms/:name/groups/create" element={<GroupCreatePage />} />
          <Route path="/console/realms/:name/groups/:groupId" element={<GroupDetailPage />} />
          <Route path="/console/realms/:name/sessions" element={<SessionListPage />} />
          <Route path="/console/realms/:name/client-scopes" element={<ClientScopeListPage />} />
          <Route path="/console/realms/:name/client-scopes/create" element={<ClientScopeCreatePage />} />
          <Route path="/console/realms/:name/client-scopes/:scopeId" element={<ClientScopeDetailPage />} />
          <Route path="/console/realms/:name/consent-categories" element={<ConsentCategoriesListPage />} />
          <Route path="/console/realms/:name/consent-categories/new" element={<ConsentCategoryDetailPage />} />
          <Route path="/console/realms/:name/consent-categories/:categoryId" element={<ConsentCategoryDetailPage />} />
          <Route path="/console/realms/:name/consent-statistics" element={<ConsentStatisticsPage />} />
          <Route path="/console/realms/:name/events" element={<LoginEventsPage />} />
          <Route path="/console/realms/:name/admin-events" element={<AdminEventsPage />} />
          <Route path="/console/realms/:name/user-federation" element={<FederationListPage />} />
          <Route path="/console/realms/:name/user-federation/create" element={<FederationCreatePage />} />
          <Route path="/console/realms/:name/user-federation/:id" element={<FederationDetailPage />} />
          <Route path="/console/realms/:name/identity-providers" element={<IdpListPage />} />
          <Route path="/console/realms/:name/identity-providers/create" element={<IdpCreatePage />} />
          <Route path="/console/realms/:name/identity-providers/:alias" element={<IdpDetailPage />} />
          <Route path="/console/realms/:name/saml-providers" element={<SamlSpListPage />} />
          <Route path="/console/realms/:name/saml-providers/create" element={<SamlSpCreatePage />} />
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
          <Route path="/console/realms/:name/organizations/new" element={<OrganizationCreatePage />} />
          <Route path="/console/realms/:name/organizations/:slug" element={<OrganizationDetailPage />} />
          <Route path="/console/realms/:name/webhooks" element={<WebhookListPage />} />
          <Route path="/console/realms/:name/webhooks/new" element={<WebhookCreatePage />} />
          <Route path="/console/realms/:name/webhooks/:webhookId" element={<WebhookDetailPage />} />
          <Route path="/console/realms/:name/service-accounts" element={<ServiceAccountListPage />} />
          <Route path="/console/realms/:name/service-accounts/new" element={<ServiceAccountCreatePage />} />
          <Route path="/console/realms/:name/service-accounts/:accountId" element={<ServiceAccountDetailPage />} />
          <Route path="/console/realms/:name/custom-attributes" element={<CustomAttributesPage />} />
          <Route path="/console/realms/:name/scim" element={<ScimConfigPage />} />
          <Route path="/console/realms/:name/authorization-policies" element={<PolicyListPage />} />
          <Route path="/console/realms/:name/authorization-policies/new" element={<PolicyCreatePage />} />
          <Route path="/console/realms/:name/authorization-policies/:policyId" element={<PolicyDetailPage />} />
          <Route path="/console/plugins" element={<PluginsPage />} />
          {/* Catch-all for unknown /console/... paths — rendered inside the Layout shell */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      {/* Catch-all for every other URL (e.g. bare / or unknown top-level paths) */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </ErrorBoundary>
  );
}
