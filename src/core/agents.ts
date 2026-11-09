import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadConfig } from "./config.ts";
import { formatMessages, pending, postMessage, takePending } from "./inbox.ts";
import { CENTRAL_WINDOW, windowName } from "./naming.ts";
import { paths } from "./paths.ts";
import { agentSystemPrompt } from "./prompts.ts";
import {
  type Agent,
  type AgentStatus,
  type State,
  type Task,
  now,
  readState,
  withState,
  writeStatusMirror,
} from "./state.ts";
import { createTask } from "./tasks.ts";
import * as t from "./tmux.ts";
import { centralCommand } from "./self.ts";

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function agentTasks(state: State, agent: Agent): Task[] {
  return agent.taskIds
    .map((id) => state.tasks.find((task) => task.id === id))
    .filter(Boolean) as Task[];
}

export function agentWindowName(state: State, agent: Agent) {
  return windowName(agent.status, agentTasks(state, agent), agent.description);
}

export function findAgent(state: State, id: string): Agent {
  const norm = id.startsWith("a") ? id : `a${id}`;
  const agent = state.agents.find((a) => a.id === norm);
  if (!agent) throw new Error(`Subagente ${id} não existe. Use subcheck para listar.`);
  return agent;
}

/** Sessão do tmux onde as abas são criadas: a da central, senão a atual. */
function targetSession(state: State): string {
  if (state.central && t.listWindows().some((w) => w.paneId === state.central!.paneId)) {
    return t.display("#{session_name}", state.central.paneId);
  }
  if (state.session && t.sessionExists(state.session)) return state.session;
  if (t.insideTmux()) return t.display("#{session_name}");
  throw new Error("Nenhuma sessão do tmux encontrada. Rode `central init` dentro do tmux.");
}

function slug(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function createWorktree(root: string, name: string, dirTemplate: string, agentId: string, branchHint: string) {
  const base = resolve(dirTemplate.replace("{root}", root).replace("{name}", name));
  const path = join(base, agentId);
  const branch = `central/${slug(branchHint) || agentId}`;
  mkdirSync(base, { recursive: true });
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let exists = true;
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  } catch {
    exists = false;
  }
  git(exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path]);
  return { path, branch };
}

export interface SpawnInput {
  prompt: string;
  taskIds?: number[];
  ticket?: string;
  title?: string;
  description?: string;
  cli?: string;
  worktree?: boolean;
  permissionMode?: string;
}

function buildCommand(opts: {
  cli: string;
  agentDir: string;
  sessionId: string;
  label: string;
  permissionMode: string;
  blockHidden: boolean;
  extraArgs: string[];
  mcpConfig?: string;
}) {
  const sys = join(opts.agentDir, "system.md");
  const prompt = join(opts.agentDir, "prompt.md");
  if (opts.cli === "claude") {
    return [
      "claude",
      `"$(cat ${shq(prompt)})"`,
      "--session-id",
      opts.sessionId,
      "--name",
      shq(opts.label),
      "--permission-mode",
      shq(opts.permissionMode),
      "--settings",
      shq(JSON.stringify({ editorMode: "normal" })),
      "--append-system-prompt-file",
      shq(sys),
      ...(opts.mcpConfig ? ["--mcp-config", shq(opts.mcpConfig)] : []),
      "--allowedTools",
      "mcp__tmux-central",
      ...opts.extraArgs.map(shq),
      ...(opts.blockHidden ? ["--disallowedTools", "Agent", "Task"] : []),
    ].join(" ");
  }
  // CLI genérica: o papel do agente vai junto do prompt inicial.
  return `${opts.cli} ${opts.extraArgs.map(shq).join(" ")} "$(cat ${shq(sys)}; echo; cat ${shq(prompt)})"`;
}

