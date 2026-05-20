// Package client provides HTTP client functionality for Idenplane API communication
package client

import (
	"context"
	"fmt"
)

// AuthFlow represents an authentication flow in the Idenplane API
type AuthFlow struct {
	ID          string   `json:"id"`
	Alias       string   `json:"alias"`
	Description string   `json:"description,omitempty"`
	ProviderID  string   `json:"providerId,omitempty"`
	Type        string   `json:"type,omitempty"`
	BuiltIn     bool     `json:"builtIn,omitempty"`
	// Nested flows and executions
	AuthenticationExecutions []AuthExecution `json:"authenticationExecutions,omitempty"`
	// Timestamps
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// AuthExecution represents an authentication execution within a flow
type AuthExecution struct {
	ID               string `json:"id"`
	DisplayName      string `json:"displayName"`
	Requirement      string `json:"requirement"`
	Authenticator    string `json:"authenticator,omitempty"`
	AuthenticatorFlow bool   `json:"authenticatorFlow,omitempty"`
	FlowID           string `json:"flowId,omitempty"`
	Priority         int    `json:"priority,omitempty"`
	Configurable     bool   `json:"configurable,omitempty"`
	Authentication   string `json:"authentication,omitempty"`
	SubFlow          bool   `json:"subFlow,omitempty"`
}

// CreateAuthFlowRequest represents the request body for creating an auth flow
type CreateAuthFlowRequest struct {
	Alias       string `json:"alias"`
	Description string `json:"description,omitempty"`
	ProviderID  string `json:"providerId,omitempty"`
	Type        string `json:"type,omitempty"`
}

// UpdateAuthFlowRequest represents the request body for updating an auth flow
type UpdateAuthFlowRequest struct {
	Alias       string `json:"alias,omitempty"`
	Description string `json:"description,omitempty"`
}

// ExecutionUpdateRequest represents the request body for updating an execution requirement
type ExecutionUpdateRequest struct {
	Requirement string `json:"requirement"`
}

// ExecutionJSONRequest represents the request body for creating executions
type ExecutionJSONRequest struct {
	DisplayName   string `json:"displayName"`
	Provider      string `json:"provider"`
	Requirement   string `json:"requirement"`
}

// AuthFlowsClient provides methods for interacting with Idenplane authentication flows API
type AuthFlowsClient struct {
	httpClient *HTTPClient
}

// NewAuthFlowsClient creates a new AuthFlowsClient
func NewAuthFlowsClient(httpClient *HTTPClient) *AuthFlowsClient {
	return &AuthFlowsClient{
		httpClient: httpClient,
	}
}

// CreateAuthFlow creates a new authentication flow
func (c *AuthFlowsClient) CreateAuthFlow(ctx context.Context, realmName string, req CreateAuthFlowRequest) (*AuthFlow, error) {
	var flow AuthFlow
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows", realmName)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &flow)
	if err != nil {
		return nil, fmt.Errorf("failed to create auth flow: %w", err)
	}
	return &flow, nil
}

// ListAuthFlows returns all authentication flows in a realm
func (c *AuthFlowsClient) ListAuthFlows(ctx context.Context, realmName string) ([]AuthFlow, error) {
	var flows []AuthFlow
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &flows)
	if err != nil {
		return nil, fmt.Errorf("failed to list auth flows: %w", err)
	}
	return flows, nil
}

// GetAuthFlow returns an authentication flow by ID
func (c *AuthFlowsClient) GetAuthFlow(ctx context.Context, realmName, flowID string) (*AuthFlow, error) {
	var flow AuthFlow
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s", realmName, flowID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &flow)
	if err != nil {
		return nil, fmt.Errorf("failed to get auth flow %s: %w", flowID, err)
	}
	return &flow, nil
}

// GetAuthFlowByAlias returns an authentication flow by alias
func (c *AuthFlowsClient) GetAuthFlowByAlias(ctx context.Context, realmName, alias string) (*AuthFlow, error) {
	// First get the flow by alias via executions
	var flow AuthFlow
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s", realmName, alias)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &flow)
	if err != nil {
		return nil, fmt.Errorf("failed to get auth flow %s: %w", alias, err)
	}
	return &flow, nil
}

// UpdateAuthFlow updates an authentication flow
func (c *AuthFlowsClient) UpdateAuthFlow(ctx context.Context, realmName, flowID string, req UpdateAuthFlowRequest) (*AuthFlow, error) {
	var flow AuthFlow
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s", realmName, flowID)
	err := c.httpClient.PutJSON(ctx, path, req, &flow)
	if err != nil {
		return nil, fmt.Errorf("failed to update auth flow %s: %w", flowID, err)
	}
	return &flow, nil
}

