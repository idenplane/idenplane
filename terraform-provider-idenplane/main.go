// terraform-provider-idenplane is the official Terraform provider for Idenplane
package main

import (
	"flag"
	"os"

	"github.com/idenplane/terraform-provider-idenplane/provider"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
)

// Version is set during build via ldflags
var Version = "dev"

func main() {
	var debug bool

	flag.BoolVar(&debug, "debug", false, "start the provider in debug mode")
	flag.Parse()

	opts := providerserver.ServeOpts{
		Address: "registry.terraform.io/idenplane/terraform-provider-idenplane",
		Debug:   debug,
	}

	err := providerserver.Serve(nil, provider.New, opts)
	if err != nil {
		os.Exit(1)
	}
}