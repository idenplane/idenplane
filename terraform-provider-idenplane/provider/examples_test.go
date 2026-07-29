package provider

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	dsschema "github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	rsschema "github.com/hashicorp/terraform-plugin-framework/resource/schema"
)

// The examples under examples/ previously described a provider schema that had
// never existed — a provider block with auth_method and admin credentials,
// against a provider that only ever took url and api_key. Nothing caught it
// because nothing compared the two.
//
// This asks the provider for its real schemas and checks every attribute the
// examples set against them: unknown names, and attributes that are computed
// and so cannot be assigned. It is the check that would have caught the old
// examples on the day they were written.

var (
	blockRe = regexp.MustCompile(`(?ms)^(resource|data)\s+"(idenplane_\w+)"\s+"\w+"\s*\{(.*?)^\}`)
	attrRe  = regexp.MustCompile(`(?m)^\s{2}([a-z_0-9]+)\s*=`)
	cmtRe   = regexp.MustCompile(`#.*`)
)

// attrInfo records what the provider says about one attribute.
type attrInfo struct{ computed bool }

func resourceSchemas(t *testing.T) map[string]map[string]attrInfo {
	t.Helper()
	ctx := context.Background()
	out := map[string]map[string]attrInfo{}

	p := New()
	var meta provider.MetadataResponse
	p.Metadata(ctx, provider.MetadataRequest{}, &meta)

	for _, ctor := range p.Resources(ctx) {
		r := ctor()
		var md resource.MetadataResponse
		r.Metadata(ctx, resource.MetadataRequest{ProviderTypeName: meta.TypeName}, &md)
		var sr resource.SchemaResponse
		r.Schema(ctx, resource.SchemaRequest{}, &sr)
		out["resource:"+md.TypeName] = collect(sr.Schema.Attributes)
	}
	for _, ctor := range p.DataSources(ctx) {
		d := ctor()
		var md datasource.MetadataResponse
		d.Metadata(ctx, datasource.MetadataRequest{ProviderTypeName: meta.TypeName}, &md)
		var sr datasource.SchemaResponse
		d.Schema(ctx, datasource.SchemaRequest{}, &sr)
		out["data:"+md.TypeName] = collectDS(sr.Schema.Attributes)
	}
	return out
}

func collect(attrs map[string]rsschema.Attribute) map[string]attrInfo {
	m := map[string]attrInfo{}
	for name, a := range attrs {
		m[name] = attrInfo{computed: a.IsComputed() && !a.IsOptional() && !a.IsRequired()}
	}
	return m
}

func collectDS(attrs map[string]dsschema.Attribute) map[string]attrInfo {
	m := map[string]attrInfo{}
	for name, a := range attrs {
		m[name] = attrInfo{computed: a.IsComputed() && !a.IsOptional() && !a.IsRequired()}
	}
	return m
}

func TestExamplesMatchProviderSchema(t *testing.T) {
	schemas := resourceSchemas(t)

	root := filepath.Join("..", "examples")
	var files []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(path, ".tf") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", root, err)
	}
	if len(files) == 0 {
		t.Fatalf("no .tf files under %s — this test would pass vacuously", root)
	}

	for _, f := range files {
		body, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("reading %s: %v", f, err)
		}
		for _, m := range blockRe.FindAllStringSubmatch(string(body), -1) {
			kind, typ, block := m[1], m[2], cmtRe.ReplaceAllString(m[3], "")

			known, ok := schemas[kind+":"+typ]
			if !ok {
				t.Errorf("%s: %s %q is not registered by the provider", f, kind, typ)
				continue
			}
			for _, a := range attrRe.FindAllStringSubmatch(block, -1) {
				name := a[1]
				info, ok := known[name]
				if !ok {
					t.Errorf("%s: %s.%s does not exist in the provider schema", f, typ, name)
					continue
				}
				if info.computed {
					t.Errorf("%s: %s.%s is computed and cannot be set", f, typ, name)
				}
			}
		}
	}
}
