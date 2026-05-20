// Pulumi provider for AuthMe - Main entry point
// cmd/pulumi-resource-authme/main.go
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/pulumi/pulumi/sdk/v3/go/common/util/cmdutil"
	"github.com/pulumi/pulumi/sdk/v3/go/common/util/rpcutil"
	"github.com/pulumi/pulumi/sdk/v3/go/common/resource/plugin"
	"github.com/pulumi/pulumi/sdk/v3/go/common/tokens"
	"github.com/pulumi/pulumi-terraform-bridge/v3/pkg/tfbridge"

	"github.com/authme/pulumi-provider-authme/provider/pkg"
)

// Version is the version of this provider.
var Version = "0.1.0"

// ProviderName is the name of the provider.
const ProviderName = "authme"

func main() {
	// Parse command line flags
	debugFlag := flag.Bool("debug", false, "Enable debug logging")
	traceFlag := flag.String("trace", "", "Enable tracing to a file")
	versionFlag := flag.Bool("version", false, "Print version information")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("pulumi-resource-authme v%s\n", Version)
		os.Exit(0)
	}

	// Set up logging
	if *debugFlag {
		cmdutil.InitDebugLogging()
	}

	// Set up tracing if requested
	ctx := context.Background()
	if *traceFlag != "" {
		if err := cmdutil.InitTracing("pulumi-resource-authme", *traceFlag); err != nil {
			fmt.Fprintf(os.Stderr, "Error initializing tracing: %v\n", err)
			os.Exit(1)
		}
	}

	// Get the host
	host := plugin.NewHost(cmdutil.Diag(), os.Stdin, os.Stdout, os.Stderr, *debugFlag)

	// Load and create the provider
	p, err := loadProvider(ctx, host)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading provider: %v\n", err)
		os.Exit(1)
	}

	// Serve the provider
	err = rpcutil.Serve(
		nil,
		p,
		true, // Accept secrets
		nil,  // No custom error handler
		nil,  // No TLS config
		nil,  // No metadata
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error serving provider: %v\n", err)
		os.Exit(1)
	}
}

// loadProvider loads the Pulumi provider from the Terraform provider.
func loadProvider(ctx context.Context, host *plugin.Host) (*tfbridge.Provider, error) {
	// Get provider info
	info := pkg.ProviderInfo()

	// Create the Pulumi provider using the tfbridge
	p, err := tfbridge.NewProvider(
		host,
		tokens.Package(ProviderName),
		Version,
		info.P,
		info,
		nil, // No schema post processor
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create Pulumi provider: %w", err)
	}

	return p, nil
}

// ProviderMetadata represents metadata about the provider.
type ProviderMetadata struct {
	Version string `json:"version"`
	Name    string `json:"name"`
	Schema  string `json:"schema"`
}

// getSchemaPath returns the path to the provider schema file.
func getSchemaPath() string {
	return os.Getenv("PULUMI_PROVIDER_SCHEMA")
}

// loadSchema loads the provider schema from disk.
func loadSchema() ([]byte, error) {
	schemaPath := getSchemaPath()
	if schemaPath == "" {
		return nil, nil
	}

	data, err := os.ReadFile(schemaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read schema: %w", err)
	}

	return data, nil
}
