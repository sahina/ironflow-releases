#!/usr/bin/env node
// Contract test for the reference app wire format.
// Every language validates the same fixtures against the same schemas; this is
// the TypeScript/JavaScript side. Go and Python read contracts/fixtures/index.json
// the same way and must agree case for case.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const manifest = readJson("fixtures/index.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

for (const file of readdirSync(join(root, manifest.schemaDir)).sort()) {
  ajv.addSchema(readJson(join(manifest.schemaDir, file)));
}

const validators = new Map();
const validatorFor = (schemaFile) => {
  if (!validators.has(schemaFile)) {
    const schema = readJson(join(manifest.schemaDir, schemaFile));
    validators.set(schemaFile, ajv.getSchema(schema.$id));
  }
  return validators.get(schemaFile);
};

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};

// Drift guard. The manifest is the contract between the three languages, so a
// schema or fixture that no case names is invisible to every language at once.
{
  const shared = new Set(["common.v1.schema.json", "metadata.v1.schema.json"]);
  const onDisk = readdirSync(join(root, manifest.schemaDir)).filter((f) => !shared.has(f));
  const exercised = new Set(manifest.cases.map((c) => c.schema));
  for (const f of onDisk) {
    check("fixtures/index.json", exercised.has(f), `schema ${f} has no fixture case`);
  }

  const listed = new Set(manifest.cases.map((c) => c.fixture));
  const walk = (dir) =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  for (const f of walk("fixtures")) {
    if (f === "fixtures/index.json") continue;
    check("fixtures/index.json", listed.has(f), `fixture ${f} is not listed`);
  }
}

// The catalog is language-neutral input for every service; validate it too.
{
  const validate = ajv.compile(readJson("catalog.schema.json"));
  check("catalog.json", validate(readJson("catalog.json")), ajv.errorsText(validate.errors));
}

const EXPECTATIONS = new Set(["valid", "schema-invalid", "domain-invalid"]);

for (const c of manifest.cases) {
  if (!EXPECTATIONS.has(c.expect)) {
    // An unknown value would otherwise fall through to the "expect valid" branch
    // and quietly assert the opposite of what the case was written for.
    check(c.fixture, false, `unknown expect value ${JSON.stringify(c.expect)}`);
    continue;
  }
  const validate = validatorFor(c.schema);
  const ok = validate(readJson(c.fixture));
  const errors = ajv.errorsText(validate.errors);
  if (c.expect === "schema-invalid") {
    // Negative assertion first: a no-op validator cannot pass this suite.
    check(c.fixture, !ok, `expected a schema violation (${c.reason}) but it validated`);
  } else {
    // domain-invalid payloads are well-formed on the wire on purpose. Only the
    // ordering service, holding the catalog, can reject them.
    check(c.fixture, ok, `expected valid, got: ${errors}`);
  }
}

if (failures.length > 0) {
  console.error(`contracts: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`contracts: ${manifest.cases.length} fixture cases + catalog OK`);
