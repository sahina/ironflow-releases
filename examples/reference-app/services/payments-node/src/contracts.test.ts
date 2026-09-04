// The shared wire contract, from this service's side.
//
// contracts/ is language-neutral and never copied into a service. These cases
// read the committed files in place and prove two things the workspace-level
// contract test cannot: that the transformation this service applies before
// registering a schema keeps the committed fixtures valid, and that the schema
// it hands the engine has no external $ref left for the engine to refuse.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findContractsDir, loadDataSchema, OWNED_SCHEMAS } from "./contracts.js";

const contractsDir = findContractsDir();
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(contractsDir, "fixtures", "valid", `${name}.json`), "utf8")) as {
    data: Record<string, unknown>;
  };

// The same validator contracts/validate.mjs uses, so this asserts what the file
// name claims: the transformed schema still accepts the committed payload,
// values and patterns included. A hand-rolled field-name check would pass a
// schema whose $ref survived the transformation as a broken local pointer.
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

function validateAgainst(schema: Record<string, unknown>, data: Record<string, unknown>): string {
  const validate = ajv.compile(schema);
  return validate(data) ? "" : ajv.errorsText(validate.errors);
}

describe("findContractsDir", () => {
  it("finds the committed contracts from this package's directory", () => {
    expect(JSON.parse(readFileSync(join(contractsDir, "catalog.json"), "utf8")).products).toHaveLength(3);
  });
});

describe("OWNED_SCHEMAS", () => {
  it("is exactly the payment facts this context publishes, plus the control event it consumes", () => {
    expect(OWNED_SCHEMAS).toEqual([
      "payment.authorized",
      "payment.captured",
      "payment.declined",
      "demo.payment.continue",
    ]);
  });
});

describe("loadDataSchema", () => {
  it.each(OWNED_SCHEMAS)("registers the data subschema of %s, not the test envelope", (name) => {
    const schema = loadDataSchema(contractsDir, name);
    // The envelope is a test-time shape no service ever emits. Registering it
    // would declare that every payload looks like {data, metadata} and fail
    // every handler that validates its input.
    expect(Object.keys(schema.properties as object)).not.toContain("metadata");
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it.each(OWNED_SCHEMAS)("leaves no external $ref in %s for the engine to refuse", (name) => {
    // internal/schemacache/cache.go refuses external $ref resolution when it
    // compiles a registered schema, so a schema reaching common.v1 by URL fails
    // to compile at registration time.
    expect(JSON.stringify(loadDataSchema(contractsDir, name))).not.toContain("https://ironflow.run/");
  });

  it.each(OWNED_SCHEMAS)("keeps the committed %s fixture valid after the transformation", (name) => {
    expect(validateAgainst(loadDataSchema(contractsDir, name), fixture(name).data)).toBe("");
  });

  it("inlines the shared primitives a payment fact reaches by URL", () => {
    const schema = loadDataSchema(contractsDir, "payment.authorized");
    const properties = schema.properties as Record<string, { $ref?: string }>;
    expect(properties.orderId?.$ref).toBe("#/$defs/entityId");
    expect((schema.$defs as Record<string, unknown>).entityId).toEqual({
      description: "One safe Ironflow subject segment: lowercase UUID without separators.",
      type: "string",
      pattern: "^[0-9a-f]{32}$",
    });
  });

  // The refusal that keeps an unregisterable schema out of the engine. Any
  // external $ref other than common.v1 is rejected here rather than sent to a
  // server that would reject it at registration time with a worse message.
  it("refuses an external $ref it cannot inline", () => {
    const scratch = mkdtempSync(join(tmpdir(), "refapp-contracts-"));
    try {
      mkdirSync(join(scratch, "schemas"));
      writeFileSync(join(scratch, "catalog.json"), JSON.stringify({ products: [] }));
      copyFileSync(
        join(contractsDir, "schemas", "common.v1.schema.json"),
        join(scratch, "schemas", "common.v1.schema.json"),
      );
      writeFileSync(
        join(scratch, "schemas", "foreign.v1.schema.json"),
        JSON.stringify({
          properties: {
            data: { type: "object", properties: { x: { $ref: "https://example.com/other.json#/$defs/x" } } },
          },
        }),
      );
      expect(() => loadDataSchema(scratch, "foreign")).toThrow(/unsupported external \$ref/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("names the file it cannot find rather than registering nothing", () => {
    expect(() => loadDataSchema(contractsDir, "payment.refunded")).toThrow(/payment\.refunded/);
  });
});
