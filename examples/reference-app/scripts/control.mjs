#!/usr/bin/env node
// Presenter control client. Sends one authenticated command to the running
// supervisor from a second terminal.
//
//   node scripts/control.mjs crash payments
//
// Used by `make reference-app-crash-payment` during the crash-and-resume demo.
import { sendControl } from "./lib/control.mjs";

async function main(argv) {
  const [action, target] = argv;
  if (!action) {
    process.stderr.write("usage: control.mjs <action> [target]   (e.g. control.mjs crash payments)\n");
    return 2;
  }
  try {
    process.stdout.write(`${await sendControl(action, target)}\n`);
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
  process.exitCode = await main(process.argv.slice(2));
}

export { main };
