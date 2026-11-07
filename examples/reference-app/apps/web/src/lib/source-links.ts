// Where each part of this system lives, so the page a reader is looking at can
// point straight at the code behind it.
//
// GitHub, not a local path: a presenter's audience is watching a screen, not
// sitting at the checkout.

// The engine source is private. The public mirror carries this example, and its
// root is the engine's public home.
const REPO = "https://github.com/sahina/ironflow-releases";
const EXAMPLE = `${REPO}/tree/main/examples/reference-app`;

/**
 * A path inside `examples/reference-app`, or the repository root for the engine
 * itself — which is the one participant that is not part of this example.
 */
export function sourceUrl(path: string): string {
  return path === "" ? REPO : `${EXAMPLE}/${path}`;
}
