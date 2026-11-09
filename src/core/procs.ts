import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { procWindowName } from "./naming.ts";
import { paths } from "./paths.ts";
import { type Proc, now, readState, withState } from "./state.ts";
import * as t from "./tmux.ts";

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

function alive(proc: Proc) {
  return t.listWindows().some((w) => w.paneId === proc.paneId);
}

function session(dir: string) {
  const s = readState(dir);
  if (s.central) {
    try {
      return t.display("#{session_name}", s.central.paneId);
    } catch {
      /* central fechada */
    }
  }
  if (s.session && t.sessionExists(s.session)) return s.session;
  return t.display("#{session_name}");
}

export function startProc(dir: string, input: { name: string; command: string; cwd?: string; restart?: boolean }) {
  const state = readState(dir);
  const existing = state.processes.find((p) => p.name === input.name);
  if (existing && alive(existing)) {
    throw new Error(`O processo ${input.name} já está rodando. Use proc_restart ou proc_stop.`);
  }
  const cwd = resolve(state.root, input.cwd ?? ".");
  const restart = input.restart ?? true;
  const procDir = join(dir, "procs");
  mkdirSync(procDir, { recursive: true });
  mkdirSync(paths(dir).logs, { recursive: true });
  const log = join(paths(dir).logs, `${input.name}.log`);
  const script = join(procDir, `${input.name}.sh`);
  writeFileSync(
    script,
    `#!/usr/bin/env bash
cd ${shq(cwd)}
while true; do
  printf '\\n\\033[2m[central] %s iniciando: %s\\033[0m\\n' "$(date +%T)" ${shq(input.command)}
  bash -lc ${shq(input.command)}
  code=$?
  printf '\\033[2m[central] %s saiu com código %s\\033[0m\\n' "$(date +%T)" "$code"
  ${restart ? "" : "break"}
  [ "$code" -eq 130 ] && break
  sleep 2
done
exec "\${SHELL:-/bin/zsh}" -l
`,
  );
  chmodSync(script, 0o755);
  const win = t.newWindow({
    session: session(dir),
    name: procWindowName(input.name),
    cwd,
    env: { CENTRAL_DIR: dir, CENTRAL_PROC: input.name },
    command: script,
  });
  t.tmuxOk(["pipe-pane", "-o", "-t", win.paneId, `cat >> ${shq(log)}`]);
  withState(dir, (s) => {
    s.processes = s.processes.filter((p) => p.name !== input.name);
    s.processes.push({ name: input.name, command: input.command, cwd, restart, ...win, createdAt: now() });
  });
  return `Processo ${input.name} iniciado na aba "${procWindowName(input.name)}" (${win.windowId}).`;
}

export function stopProc(dir: string, name: string) {
  const proc = readState(dir).processes.find((p) => p.name === name);
  if (!proc) throw new Error(`Processo ${name} não existe.`);
  t.killWindow(proc.windowId);
  withState(dir, (s) => {
    s.processes = s.processes.filter((p) => p.name !== name);
  });
  return `Processo ${name} parado.`;
}

export function restartProc(dir: string, name: string) {
  const proc = readState(dir).processes.find((p) => p.name === name);
  if (!proc) throw new Error(`Processo ${name} não existe.`);
  t.killWindow(proc.windowId);
  return startProc(dir, { name, command: proc.command, cwd: proc.cwd, restart: proc.restart });
}

export function listProcs(dir: string) {
  const windows = t.listWindows();
  return readState(dir).processes.map((p) => ({
    name: p.name,
    command: p.command,
    cwd: p.cwd,
    restart: p.restart,
    alive: windows.some((w) => w.paneId === p.paneId),
  }));
}

export function procLogs(dir: string, name: string, lines = 100, grep?: string) {
  const proc = readState(dir).processes.find((p) => p.name === name);
  let text = "";
  if (proc && alive(proc)) text = t.capture(proc.paneId, Math.max(lines, 200));
  else {
    const log = join(paths(dir).logs, `${name}.log`);
    if (!existsSync(log)) throw new Error(`Sem logs para ${name}.`);
    text = readFileSync(log, "utf8").replace(ANSI, "");
  }
  let out = text.split("\n");
  if (grep) {
    const re = new RegExp(grep, "i");
    out = out.filter((l) => re.test(l));
  }
  return out.slice(-lines).join("\n");
}

/** Sobe os processos de `.central/config.json` que ainda não estão rodando. */
export function procUp(dir: string) {
  const cfg = loadConfig(dir);
  const running = new Set(listProcs(dir).filter((p) => p.alive).map((p) => p.name));
  const out: string[] = [];
  for (const [name, p] of Object.entries(cfg.processes)) {
    if (running.has(name)) out.push(`${name}: já rodando`);
    else out.push(startProc(dir, { name, ...p }));
  }
  return out.join("\n") || "Nenhum processo em .central/config.json.";
}
