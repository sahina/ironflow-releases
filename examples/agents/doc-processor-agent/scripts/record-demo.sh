#!/usr/bin/env bash
# record-demo.sh — narrative wrapper around demo-crash-resume.sh tuned for
# asciinema recording. Adds banners + brief pauses between phases so a
# casual viewer can follow along.
#
# Capture with (run interactively in a real terminal — asciinema needs a TTY):
#
#   asciinema rec docs/images/agent-crash-resume.cast \
#     --cols 100 --rows 30 --idle-time-limit 1 --overwrite
#   # then in the recording session:
#   $ examples/agents/doc-processor-agent/scripts/record-demo.sh
#   $ exit
#
# Re-run while iterating; the cast is small enough to commit.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

banner() {
  printf '\n\033[1;35m── %s ──\033[0m\n' "$*"
  sleep 0.7
}

clear

banner "1. Ironflow agent surviving kill -9"
echo "We will start a 3-step doc-processor agent, kill the worker mid-OCR,"
echo "then restart — the agent picks up from cached steps."
sleep 2

banner "2. running the demo"
sleep 0.4

bash "${HERE}/demo-crash-resume.sh"

banner "3. ✅ kill -9 → orphaned run → restart → projection caught up"
echo "The OCR step ran twice (it never completed before kill); classify,"
echo "publish, and memory.append ran exactly once. No re-billed LLM calls,"
echo "no re-emitted side effects, no lost state."
sleep 2
