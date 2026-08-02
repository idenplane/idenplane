// Package provider implements the Terraform provider for Idenplane
package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/idenplane/terraform-provider-idenplane/client"
)

// baseResource provides the Configure() implementation shared by every
// resource in this provider. Embed it to satisfy resource.ResourceWithConfigure
// and gain an httpClient field populated from the provider's ProviderData.
type baseResource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// Configure retrieves the *client.HTTPClient the provider wires up via
// ProviderData and stores it on the embedding resource.
func (b *baseResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	httpClient, ok := req.ProviderData.(*client.HTTPClient)
	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected Resource Configure Type",
			fmt.Sprintf("Expected *client.HTTPClient, got: %T", req.ProviderData),
		)
		return
	}

	b.httpClient = httpClient
}

// addAPIError appends a standard error diagnostic for a failed API call,
// formatting detailFormat with args the same way every resource's CRUD
// methods already do (e.g. "Unable to read client %s in realm %s: %v").
func addAPIError(diags *diag.Diagnostics, summary, detailFormat string, args ...any) {
	diags.AddError(summary, fmt.Sprintf(detailFormat, args...))
}
