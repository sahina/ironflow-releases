#!/usr/bin/env bash
# Check if a newer Ironflow release is available.
#
# Behavior:
#   - Reads the installed version from `ironflow version --json` (source of truth).
#     Falls back to the local SKILL.md frontmatter `version:` only if the binary
#     is not on PATH.
#   - Caches check result for 24h via .last_checked stamp file
#   - Fetches the latest release tag (v*) from the public ironflow-releases repo
#   - Prints "CURRENT" or "OUTDATED:<latest_version>" to stdout
#   - Network failures / no binary = silent skip (prints nothing, exits 0)
#
# Usage: check-version.sh
# Output (stdout):
#   CURRENT                — installed matches latest
#   OUTDATED:<version>     — newer version available
#   (nothing)              — cache hit OR network failure (skip silently)

set -uo pipefail

SKILL_DIR="$HOME/.agents/skills/ironflow"
LOCAL_SKILL="$SKILL_DIR/SKILL.md"
STAMP_FILE="$SKILL_DIR/.last_checked"
CACHE_SECONDS=86400   # 24h

# If running from a project-local install, fall back to local path for the stamp.
# If neither a global nor a local install exists, there is nothing to check:
# skip silently (avoids a network fetch on every run and a bogus OUTDATED for
# skills that were never installed; the stamp's parent dir wouldn't exist anyway).
if [ ! -f "$LOCAL_SKILL" ]; then
  if [ -f ".agents/skills/ironflow/SKILL.md" ]; then
    SKILL_DIR=".agents/skills/ironflow"
    LOCAL_SKILL="$SKILL_DIR/SKILL.md"
    STAMP_FILE="$SKILL_DIR/.last_checked"
  else
    exit 0   # no skills installed — nothing to check
  fi
fi

# Cache check (stamp lives in the skill dir if one exists; else skip caching).
if [ -f "$STAMP_FILE" ]; then
  now=$(date +%s)
  stamp=$(stat -f %m "$STAMP_FILE" 2>/dev/null || stat -c %Y "$STAMP_FILE" 2>/dev/null || echo 0)
  age=$((now - stamp))
  if [ "$age" -lt "$CACHE_SECONDS" ]; then
    exit 0   # cache hit — silent
  fi
fi

# Installed version: prefer the binary (source of truth), fall back to frontmatter.
LOCAL_VERSION=""
if command -v ironflow >/dev/null 2>&1; then
  LOCAL_VERSION=$(ironflow version --json 2>/dev/null \
    | grep -oE '"version":"[^"]*"' | head -1 | sed 's/.*:"\(.*\)"/\1/')
fi
if [ -z "$LOCAL_VERSION" ] && [ -f "$LOCAL_SKILL" ]; then
  LOCAL_VERSION=$(awk '/^version:/{print $2; exit}' "$LOCAL_SKILL" 2>/dev/null || echo "")
fi
LOCAL_VERSION="${LOCAL_VERSION#v}"
if [ -z "$LOCAL_VERSION" ]; then
  exit 0   # no installed version discoverable — silent skip
fi

# Fetch latest release from the public mirror.
# Try anonymous first; if that fails (rate limit), fall back to gh CLI.
LATEST_JSON=$(curl -fsSL --max-time 5 \
  "https://api.github.com/repos/sahina/ironflow-releases/releases/latest" 2>/dev/null || echo "")

if [ -z "$LATEST_JSON" ] && command -v gh >/dev/null 2>&1; then
  LATEST_JSON=$(gh api repos/sahina/ironflow-releases/releases/latest 2>/dev/null || echo "")
fi

if [ -z "$LATEST_JSON" ]; then
  # Network failure — touch stamp so we don't retry storm, silent skip
  touch "$STAMP_FILE" 2>/dev/null || true
  exit 0
fi

# Extract tag_name (strip leading "v" if present)
LATEST_TAG=$(echo "$LATEST_JSON" | grep -oE '"tag_name":\s*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
LATEST_VERSION="${LATEST_TAG#v}"

# Touch stamp regardless of result
touch "$STAMP_FILE" 2>/dev/null || true

# Reject an empty or implausible tag (untrusted network JSON flows into the
# OUTDATED string the router surfaces — keep it to digits and dots).
case "$LATEST_VERSION" in
  ''|*[!0-9.]*) exit 0 ;;
esac

if [ "$LOCAL_VERSION" = "$LATEST_VERSION" ]; then
  echo "CURRENT"
else
  # Simple version comparison sufficient for semver-ish tags from GH releases
  if [ "$(printf '%s\n%s\n' "$LOCAL_VERSION" "$LATEST_VERSION" | sort -V | tail -1)" = "$LATEST_VERSION" ]; then
    echo "OUTDATED:$LATEST_VERSION"
  else
    echo "CURRENT"   # local is ahead (dev build) — treat as current
  fi
fi
