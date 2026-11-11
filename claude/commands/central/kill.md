End a subagent of the tmux central and close its window.

Arguments: `<agent> [--remove-worktree]`.

Steps:

1. Before closing, call `subcheck` and, if the subagent is working (`●`) or has queued messages,
   tell the user what would be lost and ask for confirmation. Otherwise go ahead.
2. Call `agent_kill` with the agent and `remove_worktree` when asked. Removing a worktree with
   uncommitted changes fails on purpose; report the error as is.
3. Reply in one line.
