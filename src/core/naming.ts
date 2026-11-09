import type { AgentStatus, Task } from "./state.ts";

export const STATUS_ICON: Record<AgentStatus, string> = {
  starting: "○",
  working: "●",
  waiting: "?",
  idle: "✓",
  done: "✓",
  blocked: "!",
  dead: "✗",
};

export const CENTRAL_WINDOW = "◆ central";
export const PROC_PREFIX = "⚙";

const MAX_DESC = 32;

function shorten(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

/**
 * `<status> [#1 | #2] TG-123 | TG-456 || breve descrição`
 * Partes vazias são omitidas.
 */
export function windowName(status: AgentStatus, tasks: Pick<Task, "id" | "ticket">[], description?: string) {
  const parts: string[] = [STATUS_ICON[status]];
  if (tasks.length) parts.push(`[${tasks.map((t) => `#${t.id}`).join(" | ")}]`);
  const tickets = [...new Set(tasks.map((t) => t.ticket).filter(Boolean))] as string[];
  if (tickets.length) parts.push(tickets.join(" | "));
  if (description?.trim()) parts.push(`|| ${shorten(description, MAX_DESC)}`);
  return parts.join(" ");
}

export function procWindowName(name: string, alive = true) {
  return `${PROC_PREFIX} ${name}${alive ? "" : " ✗"}`;
}
