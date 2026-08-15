"use client";

import { ironflow } from "@ironflow/browser";

ironflow.configure({
  serverUrl: process.env.NEXT_PUBLIC_IRONFLOW_SERVER_URL,
});

ironflow.connect().catch((err) => {
  console.error("[ironflow] Failed to connect:", err);
});

/**
 * Who this tab is.
 *
 * sessionStorage, not localStorage: localStorage is shared by every tab on the
 * origin, so two tabs would be the same traveller and the race demo would look
 * broken. Caveat that survives no amount of code — *duplicating* a tab copies
 * sessionStorage too. Open a new tab to localhost:3000 instead, or rename.
 */
export function getTraveler(): string {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem("traveler");
  if (existing) return existing;
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  window.sessionStorage.setItem("traveler", name);
  return name;
}

export function setTraveler(name: string): void {
  window.sessionStorage.setItem("traveler", name);
}

const NAMES = ["Alice", "Bob", "Cleo", "Dev", "Emi", "Fen", "Gus", "Hana"];
