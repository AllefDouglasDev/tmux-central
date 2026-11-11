#!/usr/bin/env bash
# Hooks do tmux-central: atualiza o status da aba (● ? ✓ ✗) e entrega
# mensagens da fila. Só age em subagentes (CENTRAL_AGENT_ID no env) ou no
# pane registrado como central; em qualquer outra sessão sai na hora.
# Uso: central.sh prompt|pretool|posttool|waiting|stop|end  (JSON no stdin)

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

# Caminho rápido: já está "working", nada a fazer a cada ferramenta.
case "$event" in
  pretool|posttool)
    [ "$(cat "$dir/status/$id" 2>/dev/null)" = working ] && exit 0 ;;
esac

command -v central >/dev/null 2>&1 || exit 0
CENTRAL_DIR="$dir" CENTRAL_AGENT_ID="$id" exec central hook "$event"