export function spawnAgent(dir: string, input: SpawnInput): Agent {
  const config = loadConfig(dir);
  const cli = input.cli || config.agent.cli;

  // 1. Reserva o id e as tasks.
  const { agent, tasks, state } = withState(dir, (s) => {
    const id = `a${s.nextAgentId++}`;
    let taskIds = input.taskIds ?? [];
    if (!taskIds.length) {
      const task = createTask(s, {
        ticket: input.ticket,
        title: input.title || input.description || input.prompt.slice(0, 60),
        description: input.description,
      });
      taskIds = [task.id];
    }
    for (const tid of taskIds) {
      const task = s.tasks.find((x) => x.id === tid);
      if (!task) throw new Error(`Task #${tid} não existe.`);
      task.agentId = id;
      task.status = "doing";
      task.updatedAt = now();
    }
    const agent: Agent = {
      id,
      windowId: "",
      paneId: "",
      taskIds,
      description: input.description || input.title || "",
      status: "starting",
      cli,
      cwd: s.root,
      sessionId: cli === "claude" ? randomUUID() : undefined,
      createdAt: now(),
      updatedAt: now(),
    };
    s.agents.push(agent);
    return { agent, tasks: agentTasks(s, agent), state: structuredClone(s) };
  });

  try {
    // 2. Worktree opcional.
    if (input.worktree) {
      const hint = tasks.map((x) => x.ticket).filter(Boolean).join("-") || `${agent.id}-${agent.description}`;
      agent.worktree = createWorktree(state.root, state.name, config.worktreeDir, agent.id, hint);
      agent.cwd = agent.worktree.path;
    }

    // 3. Arquivos do agente: papel, prompt e script de execução.
    const agentDir = paths(dir).agentDir(agent.id);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "system.md"), agentSystemPrompt(agent, tasks, state.name));
    writeFileSync(join(agentDir, "prompt.md"), input.prompt);

    let mcpConfig: string | undefined;
    if (agent.cwd !== state.root) {
      // Fora da raiz o registro local do MCP não vale; passa explicitamente.
      mcpConfig = join(agentDir, "mcp.json");
      const [command, ...args] = centralCommand();
      writeFileSync(
        mcpConfig,
        JSON.stringify({ mcpServers: { "tmux-central": { command, args: [...args, "mcp"] } } }, null, 2),
      );
    }

    const label = windowName("working", tasks, agent.description).slice(2);
    const central = centralCommand().map(shq).join(" ");
    const run = join(agentDir, "run.sh");
    writeFileSync(
      run,
      [
        "#!/usr/bin/env bash",
        `cd ${shq(agent.cwd)}`,
        buildCommand({
          cli,
          agentDir,
          sessionId: agent.sessionId ?? "",
          label: `${agent.id} ${label}`,
          permissionMode: input.permissionMode || config.agent.permissionMode,
          blockHidden: config.agent.blockHiddenSubagents,
          extraArgs: config.agent.extraArgs,
          mcpConfig,
        }),
        `${central} hook exited </dev/null`,
        `exec "\${SHELL:-/bin/zsh}" -l`,
        "",
      ].join("\n"),
    );
    chmodSync(run, 0o755);

    // 4. Abre a aba.
    const win = t.newWindow({
      session: targetSession(state),
      name: windowName("starting", tasks, agent.description),
      cwd: agent.cwd,
      env: { CENTRAL_ROLE: "agent", CENTRAL_AGENT_ID: agent.id, CENTRAL_DIR: dir },
      command: run,
    });

    return withState(dir, (s) => {
      const a = findAgent(s, agent.id);
      Object.assign(a, { windowId: win.windowId, paneId: win.paneId, worktree: agent.worktree, cwd: agent.cwd, updatedAt: now() });
      writeStatusMirror(dir, a.id, a.status);
      return structuredClone(a);
    });
  } catch (err) {
    withState(dir, (s) => {
      const a = s.agents.find((x) => x.id === agent.id);
      if (a) a.status = "dead";
    });
    throw err;
  }
}

/**
 * Atualiza o status de um agente (ou da central) e o nome da aba.
 * `soft`: não sobrescreve "done"/"blocked" vindos do report (eventos de
 * ferramenta e fim de turno); só um novo prompt ou mensagem reabre o agente.
 */
export function setStatus(dir: string, who: string, status: AgentStatus, opts: { soft?: boolean } = {}) {
  const changed = withState(dir, (s) => {
    if (who === "central") {
      if (!s.central || s.central.status === status) return null;
      s.central.status = status;
      s.central.updatedAt = now();
      return { windowId: s.central.windowId, name: CENTRAL_WINDOW };
    }
    const a = s.agents.find((x) => x.id === who);
    if (!a) return null;
    if (opts.soft && (a.status === "done" || a.status === "blocked")) return null;
    if (a.status === status) return null;
    a.status = status;
    a.updatedAt = now();
    return { windowId: a.windowId, name: agentWindowName(s, a) };
  });
  if (changed) writeStatusMirror(dir, who, status);
  if (changed?.windowId) {
    t.renameWindow(changed.windowId, changed.name);
    t.refreshStatus();
  }
}

export function renameAgentWindow(dir: string, id: string) {
  const s = readState(dir);
  const a = findAgent(s, id);
  if (a.windowId) t.renameWindow(a.windowId, agentWindowName(s, a));
}

function recipientInfo(state: State, to: string) {
  if (to === "central") {
    return state.central ? { paneId: state.central.paneId, status: state.central.status, cli: "claude" } : null;
  }
  const a = findAgent(state, to);
  return { paneId: a.paneId, status: a.status, cli: a.cli };
}

/**
 * Envia uma mensagem. Se o destinatário está ocioso, cola no pane na hora;
 * se está trabalhando, fica na inbox e o hook Stop/UserPromptSubmit entrega.
 */
