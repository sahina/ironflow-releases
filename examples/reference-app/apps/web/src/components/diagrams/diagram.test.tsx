import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { CrashResumeSequence, CRASH_RESUME } from "@/components/diagrams/crash-resume-sequence";
import { HappyPathSequence, HAPPY_PATH } from "@/components/diagrams/happy-path-sequence";
import {
  BOX,
  CAPTION_Y,
  edgeBetween,
  SystemMap,
  SYSTEM_MAP_NODES,
  VIEWBOX,
} from "@/components/diagrams/system-map";

const diagrams = [
  ["the system map", <SystemMap key="map" />],
  ["the happy path", <HappyPathSequence key="happy" />],
  ["crash and resume", <CrashResumeSequence key="crash" />],
] as const;

describe.each(diagrams)("%s", (_name, element) => {
  test("is an image with an accessible name and a description", () => {
    // A diagram nobody can read is decoration. `role="img"` plus a name and a
    // description is the minimum that makes it content.
    const { container } = render(element);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("role", "img");
    const labelledBy = svg?.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
    expect(labelledBy.length).toBe(2);
    for (const id of labelledBy) {
      expect(container.querySelector(`#${id}`)?.textContent).toBeTruthy();
    }
    expect(container.querySelector("title")?.textContent).toBeTruthy();
    expect(container.querySelector("desc")?.textContent).toBeTruthy();
  });

  test("scales from a viewBox instead of a fixed size", () => {
    // These sit in a page that has to work on a phone and on a projector.
    const { container } = render(element);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("viewBox");
    expect(svg).not.toHaveAttribute("width");
    expect(svg).not.toHaveAttribute("height");
  });

  test("draws nothing outside its own viewBox", () => {
    // A clipped label is invisible with no error anywhere.
    const { container } = render(element);
    const svg = container.querySelector("svg")!;
    const [, , width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);

    for (const text of svg.querySelectorAll("text")) {
      const x = Number(text.getAttribute("x"));
      const y = Number(text.getAttribute("y"));
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThanOrEqual(height);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
    }
  });

  test("carries its labels as real text", () => {
    // Not a raster, not a path tracing letters: the labels have to be
    // selectable, searchable and readable by a screen reader.
    const { container } = render(element);

    expect(container.querySelectorAll("text").length).toBeGreaterThan(3);
  });

  test("references no external or raster asset", () => {
    // Everything is inline. An <image>, a fetched url(...) or a remote href is
    // a file this page would have to ship and could fail to load. An in-document
    // `url(#id)` — how SVG names its own marker — is not that.
    const { container } = render(element);
    const markup = container.innerHTML;

    expect(container.querySelector("image")).toBeNull();
    expect(markup).not.toMatch(/url\((?!#)/);
    expect(markup).not.toMatch(/https?:\/\//);
  });

  test("does not animate", () => {
    // A diagram that moves competes with the demonstration beside it, and
    // motion is the first thing to hurt a reader who did not ask for it.
    //
    // The SVG elements and any inline style, which is all this component can
    // carry: a stylesheet rule would need a different check, and none of these
    // components has a class of its own to target.
    const { container } = render(element);

    expect(container.querySelector("animate, animateTransform, animateMotion, set")).toBeNull();
    for (const node of container.querySelectorAll("[style]")) {
      expect(node.getAttribute("style")).not.toMatch(/animation|transition/);
    }
  });

  test("uses no shadow or blur filter", () => {
    // Low detail on purpose. A filter is decoration that costs legibility on a
    // projector and renders differently everywhere.
    const { container } = render(element);

    expect(container.querySelector("filter, feDropShadow, feGaussianBlur")).toBeNull();
    expect(container.innerHTML).not.toMatch(/filter=|box-shadow|drop-shadow/);
  });

  test("takes every colour from the page, with no literal anywhere", () => {
    // The page is dark-only today. Structural strokes follow `currentColor` and
    // the accent is the stylesheet's own custom property, so a light theme
    // would not need a second diagram.
    //
    // "currentColor appears somewhere" is not this assertion: that stays green
    // with every other stroke hardcoded, which is exactly how a literal accent
    // survived the first version of this file.
    const { container } = render(element);
    const markup = container.innerHTML;

    expect(markup).toMatch(/currentColor/);
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(markup).not.toMatch(/\b(rgb|hsl)a?\(/i);
  });

  test("draws an accented arrow's head in the accent, not in ink", () => {
    // A marker is rendered from <defs>, outside the group whose stroke it is
    // drawn for, so it inherits nothing from the line that references it.
    const { container } = render(element);

    for (const marker of container.querySelectorAll("marker")) {
      const fill = marker.querySelector("path")?.getAttribute("fill");
      const accentMarker = marker.id.endsWith("-accent");
      expect(fill).toBe(accentMarker ? "var(--accent)" : "currentColor");
    }
  });
});

describe("the diagrams stay low-detail", () => {
  test("the system map has at most six nodes", () => {
    expect(SYSTEM_MAP_NODES.length).toBeLessThanOrEqual(6);
  });

  test("Ironflow is the centre of the system map", () => {
    // The claim the map exists to make: every arrow goes through Ironflow, and
    // no service talks to another directly.
    const centre = SYSTEM_MAP_NODES.find((node) => node.centre);
    expect(centre?.label).toMatch(/Ironflow/);
    expect(SYSTEM_MAP_NODES.filter((node) => node.centre)).toHaveLength(1);
  });

  test("the happy path has at most five participants and ten messages", () => {
    expect(HAPPY_PATH.participants.length).toBeLessThanOrEqual(5);
    expect(HAPPY_PATH.messages.length).toBeLessThanOrEqual(10);
  });

  test("the crash sequence has at most five participants and ten messages", () => {
    expect(CRASH_RESUME.participants.length).toBeLessThanOrEqual(5);
    expect(CRASH_RESUME.messages.length).toBeLessThanOrEqual(10);
  });

  test("every sequence message names a participant that exists", () => {
    // A message drawn to a lifeline that is not there is a line into space.
    for (const { participants, messages } of [HAPPY_PATH, CRASH_RESUME]) {
      const known = new Set(participants.map((participant) => participant.id));
      for (const message of messages) {
        expect(known).toContain(message.from);
        expect(known).toContain(message.to);
      }
    }
  });

  test("the crash sequence shows the authorization surviving the restart", () => {
    // The whole point of the third scenario: the card is held once, the worker
    // dies, and the replacement captures without authorizing again.
    const labels = CRASH_RESUME.messages.map((message) => message.label).join(" | ");

    expect(labels).toMatch(/authorize/i);
    expect(labels).toMatch(/capture/i);
    expect(CRASH_RESUME.notes.join(" ")).toMatch(/memoi[sz]ed|replay/i);
  });

  test("the happy path never lets an order be paid before the capture", () => {
    const order = HAPPY_PATH.messages.map((message) => message.label);
    const captured = order.findIndex((label) => /captur/i.test(label));
    const paid = order.findIndex((label) => /paid/i.test(label));

    expect(captured).toBeGreaterThanOrEqual(0);
    expect(paid).toBeGreaterThan(captured);
  });
});

describe("labels survive the lines behind them", () => {
  // A sequence message label is centred between its two participants, so it
  // crosses every lifeline in between. Without a halo the lifeline is drawn
  // through the words — which every policy test above happily allows.
  test.each([
    ["the happy path", <HappyPathSequence key="h" />],
    ["crash and resume", <CrashResumeSequence key="c" />],
  ])("%s paints a halo behind its text", (_name, element) => {
    const { container } = render(element);
    const texts = [...container.querySelectorAll("text")];

    // The notes below the drawing sit under no lifeline and need none.
    const overLifelines = texts.filter((text) => text.getAttribute("text-anchor") !== null);
    expect(overLifelines.length).toBeGreaterThan(0);
    for (const text of overLifelines) {
      expect(text.getAttribute("paint-order")).toBe("stroke");
      expect(text.getAttribute("stroke")).toBe("var(--raised)");
    }
  });
});

describe("the system map's geometry", () => {
  // Arithmetic, not appearance — but the arithmetic is what decides whether a
  // reader can read it. Centre-to-centre edges struck through four labels in
  // the first version of this file, and every policy test above stayed green.

  const centre = SYSTEM_MAP_NODES.find((node) => node.centre)!;

  /** The rectangle a node's box occupies. */
  const boxOf = (node: (typeof SYSTEM_MAP_NODES)[number]) => ({
    left: node.x - BOX.width / 2,
    right: node.x + BOX.width / 2,
    top: node.y - BOX.height / 2,
    bottom: node.y + BOX.height / 2,
  });

  test("no edge passes through any node's box", () => {
    for (const node of SYSTEM_MAP_NODES.filter((candidate) => !candidate.centre)) {
      const edge = edgeBetween(node, centre);
      for (const box of SYSTEM_MAP_NODES.map(boxOf)) {
        // Every edge here is axis-aligned, so "inside the box" is a range test.
        const insideX = edge.x1 > box.left && edge.x1 < box.right;
        const insideY = edge.y1 > box.top && edge.y1 < box.bottom;
        const crossesVertically =
          insideX && Math.min(edge.y1, edge.y2) < box.bottom && Math.max(edge.y1, edge.y2) > box.top;
        const crossesHorizontally =
          insideY && Math.min(edge.x1, edge.x2) < box.right && Math.max(edge.x1, edge.x2) > box.left;
        expect(crossesVertically || crossesHorizontally).toBe(false);
      }
    }
  });

  test("no two boxes overlap", () => {
    const boxes = SYSTEM_MAP_NODES.map(boxOf);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlaps).toBe(false);
      }
    }
  });

  test("the caption clears every box", () => {
    // It sat 4px inside the notifications box, over the word "Python".
    for (const box of SYSTEM_MAP_NODES.map(boxOf)) {
      expect(CAPTION_Y).toBeGreaterThan(box.bottom);
    }
    expect(CAPTION_Y).toBeLessThanOrEqual(VIEWBOX.height);
  });
});

describe("the diagrams read at a narrow width", () => {
  test("each participant's name is rendered as text, not only as a tooltip", () => {
    render(<HappyPathSequence />);

    for (const participant of HAPPY_PATH.participants) {
      expect(screen.getByText(participant.label)).toBeInTheDocument();
    }
  });
});
