# Comandos do Claude (`/central:*`)

Os comandos ficam em [`claude/commands/central/`](../claude/commands/central/) e o `install.sh` os liga em `~/.claude/commands/central/`, onde o Claude Code os expõe como `/central:<nome>`. Para instalar à mão, copie os arquivos para essa pasta. Todos usam as ferramentas do MCP `tmux-central`, então o projeto precisa ter passado por `central setup` (o `central init` faz isso).

| Comando | Argumentos |
|---|---|
| `/central:init` | uma primeira instrução para a central, opcional |
| `/central:spawn` | o trabalho a delegar; aceita tickets (`TG-123`), tasks (`#2`), `--worktree` e `--cli <nome>` |
| `/central:subcheck` | `--lines <n>`, `--all` |
| `/central:send` | `<agente> <mensagem>` |
| `/central:tasks` | nada, `add <título> [TG-123]` ou `<#id> <status\|comentário>` |
| `/central:kill` | `<agente> [--remove-worktree]` |

O conteúdo de cada comando está abaixo, para quem quiser criá-los à mão ou adaptá-los a outro agente.

## `/central:init`

Arquivo: `claude/commands/central/init.md`

````markdown
Make this Claude session the **central** of the current project: the coordinator that delegates work
to subagents running as visible tmux windows, through the `tmux-central` MCP.

Arguments: none. Anything after the command is a first instruction for the central to act on once
it is registered.

Steps:

1. If the `tmux-central` MCP tools (`central_register`, `agent_spawn`…) are not available in this
   session, run `central setup` with Bash in the project root. It registers the MCP for this
   project only (scope local, never committed). Then tell the user, in one sentence, to restart as
   central with `central init` in the terminal (an MCP added mid-session only loads on restart),
   and stop.
2. If `$TMUX` is empty (check with Bash), say the session is not inside tmux and that
   `central init` opens the right session; stop.
3. Call `central_register`. It names this window `◆ central` and makes the hooks track this pane.
4. From now on, follow these rules for the rest of the session:
   - Never use the Agent/Task tool. Every subagent is created with `agent_spawn`, which opens a new
     tmux window named `[#1 | #2] TG-123 | TG-456`, or `[#3] short description` when there is no ticket.
   - Register work first with `task_create` (local id `#N`, ticket when there is one), then pass
     `task_ids` to `agent_spawn`, or pass `ticket`/`title` and let it create the task.
   - Write each subagent prompt so it stands on its own: goal, context, relevant files, done
     criteria and what not to touch. The subagent does not see this conversation.
   - Use `worktree: true` when two subagents may edit the same files at the same time.
   - Messages from subagents arrive by themselves as `[central-msg aN → central]`. Do not poll in a
     loop; use `subcheck` when the user asks or a decision needs it.
   - Automatic alerts need action right away:
     - `📋 PLANO PARA APROVAÇÃO`: summarize the plan for the user in a few bullets (what changes,
       files, risks, open decisions) and ask whether to approve or what to change. Then call
       `agent_plan_decision` (`approve`, `approve_manual`, or `change` with the feedback). Never
       approve without the user.
     - `❓ PERGUNTAS`: show the questions briefly and say which window to answer them in.
     - `⏸ PERMISSÃO`: say which window needs an approval.
     - `💬 FIM DE TURNO`: the subagent stopped without a report; summarize what it said in one or
       two sentences and whether it needs something.
     - `✓ concluído` / `! bloqueado`: summarize the report; for a blocker, say what it needs.
   - Use `lock_acquire`/`lock_release` for shared resources, `note_write`/`note_read` for shared
     context and `proc_start`/`proc_logs` for dev servers.
5. Reply with one line confirming the central is up, then act on the arguments, if any.
````

## `/central:spawn`

Arquivo: `claude/commands/central/spawn.md`

````markdown
Create a subagent in a new tmux window through the `tmux-central` MCP — never through the Agent/Task
tool.

Arguments: free text with the work to delegate. It may include ticket ids (`TG-123`), local task
ids (`#2`), `--worktree` and `--cli <name>`.

Steps:

1. Resolve the tasks: local ids (`#N`) go to `task_ids`; for each ticket without a local task,
   call `task_create` with the ticket and a short title. Several related tasks may share one
   subagent.
2. Write the subagent prompt so it stands on its own: goal, context from this conversation that it
   needs, relevant files, done criteria, what not to touch, and that it must finish with
   `report` kind `done` (or `blocked`).
3. Call `agent_spawn` with the prompt, `task_ids`, a short `description` (up to ~30 characters; it
   names the window only when there is no ticket), `worktree` when asked or when another subagent edits the same files,
   and `cli` when given.
4. Reply in one line with the subagent id and the window name.
````

## `/central:subcheck`

Arquivo: `claude/commands/central/subcheck.md`

````markdown
Show the status of every subagent of the tmux central in this project.

Arguments:
- `--lines <n>` — also show the last `n` lines of each subagent window.
- `--all` — include subagents that ended more than an hour ago.

Steps:

1. Call the `subcheck` tool of the `tmux-central` MCP with the arguments. If the tool is not
   available, run `central subcheck` (plus the same flags) with Bash instead.
2. Reply with one line per subagent: status icon, id, window name, and the first line of its last
   report. Icons: `○` starting, `●` working, `?` waiting for the user, `✓` finished, `!` blocked,
   `✗` ended. Add a line for queued messages when there are any.
3. Below the list, point out only what needs the user: subagents waiting (`?`) or blocked (`!`),
   with the question or blocker they reported. Say nothing else.
````

## `/central:send`

Arquivo: `claude/commands/central/send.md`

````markdown
Send a message from the central to a subagent through the `tmux-central` MCP.

Arguments: `<agent> <message>` — the agent id (`a1`, or just `1`) followed by the message.

Steps:

1. Call `agent_send` with the agent and the message, as written. Do not rewrite it, unless it
   refers to things in this conversation the subagent cannot see: then add that context.
2. Reply in one line: delivered now, or queued until the subagent finishes its current turn.
````

## `/central:tasks`

Arquivo: `claude/commands/central/tasks.md`

````markdown
Manage the local tasks of the tmux central (`#1`, `#2`…), each with an optional ticket id.

Arguments:
- no arguments — list the tasks.
- `add <title> [TG-123]` — create a task.
- `<#id> <status|comment>` — set the status (`todo`, `doing`, `blocked`, `done`) or add a comment.

Steps:

1. Use the `tmux-central` MCP tools: `task_list`, `task_create` and `task_update`. If they are not
   available, use the `central tasks` command with Bash.
2. Reply with the tool output as printed, without summarizing it.
````

## `/central:kill`

Arquivo: `claude/commands/central/kill.md`

````markdown
End a subagent of the tmux central and close its window.

Arguments: `<agent> [--remove-worktree]`.

Steps:

1. Before closing, call `subcheck` and, if the subagent is working (`●`) or has queued messages,
   tell the user what would be lost and ask for confirmation. Otherwise go ahead.
2. Call `agent_kill` with the agent and `remove_worktree` when asked. Removing a worktree with
   uncommitted changes fails on purpose; report the error as is.
3. Reply in one line.
````

## Hook `central.sh`

Arquivo: `claude/hooks/central.sh`, ligado em `~/.claude/hooks/central.sh`. Os eventos que ele recebe estão em [instalacao.md](instalacao.md#hooks-do-claude-code).

````bash
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
````
