#!/usr/bin/env bash
# tmux-central hooks: update the window status (● ? ✓ ✗) and deliver
# queued messages. Only acts on subagents (CENTRAL_AGENT_ID in the env) or on
# the pane registered as the central; any other session exits right away.
# Usage: central.sh prompt|pretool|posttool|waiting|ask|stop|end  (JSON on stdin)

event="${1:-}"
id="${CENTRAL_AGENT_ID:-}"
dir="${CENTRAL_DIR:-}"

if [ -z "$id" ]; then
  [ -n "${TMUX_PANE:-}" ] || exit 0
  d="$PWD"
  while [ "$d" != "/" ]; do
    if [ -f "$d/.central/state.json" ]; then dir="$d/.central"; break; fi
    d="$(dirname "$d")"
  done
  [ -n "$dir" ] || exit 0
  [ "$(cat "$dir/central.pane" 2>/dev/null)" = "$TMUX_PANE" ] || exit 0
  id=central
fi

# Fast path: already "working", nothing to do on every tool call.
case "$event" in
  pretool|posttool)
    [ "$(cat "$dir/status/$id" 2>/dev/null)" = working ] && exit 0 ;;
esac

command -v central >/dev/null 2>&1 || exit 0
CENTRAL_DIR="$dir" CENTRAL_AGENT_ID="$id" exec central hook "$event"
