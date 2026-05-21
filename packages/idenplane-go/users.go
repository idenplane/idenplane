package idenplane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// CreateUserRequest is the payload for creating a user via the admin API.
type CreateUserRequest struct {
	Username  string `json:"username"`
	Email     string `json:"email,omitempty"`
	FirstName string `json:"firstName,omitempty"`
	LastName  string `json:"lastName,omitempty"`
	Enabled   bool   `json:"enabled"`
}

// UpdateUserRequest is the payload for partial user updates. All fields are optional.
type UpdateUserRequest struct {
	Email     *string `json:"email,omitempty"`
	FirstName *string `json:"firstName,omitempty"`
	LastName  *string `json:"lastName,omitempty"`
	Enabled   *bool   `json:"enabled,omitempty"`
}

// ListUsersParams holds optional filters and pagination for User.List.
type ListUsersParams struct {
	Username  string
	Email     string
	FirstName string
	LastName  string
	Search    string
	Enabled   *bool
	First     int
	Max       int
}

// UserRepresentation is the wire representation of a user from the admin API.
type UserRepresentation struct {
	ID            string              `json:"id"`
	Created       int64               `json:"createdTimestamp"`
	Username      string              `json:"username"`
	Enabled       bool                `json:"enabled"`
	EmailVerified bool                `json:"emailVerified"`
	Email         string              `json:"email"`
	FirstName     string              `json:"firstName"`
	LastName      string              `json:"lastName"`
	Groups        []string            `json:"groups,omitempty"`
	Attributes    map[string][]string `json:"attributes,omitempty"`
}

func (r *UserRepresentation) toUser() *User {
	var ts *int64
	if r.Created != 0 {
		c := r.Created
		ts = &c
	}
	return &User{
		ID:               r.ID,
		Username:         r.Username,
		Enabled:          r.Enabled,
		EmailVerified:    r.EmailVerified,
		Email:            r.Email,
		FirstName:        r.FirstName,
		LastName:         r.LastName,
		Groups:           r.Groups,
		Attributes:       r.Attributes,
		CreatedTimestamp: ts,
	}
}

// UserAttributes is reserved for future structured attribute handling.
type UserAttributes struct{}

// UserService exposes admin operations on the realm's users endpoint.
type UserService struct {
	client *Client
}

// extractUserID parses the trailing path segment from a Location header.
func extractUserID(location string) string {
	if location == "" {
		return ""
	}
	location = strings.TrimRight(location, "/")
	if idx := strings.LastIndex(location, "/"); idx >= 0 {
		return location[idx+1:]
	}
	return location
}

func (us *UserService) usersURL() string {
	return fmt.Sprintf("%s/admin/realms/%s/users", strings.TrimSuffix(us.client.config.ServerURL, "/"), us.client.config.Realm)
}

// doRequest builds, authenticates, and dispatches an admin API request.
// When body is non-nil it is JSON-encoded and the Content-Type header set.
// When the client has an AdminToken configured, the Authorization header is
// attached so admin endpoints don't return 401.
func (us *UserService) doRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, ErrServerError("marshal request body: " + err.Error())
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, path, reader)
	if err != nil {
		return nil, ErrNetworkError("build request", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if auth := us.client.authHeader(); auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := us.client.config.httpClient().Do(req)
	if err != nil {
		return nil, ErrNetworkError("request failed", err)
	}
	return resp, nil
}

// Create creates a user and returns the resulting record. Idenplane's admin
// API returns 201 with a Location header containing the new user's ID; we
// follow that with a GET to populate the full record. If the POST response
// body itself already carries a full UserRepresentation (with an ID), we
// trust it and skip the follow-up GET.
func (us *UserService) Create(ctx context.Context, req CreateUserRequest) (*User, error) {
	if req.Username == "" {
		return nil, ErrInvalidConfig("Username is required")
	}
	resp, err := us.doRequest(ctx, http.MethodPost, us.usersURL(), req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("create user: status %d", resp.StatusCode))
	}

	var locationID string
	if loc := resp.Header.Get("Location"); loc != "" {
		locationID = extractUserID(loc)
	}

	rawBody, _ := io.ReadAll(resp.Body)
	var rep UserRepresentation
	if len(rawBody) > 0 {
		_ = json.Unmarshal(rawBody, &rep)
	}

	// Prefer the server's POST body when it already contains a full record.
	if locationID == "" && rep.ID != "" {
		return rep.toUser(), nil
	}

	id := locationID
	if id == "" {
		id = rep.ID
	}
	if id == "" {
		return nil, ErrServerError("create user: no ID returned")
	}

	user, err := us.Get(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("user created (id=%s) but fetch failed: %w", id, err)
	}
	return user, nil
}

