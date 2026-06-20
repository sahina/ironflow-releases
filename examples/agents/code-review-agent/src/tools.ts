import { defineTool } from "@ironflow/node/agent";
import { z } from "zod";

// ── Tools ───────────────────────────────────────────────────────
//
// Real implementations would wrap the GitHub API. Here we simulate
// network IO with a fixed sleep so the demo behaves predictably and
// the example runs offline.
//
// Each tool() invocation in the agent is a memoized step. A crash
// mid-fetch re-runs the fetch; a crash after fetch but before LLM
// replays the diff from cache.
//
// ────────────────────────────────────────────────────────────────

export const fetchDiff = defineTool({
  name: "fetch-diff",
  description: "Fetch the diff for a pull request",
  input: z.object({ repo: z.string(), pr: z.number().int().positive() }),
  handler: async ({ repo, pr }) => {
    console.log(`[fetch-diff] ${repo}#${pr}`);
    await new Promise((r) => setTimeout(r, 500));
    return {
      repo,
      pr,
      diff: [
        `diff --git a/src/auth.ts b/src/auth.ts`,
        `+ if (token === expected) { return user; }`,
        `- if (token == expected) { return user; }`,
      ].join("\n"),
      filesChanged: 1,
    };
  },
});

export const postComment = defineTool({
  name: "post-comment",
  description: "Post a review comment on the PR",
  input: z.object({
    repo: z.string(),
    pr: z.number().int().positive(),
    body: z.string().min(1),
  }),
  handler: async ({ repo, pr, body }) => {
    console.log(`[post-comment] ${repo}#${pr}: ${body.slice(0, 60)}…`);
    await new Promise((r) => setTimeout(r, 200));
    return { commentId: `c-${Date.now()}` };
  },
});
