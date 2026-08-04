<p align="center">
  <img src="https://idenplane.com/logo.svg" alt="Idenplane" width="60" />
</p>

<h2 align="center">idenplane-go</h2>

<p align="center">
  <strong>Official server-side Go SDK for <a href="https://idenplane.com">Idenplane</a></strong><br />
  <sub>OIDC discovery and admin management (users, roles, groups) against the Idenplane realm-management API.</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/go-1.24%2B-00ADD8" alt="Go 1.24+" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

---

## Install

```bash
go get github.com/idenplane/idenplane/packages/idenplane-go
```

Requires Go 1.24 or newer. No third-party runtime dependencies — only the standard library.

---

## Quick start

```go
package main

import (
	"context"
	"fmt"
	"log"

	idenplane "github.com/idenplane/idenplane/packages/idenplane-go"
)

func main() {
	client := idenplane.NewClient(idenplane.Config{
		ServerURL:  "https://auth.example.com",
		Realm:      "my-realm",
		ClientID:   "my-app",
		AdminToken: "eyJ...", // service-account token with the realm-management role
	})

	ctx := context.Background()

	user, err := client.Users.Create(ctx, idenplane.CreateUserRequest{
		Username: "alice",
		Email:    "alice@example.com",
		Enabled:  true,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("created user", user.ID)
}
```

`NewClientWithDefaults(serverURL, realm, clientID)` is a shorthand for the common case where you don't need to override `Scopes`, `HTTPClient`, `DiscoveryTTL`, or `HTTPTimeout`.

`ServerURL` must be `https://` unless the host is a loopback address (`localhost`, `127.0.0.1`, `::1`) or `Config.AllowInsecureHTTP` is explicitly set — plaintext HTTP would otherwise send `AdminToken` over the wire unencrypted.

---

## Auth

Every admin-API call (`Users`, `Roles`, `Groups`) is authenticated with `Config.AdminToken`, sent as `Authorization: Bearer <token>`. Typically this is obtained via the OAuth 2.0 client-credentials flow against a service account that holds the `realm-management` role. If `AdminToken` is empty, the `Authorization` header is simply omitted — useful for discovery-only usage.

---

## User CRUD

```go
// Get
user, err := client.Users.Get(ctx, "user-id-123")

// List with filters and pagination (page is 1-based, limit defaults to 20)
users, total, err := client.Users.List(ctx, idenplane.ListUsersParams{
	Search: "alice",
	Page:   1,
	Limit:  25,
})

// Update (returns error only; fetch again with Get if you need the updated record)
newEmail := "new@example.com"
err = client.Users.Update(ctx, "user-id-123", idenplane.UpdateUserRequest{
	Email: &newEmail,
})

// Reset password
err = client.Users.ResetPassword(ctx, "user-id-123", "S3cret!", true /* temporary */)

// Delete
err = client.Users.Delete(ctx, "user-id-123")
```

`Create` follows the admin API's `201` + `Location` header response with a `GET` to populate the full record, unless the `POST` body already carried one.

---

## Role CRUD

Realm roles are addressed by **name**, not by ID:

```go
role, err := client.Roles.Create(ctx, idenplane.CreateRoleRequest{
	Name:        "billing-admin",
	Description: "Can manage billing settings",
})

role, err = client.Roles.Get(ctx, "billing-admin")

roles, err := client.Roles.List(ctx)

desc := "Updated description"
role, err = client.Roles.Update(ctx, "billing-admin", idenplane.UpdateRoleRequest{
	Description: &desc,
})

err = client.Roles.Delete(ctx, "billing-admin")
```

---

## Group CRUD

Groups are addressed by ID and support nesting via `ParentID`:

```go
parent, err := client.Groups.Create(ctx, idenplane.CreateGroupRequest{Name: "engineering"})

child, err := client.Groups.Create(ctx, idenplane.CreateGroupRequest{
	Name:     "platform-team",
	ParentID: parent.ID,
})

group, err := client.Groups.Get(ctx, child.ID)

groups, err := client.Groups.List(ctx)

newName := "platform-infra"
group, err = client.Groups.Update(ctx, child.ID, idenplane.UpdateGroupRequest{Name: &newName})

err = client.Groups.Delete(ctx, child.ID)
```

---

## Discovery

```go
discovery := idenplane.NewDiscoveryClient(idenplane.Config{
	ServerURL: "https://auth.example.com",
	Realm:     "my-realm",
	ClientID:  "my-app",
})

oidc, err := discovery.Get(ctx) // cached for Config.DiscoveryTTL (default 1 hour)
fmt.Println(oidc.TokenEndpoint)

oidc, err = discovery.Refresh(ctx) // force a refetch, bypassing the cache
```

---

## Errors

All SDK errors are `*idenplane.Error`, carrying a stable `Code` (`idenplane.ErrCodeUserNotFound`, `ErrCodeRoleNotFound`, `ErrCodeGroupNotFound`, `ErrCodeServerError`, `ErrCodeNetworkError`, ...):

```go
user, err := client.Users.Get(ctx, "missing-id")
var idenplaneErr *idenplane.Error
if errors.As(err, &idenplaneErr) && idenplaneErr.Code == idenplane.ErrCodeUserNotFound {
	// handle not-found
}

if idenplane.IsRetryable(err) {
	// network error or 5xx — safe to retry
}
```

---

## Development

```bash
git clone https://github.com/idenplane/idenplane.git
cd idenplane/packages/idenplane-go
go build ./...
go vet ./...
go test ./...
```

---

## License

MIT. See [LICENSE](./LICENSE).
