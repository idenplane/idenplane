// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"fmt"
)

// Organization represents an organization in the AuthMe API
type Organization struct {
	ID              string   `json:"id"`
	RealmID         string   `json:"realmId,omitempty"`
	Slug            string   `json:"slug"`
	Name            string   `json:"name"`
	DisplayName     string   `json:"displayName,omitempty"`
	Description     string   `json:"description,omitempty"`
	Enabled         bool     `json:"enabled,omitempty"`
	LogoURL         string   `json:"logoUrl,omitempty"`
	PrimaryColor    string   `json:"primaryColor,omitempty"`
	RequireMFA      bool     `json:"requireMfa,omitempty"`
	VerifiedDomains []string `json:"verifiedDomains,omitempty"`
	// Timestamps
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// OrganizationMember represents a member of an organization
type OrganizationMember struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organizationId"`
	UserID         string `json:"userId"`
	Role           string `json:"role"`
	JoinedAt       string `json:"joinedAt,omitempty"`
	// User info (populated when fetching members)
	User *User `json:"user,omitempty"`
}

// OrganizationInvitation represents an invitation to an organization
type OrganizationInvitation struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organizationId"`
	Email          string `json:"email"`
	Role           string `json:"role"`
	Token          string `json:"token,omitempty"`
	ExpiresAt      string `json:"expiresAt,omitempty"`
	AcceptedAt     string `json:"acceptedAt,omitempty"`
	CreatedAt      string `json:"createdAt,omitempty"`
}

// OrganizationSsoConnection represents an SSO connection for an organization
type OrganizationSsoConnection struct {
	ID             string                 `json:"id"`
	OrganizationID string                `json:"organizationId"`
	Type           string                 `json:"type"`
	Name           string                 `json:"name"`
	Enabled        bool                   `json:"enabled,omitempty"`
	Config         map[string]interface{} `json:"config,omitempty"`
	CreatedAt      string                 `json:"createdAt,omitempty"`
	UpdatedAt      string                 `json:"updatedAt,omitempty"`
}

// DomainVerificationResult represents the result of domain verification
type DomainVerificationResult struct {
	Domain          string `json:"domain"`
	TXTRecord       string `json:"txtRecord"`
	TXTValue        string `json:"txtValue,omitempty"`
	Message         string `json:"message,omitempty"`
	Verified        bool   `json:"verified"`
	AlreadyVerified bool   `json:"alreadyVerified,omitempty"`
}

// CreateOrganizationRequest represents the request body for creating an organization
type CreateOrganizationRequest struct {
	Slug         string   `json:"slug"`
	Name         string   `json:"name"`
	DisplayName  string   `json:"displayName,omitempty"`
	Description  string   `json:"description,omitempty"`
	Enabled      *bool    `json:"enabled,omitempty"`
	LogoURL      string   `json:"logoUrl,omitempty"`
	PrimaryColor string   `json:"primaryColor,omitempty"`
	RequireMFA  *bool    `json:"requireMfa,omitempty"`
}

// UpdateOrganizationRequest represents the request body for updating an organization
type UpdateOrganizationRequest struct {
	Name         string   `json:"name,omitempty"`
	DisplayName  string   `json:"displayName,omitempty"`
	Description  string   `json:"description,omitempty"`
	Enabled      *bool    `json:"enabled,omitempty"`
	LogoURL      string   `json:"logoUrl,omitempty"`
	PrimaryColor string   `json:"primaryColor,omitempty"`
	RequireMFA  *bool    `json:"requireMfa,omitempty"`
}

// AddMemberRequest represents the request body for adding a member to an organization
type AddMemberRequest struct {
	UserID string `json:"userId"`
	Role   string `json:"role,omitempty"`
}

// UpdateMemberRoleRequest represents the request body for updating a member's role
type UpdateMemberRoleRequest struct {
	Role string `json:"role"`
}

// CreateInvitationRequest represents the request body for creating an invitation
type CreateInvitationRequest struct {
	Email string `json:"email"`
	Role  string `json:"role,omitempty"`
}

// AcceptInvitationRequest represents the request body for accepting an invitation
type AcceptInvitationRequest struct {
	Token  string `json:"token"`
	UserID string `json:"userId,omitempty"`
}

// VerifyDomainRequest represents the request body for verifying a domain
type VerifyDomainRequest struct {
	Domain string `json:"domain"`
}

