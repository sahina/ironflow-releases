// Five processes and one server, arranged so the claim is visible before the
// labels are read: everything connects to Ironflow, and nothing connects to
// anything else.
//
// Deliberately low detail — no shadows, no gradients, no animation, no raster.
// Every colour comes from the page: structural strokes and text follow
// `currentColor`, and the accent is the same custom property the rest of the
// stylesheet uses.

const ACCENT = "var(--accent)";

export type MapNode = {
  id: string;
  label: string;
  language?: string;
  /** Ironflow, drawn in the middle. Exactly one node has this. */
  centre?: boolean;
  /** The centre of the node's box. */
  x: number;
  y: number;
};

export const BOX = { width: 132, height: 46 };

/** The drawing area. Tall enough for the caption to clear the bottom row. */
export const VIEWBOX = { width: 600, height: 348 };

export const SYSTEM_MAP_NODES: MapNode[] = [
  { id: "engine", label: "Ironflow", language: "one local server", centre: true, x: 300, y: 173 },
  { id: "web", label: "Web", language: "TypeScript", x: 300, y: 57 },
  { id: "orders", label: "Ordering", language: "Go", x: 70, y: 173 },
  { id: "payments", label: "Payments", language: "TypeScript", x: 530, y: 173 },
  { id: "notifications", label: "Notifications", language: "Python", x: 300, y: 289 },
];

export const CAPTION_Y = 336;

/**
 * One edge, drawn between the two boxes rather than between their centres.
 *
 * Centre-to-centre is the obvious version and it is wrong: the labels sit at
 * the node's own x, so a vertical edge runs straight through them. Stopping at
 * the box boundary is what keeps every label readable — and the rects are
 * filled as well, so nothing shows through them either.
 */
export function edgeBetween(node: MapNode, centre: MapNode) {
  const half = { x: BOX.width / 2, y: BOX.height / 2 };
  if (node.x === centre.x) {
    const above = node.y < centre.y;
    return {
      x1: node.x,
      y1: node.y + (above ? half.y : -half.y),
      x2: centre.x,
      y2: centre.y + (above ? -half.y : half.y),
    };
  }
  const left = node.x < centre.x;
  return {
    x1: node.x + (left ? half.x : -half.x),
    y1: node.y,
    x2: centre.x + (left ? -half.x : half.x),
    y2: centre.y,
  };
}

export function SystemMap() {
  // Non-null: the list above is a constant with exactly one centre, and
  // `diagram.test.tsx` asserts that. A fallback here would be a guard for a
  // condition the tests make impossible.
  const centre = SYSTEM_MAP_NODES.find((node) => node.centre)!;

  return (
    <figure className="diagram" tabIndex={0} role="group" aria-label="The system map">
      <svg
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        role="img"
        aria-labelledby="system-map-title system-map-desc"
        focusable="false"
      >
        <title id="system-map-title">The system map</title>
        <desc id="system-map-desc">
          Four application processes — a TypeScript web application, a Go ordering service, a
          TypeScript payment worker and a Python notification subscriber — each connect only to one
          local Ironflow server at the centre. No process connects to another directly.
        </desc>

        {SYSTEM_MAP_NODES.filter((node) => !node.centre).map((node) => (
          <line
            key={`edge-${node.id}`}
            {...edgeBetween(node, centre)}
            stroke="currentColor"
            strokeOpacity="0.35"
          />
        ))}

        {SYSTEM_MAP_NODES.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x - BOX.width / 2}
              y={node.y - BOX.height / 2}
              width={BOX.width}
              height={BOX.height}
              rx="6"
              // Filled, not transparent: a box that lets the page through lets
              // an edge through too.
              fill="var(--raised)"
              stroke={node.centre ? ACCENT : "currentColor"}
              strokeOpacity={node.centre ? 1 : 0.5}
            />
            <text
              x={node.x}
              y={node.y - 3}
              textAnchor="middle"
              fill={node.centre ? ACCENT : "currentColor"}
              fontSize="13"
            >
              {node.label}
            </text>
            {node.language && (
              <text
                x={node.x}
                y={node.y + 13}
                textAnchor="middle"
                fill="currentColor"
                fontSize="11"
                opacity="0.6"
              >
                {node.language}
              </text>
            )}
          </g>
        ))}

        <text
          x={VIEWBOX.width / 2}
          y={CAPTION_Y}
          textAnchor="middle"
          fill="currentColor"
          fontSize="12"
          opacity="0.7"
        >
          Commands, entity events, projections and Pub/Sub. No business HTTP between services.
        </text>
      </svg>
    </figure>
  );
}
