import { appendFileSync, readFileSync } from "node:fs";
import { setStatus } from "./agents.ts";
import { clearAsk, onAsk, onPermission, onTool, onTurnEnd } from "./attention.ts";
import { formatMessages, takePending } from "./inbox.ts";
import { findCentralDir, paths } from "./paths.ts";
import { readState } from "./state.ts";

interface HookInput {
  cwd?: string;
  reason?: string;
  stop_hook_active?: boolean;
  notification_type?: string;
  message?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  last_assistant_message?: string;
}

function readStdin(): HookInput {
  try {
    const raw = readFileSync(0, "utf8");
    if (process.env.CENTRAL_HOOK_DEBUG) appendFileSync(process.env.CENTRAL_HOOK_DEBUG, raw.trim() + "\n");
    return raw.trim() ? (JSON.parse(raw) as HookInput) : {};
  } catch {
    return {};
  }
}

/** Identifica quem disparou o hook: subagente (env) ou o pane registrado como central. */
function identify(input: HookInput): { dir: string; who: string } | null {
  const dir = process.env.CENTRAL_DIR || findCentralDir(input.cwd);
  if (!dir) return null;
  const id = process.env.CENTRAL_AGENT_ID;
  if (id) return { dir, who: id };
  try {
    const pane = readFileSync(paths(dir).centralPane, "utf8").trim();
    if (pane && pane === process.env.TMUX_PANE) return { dir, who: "central" };
  } catch {
    /* sem central */
  }
  return null;
}

/**
 * Eventos: prompt (UserPromptSubmit), pretool, posttool, ask (PreToolUse de
 * AskUserQuestion/ExitPlanMode), waiting (Notification),
 * stop (Stop), end (SessionEnd), exited (a CLI saiu).
 * Nunca falha: um erro aqui não pode travar o Claude.
 */
export function handleHook(event: string): string {
  const input = event === "exited" ? {} : readStdin();
  const me = identify(input);
  if (!me) return "";
  const { dir, who } = me;
  if (who !== "central" && !readState(dir).agents.some((a) => a.id === who)) return "";

  switch (event) {
    case "prompt": {
      clearAsk(dir, who);
      setStatus(dir, who, "working");
      const msgs = takePending(dir, who);
      if (!msgs.length) return "";
      return JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: formatMessages(msgs) },
      });
    }
    case "pretool":
    case "posttool":
      onTool(dir, who, event === "pretool" ? "pre" : "post", input.tool_name, input.tool_use_id);
      return "";
    case "ask":
      if (who === "central") setStatus(dir, who, "waiting");
      else onAsk(dir, who, input.tool_name ?? "", input.tool_input ?? {}, input.tool_use_id);
      return "";
    case "waiting":
      if (input.notification_type === "idle_prompt") return "";
      onPermission(dir, who, input.message);
      return "";
    case "stop": {
      const msgs = takePending(dir, who);
      if (msgs.length) {
        setStatus(dir, who, "working");
        return JSON.stringify({
          decision: "block",
          reason: `Novas mensagens chegaram pelo tmux-central:\n\n${formatMessages(msgs)}`,
        });
      }
      if (who === "central") setStatus(dir, who, "idle", { soft: true });
      else onTurnEnd(dir, who, input.last_assistant_message);
      return "";
    }
    case "end":
      if (input.reason === "clear" || input.reason === "resume") return "";
      setStatus(dir, who, "dead");
      return "";
    case "exited":
      setStatus(dir, who, "dead");
      return "";
    default:
      return "";
  }
}
