// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOrganizationsClient_CreateOrganization(t *testing.T) {
	expectedOrg := Organization{
		ID:      "org-123",
		Slug:    "test-org",
		Name:    "Test Organization",
		Enabled: true,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/organizations" {
			t.Errorf("expected path /admin/realms/test-realm/organizations, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedOrg)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	req := CreateOrganizationRequest{
		Slug: "test-org",
		Name: "Test Organization",
	}

	org, err := orgsClient.CreateOrganization(context.Background(), "test-realm", req)
	if err != nil {
		t.Fatalf("failed to create organization: %v", err)
	}

	if org.ID != expectedOrg.ID {
		t.Errorf("expected org ID %s, got %s", expectedOrg.ID, org.ID)
	}
	if org.Slug != expectedOrg.Slug {
		t.Errorf("expected org slug %s, got %s", expectedOrg.Slug, org.Slug)
	}
}

func TestOrganizationsClient_ListOrganizations(t *testing.T) {
	expectedOrgs := []Organization{
		{ID: "org-1", Slug: "org-one", Name: "Organization One"},
		{ID: "org-2", Slug: "org-two", Name: "Organization Two"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/organizations" {
			t.Errorf("expected path /admin/realms/test-realm/organizations, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedOrgs)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	orgs, err := orgsClient.ListOrganizations(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to list organizations: %v", err)
	}

	if len(orgs) != len(expectedOrgs) {
		t.Errorf("expected %d organizations, got %d", len(expectedOrgs), len(orgs))
	}
}

func TestOrganizationsClient_GetOrganization(t *testing.T) {
	slug := "test-org"
	expectedOrg := Organization{
		ID:   "org-123",
		Slug: slug,
		Name: "Test Organization",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedOrg)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	org, err := orgsClient.GetOrganization(context.Background(), "test-realm", slug)
	if err != nil {
		t.Fatalf("failed to get organization: %v", err)
	}

	if org.ID != expectedOrg.ID {
		t.Errorf("expected org ID %s, got %s", expectedOrg.ID, org.ID)
	}
}

func TestOrganizationsClient_UpdateOrganization(t *testing.T) {
	slug := "test-org"
	expectedOrg := Organization{
		ID:   "org-123",
		Slug: slug,
		Name: "Updated Organization",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedOrg)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	req := UpdateOrganizationRequest{
		Name: "Updated Organization",
	}

	org, err := orgsClient.UpdateOrganization(context.Background(), "test-realm", slug, req)
	if err != nil {
		t.Fatalf("failed to update organization: %v", err)
	}

	if org.Name != expectedOrg.Name {
		t.Errorf("expected name %s, got %s", expectedOrg.Name, org.Name)
	}
}

func TestOrganizationsClient_DeleteOrganization(t *testing.T) {
	slug := "test-org"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	err = orgsClient.DeleteOrganization(context.Background(), "test-realm", slug)
	if err != nil {
		t.Fatalf("failed to delete organization: %v", err)
	}
}

func TestOrganizationsClient_AddMember(t *testing.T) {
	slug := "test-org"
	expectedMember := OrganizationMember{
		ID:             "member-123",
		OrganizationID: "org-123",
		UserID:         "user-123",
		Role:           "member",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug + "/members"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedMember)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	req := AddMemberRequest{
		UserID: "user-123",
		Role:   "member",
	}

	member, err := orgsClient.AddMember(context.Background(), "test-realm", slug, req)
	if err != nil {
		t.Fatalf("failed to add member: %v", err)
	}

	if member.ID != expectedMember.ID {
		t.Errorf("expected member ID %s, got %s", expectedMember.ID, member.ID)
	}
}

func TestOrganizationsClient_ListMembers(t *testing.T) {
	slug := "test-org"
	expectedMembers := []OrganizationMember{
		{ID: "member-1", UserID: "user-1", Role: "admin"},
		{ID: "member-2", UserID: "user-2", Role: "member"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug + "/members"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedMembers)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	members, err := orgsClient.ListMembers(context.Background(), "test-realm", slug)
	if err != nil {
		t.Fatalf("failed to list members: %v", err)
	}

	if len(members) != len(expectedMembers) {
		t.Errorf("expected %d members, got %d", len(expectedMembers), len(members))
	}
}

func TestOrganizationsClient_RemoveMember(t *testing.T) {
	slug := "test-org"
	userID := "user-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug + "/members/" + userID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	err = orgsClient.RemoveMember(context.Background(), "test-realm", slug, userID)
	if err != nil {
		t.Fatalf("failed to remove member: %v", err)
	}
}

func TestOrganizationsClient_CreateInvitation(t *testing.T) {
	slug := "test-org"
	expectedInvitation := OrganizationInvitation{
		ID:             "inv-123",
		OrganizationID: "org-123",
		Email:          "test@example.com",
		Role:           "member",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug + "/invitations"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedInvitation)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	req := CreateInvitationRequest{
		Email: "test@example.com",
		Role:  "member",
	}

	invitation, err := orgsClient.CreateInvitation(context.Background(), "test-realm", slug, req)
	if err != nil {
		t.Fatalf("failed to create invitation: %v", err)
	}

	if invitation.ID != expectedInvitation.ID {
		t.Errorf("expected invitation ID %s, got %s", expectedInvitation.ID, invitation.ID)
	}
}

func TestOrganizationsClient_CreateSsoConnection(t *testing.T) {
	slug := "test-org"
	expectedConn := OrganizationSsoConnection{
		ID:             "sso-123",
		OrganizationID: "org-123",
		Type:           "saml",
		Name:           "Test SSO",
		Enabled:        true,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug + "/sso-connections"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedConn)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	req := CreateSsoConnectionRequest{
		Type:    "saml",
		Name:    "Test SSO",
		Enabled: boolPtr(true),
	}

	conn, err := orgsClient.CreateSsoConnection(context.Background(), "test-realm", slug, req)
	if err != nil {
		t.Fatalf("failed to create SSO connection: %v", err)
	}

	if conn.ID != expectedConn.ID {
		t.Errorf("expected connection ID %s, got %s", expectedConn.ID, conn.ID)
	}
}

func TestOrganizationsClient_DeleteSsoConnection(t *testing.T) {
	slug := "test-org"
	connectionID := "sso-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/organizations/" + slug + "/sso-connections/" + connectionID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	orgsClient := NewOrganizationsClient(client)
	err = orgsClient.DeleteSsoConnection(context.Background(), "test-realm", slug, connectionID)
	if err != nil {
		t.Fatalf("failed to delete SSO connection: %v", err)
	}
}

// Helper function
func boolPtr(b bool) *bool {
	return &b
}