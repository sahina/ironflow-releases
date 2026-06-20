import { agent } from "@ironflow/node/agent";
import { EVENTS } from "./events.js";
import { reviewWith } from "./llm.js";
import { fetchDiff, postComment } from "./tools.js";

interface PrOpened {
  repo: string;
  pr: number;
}

// ── Code Review Agent ──────────────────────────────────────────
//
// PR webhook → fetch diff → LLM review → human approval → post comment.
//
// Why each primitive earns its place:
//
//   tool(fetchDiff)  — durable network IO
//   llm()            — memoize the (slow, expensive) provider call
//   approve()        — pause the run until a human says ship it; survives
//                      restarts, holds for hours/days without burning a
//                      worker slot
//   tool(postComment)— durable side-effect; idempotency-key keeps the
//                      same comment from being posted twice on retry
//
// All five primitives compose over step.run + step.waitForEvent. Crash
// at any boundary, restart, the agent picks up at the next pending step.
//
// See docs/tutorials/agent-survives-crash.md for the crash-resume
// walkthrough; this example layers llm + approve on top.
//
// ────────────────────────────────────────────────────────────────

export const codeReviewAgent = agent(
  {
    id: "code-review-agent",
    description: "Reviews a PR diff with an LLM, then posts a comment after human approval.",
    triggers: [{ event: EVENTS.PrOpened }],
    recording: true,
  },
  async ({ event, tool, llm, approve, logger }) => {
    const { repo, pr } = event.data as PrOpened;
    logger.info(`reviewing ${repo}#${pr}`);

    const { diff } = await tool(fetchDiff, { repo, pr });

    const review = await llm.complete({
      messages: [{ role: "user", content: `Review this diff:\n${diff}` }],
      call: () => reviewWith(diff),
    });

    const reviewText = String(review.content ?? "(no review content)");

    const decision = await approve("post-review", {
      ttl: "24h",
      payload: { repo, pr, reviewText },
    });

    if (!decision.approved) {
      logger.info(`approval ${decision.reason ?? "denied"}; skipping post`);
      return { repo, pr, posted: false, reason: decision.reason };
    }

    const { commentId } = await tool(postComment, {
      repo,
      pr,
      body: `${reviewText}\n\n— posted by code-review-agent`,
    });

    return { repo, pr, posted: true, commentId };
  },
);
