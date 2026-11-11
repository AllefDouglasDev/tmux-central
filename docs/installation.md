# Installation

## Requirements

| Tool | Version | Why |
|---|---|---|
| `tmux` | 3.2+ (uses `display-popup`) | every subagent is a tmux window |
| `node` | 23.6+ | runs the TypeScript directly, with no build step |
| `claude` (Claude Code) | current | the central and the subagents |
| `jq` | any | `install.sh` edits `~/.claude/settings.json` |
| `fzf` | any | `central pick`, the window picker |
| `git` | 2.5+ | only for `--worktree` |

On macOS: `brew install tmux node jq fzf`. Other subagent CLIs (`codex`, etc.) are optional.

Prefer to let an agent do it? See [agent-install-prompt.md](agent-install-prompt.md).

## Automatic installation

```sh
git clone https://github.com/AllefDouglasDev/tmux-central.git tmux-central
cd tmux-central
./install.sh
```

`install.sh` is idempotent and:

1. Checks the dependencies and the Node version.
2. Runs `npm ci`.
3. Creates the links:
   - `~/.local/bin/central` → `bin/central`;
   - `~/.claude/hooks/central.sh` → `claude/hooks/central.sh`;
   - `~/.claude/commands/central/*.md` → `claude/commands/central/*.md` (the `/central:*` commands).

   If a dotfiles repository exists at `$DOTFILES` (default `~/Development/personal/dotfiles`), the links point there instead of this repository. A file that already existed at the destination is moved to `<file>.bak.<timestamp>`.
4. Adds the tmux-central hooks to `~/.claude/settings.json`, with a backup at `~/.claude/settings.json.bak.central`.
5. Reloads tmux, if it is running.

Make sure `~/.local/bin` is on your `PATH`:

```sh
command -v central || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

## tmux integration (manual)

`install.sh` does not touch `~/.tmux.conf`. For the subagent summary in the status bar and the window picker, add:

```tmux
# tmux-central: subagent summary (◆ 2● 1? 3✓) and window picker
set -g status-interval 5
set -g status-right '#(central status --tmux --session "#S")%T'
bind a display-popup -E -w 70% -h 50% -d '#{pane_current_path}' "central pick '#S'"
```

With this, `<prefix> a` opens the `fzf` picker. Reload with `tmux source-file ~/.tmux.conf`.

## Claude Code hooks

The hooks are global, but `central.sh` only acts on subagents (`CENTRAL_AGENT_ID` in the environment) or on the pane registered as the central; in any other session it exits right away. If you prefer to set them up by hand, this is the snippet `install.sh` merges into `~/.claude/settings.json`:

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

## Environment variables

| Variable | Effect |
|---|---|
| `CENTRAL_NODE` | path of the Node binary `central` uses (useful when a project's `.tool-versions` pins an old Node) |
| `CENTRAL_LANG=en` | makes `central setup` create `config.json` with alerts and prompts in English |
| `DOTFILES` | where `install.sh` looks for a dotfiles repository |

## Uninstalling

```sh
rm ~/.local/bin/central ~/.claude/hooks/central.sh
rm -r ~/.claude/commands/central
```

Then remove the `central.sh` entries from the hooks in `~/.claude/settings.json` and, in each project, delete `.central/` and run `claude mcp remove tmux-central --scope local`.
