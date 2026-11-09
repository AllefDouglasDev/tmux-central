#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  install.sh — instala o tmux-central nesta máquina (idempotente)
# ═══════════════════════════════════════════════════════════════════
#  1. Confere dependências (tmux, node ≥ 23.6, claude, fzf, jq)
#  2. Instala as dependências npm
#  3. Liga o dotfiles: bin/central, hook e comandos /central:* em ~/.claude
#  4. Garante os hooks do tmux-central no ~/.claude/settings.json
#  5. Recarrega o tmux, se estiver rodando
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES="${DOTFILES:-${DEV:-$HOME/Development}/personal/dotfiles}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

echo "→ dependências"
for bin in tmux claude fzf jq; do
  command -v "$bin" >/dev/null && ok "$bin" || warn "$bin não encontrado (brew install $bin)"
done
node_bin="${CENTRAL_NODE:-$(command -v /opt/homebrew/bin/node || command -v node)}"
"$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)' \
  || die "node ≥ 23.6 necessário ($node_bin é $("$node_bin" -v))"
ok "node $("$node_bin" -v)"

echo "→ npm"
(cd "$ROOT" && npm ci --silent --no-audit --no-fund) && ok "dependências instaladas"

echo "→ links (dotfiles: $DOTFILES)"
link() {
  local src="$1" dest="$2"
  [ -e "$src" ] || { warn "falta $src"; return; }
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then ok "${dest/#$HOME/~}"; return; fi
  if [ -e "$dest" ] || [ -L "$dest" ]; then mv "$dest" "$dest.bak.$(date +%s)"; warn "backup de ${dest/#$HOME/~}"; fi
  mkdir -p "$(dirname "$dest")"
  ln -s "$src" "$dest" && ok "${dest/#$HOME/~} → ${src/#$HOME/~}"
}
if [ -d "$DOTFILES" ]; then
  [ -x "$DOTFILES/bin/central" ] && ok "dotfiles/bin/central" || warn "dotfiles/bin/central não existe"
  link "$DOTFILES/config/claude/hooks/central.sh" "$HOME/.claude/hooks/central.sh"
  for f in "$DOTFILES"/config/claude/commands/central/*.md; do
    link "$f" "$HOME/.claude/commands/central/$(basename "$f")"
  done
else
  warn "dotfiles não encontrado; linkando só o binário em ~/.local/bin"
  link "$ROOT/bin/central" "$HOME/.local/bin/central"
fi
command -v central >/dev/null && ok "central no PATH ($(command -v central))" || warn "central fora do PATH"

echo "→ hooks do Claude Code"
SETTINGS="$HOME/.claude/settings.json"
if grep -q 'hooks/central.sh ask' "$SETTINGS" 2>/dev/null; then
  ok "já configurados em ${SETTINGS/#$HOME/~}"
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
  ok "hooks adicionados (backup em ${SETTINGS/#$HOME/~}.bak.central)"
fi

if tmux info >/dev/null 2>&1; then
  tmux source-file "$HOME/.tmux.conf" && ok "tmux recarregado"
fi

cat <<'FIM'

Pronto. Num projeto:
  central init            abre a sessão do projeto com o Claude como central
  /central:init           transforma um Claude já aberto (dentro do tmux) na central
  Ctrl-s a                picker das abas da central
FIM
