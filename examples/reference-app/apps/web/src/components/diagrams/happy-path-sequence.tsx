// The ordinary order, end to end. Five participants, eight messages, and the
// one ordering rule the whole example turns on.

import { SequenceDiagram, type Sequence } from "@/components/diagrams/sequence";

export const HAPPY_PATH: Sequence = {
  id: "happy-path",
  title: "The happy path",
  description:
    "A customer places an order in the browser; the Go ordering service records it and waits for approval; an operator approves; the Node payment worker authorizes and captures; only then does the order become paid; the Python subscriber records the delivery.",
  participants: [
    { id: "web", label: "Browser", language: "TypeScript" },
    { id: "orders", label: "Ordering", language: "Go" },
    { id: "payments", label: "Payments", language: "TypeScript" },
    { id: "notifications", label: "Notifications", language: "Python" },
  ],
  messages: [
    { from: "web", to: "orders", label: "place.order" },
    { from: "orders", to: "orders", label: "order.placed — waits for approval" },
    { from: "web", to: "orders", label: "approve.order" },
    { from: "orders", to: "payments", label: "order.released" },
    { from: "payments", to: "payments", label: "payment.authorized — the card is held" },
    { from: "payments", to: "orders", label: "payment.captured", accent: true },
    { from: "orders", to: "notifications", label: "order.paid → order-status topic", accent: true },
    { from: "notifications", to: "orders", label: "notification.sent" },
  ],
  notes: [
    "Only a capture can make an order paid. An authorization is a hold, not proof of payment.",
    "Nothing here is an HTTP call between services: every arrow is an Ironflow message.",
  ],
};

export function HappyPathSequence() {
  return <SequenceDiagram sequence={HAPPY_PATH} />;
}
