import { describe, expect, test } from "vitest";
import { diffChangedSet, hashContent, stableId } from "../src/hash.js";

describe("hashContent", () => {
  test("is stable and hex-encoded", () => {
    const a = hashContent(new TextEncoder().encode("hello"));
    const b = hashContent(new TextEncoder().encode("hello"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs for different content", () => {
    const a = hashContent(new TextEncoder().encode("hello"));
    const b = hashContent(new TextEncoder().encode("hello "));
    expect(a).not.toBe(b);
  });
});

describe("diffChangedSet", () => {
  test("returns objects never seen before", () => {
    const changed = diffChangedSet([{ key: "a.pdf", hash: "h1" }], new Map());
    expect(changed).toEqual([{ key: "a.pdf", hash: "h1" }]);
  });

  test("skips objects whose hash is unchanged", () => {
    const seen = new Map([["a.pdf", "h1"]]);
    expect(diffChangedSet([{ key: "a.pdf", hash: "h1" }], seen)).toEqual([]);
  });

  test("returns objects whose hash changed — this is a restatement", () => {
    const seen = new Map([["a.pdf", "h1"]]);
    expect(diffChangedSet([{ key: "a.pdf", hash: "h2" }], seen)).toEqual([
      { key: "a.pdf", hash: "h2" },
    ]);
  });

  test("does not resurrect objects that vanished from the source", () => {
    const seen = new Map([["gone.pdf", "h1"]]);
    expect(diffChangedSet([], seen)).toEqual([]);
  });
});

describe("stableId", () => {
  test("is deterministic — the property a retried emit depends on", () => {
    expect(stableId("doc", "t1", 4, "Total revenue")).toBe(
      stableId("doc", "t1", 4, "Total revenue"),
    );
  });

  test("distinguishes rows that differ in any coordinate", () => {
    const a = stableId("doc", "t1", 4, "Total revenue");
    expect(a).not.toBe(stableId("doc", "t1", 5, "Total revenue"));
    expect(a).not.toBe(stableId("doc", "t2", 4, "Total revenue"));
    expect(a).not.toBe(stableId("doc", "t1", 4, "Total costs"));
  });

  test("does not collide across a field boundary", () => {
    // A separator-join would make both of these "a b c". Financial row labels
    // contain spaces constantly ("Total revenue"), so this is a live risk,
    // not a theoretical one.
    expect(stableId("a b", "c")).not.toBe(stableId("a", "b c"));
  });
});
