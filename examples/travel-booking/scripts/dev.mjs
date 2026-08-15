#!/usr/bin/env node
// Supervisor for `pnpm dev`. Runs two children:
//
//   next dev  — the UI, never restarted
//   worker.ts — the Ironflow worker, restarted whenever it exits
//
// The worker needs its own process because the demo's best moment is killing it
// mid-booking and watching the run resume. An embedded worker (todo-web's
// pattern) can't do that: process.exit(1) would take the dev server with it and
// nothing would bring either back.

import { spawn } from "node:child_process";

const children = new Set();
let shuttingDown = false;

function run(name, command, args, { restart = false } = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
  });
  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;

    if (!restart) {
      console.error(`[dev] ${name} exited (${signal ?? code}) — shutting down`);
      shutdown(code ?? 1);
      return;
    }

    // Exit 2 means "this will fail the same way next time" (port taken, bad
    // config). Restarting is an infinite loop, so stop instead — the child has
    // already printed why.
    if (code === 2) {
      console.error(`[dev] ${name} exited (2) — configuration problem, not restarting`);
      shutdown(2);
      return;
    }

    console.log(`[dev] ${name} exited (${signal ?? code}) — restarting`);
    // Small pause so a crash-loop doesn't spin the CPU while you read the error.
    setTimeout(() => {
      if (!shuttingDown) run(name, command, args, { restart });
    }, 300);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("next", "pnpm", ["exec", "next", "dev"]);
run("worker", "pnpm", ["exec", "tsx", "worker.ts"], { restart: true });

console.log("[dev] UI on http://localhost:3000 — worker supervised, crash it from the chaos panel");
