---
name: ironflow
version: 0.36.1
description: |
  Universal entry point for Ironflow AI assistance. Classifies user intent and dispatches
  to the right specialized skill. Use when the user mentions "ironflow", "help with ironflow",
  "my ironflow project", or any Ironflow-related request that doesn't have a sharper trigger.
  This router uses ONLY universal primitives (text output, Read, Grep, Bash) — no
  Claude-specific tools — so it works across Claude Code, Codex CLI, and Gemini CLI.
user-invocable: true
argument-hint: "[your request] — e.g., 'set up ironflow' or 'my run failed'"
allowed-tools:
  - Read
  - Grep
  - Bash
  - WebFetch
---

# Ironflow Router

Routes any Ironflow-related request to the right specialized skill. With sharp triggers
on the specialized skills, the router fires only when the user types `/ironflow` directly,
or when the request is ambiguous.

> **Path convention.** Paths are shown as `~/.agents/skills/...` (global install), and here they
> are real files on disk: this router is deliberately NOT bundled into the desktop agent (see
> `bundledSkills.ts`), so it never runs as a packaged resource. The directory is not fixed,
> though — `ironflow skills sync --local` vendors to `./.agents/skills/`, and `npx skills add`
> installs under the agent's own skills directory. If a path here does not resolve, find the
> sibling skill under this file's own directory, or activate it by name; never guess a prefix.
>
> The five bundled skills use a different convention — relative paths for their own files — because
> a packaged skill serves those as readable resources rather than files. Do not copy this note into
> them (#1864).

## Step 0: Version Check (Cached Daily)

Before classifying, check if a newer Ironflow release is available:

```bash
scripts/check-version.sh
```

The script handles caching (24h stamp at `.last_checked`), network failures (silent skip),
and prints `OUTDATED:<version>` or `CURRENT` to stdout.

If `OUTDATED:<version>`, surface this to the user once, then continue with classification:

> "Heads up: Ironflow v<version> is available (you have v<current>). Upgrade the binary
> (`brew upgrade ironflow`, or pull the latest Docker image), then run
> `ironflow skills sync` to update your skills."

Skills ship inside the `ironflow` binary, so `ironflow skills sync` always installs the
version matching your binary. If `ironflow` is not on PATH the skills came from
`npx skills add sahina/ironflow-releases` instead — tell the user to re-run that to update,
and do not tell them to upgrade a binary they do not have.

If the user invokes `/ironflow update`, run:
```bash
scripts/update-skills.sh
```

Otherwise, continue.

## Step 1: Classify Intent

Match the user's request against these buckets:

| Bucket | Skill | Sample triggers |
|---|---|---|
| Does it fit / where would we use it | `ironflow-fit` | "should we use ironflow", "where can we use it", "ironflow fit", "analyze my codebase" |
| Set up / scaffold / architecture | `ironflow-start` | "set up", "install", "walk me through", "push vs pull" |
| Build code / tests / audit | `ironflow-code` | "write a function", "add tests", "review my code" |
| Operate / debug / deploy | `ironflow-ops` | "run failed", "stuck", "scale cluster", "upgrade SDK" |
| Reference / lookup | `ironflow-docs` | "how do I emit", "CLI for X", "SDK syntax" |

### Confidence levels

- **HIGH** — request clearly matches one bucket. Dispatch directly.
- **LOW** — request is ambiguous or doesn't match any bucket. Show menu (Step 2).

Common HIGH examples:
- "my order processing run failed" → `ironflow-ops`
- "create a function that processes orders" → `ironflow-code`
- "set up ironflow in my Next.js app" → `ironflow-start`
- "would ironflow help our Spring services?" → `ironflow-fit`
- "what's the syntax for waitForEvent" → `ironflow-docs`

Common LOW examples (always show menu):
- "help with ironflow"
- "I have a question about my ironflow project"
- "fix this" (without context)

## Step 2: Dispatch (HIGH confidence)

1. Print a single line announcing the dispatch:

   > "Read and follow `~/.agents/skills/ironflow-<name>/SKILL.md` for this request."

2. **Immediately** `Read` the target `SKILL.md` file and execute its workflow in this
   same turn. Do not stop after printing. Do not wait for the user to invoke another
   skill. Classify + dispatch + execute happen together.

Works identically in Claude Code, Codex CLI, and Gemini CLI — all support `Read`.

## Step 3: Menu (LOW confidence)

Print this menu, wait for the user to reply with a number or describe further:

```
Your request could match a few skills. Which one?

  1) fit    — Should we use Ironflow, and where? Scans your code,
              writes an HTML report
              Trigger: "where can we use ironflow", "analyze my codebase"

  2) start  — Set up Ironflow / scaffold / pick patterns
              Trigger: "set up ironflow", "push vs pull"

  3) code   — Write functions, projections, workers, tests, audits
              Trigger: "write a function", "add tests"

  4) ops    — Debug, deploy, scale, upgrade, migrate
              Trigger: "run failed", "scale cluster"

  5) docs   — SDK / CLI / MCP reference lookup
              Trigger: "how do I emit", "CLI for X"

Reply with a number, or describe more.
```

After the user picks, dispatch (per Step 2). At the end, print a one-line educational tip:

> "Tip: next time say 'X' to skip this menu."
> (substitute X with the matching trigger phrase from the menu)

## Step 4: Cross-Skill Hand-Off

Each workflow skill ends with a "Next:" pointer. When the user follows that pointer (e.g.,
they invoke `/ironflow-code` after `/ironflow-ops` diagnosed a bug), context is preserved
in the conversation. The router does not orchestrate chains — let conversation context
carry the user forward.

## Cross-Agent Compatibility

This skill uses only universal primitives:
- **Text output** — agent prints menu, user replies in chat
- **Read** — load skill files
- **Grep** — search local files when needed
- **Bash** — run scripts, check versions
- **WebFetch** — version check, doc lookup (optional; degrades gracefully)

No `Skill` tool, no `AskUserQuestion`, no `Agent` tool. Works in Claude Code, Codex CLI,
Gemini CLI identically.

## Skill Map (for reference)

```
/ironflow         this router
/ironflow-fit     does it fit? codebase analysis -> HTML report
/ironflow-start   setup + scaffold + architecture decisions
/ironflow-code    write code + tests + audit
/ironflow-ops     debug + migrate + deploy/scale (index + sub-files)
/ironflow-docs    SDK / CLI / MCP reference (index + topic files)
```
