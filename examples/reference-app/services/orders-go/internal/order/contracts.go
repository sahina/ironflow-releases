package order

// Loading side of the shared wire contract. `contracts/` is language-neutral and
// is never copied into a service, so everything here reads those files in place:
// the catalog this context prices orders from, and the schemas it registers with
// Ironflow before it reports ready.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// commonSchemaRef is the `$id` of contracts/schemas/common.v1.schema.json. Every
// message schema reaches its primitives through it.
const commonSchemaRef = "https://ironflow.run/reference-app/contracts/common.v1.schema.json#/$defs/"

// FindContractsDir returns the absolute path of `contracts/`.
//
// REFERENCE_APP_CONTRACTS_DIR wins when set. Otherwise it walks up from the
// working directory, which finds the same directory from the service root at
// runtime and from a package directory under `go test`.
func FindContractsDir() (string, error) {
	if dir := os.Getenv("REFERENCE_APP_CONTRACTS_DIR"); dir != "" {
		if _, err := os.Stat(filepath.Join(dir, "catalog.json")); err != nil {
			return "", fmt.Errorf("REFERENCE_APP_CONTRACTS_DIR=%s has no catalog.json: %w", dir, err)
		}
		return dir, nil
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(dir, "contracts")
		if _, err := os.Stat(filepath.Join(candidate, "catalog.json")); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no contracts/catalog.json above the working directory; set REFERENCE_APP_CONTRACTS_DIR")
		}
		dir = parent
	}
}

// Product is one line of the committed catalog.
type Product struct {
	SKU            string `json:"sku"`
	Name           string `json:"name"`
	UnitPriceCents int64  `json:"unitPriceCents"`
}

// Catalog is the committed price list. It is the only authority on prices: the
// browser's total is a display value this service recomputes and checks.
type Catalog struct {
	Version  int       `json:"version"`
	Currency string    `json:"currency"`
	Products []Product `json:"products"`
	bySKU    map[string]Product
}

// LoadCatalog reads contracts/catalog.json.
func LoadCatalog(contractsDir string) (*Catalog, error) {
	raw, err := os.ReadFile(filepath.Join(contractsDir, "catalog.json"))
	if err != nil {
		return nil, fmt.Errorf("read catalog: %w", err)
	}
	var c Catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("parse catalog: %w", err)
	}
	if len(c.Products) == 0 {
		return nil, fmt.Errorf("catalog has no products")
	}
	c.bySKU = make(map[string]Product, len(c.Products))
	for _, p := range c.Products {
		if p.UnitPriceCents <= 0 {
			return nil, fmt.Errorf("catalog product %q has a non-positive price", p.SKU)
		}
		c.bySKU[p.SKU] = p
	}
	return &c, nil
}

// Lookup returns the catalog product for a SKU.
func (c *Catalog) Lookup(sku string) (Product, bool) {
	p, ok := c.bySKU[sku]
	return p, ok
}

// LoadDataSchema reads one contract file and returns the registerable form of
// its `data` subschema.
//
// Two transformations, both forced by the engine:
//
//   - Only `properties.data` is registered. Ironflow carries data and metadata
//     on separate channels, so the `{data, metadata}` envelope in the contract
//     file is a test-time shape no service ever emits.
//   - External `$ref`s are inlined. The engine refuses external `$ref`
//     resolution at registration time (internal/schemacache/cache.go), so a
//     schema that points at common.v1.schema.json by URL fails to compile.
//     Every referenced `common` definition is copied into a local `$defs`.
func LoadDataSchema(contractsDir, file string) (map[string]any, error) {
	envelope, err := readJSONObject(filepath.Join(contractsDir, "schemas", file))
	if err != nil {
		return nil, err
	}
	properties, _ := envelope["properties"].(map[string]any)
	data, ok := properties["data"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s has no properties.data", file)
	}

	common, err := readJSONObject(filepath.Join(contractsDir, "schemas", "common.v1.schema.json"))
	if err != nil {
		return nil, err
	}
	commonDefs, ok := common["$defs"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("common.v1.schema.json has no $defs")
	}

	used := map[string]any{}
	inlined, err := inlineCommonRefs(data, commonDefs, used)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", file, err)
	}
	schema, _ := inlined.(map[string]any)
	schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
	if len(used) > 0 {
		schema["$defs"] = used
	}
	return schema, nil
}

// inlineCommonRefs rewrites every `common.v1` `$ref` to a local pointer and
// collects the definitions it named into used. It refuses any other external
// `$ref` rather than registering a schema the engine will reject.
func inlineCommonRefs(node any, commonDefs map[string]any, used map[string]any) (any, error) {
	switch typed := node.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, value := range typed {
			if key == "$ref" {
				ref, _ := value.(string)
				name, found := strings.CutPrefix(ref, commonSchemaRef)
				if !found {
					if strings.Contains(ref, "://") {
						return nil, fmt.Errorf("unsupported external $ref %q", ref)
					}
					out[key] = value
					continue
				}
				def, ok := commonDefs[name]
				if !ok {
					return nil, fmt.Errorf("$ref names unknown common definition %q", name)
				}
				used[name] = def
				out[key] = "#/$defs/" + name
				continue
			}
			converted, err := inlineCommonRefs(value, commonDefs, used)
			if err != nil {
				return nil, err
			}
			out[key] = converted
		}
		return out, nil
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			converted, err := inlineCommonRefs(item, commonDefs, used)
			if err != nil {
				return nil, err
			}
			out[i] = converted
		}
		return out, nil
	default:
		return node, nil
	}
}

func readJSONObject(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", filepath.Base(path), err)
	}
	return out, nil
}
