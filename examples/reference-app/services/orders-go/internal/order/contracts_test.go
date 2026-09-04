package order

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v5"
)

// The Go half of the shared contract test. It reads the same
// contracts/fixtures/index.json manifest the TypeScript and Python suites read.
// No fixture is copied into this service.

type fixtureCase struct {
	Fixture string `json:"fixture"`
	Schema  string `json:"schema"`
	Expect  string `json:"expect"`
	Reason  string `json:"reason"`
}

// externalRef matches any `$ref` that is not a local `#/...` pointer.
var externalRef = regexp.MustCompile(`"\$ref"\s*:\s*"[^#][^"]*"`)

type fixtureManifest struct {
	Cases []fixtureCase `json:"cases"`
}

func contractsDir(t *testing.T) string {
	t.Helper()
	dir, err := FindContractsDir()
	if err != nil {
		t.Fatalf("locate contracts: %v", err)
	}
	return dir
}

// compileEnvelope compiles a contract file as written, `{data, metadata}` and
// all. The cross-file `$ref`s resolve because every schema file is added under
// its own `$id`; this is the test-time view of the contract, not the shape any
// service registers or emits.
func compileEnvelope(t *testing.T, dir, file string) *jsonschema.Schema {
	t.Helper()
	compiler := jsonschema.NewCompiler()
	compiler.Draft = jsonschema.Draft2020

	entries, err := os.ReadDir(filepath.Join(dir, "schemas"))
	if err != nil {
		t.Fatalf("read schemas: %v", err)
	}
	var target string
	for _, entry := range entries {
		path := filepath.Join(dir, "schemas", entry.Name())
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("parse %s: %v", entry.Name(), err)
		}
		id, _ := doc["$id"].(string)
		if id == "" {
			t.Fatalf("%s has no $id", entry.Name())
		}
		if err := compiler.AddResource(id, bytes.NewReader(raw)); err != nil {
			t.Fatalf("add %s: %v", entry.Name(), err)
		}
		if entry.Name() == file {
			target = id
		}
	}
	if target == "" {
		t.Fatalf("schema %s not found in %s/schemas", file, dir)
	}
	schema, err := compiler.Compile(target)
	if err != nil {
		t.Fatalf("compile %s: %v", file, err)
	}
	return schema
}

func loadFixture(t *testing.T, dir, rel string) any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse %s: %v", rel, err)
	}
	return doc
}

func loadManifest(t *testing.T, dir string) fixtureManifest {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "fixtures", "index.json"))
	if err != nil {
		t.Fatalf("read fixture manifest: %v", err)
	}
	var manifest fixtureManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse fixture manifest: %v", err)
	}
	if len(manifest.Cases) == 0 {
		t.Fatal("fixture manifest is empty")
	}
	return manifest
}

func TestFixturesMatchTheirSchemas(t *testing.T) {
	dir := contractsDir(t)

	for _, tc := range loadManifest(t, dir).Cases {
		t.Run(tc.Fixture, func(t *testing.T) {
			schema := compileEnvelope(t, dir, tc.Schema)
			err := schema.Validate(loadFixture(t, dir, tc.Fixture))

			switch tc.Expect {
			case "valid":
				if err != nil {
					t.Fatalf("expected valid, got: %v", err)
				}
			case "schema-invalid":
				if err == nil {
					t.Fatalf("expected the schema to reject this fixture (%s)", tc.Reason)
				}
			case "domain-invalid":
				// Well formed on the wire on purpose. Only Ordering holds the
				// catalog, so only Ordering can reject it — see model_test.go.
				if err != nil {
					t.Fatalf("a domain-invalid fixture must still satisfy its schema, got: %v", err)
				}
			default:
				t.Fatalf("unknown expect value %q", tc.Expect)
			}
		})
	}
}

// The registered form is what the engine actually enforces on every append, so
// it gets the same fixtures. A `data` subschema that drifts from its envelope
// would pass the test above and still reject every real event.
func TestRegisteredDataSchemasAcceptValidFixtures(t *testing.T) {
	dir := contractsDir(t)

	for _, tc := range loadManifest(t, dir).Cases {
		if tc.Expect != "valid" {
			continue
		}
		t.Run(tc.Schema, func(t *testing.T) {
			data, err := LoadDataSchema(dir, tc.Schema)
			if err != nil {
				t.Fatalf("load data schema: %v", err)
			}
			encoded, err := json.Marshal(data)
			if err != nil {
				t.Fatalf("marshal data schema: %v", err)
			}
			// Every `$ref` must be a local pointer. `$schema` is a URL and is
			// not a reference, so match on the keyword, not on "://".
			if external := externalRef.FindString(string(encoded)); external != "" {
				t.Fatalf("registered schema still holds an external $ref: %s", external)
			}

			compiler := jsonschema.NewCompiler()
			compiler.Draft = jsonschema.Draft2020
			// The engine refuses external $ref resolution; this compiler mirrors
			// that so a schema that only works with a network fetch fails here.
			compiler.LoadURL = func(string) (io.ReadCloser, error) {
				t.Fatalf("registered schema attempted an external fetch")
				return nil, nil
			}
			if err := compiler.AddResource("inline.json", bytes.NewReader(encoded)); err != nil {
				t.Fatalf("add resource: %v", err)
			}
			compiled, err := compiler.Compile("inline.json")
			if err != nil {
				t.Fatalf("compile registered schema: %v", err)
			}

			envelope, ok := loadFixture(t, dir, tc.Fixture).(map[string]any)
			if !ok {
				t.Fatalf("fixture %s is not an object", tc.Fixture)
			}
			if err := compiled.Validate(envelope["data"]); err != nil {
				t.Fatalf("registered schema rejects the valid fixture's data: %v", err)
			}
		})
	}
}

func TestCatalogLoads(t *testing.T) {
	catalog, err := LoadCatalog(contractsDir(t))
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	if len(catalog.Products) != 3 {
		t.Fatalf("expected the committed three-product catalog, got %d", len(catalog.Products))
	}
	if _, ok := catalog.Lookup("sku_desk_lamp"); !ok {
		t.Fatal("sku_desk_lamp is missing from the catalog")
	}
	if _, ok := catalog.Lookup("sku_not_real"); ok {
		t.Fatal("an unknown SKU resolved")
	}
}
