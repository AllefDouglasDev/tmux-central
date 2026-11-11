Send a message from the central to a subagent through the `tmux-central` MCP.

Arguments: `<agent> <message>` — the agent id (`a1`, or just `1`) followed by the message.

Steps:

1. Call `agent_send` with the agent and the message, as written. Do not rewrite it, unless it
   refers to things in this conversation the subagent cannot see: then add that context.
2. Reply in one line: delivered now, or queued until the subagent finishes its current turn.
