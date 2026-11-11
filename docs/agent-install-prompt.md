# Install prompt for your agent

Copy the block below and paste it into your coding agent (Claude Code, Codex, Cursor…) running in a terminal on this machine. It finds or clones the repository, installs everything, wires up tmux and Claude Code, and checks that it all works, always asking before it touches your own files.

````text
Install and integrate tmux-central on this machine. tmux-central is an MCP server + CLI that turns
Claude Code into a "central" that delegates work to subagents, each one in a visible tmux window.

Repository: https://github.com/AllefDouglasDev/tmux-central.git

Follow the steps in order. Before editing any of my configuration files (~/.tmux.conf, ~/.zshrc,
~/.bashrc, ~/.claude/settings.json), show me the snippet you will add and ask for my
confirmation. Do not use sudo without asking me. At the end, give me a short summary of what was
done and what is still pending.

1. Find the project
   - Look for an existing clone before cloning: run `command -v central` and, if it exists,
     follow the symlink (readlink) up to the project root; also look for folders named
     `tmux-central` or `mcp-tmux` in ~, ~/Development, ~/dev, ~/code, ~/projects and ~/src (up to
     3 levels deep), and confirm it is the right project by its `package.json` with
     `"name": "tmux-central"`.
   - If you find one, use it: run `git status`, and `git pull --ff-only` if the tree is clean; if
     there are local changes, do not pull and tell me.
   - If you don't find one, ask me where to clone it (suggest ~/Development/tmux-central) and run
     `git clone https://github.com/AllefDouglasDev/tmux-central.git <folder>`.

2. Dependencies
   - Check for: tmux (3.2+), node (23.6+), claude (Claude Code), jq, fzf and git.
   - For anything missing, suggest the system's install command (`brew install …` on macOS, the
     distro's package manager on Linux) and run it only after I confirm.
   - If the node on the PATH is older than 23.6 but a newer one is installed, use
     `CENTRAL_NODE=<path>` instead of changing the system node.

3. Installation
   - In the project root, run `./install.sh`. It runs `npm ci`, creates the links
     `~/.local/bin/central`, `~/.claude/hooks/central.sh` and `~/.claude/commands/central/*.md`,
     and merges the tmux-central hooks into `~/.claude/settings.json` (with a backup).
   - Read its output: any line marked `✗` or `!` must be fixed or reported to me.
   - If `command -v central` fails, add `export PATH="$HOME/.local/bin:$PATH"` to my shell rc
     (with confirmation) and use the adjusted PATH for the rest of the session.

4. tmux integration
   - Check whether ~/.tmux.conf already mentions `central status`. If not, propose adding:
       set -g status-interval 5
       set -g status-right '#(central status --tmux --session "#S")%T'
       bind a display-popup -E -w 70% -h 50% -d '#{pane_current_path}' "central pick '#S'"
     If I already have my own status-right, propose fitting `#(central status --tmux --session "#S")`
     into it instead of replacing it. If the `a` key is already bound under the prefix, suggest
     another one.
   - If tmux is running, reload it with `tmux source-file ~/.tmux.conf`.

5. Verification
   - `central help` prints the help.
   - `jq '.hooks | keys' ~/.claude/settings.json` lists UserPromptSubmit, PreToolUse, PostToolUse,
     Notification, Stop and SessionEnd, and `grep -c central.sh ~/.claude/settings.json` is
     greater than 0.
   - `ls ~/.claude/commands/central` shows init, spawn, subcheck, send, tasks and kill.
   - In the tmux-central root, `npm run check` and `npm test` pass (the tests use an isolated
     tmux server and do not touch my sessions).

6. Wrap-up
   - Do not run `central init` for me: it opens an interactive tmux session.
   - Finish by telling me, in a few lines, what was installed, what is pending and how to start:
     go into a project and run `central init`; inside a Claude session already running in tmux,
     use `/central:init`; to browse the windows, `<tmux prefix> a`. The documentation is in
     `docs/usage.md` inside the repository.
````
