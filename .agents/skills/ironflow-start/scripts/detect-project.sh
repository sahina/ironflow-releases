#!/usr/bin/env bash
# Detect project type and Ironflow install state.
#
# Output (key=value pairs, one per line):
#   framework=<nextjs|hono|express|remix|node|go|unknown>
#   language=<ts|go|both|none>
#   ironflow_installed=<true|false>           # SDK present in this project
#   ironflow_cli=<version|none>               # engine binary on PATH
#   package_manager=<pnpm|yarn|npm|bun|none>   # only for TS projects
#
# Usage: detect-project.sh

set -uo pipefail

FRAMEWORK="unknown"
LANGUAGE="none"
IRONFLOW_INSTALLED="false"
IRONFLOW_CLI="none"
PACKAGE_MANAGER="none"

# Engine binary. The SDK is useless without one, so setup asks about installing
# it — skip that question when it is already here.
if command -v ironflow >/dev/null 2>&1; then
  IRONFLOW_CLI=$(ironflow version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  [ -z "$IRONFLOW_CLI" ] && IRONFLOW_CLI="unknown"
fi

HAS_PACKAGE_JSON=false
HAS_GO_MOD=false

if [ -f "package.json" ]; then
  HAS_PACKAGE_JSON=true
fi
if [ -f "go.mod" ]; then
  HAS_GO_MOD=true
fi

# Determine language
if [ "$HAS_PACKAGE_JSON" = true ] && [ "$HAS_GO_MOD" = true ]; then
  LANGUAGE="both"
elif [ "$HAS_PACKAGE_JSON" = true ]; then
  LANGUAGE="ts"
elif [ "$HAS_GO_MOD" = true ]; then
  LANGUAGE="go"
fi

# Detect TS framework + package manager + ironflow
if [ "$HAS_PACKAGE_JSON" = true ]; then
  PKG=$(cat package.json 2>/dev/null)

  if echo "$PKG" | grep -q '"next"'; then
    FRAMEWORK="nextjs"
  elif echo "$PKG" | grep -q '"@remix-run/'; then
    FRAMEWORK="remix"
  elif echo "$PKG" | grep -q '"hono"'; then
    FRAMEWORK="hono"
  elif echo "$PKG" | grep -q '"express"'; then
    FRAMEWORK="express"
  else
    FRAMEWORK="node"
  fi

  if echo "$PKG" | grep -q '"@ironflow/node"\|"@ironflow/browser"\|"@ironflow/core"\|"@ironflow/langgraph"'; then
    IRONFLOW_INSTALLED="true"
  fi

  # Package manager detection
  if [ -f "pnpm-lock.yaml" ]; then
    PACKAGE_MANAGER="pnpm"
  elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    PACKAGE_MANAGER="bun"
  elif [ -f "yarn.lock" ]; then
    PACKAGE_MANAGER="yarn"
  elif [ -f "package-lock.json" ]; then
    PACKAGE_MANAGER="npm"
  else
    # Read packageManager field
    PM=$(echo "$PKG" | grep -E '"packageManager":' | head -1 | sed 's/.*"packageManager":[[:space:]]*"\([a-z]*\).*/\1/')
    if [ -n "$PM" ]; then
      PACKAGE_MANAGER="$PM"
    fi
  fi
fi

# Detect Go ironflow install. The public Go SDK lives at
# `github.com/sahina/ironflow-go/ironflow` (published in v0.22.6, #979).
# Pre-v0.22.6 the SDK was not published to a public module, so external
# users could only resolve the engine-internal `sahina/ironflow/sdk/go/ironflow`
# path via a private-repo checkout — out of scope for the agent skill's
# detection heuristic.
if [ "$HAS_GO_MOD" = true ]; then
  if grep -q "github.com/sahina/ironflow-go/ironflow" go.mod 2>/dev/null; then
    IRONFLOW_INSTALLED="true"
  fi
  if [ "$FRAMEWORK" = "unknown" ]; then
    FRAMEWORK="go"
  fi
fi

echo "framework=$FRAMEWORK"
echo "language=$LANGUAGE"
echo "ironflow_installed=$IRONFLOW_INSTALLED"
echo "ironflow_cli=$IRONFLOW_CLI"
echo "package_manager=$PACKAGE_MANAGER"
