// terraform-provider-authme is the official Terraform provider for AuthMe
package main

import (
	"flag"
	"os"

	"github.com/authme/terraform-provider-authme/provider"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
)

// Version is set during build via ldflags
var Version = "dev"

func main() {
	var debug bool

	flag.BoolVar(&debug, "debug", false, "start the provider in debug mode")
	flag.Parse()

	opts := providerserver.ServeOpts{
		Address: "registry.terraform.io/authme/terraform-provider-authme",
		Debug:   debug,
	}

	err := providerserver.Serve(nil, provider.New, opts)
	if err != nil {
		os.Exit(1)
	}
}