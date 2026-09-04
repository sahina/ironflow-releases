// The third scenario: the payment worker dies mid-order and the replacement
// finishes it without charging the card twice.

import { SequenceDiagram, type Sequence } from "@/components/diagrams/sequence";

export const CRASH_RESUME: Sequence = {
  id: "crash-resume",
  title: "Crash and resume",
  description:
    "The payment worker authorizes the card and the run parks on a durable wait. The presenter kills the worker; the supervisor starts a replacement. The replacement resumes the same run from the memoized authorization and captures once — the gateway is never asked to authorize again.",
  participants: [
    { id: "payments", label: "Payment worker", language: "TypeScript" },
    { id: "engine", label: "Ironflow" },
    { id: "gateway", label: "Card gateway" },
    { id: "replacement", label: "Replacement worker", language: "TypeScript" },
  ],
  messages: [
    { from: "payments", to: "gateway", label: "authorize — the card is held, once" },
    { from: "payments", to: "engine", label: "payment.authorized" },
    { from: "payments", to: "engine", label: "the run parks on a durable wait" },
    { from: "payments", to: "payments", label: "SIGKILL — the presenter's crash control", accent: true },
    { from: "replacement", to: "engine", label: "the supervisor starts a replacement" },
    { from: "engine", to: "replacement", label: "resume: the authorize step is memoized", accent: true },
    { from: "replacement", to: "gateway", label: "capture — the first call to the gateway" },
    { from: "replacement", to: "engine", label: "payment.captured → order.paid" },
  ],
  notes: [
    "A parked run holds no worker claim, so killing the worker costs nothing and needs no timeout.",
    "The replacement never calls the gateway to authorize: durable replay skips the memoized step.",
  ],
};

export function CrashResumeSequence() {
  return <SequenceDiagram sequence={CRASH_RESUME} />;
}
