// What the supervisor tells this application about the engine it started.

/** The engine URL, discovered at boot and passed down by scripts/dev.mjs. */
export function ironflowUrl(): string {
  return process.env.NEXT_PUBLIC_IRONFLOW_URL ?? "http://127.0.0.1:9123";
}

/**
 * The engine's bootstrap key, read on the server and handed to the page.
 *
 * The supervisor starts the engine with `--dev`, so nothing checks this and an
 * empty value works. It is passed anyway: dropping `--dev` from
 * scripts/dev.mjs must not also require a change here. Either way this is a
 * local-demo shape, labeled as such in the UI — a real application never ships
 * an admin credential to a browser.
 */
export function bootstrapKey(): string {
  return process.env.IRONFLOW_API_KEY ?? "";
}
