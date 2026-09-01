#!/usr/bin/env node
// Delete this example's runtime data — and nothing else.
//
// A normal run keeps its history on purpose: the "New demo session" control in
// the UI filters what you see without destroying anything. This command is the
// only thing that deletes, so it re-derives the target path from its own
// location and refuses every other shape. See assertResettable in lib/control.mjs.
import { rmSync } from "node:fs";
import { assertResettable } from "./lib/control.mjs";

function main() {
  try {
    const { exists, dir } = assertResettable();
    if (!exists) {
      process.stdout.write("nothing to reset\n");
      return 0;
    }
    rmSync(dir, { recursive: true, force: true });
    process.stdout.write(`removed ${dir}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

// import.meta.main, not an argv[1] comparison: argv[1] is the path as typed
// while import.meta.url is realpath'd, so behind a symlinked checkout (macOS
// /var -> /private/var, a symlinked home) the comparison is false and the
// script exits 0 having done nothing.
if (import.meta.main) {
  process.exitCode = main();
}

export { main };
