import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { paths } from "./paths.ts";

export type TaskStatus = "todo" | "doing" | "blocked" | "done";
export type AgentStatus =
  | "starting"
  | "working"
  | "waiting"
  | "idle"
  | "done"
  | "blocked"
  | "dead";

export interface Task {
  id: number;
  ticket?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  agentId?: string;
  comments: { at: string; by: string; text: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  windowId: string;
  paneId: string;
  taskIds: number[];
  description: string;
  status: AgentStatus;
  cli: string;
  cwd: string;
  /** Sessão do Claude, para `central resume`. */
  sessionId?: string;
  worktree?: { path: string; branch: string };
  lastReport?: { at: string; kind: string; text: string };
  lastOutputHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Proc {
  name: string;
  command: string;
  cwd: string;
  restart: boolean;
  windowId: string;
  paneId: string;
  createdAt: string;
}

export interface Lock {
  owner: string;
  reason?: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface State {
  version: 1;
  root: string;
  name: string;
  session?: string;
  central?: { paneId: string; windowId: string; status: AgentStatus; updatedAt: string };
  nextTaskId: number;
  nextAgentId: number;
  tasks: Task[];
  agents: Agent[];
  processes: Proc[];
  locks: Record<string, Lock>;
}

export const now = () => new Date().toISOString();

export function emptyState(root: string, name: string): State {
  return {
    version: 1,
    root,
    name,
    nextTaskId: 1,
    nextAgentId: 1,
    tasks: [],
    agents: [],
    processes: [],
    locks: {},
  };
}

export function readState(dir: string): State {
  return JSON.parse(readFileSync(paths(dir).state, "utf8")) as State;
}

export function writeJsonAtomic(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, file);
}

const sleepSync = (ms: number) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Lock entre processos com mkdir (atômico); locks com mais de 10s são considerados órfãos. */
function acquire(lockDir: string) {
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      mkdirSync(lockDir);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > 10_000) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Não consegui o lock ${lockDir}`);
      sleepSync(15);
    }
  }
}

/** Lê o estado, aplica `fn` e grava, tudo sob lock. */
export function withState<T>(dir: string, fn: (s: State) => T): T {
  const p = paths(dir);
  acquire(p.lock);
  try {
    const state = readState(dir);
    const result = fn(state);
    writeJsonAtomic(p.state, state);
    return result;
  } finally {
    rmSync(p.lock, { recursive: true, force: true });
  }
}

export function stateExists(dir: string) {
  return existsSync(paths(dir).state);
}

/** Espelho do status em arquivo, lido pelo hook em shell sem precisar subir o node. */
export function writeStatusMirror(dir: string, who: string, status: AgentStatus) {
  const file = paths(dir).status(who);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, status);
}
