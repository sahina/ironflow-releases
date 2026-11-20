#!/usr/bin/env bash
# Update Ironflow skills to the version bundled in the installed binary.
#
# Skills ship inside the `ironflow` binary, so updating just means re-syncing
# them from it with `ironflow skills sync`. This script detects whether the
# existing install is project-local (.agents/skills) or global (~/.agents/skills)
# and re-syncs in the same mode.
#
# Usage: update-skills.sh

set -uo pipefail

# Plugin installs: `ironflow skills sync` writes elsewhere and would leave them stale.
# A Claude Code plugin cache is a copy of the whole mirror, so .claude-plugin/ sits
# above .agents/ (with the Codex manifest inside .agents/ too). A Codex plugin cache is
# a copy of .agents/ alone, so its manifest sits beside skills/ with nothing above it.
here="$(dirname "$0")"
codex_marker="$here/../../../.codex-plugin/plugin.json"
claude_marker="$here/../../../../.claude-plugin/marketplace.json"
# A project's own marketplace file can sit at the same path, so the file's top-level
# name (its first "name" key) must be ironflow.
names_ironflow() { grep -oE '"name" *: *"[^"]*"' "$1" 2>/dev/null | head -1 | grep -q '"ironflow"$'; }
if names_ironflow "$claude_marker"; then
  echo "These skills come from the Ironflow Claude Code plugin. Update them in Claude Code:"
  echo "  /plugin marketplace update ironflow"
  echo "  /plugin update ironflow@ironflow"
  exit 0
fi
if names_ironflow "$codex_marker"; then
  echo "These skills come from the Ironflow Codex plugin. Update them with:"
  echo "  codex plugin marketplace upgrade ironflow"
  echo "  codex plugin add ironflow@ironflow"
  exit 0
fi

if ! command -v ironflow >/dev/null 2>&1; then
  echo "The 'ironflow' binary is not on your PATH."
  echo "Install it (https://docs.ironflow.run/tutorials/installation/), then run:"
  echo "  ironflow skills sync"
  exit 1
fi

# Prefer a project-local install if one exists, else fall back to global.
if [ -d ".agents/skills/ironflow" ]; then
  echo "Updating project-local skills (./.agents/skills)..."
  ironflow skills sync --local
elif [ -d "$HOME/.agents/skills/ironflow" ]; then
  echo "Updating global skills (~/.agents/skills)..."
  ironflow skills sync --global
else
  echo "No existing Ironflow skills install detected. Installing into this project..."
  ironflow skills sync --local
fi

echo ""
echo "Run 'ironflow skills doctor' to (re)wire your coding agent if needed."
