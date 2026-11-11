# Instalação

## Requisitos

| Ferramenta | Versão | Para quê |
|---|---|---|
| `tmux` | 3.2+ (usa `display-popup`) | cada subagente é uma janela do tmux |
| `node` | 23.6+ | executa o TypeScript direto, sem build |
| `claude` (Claude Code) | atual | central e subagentes |
| `jq` | qualquer | o `install.sh` edita o `~/.claude/settings.json` |
| `fzf` | qualquer | `central pick`, o seletor de abas |
| `git` | 2.5+ | só para `--worktree` |

No macOS: `brew install tmux node jq fzf`. Outras CLIs de subagente (`codex` etc.) são opcionais.

## Instalação automática

```sh
git clone https://github.com/AllefDouglasDev/tmux-central.git tmux-central
cd tmux-central
./install.sh
```

O `install.sh` é idempotente e:

1. Confere as dependências e a versão do Node.
2. Roda `npm ci`.
3. Cria os links:
   - `~/.local/bin/central` → `bin/central`;
   - `~/.claude/hooks/central.sh` → `claude/hooks/central.sh`;
   - `~/.claude/commands/central/*.md` → `claude/commands/central/*.md` (os comandos `/central:*`).

   Se existir um dotfiles em `$DOTFILES` (padrão `~/Development/personal/dotfiles`), os links apontam para ele em vez deste repositório. Um arquivo que já existia no destino é movido para `<arquivo>.bak.<timestamp>`.
4. Acrescenta os hooks do tmux-central ao `~/.claude/settings.json`, com backup em `~/.claude/settings.json.bak.central`.
5. Recarrega o tmux, se ele estiver rodando.

Confira se `~/.local/bin` está no `PATH`:

```sh
command -v central || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

## Integração com o tmux (manual)

O `install.sh` não mexe no `~/.tmux.conf`. Para ter o resumo dos subagentes na barra de status e o seletor de abas, acrescente:

```tmux
# tmux-central: resumo dos subagentes (◆ 2● 1? 3✓) e seletor de abas
set -g status-interval 5
set -g status-right '#(central status --tmux --session "#S")%T'
bind a display-popup -E -w 70% -h 50% -d '#{pane_current_path}' "central pick '#S'"
```

Com isso, `<prefixo> a` abre o seletor com `fzf`. Recarregue com `tmux source-file ~/.tmux.conf`.

## Hooks do Claude Code

Os hooks são globais, mas o `central.sh` só age em subagentes (`CENTRAL_AGENT_ID` no ambiente) ou no pane registrado como central; em qualquer outra sessão ele sai na hora. Se preferir configurar à mão, este é o trecho que o `install.sh` mescla em `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/central.sh prompt" }] }],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/central.sh pretool" }] },
      { "matcher": "AskUserQuestion|ExitPlanMode", "hooks": [{ "type": "command", "command": "~/.claude/hooks/central.sh ask" }] }
    ],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/central.sh posttool" }] }],
    "Notification": [
      { "matcher": "permission_prompt|elicitation_dialog", "hooks": [{ "type": "command", "command": "~/.claude/hooks/central.sh waiting" }] }
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/central.sh stop" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/central.sh end" }] }]
  }
}
```

## Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `CENTRAL_NODE` | caminho do Node usado pelo `central` (útil quando um `.tool-versions` do projeto fixa um Node antigo) |
| `CENTRAL_LANG=en` | no `central setup`, cria o `config.json` com avisos e prompts em inglês |
| `DOTFILES` | onde o `install.sh` procura o dotfiles |

## Desinstalar

```sh
rm ~/.local/bin/central ~/.claude/hooks/central.sh
rm -r ~/.claude/commands/central
```

Depois remova as entradas `central.sh` dos hooks no `~/.claude/settings.json` e, em cada projeto, apague `.central/` e rode `claude mcp remove tmux-central --scope local`.