// DeleteAuthFlow deletes an authentication flow
func (c *AuthFlowsClient) DeleteAuthFlow(ctx context.Context, realmName, flowID string) error {
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s", realmName, flowID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete auth flow %s: %w", flowID, err)
	}
	return nil
}

// CopyAuthFlow creates a copy of an authentication flow with a new alias
func (c *AuthFlowsClient) CopyAuthFlow(ctx context.Context, realmName, flowID string, newAlias string) (*AuthFlow, error) {
	var flow AuthFlow
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s/copy", realmName, flowID)
	req := map[string]string{"newName": newAlias}
	err := c.httpClient.PostJSON(ctx, path, req, nil, &flow)
	if err != nil {
		return nil, fmt.Errorf("failed to copy auth flow %s: %w", flowID, err)
	}
	return &flow, nil
}

// ─── Auth Execution Management ─────────────────────────────────

// GetExecutions returns all executions for an authentication flow
func (c *AuthFlowsClient) GetExecutions(ctx context.Context, realmName, flowID string) ([]AuthExecution, error) {
	var executions []AuthExecution
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s/executions", realmName, flowID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &executions)
	if err != nil {
		return nil, fmt.Errorf("failed to get executions for flow %s: %w", flowID, err)
	}
	return executions, nil
}

// UpdateExecutions updates the executions for an authentication flow
func (c *AuthFlowsClient) UpdateExecutions(ctx context.Context, realmName, flowID string, req []ExecutionUpdateRequest) error {
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s/executions", realmName, flowID)
	_, err := c.httpClient.Put(ctx, path, req)
	if err != nil {
		return fmt.Errorf("failed to update executions for flow %s: %w", flowID, err)
	}
	return nil
}

// CreateExecution creates a new execution for an authentication flow
func (c *AuthFlowsClient) CreateExecution(ctx context.Context, realmName, flowID string, req ExecutionJSONRequest) (*AuthExecution, error) {
	var execution AuthExecution
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s/executions/execution", realmName, flowID)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &execution)
	if err != nil {
		return nil, fmt.Errorf("failed to create execution for flow %s: %w", flowID, err)
	}
	return &execution, nil
}

// CreateSubFlow creates a new sub-flow for an authentication flow
func (c *AuthFlowsClient) CreateSubFlow(ctx context.Context, realmName, flowID string, req ExecutionJSONRequest) (*AuthExecution, error) {
	var execution AuthExecution
	path := fmt.Sprintf("/admin/realms/%s/authentication/flows/%s/executions/flow", realmName, flowID)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &execution)
	if err != nil {
		return nil, fmt.Errorf("failed to create sub-flow for flow %s: %w", flowID, err)
	}
	return &execution, nil
}

// DeleteExecution deletes an execution from an authentication flow
func (c *AuthFlowsClient) DeleteExecution(ctx context.Context, realmName, executionID string) error {
	path := fmt.Sprintf("/admin/realms/%s/authentication/executions/%s", realmName, executionID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete execution %s: %w", executionID, err)
	}
	return nil
}

// UpdateExecution updates an execution requirement
func (c *AuthFlowsClient) UpdateExecution(ctx context.Context, realmName, executionID string, req ExecutionUpdateRequest) error {
	path := fmt.Sprintf("/admin/realms/%s/authentication/executions/%s", realmName, executionID)
	_, err := c.httpClient.Put(ctx, path, req)
	if err != nil {
		return fmt.Errorf("failed to update execution %s: %w", executionID, err)
	}
	return nil
}

// ─── Required Actions ─────────────────────────────────────────

// RequiredAction represents a required action for user registration/login
type RequiredAction struct {
	Alias          string `json:"alias"`
	Name           string `json:"name"`
	Enabled        bool   `json:"enabled,omitempty"`
	DefaultAction  bool   `json:"defaultAction,omitempty"`
	Priority       int    `json:"priority,omitempty"`
	Cost           float64 `json:"cost,omitempty"`
}

// GetRequiredActions returns all registered required actions
func (c *AuthFlowsClient) GetRequiredActions(ctx context.Context, realmName string) ([]RequiredAction, error) {
	var actions []RequiredAction
	path := fmt.Sprintf("/admin/realms/%s/authentication/register-actions", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &actions)
	if err != nil {
		return nil, fmt.Errorf("failed to get required actions: %w", err)
	}
	return actions, nil
}

// UpdateRequiredAction updates a required action
func (c *AuthFlowsClient) UpdateRequiredAction(ctx context.Context, realmName string, req RequiredAction) error {
	path := fmt.Sprintf("/admin/realms/%s/authentication/register-actions", realmName)
	_, err := c.httpClient.Put(ctx, path, req)
	if err != nil {
		return fmt.Errorf("failed to update required action %s: %w", req.Alias, err)
	}
	return nil
}