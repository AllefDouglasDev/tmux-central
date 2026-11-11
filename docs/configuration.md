# Configuration and internals

## `.central/config.json`

Created by `central setup` in each project. Every field is optional; anything missing uses the default.

```json
{
  "lang": "en",
  "agent": { "cli": "claude", "permissionMode": "auto", "blockHiddenSubagents": true, "extraArgs": [] },
  "central": { "extraArgs": [] },
  "worktreeDir": "{root}/../{name}-worktrees",
  "processes": { "web": { "command": "npm run dev", "restart": true } }
}
```

| Field | Default | Effect |
|---|---|---|
| `lang` | `pt` | language of the alerts and system prompts: `pt` or `en` |
| `agent.cli` | `claude` | subagent CLI: `claude`, `codex` or any command that takes the prompt as an argument |
| `agent.permissionMode` | `auto` | permission mode of Claude subagents (`default`, `acceptEdits`, `plan`, `bypassPermissions`, `auto`); `agent_spawn` accepts `permission_mode` per subagent |
| `agent.blockHiddenSubagents` | `true` | passes `--disallowedTools Agent Task` to subagents |
| `agent.extraArgs` | `[]` | extra arguments for the subagent CLI, for example `["--model", "sonnet"]` |
| `central.extraArgs` | `[]` | extra arguments for the central's Claude |
| `worktreeDir` | `{root}/../{name}-worktrees` | where worktrees go; `{root}` and `{name}` are replaced |
| `processes` | `{}` | processes started by `central proc up` (`command`, `cwd`, `restart`) |

## What lives in `.central/`

| Path | Contents |
|---|---|
| `state.json` | tasks, agents, processes and locks, written under a cross-process lock |
| `config.json` | the configuration above |
| `central.pane` | the tmux pane registered as the central |
| `status/<id>` | a mirror of each window's status, read by the hook without starting Node |
| `inbox/<target>/` | pending and read messages |
| `notes/` | shared notes |
| `agents/aN/` | `system.md` (role and tasks), `prompt.md`, `run.sh` and `plan.md` |

The folder is added to `.git/info/exclude`, so it is never committed.

## How it works

- **State**: tmux is the source of truth for the windows; `subcheck` reconciles `state.json` with the windows that actually exist.
- **Status**: the global Claude Code hooks call `~/.claude/hooks/central.sh`, which only acts on subagents (`CENTRAL_AGENT_ID` in the environment) or on the pane registered as the central. `UserPromptSubmit` and `PreToolUse` set `●`, the permission `Notification` sets `?`, `Stop` sets `✓` and `SessionEnd` sets `✗`. While a question or plan is pending, parallel tool calls do not take the window out of `?`.
- **Messages**: they are stored in `.central/inbox/<target>/`. If the target is idle, the message is pasted into the pane (bracketed paste and Enter). If the target is working, the `Stop` hook delivers it with `decision: block` and the agent carries on with it. A new prompt from you also delivers the queue as context.
- **Claude subagents**: they start with `--append-system-prompt-file` (role and tasks), `--permission-mode`, `--allowedTools mcp__tmux-central`, `--disallowedTools Agent Task`, `--session-id` (for `central resume`) and `editorMode: normal`, so that pasted messages don't land in vim's normal mode.
- **Other CLIs**: they get their role and prompt as an argument; without hooks, their status comes from whether the window output changes.

## Known limitations

- A folder never opened in Claude before (for example, a new worktree) shows the trust dialog; the window stays `?` until you accept it.
- Pasting a message into the central while you are typing in it mixes the texts; while the central is busy, the message waits for the end of the turn.
- An MCP server added mid-session only loads when Claude restarts (`central init`).

## Development

```sh
npm run check   # tsc
npm test        # node --test, with an isolated tmux server (-L central-test-<pid>)
```

There is no build step: Node 23.6+ runs the TypeScript directly. The code lives in `src/cli.ts` (CLI), `src/mcp/server.ts` (MCP server) and `src/core/` (state, tmux, agents, hooks, messages).
