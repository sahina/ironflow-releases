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
  ironflow skills sync
else
  echo "No existing Ironflow skills install detected. Installing globally..."
  ironflow skills sync
fi

echo ""
echo "Run 'ironflow skills doctor' to (re)wire your coding agent if needed."
