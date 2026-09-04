// The demo session: the filter that decides which orders this browser shows.
//
// Starting a new session hides earlier orders. It never deletes anything —
// history stays in the engine, and only `make reference-app-reset` removes data.

import { newEntityId } from "@/lib/ids";

const STORAGE_KEY = "reference-app.demo-session";

/** The session this browser is filtering by, created on first use. */
export function currentDemoSession(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;

  const created = newEntityId();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}

/** Starts a new session and returns it. Nothing is deleted; the filter moves. */
export function startNewDemoSession(): string {
  const created = newEntityId();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}
