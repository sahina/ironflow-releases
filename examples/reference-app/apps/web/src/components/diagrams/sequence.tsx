// The shared renderer behind both sequence diagrams.
//
// Two diagrams with the same shape — lifelines, numbered messages, a note or
// two — would otherwise be the same SVG arithmetic written twice, and would
// drift the first time one of them was adjusted.
//
// Deliberately low detail: no shadows, no gradients, no animation, no raster.
// Every colour comes from the page: structural strokes and text follow
// `currentColor`, and the accent is the same custom property the rest of the
// stylesheet uses. No literal hex anywhere, which the tests assert.

export type Participant = {
  id: string;
  label: string;
  /** The language the participant is written in, or "" for the engine. */
  language?: string;
};

export type Message = {
  from: string;
  to: string;
  label: string;
  /** Marks the step an audience is meant to look at. */
  accent?: boolean;
};

export type Sequence = {
  id: string;
  title: string;
  description: string;
  participants: Participant[];
  messages: Message[];
  /** Short lines under the drawing. The claim the diagram is making. */
  notes: string[];
};

const COLUMN = 168;
const MARGIN = 90;
const HEAD_Y = 34;
const FIRST_MESSAGE_Y = 78;
const ROW = 42;

const ACCENT = "var(--accent)";

/**
 * A halo, so a label stays readable where it crosses a lifeline.
 *
 * A message label is centred between its two participants, so it runs straight
 * over every lifeline in between — unavoidable in a sequence diagram, and the
 * reason the standard fix is to paint the text's own outline in the panel
 * colour underneath it. `paintOrder="stroke"` is what puts the stroke behind
 * the glyphs instead of on top of them.
 */
const halo = {
  stroke: "var(--raised)",
  strokeWidth: 4,
  paintOrder: "stroke" as const,
  strokeLinejoin: "round" as const,
};

/**
 * Two markers, because a marker does not inherit the stroke of the line that
 * references it: it is rendered from `<defs>`, outside the accented group. One
 * marker would draw an accent arrow's head in ink.
 */
const arrowId = (id: string, accent: boolean) => `${id}-arrow${accent ? "-accent" : ""}`;

export function SequenceDiagram({ sequence }: { sequence: Sequence }) {
  const { id, title, description, participants, messages, notes } = sequence;
  const x = (participantId: string) =>
    MARGIN + participants.findIndex((participant) => participant.id === participantId) * COLUMN;
  const width = MARGIN * 2 + (participants.length - 1) * COLUMN;
  const lastY = FIRST_MESSAGE_Y + (messages.length - 1) * ROW;
  const height = lastY + 30 + notes.length * 20;

  return (
    // tabindex on the scroll container, not the drawing: a box that scrolls
    // has to be reachable by keyboard, and the SVG inside is not focusable.
    <figure className="diagram" tabIndex={0} role="group" aria-label={title}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
        // A drawing, not a control: nothing inside is focusable, and the name
        // and description above are what a reader gets.
        focusable="false"
      >
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-desc`}>{description}</desc>

        {participants.map((participant) => (
          <g key={participant.id}>
            <text
              x={x(participant.id)}
              y={HEAD_Y - 14}
              textAnchor="middle"
              fill="currentColor"
              fontSize="13"
              {...halo}
            >
              {participant.label}
            </text>
            {participant.language && (
              <text
                x={x(participant.id)}
                y={HEAD_Y}
                textAnchor="middle"
                fill="currentColor"
                fontSize="11"
                opacity="0.6"
                {...halo}
              >
                {participant.language}
              </text>
            )}
            <line
              x1={x(participant.id)}
              y1={HEAD_Y + 12}
              x2={x(participant.id)}
              y2={lastY + 16}
              stroke="currentColor"
              strokeOpacity="0.25"
            />
          </g>
        ))}

        <defs>
          {[false, true].map((accent) => (
            <marker
              key={String(accent)}
              id={arrowId(id, accent)}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 Z" fill={accent ? ACCENT : "currentColor"} />
            </marker>
          ))}
        </defs>

        {messages.map((message, index) => {
          const y = FIRST_MESSAGE_Y + index * ROW;
          const from = x(message.from);
          const to = x(message.to);
          // A message a participant sends to itself is drawn as a label on its
          // own lifeline: an arrow with no horizontal distance renders as a dot.
          const self = from === to;
          return (
            <g key={`${message.label}-${index}`} stroke={message.accent ? ACCENT : "currentColor"}>
              {!self && (
                <line
                  x1={from}
                  y1={y}
                  x2={to}
                  y2={y}
                  markerEnd={`url(#${arrowId(id, message.accent === true)})`}
                  strokeOpacity="0.7"
                />
              )}
              <text
                x={self ? from + 10 : (from + to) / 2}
                y={y - 6}
                textAnchor={self ? "start" : "middle"}
                fill={message.accent ? ACCENT : "currentColor"}
                fontSize="12"
                {...halo}
              >
                {index + 1}. {message.label}
              </text>
            </g>
          );
        })}

        {notes.map((note, index) => (
          <text
            key={note}
            x={MARGIN - 60}
            y={lastY + 32 + index * 20}
            fill="currentColor"
            fontSize="12"
            opacity="0.7"
          >
            {note}
          </text>
        ))}
      </svg>
    </figure>
  );
}