export function sendMessage(dir: string, from: string, to: string, body: string) {
  const state = readState(dir);
  const target = to === "central" ? "central" : findAgent(state, to).id;
  postMessage(dir, from, target, body);
  const info = recipientInfo(state, target);
  const alive = info && t.listWindows().some((w) => w.paneId === info.paneId && !w.dead);
  const idle = info && (info.status === "idle" || info.status === "done" || info.status === "blocked");
  if (alive && (idle || info.cli !== "claude")) {
    const msgs = takePending(dir, target);
    if (msgs.length) {
      t.pasteAndSubmit(info.paneId, formatMessages(msgs));
      return { delivered: true, queued: 0 };
    }
  }
  return { delivered: false, queued: pending(dir, target).length };
}

export function readOutput(dir: string, id: string, lines = 80) {
  const state = readState(dir);
  const paneId = id === "central" ? state.central?.paneId : findAgent(state, id).paneId;
  if (!paneId) throw new Error("Pane não encontrado.");
  return t.capture(paneId, lines);
}

export function focus(dir: string, id: string) {
  const state = readState(dir);
  const windowId = id === "central" ? state.central?.windowId : findAgent(state, id).windowId;
  if (!windowId) throw new Error("Aba não encontrada.");
  t.focusWindow(windowId);
}

export function killAgent(dir: string, id: string, opts: { removeWorktree?: boolean } = {}) {
  const agent = withState(dir, (s) => {
    const a = findAgent(s, id);
    a.status = "dead";
    a.updatedAt = now();
    return structuredClone(a);
  });
  writeStatusMirror(dir, agent.id, "dead");
  if (agent.windowId) t.killWindow(agent.windowId);
  let note = "";
  if (opts.removeWorktree && agent.worktree) {
    try {
      execFileSync("git", ["worktree", "remove", agent.worktree.path], {
        cwd: readState(dir).root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      note = ` Worktree ${agent.worktree.path} removido (a branch ${agent.worktree.branch} foi mantida).`;
    } catch (err) {
      note = ` Não removi o worktree (há mudanças não commitadas?): ${(err as Error).message.split("\n")[0]}`;
    }
  }
  return `Subagente ${agent.id} encerrado.${note}`;
}

export interface AgentCheck {
  id: string;
  status: AgentStatus;
  window: string;
  tasks: string;
  cwd: string;
  pendingMessages: number;
  lastReport?: string;
  updated: string;
  tail?: string;
}

/** Reconcilia o estado com o tmux e devolve um resumo de cada subagente. */
export function subcheck(dir: string, opts: { lines?: number; all?: boolean } = {}): AgentCheck[] {
  const windows = t.listWindows();
  const renames: { windowId: string; name: string }[] = [];

  const state = withState(dir, (s) => {
    for (const a of s.agents) {
      if (a.status === "dead") continue;
      const w = windows.find((x) => x.paneId === a.paneId);
      let next: AgentStatus = a.status;
      if (!w) next = "dead";
      else if (a.status === "starting" && a.cli === "claude") {
        // Diálogo de confiança da pasta (comum em worktrees novos) não dispara hooks.
        if (/trust this folder|Do you trust/i.test(safeCapture(a.paneId, 40) ?? "")) next = "waiting";
      } else if (a.cli !== "claude") {
        // Sem hooks: saída mudando = trabalhando.
        const h = t.outputHash(a.paneId);
        if (h && a.lastOutputHash && h !== a.lastOutputHash) next = "working";
        else if (h && a.lastOutputHash === h && a.status === "working") next = "idle";
        a.lastOutputHash = h;
      }
      if (next !== a.status) {
        a.status = next;
        a.updatedAt = now();
        writeStatusMirror(dir, a.id, next);
      }
      if (w && w.name !== agentWindowName(s, a)) renames.push({ windowId: a.windowId, name: agentWindowName(s, a) });
    }
    return structuredClone(s);
  });
  for (const r of renames) t.renameWindow(r.windowId, r.name);

  return state.agents
    .filter((a) => opts.all || a.status !== "dead" || Date.now() - Date.parse(a.updatedAt) < 3_600_000)
    .map((a) => ({
      id: a.id,
      status: a.status,
      window: agentWindowName(state, a),
      tasks: agentTasks(state, a)
        .map((x) => `#${x.id}${x.ticket ? ` ${x.ticket}` : ""} ${x.title} (${x.status})`)
        .join("; "),
      cwd: a.cwd,
      pendingMessages: pending(dir, a.id).length,
      lastReport: a.lastReport ? `${a.lastReport.kind}: ${a.lastReport.text}` : undefined,
      updated: a.updatedAt,
      tail: opts.lines && a.status !== "dead" ? safeCapture(a.paneId, opts.lines) : undefined,
    }));
}

function safeCapture(paneId: string, lines: number) {
  try {
    return t.capture(paneId, lines);
  } catch {
    return undefined;
  }
}