// CreateSsoConnectionRequest represents the request body for creating an SSO connection
type CreateSsoConnectionRequest struct {
	Type     string                 `json:"type"`
	Name     string                 `json:"name"`
	Enabled  *bool                  `json:"enabled,omitempty"`
	Config   map[string]interface{} `json:"config,omitempty"`
}

// UpdateSsoConnectionRequest represents the request body for updating an SSO connection
type UpdateSsoConnectionRequest struct {
	Name    string                 `json:"name,omitempty"`
	Enabled *bool                  `json:"enabled,omitempty"`
	Config  map[string]interface{} `json:"config,omitempty"`
}

// OrganizationsClient provides methods for interacting with AuthMe organizations API
type OrganizationsClient struct {
	httpClient *HTTPClient
}

// NewOrganizationsClient creates a new OrganizationsClient
func NewOrganizationsClient(httpClient *HTTPClient) *OrganizationsClient {
	return &OrganizationsClient{
		httpClient: httpClient,
	}
}

// ─── Organization CRUD ─────────────────────────────────────

// CreateOrganization creates a new organization
func (c *OrganizationsClient) CreateOrganization(ctx context.Context, realmName string, req CreateOrganizationRequest) (*Organization, error) {
	var org Organization
	path := fmt.Sprintf("/admin/realms/%s/organizations", realmName)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &org)
	if err != nil {
		return nil, fmt.Errorf("failed to create organization: %w", err)
	}
	return &org, nil
}

// ListOrganizations returns all organizations in a realm
func (c *OrganizationsClient) ListOrganizations(ctx context.Context, realmName string) ([]Organization, error) {
	var orgs []Organization
	path := fmt.Sprintf("/admin/realms/%s/organizations", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &orgs)
	if err != nil {
		return nil, fmt.Errorf("failed to list organizations: %w", err)
	}
	return orgs, nil
}

// GetOrganization returns an organization by slug
func (c *OrganizationsClient) GetOrganization(ctx context.Context, realmName, slug string) (*Organization, error) {
	var org Organization
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s", realmName, slug)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &org)
	if err != nil {
		return nil, fmt.Errorf("failed to get organization %s: %w", slug, err)
	}
	return &org, nil
}

// UpdateOrganization updates an organization
func (c *OrganizationsClient) UpdateOrganization(ctx context.Context, realmName, slug string, req UpdateOrganizationRequest) (*Organization, error) {
	var org Organization
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s", realmName, slug)
	err := c.httpClient.PutJSON(ctx, path, req, &org)
	if err != nil {
		return nil, fmt.Errorf("failed to update organization %s: %w", slug, err)
	}
	return &org, nil
}

// DeleteOrganization deletes an organization
func (c *OrganizationsClient) DeleteOrganization(ctx context.Context, realmName, slug string) error {
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s", realmName, slug)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete organization %s: %w", slug, err)
	}
	return nil
}

// ─── Member Management ─────────────────────────────────────

// AddMember adds a member to an organization
func (c *OrganizationsClient) AddMember(ctx context.Context, realmName, slug string, req AddMemberRequest) (*OrganizationMember, error) {
	var member OrganizationMember
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/members", realmName, slug)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &member)
	if err != nil {
		return nil, fmt.Errorf("failed to add member: %w", err)
	}
	return &member, nil
}

// ListMembers returns all members of an organization
func (c *OrganizationsClient) ListMembers(ctx context.Context, realmName, slug string) ([]OrganizationMember, error) {
	var members []OrganizationMember
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/members", realmName, slug)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &members)
	if err != nil {
		return nil, fmt.Errorf("failed to list members: %w", err)
	}
	return members, nil
}

// UpdateMemberRole updates a member's role in an organization
func (c *OrganizationsClient) UpdateMemberRole(ctx context.Context, realmName, slug, userID string, req UpdateMemberRoleRequest) (*OrganizationMember, error) {
	var member OrganizationMember
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/members/%s", realmName, slug, userID)
	err := c.httpClient.PutJSON(ctx, path, req, &member)
	if err != nil {
		return nil, fmt.Errorf("failed to update member role: %w", err)
	}
	return &member, nil
}

// RemoveMember removes a member from an organization
func (c *OrganizationsClient) RemoveMember(ctx context.Context, realmName, slug, userID string) error {
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/members/%s", realmName, slug, userID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to remove member: %w", err)
	}
	return nil
}

// ─── Invitations ─────────────────────────────────────────

