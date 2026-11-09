import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.ts";
import { now, writeJsonAtomic } from "./state.ts";

export interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  createdAt: string;
}

export function postMessage(dir: string, from: string, to: string, body: string): Message {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const msg: Message = { id, from, to, body, createdAt: now() };
  writeJsonAtomic(join(paths(dir).inbox(to), `${id}.json`), msg);
  return msg;
}

export function pending(dir: string, who: string): Message[] {
  const box = paths(dir).inbox(who);
  if (!existsSync(box)) return [];
  return readdirSync(box)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(box, f), "utf8")) as Message);
}

/** Move as mensagens para `read/`, marcando-as como entregues. */
export function markDelivered(dir: string, who: string, messages: Message[]) {
  const box = paths(dir).inbox(who);
  const read = paths(dir).inboxRead(who);
  mkdirSync(read, { recursive: true });
  for (const m of messages) {
    try {
      renameSync(join(box, `${m.id}.json`), join(read, `${m.id}.json`));
    } catch {
      /* já entregue por outro processo */
    }
  }
}

export function takePending(dir: string, who: string): Message[] {
  const msgs = pending(dir, who);
  markDelivered(dir, who, msgs);
  return msgs;
}

export function formatMessages(messages: Message[]): string {
  return messages
    .map((m) => `[central-msg ${m.from} → ${m.to} · ${m.createdAt.slice(11, 19)}]\n${m.body}`)
    .join("\n\n");
}
