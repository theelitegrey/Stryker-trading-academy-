#!/bin/bash
# Installs the graphify CLI so /graphify works in Claude Code on the web.
#
# The skill in .claude/skills/graphify shells out to the `graphify` command,
# and every cloud session starts from a fresh container, so the package has to
# be put back on the way in. Idempotent: it skips when the command is already
# present, and does nothing outside the web environment.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# uv and pipx put the command in ~/.local/bin, which a fresh shell may not
# have on PATH yet.
export PATH="$HOME/.local/bin:$PATH"

if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy >/dev/null
  elif command -v pipx >/dev/null 2>&1; then
    pipx install graphifyy >/dev/null
  else
    python3 -m pip install --user --quiet graphifyy
  fi
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi
