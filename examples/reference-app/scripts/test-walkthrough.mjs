#!/usr/bin/env node
// The Chromium walkthrough: the demo a presenter gives, driven by a browser.
//
// The other two live gates drive the engine directly, which is the right shape
// for proving what the *system* does — but three of this example's worst
// defects were invisible to them, because all three needed a real browser:
// `configure()` tearing down a sibling's subscription, a first read racing its
// own subscription, and an effect whose "already asked" flag was one of its own
// dependencies. Every one of those passes a unit test against a fake and fails
// in front of an audience.
//
// So this script clicks. It places an order the way a customer does, approves
// it the way an operator does, and asserts what is on the screen afterwards.
// The only thing it reads over HTTP is evidence the page cannot show: the run
// that is parked on the approval wait, and the projection rows that prove a new
// demo session hid an order rather than deleting it.
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { launchChromium } from "./lib/browser.mjs";
import { DATA_DIR } from "./lib/control.mjs";
import { checker, engineApi, redact, startSupervisor, staysTrue } from "./lib/live.mjs";
import { waitFor } from "./lib/readiness.mjs";

const WALKTHROUGH_DATA = join(DATA_DIR, "walkthrough-test");
const SHOTS = join(WALKTHROUGH_DATA, "screenshots");

/** Must match STORAGE_KEY in apps/web/src/lib/session.ts. */
const SESSION_KEY = "reference-app.demo-session";

// `next dev` compiles a route the first time it is asked for one, so the first
// navigation of a run is minutes-slow on a cold cache and milliseconds after.
const FIRST_PAINT_MS = 180_000;

/**
 * The whole run's wall clock.
 *
 * Every individual wait is bounded, but they compose: five navigations at the
 * first-paint budget, a supervisor boot, and several 120s status waits add up
 * to about twenty minutes of hang with nothing to stop it, inside a `ci-full`
 * that has no job timeout either. Comfortably above a healthy run (~90s) and a
 * slow cold one, far below the unbounded case.
 *
 * It raises SIGTERM rather than exiting, so the teardown in startSupervisor is
 * the one that runs — `process.exit()` here would orphan the engine, which is
 * the exact bug the signal handler exists to prevent. `unref` so a finished run
 * is never held open by a pending timer.
 */
const DEADLINE_MS = 900_000;
setTimeout(() => {
  process.stderr.write(`\nreference-app walkthrough exceeded ${DEADLINE_MS}ms — tearing down\n`);
  process.kill(process.pid, "SIGTERM");
}, DEADLINE_MS).unref();

const check = checker();

/**
 * Fail now, naming the banner, if the page is showing one.
 *
 * Both views render a refused command as `role="alert"` ("Cannot reach
 * Ironflow — …", "That command did not reach Ironflow — …"). Without this a
 * refused approve surfaced as `timed out after 120000ms` against the payment
 * queue: two minutes of waiting, pointing at the wrong thing. The script's
 * premise is that it asserts what a person can see, and this is the first thing
 * a person sees.
 */
const noAlert = async (page) => {
  // Scoped to the app's own view, and not `page.getByRole("alert")`.
  //
  // Next renders `#__next-route-announcer__` on every page — a visually hidden
  // `<div role="alert" aria-live="assertive">` that is empty at rest and sits
  // OUTSIDE the section. An unscoped query matches it on every call and this
  // check fails instantly with an empty message. The banners themselves are
  // inside `<section aria-label="Shop">` / `"Operations"`.
  const alerts = (await page.locator("section[aria-label] [role=alert]").allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  assert.equal(alerts.length, 0, `the page is showing an error: ${alerts.join(" | ")}`);
};

/** Wait for one status cell to read exactly `label` — never a substring of the row. */
const expectStage = async (cell, label, timeoutMs) => {
  await cell.first().waitFor({ timeout: timeoutMs });
  await waitFor(`the status cell to read ${label}`, async () => (await cell.first().textContent()) === label, {
    timeoutMs,
  });
};

/** A desktop and a phone, the two widths the diagrams were designed for. */
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };

