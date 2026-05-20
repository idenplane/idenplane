// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthFlowsClient_CreateAuthFlow(t *testing.T) {
	expectedFlow := AuthFlow{
		ID:          "flow-123",
		Alias:       "custom-flow",
		Description: "Custom Authentication Flow",
		ProviderID:  "basic-flow",
		BuiltIn:     false,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/authentication/flows" {
			t.Errorf("expected path /admin/realms/test-realm/authentication/flows, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFlow)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	flowsClient := NewAuthFlowsClient(client)
	req := CreateAuthFlowRequest{
		Alias:       "custom-flow",
		Description: "Custom Authentication Flow",
		ProviderID:  "basic-flow",
	}

	flow, err := flowsClient.CreateAuthFlow(context.Background(), "test-realm", req)
	if err != nil {
		t.Fatalf("failed to create auth flow: %v", err)
	}

	if flow.ID != expectedFlow.ID {
		t.Errorf("expected flow ID %s, got %s", expectedFlow.ID, flow.ID)
	}
	if flow.Alias != expectedFlow.Alias {
		t.Errorf("expected alias %s, got %s", expectedFlow.Alias, flow.Alias)
	}
}

func TestAuthFlowsClient_ListAuthFlows(t *testing.T) {
	expectedFlows := []AuthFlow{
		{ID: "flow-1", Alias: "browser"},
		{ID: "flow-2", Alias: "registration"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/authentication/flows" {
			t.Errorf("expected path /admin/realms/test-realm/authentication/flows, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFlows)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	flowsClient := NewAuthFlowsClient(client)
	flows, err := flowsClient.ListAuthFlows(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to list auth flows: %v", err)
	}

	if len(flows) != len(expectedFlows) {
		t.Errorf("expected %d flows, got %d", len(expectedFlows), len(flows))
	}
}

func TestAuthFlowsClient_GetAuthFlow(t *testing.T) {
	flowID := "flow-123"
	expectedFlow := AuthFlow{
		ID:    flowID,
		Alias: "browser",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/authentication/flows/" + flowID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFlow)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	flowsClient := NewAuthFlowsClient(client)
	flow, err := flowsClient.GetAuthFlow(context.Background(), "test-realm", flowID)
	if err != nil {
		t.Fatalf("failed to get auth flow: %v", err)
	}

	if flow.ID != expectedFlow.ID {
		t.Errorf("expected flow ID %s, got %s", expectedFlow.ID, flow.ID)
	}
}

func TestAuthFlowsClient_UpdateAuthFlow(t *testing.T) {
	flowID := "flow-123"
	expectedFlow := AuthFlow{
		ID:          flowID,
		Alias:       "browser",
		Description: "Updated Description",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/authentication/flows/" + flowID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFlow)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	flowsClient := NewAuthFlowsClient(client)
	req := UpdateAuthFlowRequest{
		Description: "Updated Description",
	}

	flow, err := flowsClient.UpdateAuthFlow(context.Background(), "test-realm", flowID, req)
	if err != nil {
		t.Fatalf("failed to update auth flow: %v", err)
	}

	if flow.Description != expectedFlow.Description {
		t.Errorf("expected description %s, got %s", expectedFlow.Description, flow.Description)
	}
}

func TestAuthFlowsClient_DeleteAuthFlow(t *testing.T) {
	flowID := "flow-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/authentication/flows/" + flowID
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

	flowsClient := NewAuthFlowsClient(client)
	err = flowsClient.DeleteAuthFlow(context.Background(), "test-realm", flowID)
	if err != nil {
		t.Fatalf("failed to delete auth flow: %v", err)
	}
}

func TestAuthFlowsClient_GetExecutions(t *testing.T) {
	flowID := "flow-123"
	expectedExecutions := []AuthExecution{
		{ID: "exec-1", DisplayName: "Cookie", Requirement: "ALTERNATIVE"},
		{ID: "exec-2", DisplayName: "Password", Requirement: "REQUIRED"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/authentication/flows/" + flowID + "/executions"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedExecutions)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	flowsClient := NewAuthFlowsClient(client)
	executions, err := flowsClient.GetExecutions(context.Background(), "test-realm", flowID)
	if err != nil {
		t.Fatalf("failed to get executions: %v", err)
	}

	if len(executions) != len(expectedExecutions) {
		t.Errorf("expected %d executions, got %d", len(expectedExecutions), len(executions))
	}
}

func TestAuthFlowsClient_CopyAuthFlow(t *testing.T) {
	flowID := "flow-123"
	newAlias := "custom-copy"
	expectedFlow := AuthFlow{
		ID:    "flow-new",
		Alias: newAlias,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/authentication/flows/" + flowID + "/copy"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFlow)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	flowsClient := NewAuthFlowsClient(client)
	flow, err := flowsClient.CopyAuthFlow(context.Background(), "test-realm", flowID, newAlias)
	if err != nil {
		t.Fatalf("failed to copy auth flow: %v", err)
	}

	if flow.Alias != newAlias {
		t.Errorf("expected alias %s, got %s", newAlias, flow.Alias)
	}
}

func TestAuthFlowsClient_GetRequiredActions(t *testing.T) {
	expectedActions := []RequiredAction{
		{Alias: "CONFIGURE_TOTP", Name: "Configure OTP", Enabled: true},
		{Alias: "VERIFY_EMAIL", Name: "Verify Email", Enabled: true},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/authentication/register-actions" {
			t.Errorf("expected path /admin/realms/test-realm/authentication/register-actions, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedActions)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	flowsClient := NewAuthFlowsClient(client)
	actions, err := flowsClient.GetRequiredActions(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to get required actions: %v", err)
	}

	if len(actions) != len(expectedActions) {
		t.Errorf("expected %d actions, got %d", len(expectedActions), len(actions))
	}
}