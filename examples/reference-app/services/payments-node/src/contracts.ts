// Loading side of the shared wire contract, mirroring
// services/orders-go/internal/order/contracts.go. `contracts/` is
// language-neutral and is never copied into a service, so this reads the
// committed files in place.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The `$id` of contracts/schemas/common.v1.schema.json, minus the pointer. */
const COMMON_REF = "https://ironflow.run/reference-app/contracts/common.v1.schema.json#/$defs/";

/**
 * The schemas this service registers.
 *
 * The three `payment.*` facts are the ones it publishes. `demo.payment.continue`
 * is the odd one out: the plan assigns it to a web bootstrap script that does
 * not exist, and an unregistered event is one the engine validates nothing on.
 * Payments is its only consumer and the only process here that boots, so it
 * registers it — and the control event gets the same enforcement as a fact.
 */
export const OWNED_SCHEMAS = [
  "payment.authorized",
  "payment.captured",
  "payment.declined",
  "demo.payment.continue",
] as const;

type JsonObject = Record<string, unknown>;

/**
 * The absolute path of `contracts/`.
 *
 * REFERENCE_APP_CONTRACTS_DIR wins when set. Otherwise it walks up from this
 * file, which finds the same directory from `dist/` at runtime and from `src/`
 * under vitest.
 */
export function findContractsDir(): string {
  const override = process.env.REFERENCE_APP_CONTRACTS_DIR;
  if (override) {
    if (!existsSync(join(override, "catalog.json"))) {
      throw new Error(`REFERENCE_APP_CONTRACTS_DIR=${override} has no catalog.json`);
    }
    return override;
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "contracts");
    if (existsSync(join(candidate, "catalog.json"))) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) {
      throw new Error("no contracts/catalog.json above this file; set REFERENCE_APP_CONTRACTS_DIR");
    }
    dir = parent;
  }
}

function readJson(path: string): JsonObject {
  if (!existsSync(path)) throw new Error(`no contract file at ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

/**
 * One contract file, in the form the engine will accept.
 *
 * Two transformations, both forced by the engine and both explained in
 * CONTEXT-MAP.md:
 *
 *  - Only `properties.data` is registered. Ironflow carries data and metadata on
 *    separate channels, so the `{data, metadata}` envelope in the contract file
 *    is a test-time shape no service ever emits.
 *  - External `$ref`s are inlined. The engine refuses external `$ref` resolution
 *    at registration time (internal/schemacache/cache.go), so a schema pointing
 *    at common.v1.schema.json by URL fails to compile.
 */
export function loadDataSchema(contractsDir: string, name: string): JsonObject {
  const envelope = readJson(join(contractsDir, "schemas", `${name}.v1.schema.json`));
  const data = (envelope.properties as JsonObject | undefined)?.data as JsonObject | undefined;
  if (!data) throw new Error(`${name}.v1.schema.json has no properties.data`);

  const commonDefs = readJson(join(contractsDir, "schemas", "common.v1.schema.json")).$defs as JsonObject | undefined;
  if (!commonDefs) throw new Error("common.v1.schema.json has no $defs");

  const used: JsonObject = {};
  const schema = inlineCommonRefs(data, commonDefs, used) as JsonObject;
  schema.$schema = "https://json-schema.org/draft/2020-12/schema";
  if (Object.keys(used).length > 0) schema.$defs = used;
  return schema;
}

/**
 * Rewrites every `common.v1` `$ref` to a local pointer, collecting the
 * definitions it named. Any other external `$ref` is refused here rather than
 * registered for the engine to reject.
 */
function inlineCommonRefs(node: unknown, commonDefs: JsonObject, used: JsonObject): unknown {
  if (Array.isArray(node)) return node.map((item) => inlineCommonRefs(item, commonDefs, used));
  if (node === null || typeof node !== "object") return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node as JsonObject)) {
    if (key !== "$ref") {
      out[key] = inlineCommonRefs(value, commonDefs, used);
      continue;
    }
    const ref = String(value);
    if (!ref.startsWith(COMMON_REF)) {
      if (ref.includes("://")) throw new Error(`unsupported external $ref ${ref}`);
      out[key] = value;
      continue;
    }
    const defName = ref.slice(COMMON_REF.length);
    if (!(defName in commonDefs)) throw new Error(`$ref names unknown common definition ${defName}`);
    used[defName] = commonDefs[defName];
    out[key] = `#/$defs/${defName}`;
  }
  return out;
}
