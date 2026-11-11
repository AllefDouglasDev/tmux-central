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
