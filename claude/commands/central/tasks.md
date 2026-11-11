Manage the local tasks of the tmux central (`#1`, `#2`…), each with an optional ticket id.

Arguments:
- no arguments — list the tasks.
- `add <title> [TG-123]` — create a task.
- `<#id> <status|comment>` — set the status (`todo`, `doing`, `blocked`, `done`) or add a comment.

Steps:

1. Use the `tmux-central` MCP tools: `task_list`, `task_create` and `task_update`. If they are not
   available, use the `central tasks` command with Bash.
2. Reply with the tool output as printed, without summarizing it.
