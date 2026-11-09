import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.ts";
import { now } from "./state.ts";

function file(dir: string, name: string) {
  const safe = name.replace(/[^\w.-]+/g, "-").replace(/\.md$/, "");
  if (!safe) throw new Error("Nome de nota inválido.");
  return join(paths(dir).notes, `${safe}.md`);
}

export function writeNote(dir: string, name: string, content: string, opts: { append?: boolean; by?: string } = {}) {
  mkdirSync(paths(dir).notes, { recursive: true });
  const f = file(dir, name);
  if (opts.append) appendFileSync(f, `\n<!-- ${opts.by ?? "?"} · ${now()} -->\n${content}\n`);
  else writeFileSync(f, content.endsWith("\n") ? content : content + "\n");
  return `Nota ${name} ${opts.append ? "atualizada" : "gravada"} (${f}).`;
}

export function readNote(dir: string, name: string) {
  const f = file(dir, name);
  if (!existsSync(f)) throw new Error(`Nota ${name} não existe.`);
  return readFileSync(f, "utf8");
}

export function listNotes(dir: string) {
  const d = paths(dir).notes;
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
}
