// The browser the Chromium walkthrough drives.
//
// `playwright-core`, not `playwright`: by design it never downloads a browser
// and drives one already on the machine. Every developer who can look at this
// example already has Chrome, and the alternative pulls a ~94MB binary into a
// checkout that only needs it for one gate. The same choice, for the same
// reason, is made by apps/cloud-docs/scripts/render-gate.mjs.
//
// The walkthrough asserts what a person can see — text, order, and whether a
// control is there — which any recent Chromium-family engine answers
// identically. If that ever stops being true, set REFERENCE_APP_BROWSER to an
// explicit executable path.
import { execFileSync } from "node:child_process";

import { chromium } from "playwright-core";

const CHANNELS = ["chrome", "chromium", "msedge"];

/**
 * Executables to look for on PATH, after the channels.
 *
 * `channel: "chromium"` does NOT mean "the chromium on this machine" — it
 * resolves to a Playwright-managed cached revision, which `playwright-core`
 * never downloads. So a Linux box with only `/usr/bin/chromium` satisfies every
 * word of the documented prerequisite and still fails all three channels.
 * Verified: on a machine with no Chromium.app, `channel: "chromium"` launched a
 * cached 151.x that came from another package's `playwright install`.
 */
const EXECUTABLES = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge"];

const onPath = (name) => {
  try {
    return execFileSync("command", ["-v", name], { shell: true, encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
};

/** Launch the first browser that starts, or say everything that was tried. */
export async function launchChromium() {
  const explicit = process.env.REFERENCE_APP_BROWSER;
  if (explicit) return await chromium.launch({ executablePath: explicit });

  const tried = [];
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel });
    } catch (error) {
      tried.push(`channel ${channel} (${String(error?.message ?? error).split("\n")[0]})`);
    }
  }
  for (const name of EXECUTABLES) {
    const executablePath = onPath(name);
    if (!executablePath) continue;
    try {
      return await chromium.launch({ executablePath });
    } catch (error) {
      tried.push(`${executablePath} (${String(error?.message ?? error).split("\n")[0]})`);
    }
  }
  throw new Error(
    `no usable browser found. Tried: ${tried.join("; ")}. ` +
      "Install Chrome or Chromium, or set REFERENCE_APP_BROWSER to an executable path.",
  );
}
