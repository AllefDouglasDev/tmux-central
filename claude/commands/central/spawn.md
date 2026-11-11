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
