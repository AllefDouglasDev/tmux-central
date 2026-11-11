# Usage

## First time in a project

```sh
cd my-project
central init
```

`central init` creates (or reuses) a tmux session named after the project, starts Claude Code as the **central** and, the first time, runs `central setup`, which:

- creates `.central/` (state, inbox, notes, logs, `config.json`) and adds it to `.git/info/exclude`;
- registers the `tmux-central` MCP server with `claude mcp add --scope local`, only for you and with nothing committed;
- writes the rule "subagents only through `agent_spawn`" to `.claude/local/settings.md`.

The central starts with `--disallowedTools Agent Task`, so it cannot create hidden subagents. If you are already in a Claude session inside tmux, `/central:init` plays the same role, but only through the rule, without blocking the tool. An MCP server registered mid-session only loads when Claude restarts: in that case, quit and run `central init`.

Alerts and system prompts are in Portuguese by default. For English, set `"lang": "en"` in `.central/config.json`, or run `central setup` with `CENTRAL_LANG=en` the first time.

## Working with the central

Talk to the central as usual:

> Create a subagent for TG-123 that implements the CSV export endpoint, with tests.

It registers the task (`task_create`), creates the subagent (`agent_spawn`) and a new window shows up:

```
◆ central   ● [#1] TG-123   ? [#2 | #3] TG-456 | TG-457   ✓ [#4] api docs   ⚙ web      ◆ 1● 1? 1✓ 1⚙ 14:02
```

| Icon | Meaning |
|---|---|
| `◆` | the central |
| `○` | starting (or stuck on the folder trust dialog) |
| `●` | working |
| `?` | waiting for you (permission, question or plan) |
| `✓` | finished its turn or reported `done` |
| `!` | reported `blocked` |
| `✗` | the CLI exited or the window was closed |
| `⚙` | managed process (dev server, watcher) |

The window is named `[#ids] tickets` when there is a ticket, or `[#id] description` when there isn't. You can jump into any window and talk to the subagent directly.

### What reaches the central on its own

Hooks notify the central without relying on the subagent to remember:

| Alert | When | What the central does |
|---|---|---|
| `📋 PLAN FOR APPROVAL` | the subagent calls ExitPlanMode | summarizes the plan and asks whether you approve; answers with `agent_plan_decision` |
| `❓ QUESTIONS` | the subagent uses AskUserQuestion | shows the questions and says which window to answer them in |
| `⏸ PERMISSION` | the subagent stops asking for a permission | says which window needs you |
| `💬 TURN ENDED` | the subagent ends a turn without a `report` | summarizes its last message |
| `✓ done` / `! blocked` | the subagent calls `report` | summarizes the report or the blocker |

The full plan is saved to `.central/agents/aN/plan.md`. To answer from the terminal: `central plan a1 approve`, `central plan a1 approve_manual` or `central plan a1 change "use the existing table"`.

### Messages

The central talks to a subagent with `agent_send` (or `/central:send a1 …`, or `central send a1 "…"`). If the target is idle, the message is pasted into its window right away; if it is working, the message waits for the end of the turn and the `Stop` hook delivers it. Claude Code shows that delivery as a "Stop hook error", but that is expected.

### Worktrees

When two subagents may edit the same files, ask for `--worktree` (or `worktree: true`). The subagent works in a `git worktree` at `../<project>-worktrees/aN`, on a `central/<ticket>` branch. To end it and delete the worktree: `central kill a1 --remove-worktree` (it fails on purpose if there are uncommitted changes).

### Shared resources

- **Locks**: `lock_acquire`/`lock_release` for migrations, ports, the database. `central locks` lists them; `central locks release <name>` forces a release.
- **Notes**: `note_write`/`note_read` store markdown in `.central/notes/` as shared context. `central notes [name]` reads them.
- **Processes**: `proc_start web npm run dev` starts the process in its own `⚙` window with auto-restart; `proc_logs` reads its output. `central proc up` starts the processes listed in `config.json`.

### Other CLIs

`--cli codex` (or any command that takes the prompt as an argument) opens the subagent with another CLI. It gets its role and prompt as an argument; without hooks, its status comes from whether the window output changes.

## Claude commands

Installed by `install.sh` into `~/.claude/commands/central/`. Their full content is in [claude-commands.md](claude-commands.md).

| Command | What it does |
|---|---|
| `/central:init [instruction]` | makes the current session the central and, optionally, acts on the instruction |
| `/central:spawn <work> [TG-1] [#2] [--worktree] [--cli x]` | delegates work to a new subagent |
| `/central:subcheck [--lines N] [--all]` | status of every subagent |
| `/central:send <aN> <message>` | message to a subagent |
| `/central:tasks [add <title> [TG-1] \| <#id> <status\|comment>]` | lists, creates or updates local tasks |
| `/central:kill <aN> [--remove-worktree]` | ends a subagent |

## CLI

```text
Project
  central setup                 prepares the project (.central/, local MCP, rule in settings.md)
  central init [-- args]        opens/attaches the project session and starts Claude as the central
  central init --no-claude      only registers the current pane as the central
  central register              registers the current pane as the central

Subagents
  central spawn -p "prompt" [--ticket TG-1] [--title t] [--task 1,2] [--desc d] [--worktree] [--cli claude]
  central subcheck [--lines N] [--all] [--json]
  central send <aN|central> <message...>
  central inbox [aN|central]    reads pending messages
  central out <aN> [--lines N]  last lines of the window
  central focus <aN|central>
  central kill <aN> [--remove-worktree]
  central plan <aN> approve|approve_manual|change ["feedback"]
  central resume <aN>           reopens the subagent's Claude session in its window
  central pick                  picks a window with fzf (use it in a tmux popup)

Tasks
  central tasks                 lists
  central tasks add "title" [--ticket TG-1] [--desc d]
  central tasks set <id> [--status todo|doing|blocked|done] [--comment c]

Processes, locks and notes
  central proc start <name> <command...> [--cwd d] [--no-restart]
  central proc stop|restart|logs <name> [--lines N]
  central proc list | central proc up
  central locks [release <name>]
  central notes [name]

Integration
  central status --tmux [--session S]   summary for status-right
  central hook <event>                  used by the Claude Code hooks
  central mcp                           MCP server (stdio)
```

Arguments after `central init --` go to the central's Claude, for example `central init -- --model opus`.

## MCP tools

| Tool | Available to | What it does |
|---|---|---|
| `central_register` | central | registers the current pane as the central |
| `task_create` | central | creates a local task `#N`, with an optional ticket |
| `agent_spawn` | central | creates a subagent in a new window (`prompt`, `task_ids`, `ticket`, `title`, `description`, `worktree`, `cli`, `permission_mode`) |
| `subcheck` | central | status of every subagent |
| `agent_send` | central | message to a subagent |
| `agent_read_output` | central | last lines of a subagent's window |
| `agent_plan_decision` | central | `approve`, `approve_manual` or `change` with feedback |
| `agent_focus` | central | takes you to a subagent's window |
| `agent_kill` | central | ends a subagent (and its worktree, if asked) |
| `report` | subagent | reports `progress`, `blocked` or `done` |
| `message_central` | subagent | free-form message to the central |
| `task_list`, `task_update` | both | reads and updates tasks |
| `inbox_read` | both | reads pending messages |
| `note_write`, `note_read` | both | shared notes |
| `lock_acquire`, `lock_release`, `lock_list` | both | resource locks |
| `proc_start`, `proc_stop`, `proc_restart`, `proc_list`, `proc_logs` | both | managed processes |
