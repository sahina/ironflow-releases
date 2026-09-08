# Ironflow AI Skills

Teach your coding agent Ironflow. Published from the engine on each release, so
these match the version they ship with.

```bash
npx skills add sahina/ironflow-releases            # pick interactively
npx skills add sahina/ironflow-releases --all      # all skills, all detected agents
npx skills add sahina/ironflow-releases -s ironflow-code -a claude-code -g
```

Works with Claude Code, Codex, Cursor, OpenCode and ~75 other agents.

| Skill | Use it for |
| --- | --- |
| `ironflow` | Router — dispatches an ambiguous request to one of the below |
| `ironflow-fit` | Does Ironflow fit this codebase? Ranked opportunities with evidence |
| `ironflow-start` | Set up Ironflow; push vs pull, entity streams vs events |
| `ironflow-code` | Write functions, projections, workers, sagas; audit for anti-patterns |
| `ironflow-ops` | Debug failed runs, migrate SDK versions, deploy and scale |
| `ironflow-docs` | SDK, CLI and MCP reference the others read from |

If you already run the engine, `ironflow skills sync` writes the same set from the
binary — use that instead, and it stays in step with your upgrades.

Docs: https://docs.ironflow.run