// CreateInvitation creates an invitation to an organization
func (c *OrganizationsClient) CreateInvitation(ctx context.Context, realmName, slug string, req CreateInvitationRequest) (*OrganizationInvitation, error) {
	var invitation OrganizationInvitation
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/invitations", realmName, slug)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &invitation)
	if err != nil {
		return nil, fmt.Errorf("failed to create invitation: %w", err)
	}
	return &invitation, nil
}

// AcceptInvitation accepts an invitation to an organization
func (c *OrganizationsClient) AcceptInvitation(ctx context.Context, realmName, slug string, req AcceptInvitationRequest) (*OrganizationMember, error) {
	var member OrganizationMember
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/invitations/accept", realmName, slug)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &member)
	if err != nil {
		return nil, fmt.Errorf("failed to accept invitation: %w", err)
	}
	return &member, nil
}

// ListInvitations returns all invitations for an organization
func (c *OrganizationsClient) ListInvitations(ctx context.Context, realmName, slug string) ([]OrganizationInvitation, error) {
	var invitations []OrganizationInvitation
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/invitations", realmName, slug)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &invitations)
	if err != nil {
		return nil, fmt.Errorf("failed to list invitations: %w", err)
	}
	return invitations, nil
}

// ─── Domain Verification ─────────────────────────────────

// InitiateDomainVerification initiates domain verification and returns the DNS record to add
func (c *OrganizationsClient) InitiateDomainVerification(ctx context.Context, realmName, slug string, req VerifyDomainRequest) (*DomainVerificationResult, error) {
	var result DomainVerificationResult
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/domains/verify/initiate", realmName, slug)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("failed to initiate domain verification: %w", err)
	}
	return &result, nil
}

// VerifyDomain verifies domain ownership via DNS
func (c *OrganizationsClient) VerifyDomain(ctx context.Context, realmName, slug string, req VerifyDomainRequest) (*DomainVerificationResult, error) {
	var result DomainVerificationResult
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/domains/verify", realmName, slug)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("failed to verify domain: %w", err)
	}
	return &result, nil
}

// ─── SSO Connections ─────────────────────────────────────

// CreateSsoConnection creates an SSO connection for an organization
func (c *OrganizationsClient) CreateSsoConnection(ctx context.Context, realmName, slug string, req CreateSsoConnectionRequest) (*OrganizationSsoConnection, error) {
	var conn OrganizationSsoConnection
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/sso-connections", realmName, slug)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &conn)
	if err != nil {
		return nil, fmt.Errorf("failed to create SSO connection: %w", err)
	}
	return &conn, nil
}

// ListSsoConnections returns all SSO connections for an organization
func (c *OrganizationsClient) ListSsoConnections(ctx context.Context, realmName, slug string) ([]OrganizationSsoConnection, error) {
	var conns []OrganizationSsoConnection
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/sso-connections", realmName, slug)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &conns)
	if err != nil {
		return nil, fmt.Errorf("failed to list SSO connections: %w", err)
	}
	return conns, nil
}

// GetSsoConnection returns an SSO connection by ID
func (c *OrganizationsClient) GetSsoConnection(ctx context.Context, realmName, slug, connectionID string) (*OrganizationSsoConnection, error) {
	var conn OrganizationSsoConnection
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/sso-connections/%s", realmName, slug, connectionID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &conn)
	if err != nil {
		return nil, fmt.Errorf("failed to get SSO connection %s: %w", connectionID, err)
	}
	return &conn, nil
}

// UpdateSsoConnection updates an SSO connection
func (c *OrganizationsClient) UpdateSsoConnection(ctx context.Context, realmName, slug, connectionID string, req UpdateSsoConnectionRequest) (*OrganizationSsoConnection, error) {
	var conn OrganizationSsoConnection
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/sso-connections/%s", realmName, slug, connectionID)
	err := c.httpClient.PutJSON(ctx, path, req, &conn)
	if err != nil {
		return nil, fmt.Errorf("failed to update SSO connection %s: %w", connectionID, err)
	}
	return &conn, nil
}

// DeleteSsoConnection deletes an SSO connection
func (c *OrganizationsClient) DeleteSsoConnection(ctx context.Context, realmName, slug, connectionID string) error {
	path := fmt.Sprintf("/admin/realms/%s/organizations/%s/sso-connections/%s", realmName, slug, connectionID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete SSO connection %s: %w", connectionID, err)
	}
	return nil
}