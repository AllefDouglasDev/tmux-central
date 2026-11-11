#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  install.sh — installs tmux-central on this machine (idempotent)
# ═══════════════════════════════════════════════════════════════════
#  1. Checks dependencies (tmux, node ≥ 23.6, claude, fzf, jq)
#  2. Installs the npm dependencies
#  3. Links bin/central, the hook and the /central:* commands into ~/.claude
#     (from the dotfiles repo if it exists; otherwise from claude/ here)
#  4. Ensures the tmux-central hooks in ~/.claude/settings.json
#  5. Reloads tmux, if it is running
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES="${DOTFILES:-${DEV:-$HOME/Development}/personal/dotfiles}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

echo "→ dependencies"
for bin in tmux claude fzf jq; do
  command -v "$bin" >/dev/null && ok "$bin" || warn "$bin not found (brew install $bin)"
done
node_bin="${CENTRAL_NODE:-$(command -v /opt/homebrew/bin/node || command -v node)}"
"$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)' \
  || die "node ≥ 23.6 required ($node_bin is $("$node_bin" -v))"
ok "node $("$node_bin" -v)"

echo "→ npm"
(cd "$ROOT" && npm ci --silent --no-audit --no-fund) && ok "dependencies installed"

echo "→ links (dotfiles: $DOTFILES)"
link() {
  local src="$1" dest="$2"
  [ -e "$src" ] || { warn "missing $src"; return; }
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then ok "${dest/#$HOME/~}"; return; fi
  if [ -e "$dest" ] || [ -L "$dest" ]; then mv "$dest" "$dest.bak.$(date +%s)"; warn "backed up ${dest/#$HOME/~}"; fi
  mkdir -p "$(dirname "$dest")"
  ln -s "$src" "$dest" && ok "${dest/#$HOME/~} → ${src/#$HOME/~}"
}
if [ -d "$DOTFILES" ]; then
  [ -x "$DOTFILES/bin/central" ] && ok "dotfiles/bin/central" || warn "dotfiles/bin/central does not exist"
  link "$DOTFILES/config/claude/hooks/central.sh" "$HOME/.claude/hooks/central.sh"
  for f in "$DOTFILES"/config/claude/commands/central/*.md; do
    link "$f" "$HOME/.claude/commands/central/$(basename "$f")"
  done
else
  warn "dotfiles not found; linking from this repository"
  link "$ROOT/bin/central" "$HOME/.local/bin/central"
  link "$ROOT/claude/hooks/central.sh" "$HOME/.claude/hooks/central.sh"
  for f in "$ROOT"/claude/commands/central/*.md; do
    link "$f" "$HOME/.claude/commands/central/$(basename "$f")"
  done
fi
command -v central >/dev/null && ok "central on PATH ($(command -v central))" || warn "central is not on PATH"

echo "→ Claude Code hooks"
SETTINGS="$HOME/.claude/settings.json"
if grep -q 'hooks/central.sh ask' "$SETTINGS" 2>/dev/null; then
  ok "already set up in ${SETTINGS/#$HOME/~}"
else
  HOOKS='{
   "UserPromptSubmit":[{"hooks":[{"type":"command","command":"~/.claude/hooks/central.sh prompt"}]}],
   "PreToolUse":[{"hooks":[{"type":"command","command":"~/.claude/hooks/central.sh pretool"}]},
                 {"matcher":"AskUserQuestion|ExitPlanMode","hooks":[{"type":"command","command":"~/.claude/hooks/central.sh ask"}]}],
   "PostToolUse":[{"hooks":[{"type":"command","command":"~/.claude/hooks/central.sh posttool"}]}],
   "Notification":[{"matcher":"permission_prompt|elicitation_dialog","hooks":[{"type":"command","command":"~/.claude/hooks/central.sh waiting"}]}],
   "Stop":[{"hooks":[{"type":"command","command":"~/.claude/hooks/central.sh stop"}]}],
   "SessionEnd":[{"hooks":[{"type":"command","command":"~/.claude/hooks/central.sh end"}]}]
  }'
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  cp "$SETTINGS" "$SETTINGS.bak.central"
  jq --argjson h "$HOOKS" '.hooks = reduce ($h|keys[]) as $k ((.hooks // {}); .[$k] = ((.[$k] // []) + $h[$k] | unique_by(.hooks[0].command + (.matcher // ""))))' \
    "$SETTINGS.bak.central" > "$SETTINGS"
  ok "hooks added (backup at ${SETTINGS/#$HOME/~}.bak.central)"
fi

if tmux info >/dev/null 2>&1; then
  tmux source-file "$HOME/.tmux.conf" && ok "tmux reloaded"
fi

cat <<'FIM'

Done. In a project:
  central init            opens the project session with Claude as the central
  /central:init           turns a Claude session already running in tmux into the central
  <prefix> a              window picker (see docs/installation.md for the tmux setup)
FIM