async function main() {
  rmSync(WALKTHROUGH_DATA, { recursive: true, force: true });
  // 0700, and not for the screenshots: this call creates WALKTHROUGH_DATA
  // itself, ahead of the supervisor, and `mode` is ignored on a directory that
  // already exists — so without it writeSupervisorFile's own
  // `mkdirSync(..., { mode: 0o700 })` is a no-op and the directory holding the
  // 0600 control-token file stays world-readable.
  mkdirSync(SHOTS, { recursive: true, mode: 0o700 });

  let supervisor;
  let browser;
  try {
    supervisor = await startSupervisor({ dataDir: WALKTHROUGH_DATA });
    const api = engineApi(supervisor);
    const { webUrl } = supervisor;
    assert.ok(webUrl, "the supervisor never announced a web URL");

    browser = await launchChromium();
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
    const page = await context.newPage();

    // Everything the page complained about, collected and reported at the end
    // rather than failing on the first, which would hide the rest.
    //
    // Three sources, because they catch different things: a console error is
    // usually the SDK, an uncaught exception is usually a render, and a 4xx is
    // usually a URL. The `@ url` on a console error matters — the first defect
    // this found was a bare "404 (Not Found)" whose only identifying detail was
    // its location, and it was `/favicon.ico`.
    //
    // Capped, because a render loop that logs on every frame would otherwise
    // grow this without bound for the length of the run — and the failure it
    // produced would be a deepEqual diff nobody can read. Twenty is far more
    // than a passing run's zero and enough to see a pattern.
    const MAX_ERRORS = 20;
    const consoleErrors = [];
    const note = (line) => {
      if (consoleErrors.length < MAX_ERRORS) consoleErrors.push(line);
      else if (consoleErrors.length === MAX_ERRORS) consoleErrors.push(`… more than ${MAX_ERRORS}, stopped collecting`);
    };
    page.on("console", (message) => {
      if (message.type() === "error") note(`${message.text()} @ ${message.location().url}`);
    });
    page.on("pageerror", (error) => note(String(error)));
    page.on("response", (response) => {
      // `next dev` recompiles between navigations, and a client that asks for a
      // chunk from before a recompile gets a 404 that means nothing about this
      // application. Narrow on purpose: only static chunks, only from the dev
      // server. An origin allowlist would have been the broader fix and would
      // also have silenced the cross-origin engine 4xx that a CORS regression
      // produces — which is one of the things this gate exists to catch.
      if (response.status() === 404 && response.url().includes("/_next/static/")) return;
      if (response.status() >= 400) note(`HTTP ${response.status()} ${response.url()}`);
    });

    const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

    let session;
    await check("the shop loads and claims a demo session", async () => {
      await page.goto(`${webUrl}/shop`, { waitUntil: "domcontentloaded", timeout: FIRST_PAINT_MS });
      await page.getByRole("heading", { name: "Shop" }).waitFor({ timeout: FIRST_PAINT_MS });
      session = await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
      assert.ok(session, "the shop rendered without a demo session");
    });

    await check("a cart is priced from the same catalog the ordering service holds", async () => {
      await page.getByRole("button", { name: "Add Desk Lamp" }).click();
      await page.getByRole("button", { name: "Add Notebook" }).click();
      await page.getByRole("button", { name: "Add Notebook" }).click();
      // 4500 + 2 x 1200. The ordering service reprices this from
      // contracts/catalog.json and refuses the command if the two disagree, so
      // the number on screen is the number the domain agreed to.
      assert.equal(await page.getByTestId("cart-total").textContent(), "$69.00");
    });

    await check("placing the order puts it in the customer's list, waiting for approval", async () => {
      await page.selectOption("#demo-scenario", "pm_success");
      await page.selectOption("#customer-email", "ada@example.com");
      await page.getByRole("button", { name: "Place order" }).click();
      await noAlert(page);

      const row = page.locator('ul[aria-label="Your orders"] > li').first();
      await row.waitFor({ timeout: 60_000 });
      assert.equal(await row.getByTestId("order-status").textContent(), "Waiting for approval");
      // Exactly one. Every locator after this is a `.first()`, so a regression
      // that placed the order twice — the double-click guard failing — would
      // otherwise pass here and leave a second order charged behind the scenes.
      assert.equal(await page.locator('ul[aria-label="Your orders"] > li').count(), 1);
      await shot("shop");
    });

    const orderId = await waitFor("the order to reach the read model", async () => {
      const mine = Object.values(await api.projectedOrders()).filter((order) => order.demoSessionId === session);
      // Same reason as the row count above, on the other side of the wire.
      assert.ok(mine.length <= 1, `${mine.length} orders for one session — the shop placed it more than once`);
      return mine[0]?.orderId;
    });

    // Approve only after the run has parked.
    //
    // The durable wait is created when the run yields and matched only when the
    // event arrives, so an approval that beats the run there is dropped and the
    // order sits in pending_approval until its seven-day timeout, with no error
    // anywhere. A person cannot click that fast. Playwright can, every time.
    await check("the ordering run parks on the approval wait", async () => {
      // No function_id filter, deliberately. Naming the ordering service's
      // function here would be a third copy of a Go constant that nothing
      // enforces — and a rename would surface as a 60s timeout pointing at the
      // wait rather than at the rename. The step predicate below already
      // identifies exactly one run, and `order.approved` is a contract name the
      // live gate asserts is registered.
      await waitFor("a yielded approval wait", async () => {
        for (const run of await api.runs()) {
          const steps = await api.runSteps(run.id);
          if (steps.some((step) => step.wait_event_name === "order.approved" && step.status === "waiting")) {
            return run.id;
          }
        }
        return undefined;
      }, { timeoutMs: 60_000, intervalMs: 500 });
    });

    await check("the operator approves it and the order pays itself out", async () => {
      await page.goto(`${webUrl}/operations`, { waitUntil: "domcontentloaded", timeout: FIRST_PAINT_MS });
      const approve = page.getByRole("button", { name: "Approve" }).first();
      await approve.waitFor({ timeout: FIRST_PAINT_MS });
      await approve.click();
      await noAlert(page);

      // The operator's view of the attempt, live: no reload, no polling in the
      // test. If this times out, the subscription is broken even though the
      // engine is fine — which is the whole reason this gate drives a browser.
      const payment = page.locator('ul[aria-labelledby="payment-queue"] > li').first();
      await payment.waitFor({ timeout: 60_000 });
      // The operator's own status cell, by test id.
      //
      // NOT `hasText: "Captured"` on the row: hasText is a case-insensitive
      // substring match over the whole subtree and reaches inside the row's
      // CLOSED <details>, where the timeline renders a `payment.captured`
      // span. That assertion passes on the presence of an event name in the
      // projection and never reads STAGE_LABELS[paymentStage(order)] at all —
      // so dropping `captureId` from the reducer would leave this queue reading
      // "Authorized" forever with the gate still green.
      await expectStage(payment.getByTestId("payment-stage"), "Captured", 120_000);
      await shot("operations");
    });

    await check("the customer sees Paid, and the timeline names Python for the notification", async () => {
      await page.goto(`${webUrl}/shop`, { waitUntil: "domcontentloaded", timeout: FIRST_PAINT_MS });
      const row = page.locator('ul[aria-label="Your orders"] > li').first();
      await row.waitFor({ timeout: FIRST_PAINT_MS });
      // By test id, for the reason spelled out above the payment stage.
      await expectStage(row.getByTestId("order-status"), "Paid", 120_000);

      // Open the timeline. Collapsed is the default on purpose — it is the
      // explanation, not the headline — so nothing below is visible until a
      // presenter asks for it.
      await row.locator("summary").click();
      // One per status change, so three by the time an order is paid. The
      // first is enough: they all come from the same subscriber.
      const sent = row.locator('li[aria-label="notification.sent"]').first();
      await sent.waitFor({ timeout: 60_000 });
      assert.match(await sent.textContent(), /Python/);

      // The one fact the whole polyglot story rests on: three languages each
      // put their own name on this order. The browser is not among them on
      // purpose — every fact here is written by a service, and the command the
      // page sent is not a fact.
      const languages = await row.locator("li[aria-label] span:nth-child(3)").allTextContents();
      for (const language of ["Go", "TypeScript", "Python"]) {
        assert.ok(languages.includes(language), `no ${language} row in the timeline: ${languages.join(", ")}`);
      }
    });

    await check("a new demo session hides the order without deleting it", async () => {
      const before = Object.keys(await api.projectedOrders()).length;
      await page.getByRole("button", { name: "New demo session" }).click();

      await waitFor("the order list to empty", async () => (await page.locator('ul[aria-label="Your orders"] > li').count()) === 0);
      const moved = await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
      assert.notEqual(moved, session, "the session did not move");

      // The half that matters. The filter moved; the engine's history did not.
      assert.equal(Object.keys(await api.projectedOrders()).length, before);
      assert.ok((await api.projectedOrders())[orderId], "the hidden order was deleted from the read model");
    });

    await check("the system page renders at both widths", async () => {
      await page.goto(`${webUrl}/system`, { waitUntil: "domcontentloaded", timeout: FIRST_PAINT_MS });
      // Every diagram is an inline SVG with an accessible name; a missing one is
      // a diagram that never rendered.
      for (const name of ["System map", "Happy path", "Crash and resume"]) {
        await page.getByRole("img", { name: new RegExp(name, "i") }).first().waitFor({ timeout: FIRST_PAINT_MS });
      }
      await shot("system-desktop");

      await page.setViewportSize(VIEWPORTS.mobile);
      await page.getByRole("img", { name: /System map/i }).first().waitFor({ timeout: 30_000 });
      // A page that scrolls sideways on a phone has a diagram that did not fit.
      //
      // Sampled over a window, not read once: the element waited on above is
      // already present, so a single read lands immediately and a font swap or
      // a late reflow that WIDENS a diagram arrives after it. `staysTrue` is
      // the harness's own idiom for exactly this — see its comment in live.mjs.
      const overflowNow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await staysTrue("the system page does not scroll horizontally at 390px", async () => (await overflowNow()) <= 1);
      await shot("system-mobile");
    });

    await check("the browser reported no errors", () => {
      assert.equal(consoleErrors.length, 0, `the page reported:\n  ${consoleErrors.join("\n  ")}`);
    });

    await check("shutdown leaves nothing behind", async () => {
      await browser.close();
      browser = undefined;
      assert.equal(await supervisor.stop(), 0);
    });

    process.stdout.write("reference-app walkthrough passed\n");
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    if (supervisor) await supervisor.stop();
    process.stderr.write(
      `\nreference-app walkthrough FAILED: ${error.message}\n\n--- supervisor log (tail) ---\n${redact(supervisor?.tail() ?? "")}\n`,
    );
    process.stderr.write(`state kept at ${WALKTHROUGH_DATA}\nscreenshots in ${SHOTS}\n`);
    process.exitCode = 1;
  }

  // Outside the try, and guarded: cleaning up inside it meant an EBUSY from
  // this rmSync printed "passed" and then "FAILED" with a log dump, for a run
  // that had succeeded. A failure keeps the engine database, the logs and the
  // screenshots, which together say what the presenter would have seen.
  if (process.exitCode !== 1) rmSync(WALKTHROUGH_DATA, { recursive: true, force: true });
}

await main();
