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