// Get fetches a single user by ID.
func (us *UserService) Get(ctx context.Context, id string) (*User, error) {
	resp, err := us.doRequest(ctx, http.MethodGet, us.usersURL()+"/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrUserNotFound(id)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("get user: status %d", resp.StatusCode))
	}

	var rep UserRepresentation
	if err := json.NewDecoder(resp.Body).Decode(&rep); err != nil {
		return nil, ErrServerError("invalid user payload: " + err.Error())
	}
	return rep.toUser(), nil
}

// List returns users matching the supplied filters and the count returned by the server.
func (us *UserService) List(ctx context.Context, params ListUsersParams) ([]*User, int, error) {
	u, err := url.Parse(us.usersURL())
	if err != nil {
		return nil, 0, ErrInvalidConfig("invalid users URL")
	}
	q := u.Query()
	if params.Username != "" {
		q.Set("username", params.Username)
	}
	if params.Email != "" {
		q.Set("email", params.Email)
	}
	if params.FirstName != "" {
		q.Set("firstName", params.FirstName)
	}
	if params.LastName != "" {
		q.Set("lastName", params.LastName)
	}
	if params.Search != "" {
		q.Set("search", params.Search)
	}
	if params.Enabled != nil {
		q.Set("enabled", strconv.FormatBool(*params.Enabled))
	}
	if params.First > 0 {
		q.Set("first", strconv.Itoa(params.First))
	}
	if params.Max > 0 {
		q.Set("max", strconv.Itoa(params.Max))
	}
	u.RawQuery = q.Encode()

	resp, err := us.doRequest(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, 0, ErrServerError(fmt.Sprintf("list users: status %d", resp.StatusCode))
	}

	var reps []UserRepresentation
	if err := json.NewDecoder(resp.Body).Decode(&reps); err != nil {
		return nil, 0, ErrServerError("invalid list payload: " + err.Error())
	}
	users := make([]*User, len(reps))
	for i := range reps {
		users[i] = reps[i].toUser()
	}
	return users, len(users), nil
}

// Update applies a partial update to the user with the given ID.
func (us *UserService) Update(ctx context.Context, id string, req UpdateUserRequest) error {
	resp, err := us.doRequest(ctx, http.MethodPut, us.usersURL()+"/"+url.PathEscape(id), req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ErrUserNotFound(id)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ErrServerError(fmt.Sprintf("update user: status %d", resp.StatusCode))
	}
	return nil
}

// Delete removes the user with the given ID.
func (us *UserService) Delete(ctx context.Context, id string) error {
	resp, err := us.doRequest(ctx, http.MethodDelete, us.usersURL()+"/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ErrUserNotFound(id)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ErrServerError(fmt.Sprintf("delete user: status %d", resp.StatusCode))
	}
	return nil
}

// ResetPassword sets a new password for the user. If temporary is true, the
// user is required to change the password on next login.
func (us *UserService) ResetPassword(ctx context.Context, id, password string, temporary bool) error {
	body := map[string]interface{}{
		"type":      "password",
		"value":     password,
		"temporary": temporary,
	}
	resp, err := us.doRequest(ctx, http.MethodPut, us.usersURL()+"/"+url.PathEscape(id)+"/reset-password", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ErrUserNotFound(id)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ErrServerError(fmt.Sprintf("reset password: status %d", resp.StatusCode))
	}
	return nil
}
