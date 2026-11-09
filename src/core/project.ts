import { spawnSync, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";
import { postMessage } from "./inbox.ts";
import { CENTRAL_WINDOW, STATUS_ICON } from "./naming.ts";
import { DIR_NAME, findCentralDir, paths, projectRoot } from "./paths.ts";
import { CENTRAL_RULE, centralSystemPrompt } from "./prompts.ts";
import { type AgentStatus, emptyState, now, readState, stateExists, withState, writeJsonAtomic, writeStatusMirror } from "./state.ts";
import { agentWindowName, findAgent, sendMessage } from "./agents.ts";
import { updateTask } from "./tasks.ts";
import { centralCommand } from "./self.ts";
import * as t from "./tmux.ts";

export const MCP_NAME = "tmux-central";

function git(root: string, args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function excludeFromGit(root: string, pattern: string): string | null {
  try {
    git(root, ["rev-parse", "--git-dir"]);
  } catch {
    return null;
  }
  try {
    git(root, ["check-ignore", "-q", pattern.replace(/\/$/, "/x")]);
    return null; // já ignorado
  } catch {
    /* não ignorado */
  }
  const exclude = resolve(root, git(root, ["rev-parse", "--git-path", "info/exclude"]));
  mkdirSync(dirname(exclude), { recursive: true });
  const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (current.split("\n").includes(pattern)) return null;
  appendFileSync(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}${pattern}\n`);
  return `${pattern} adicionado a .git/info/exclude`;
}

function registerMcp(root: string): string {
  const check = spawnSync("claude", ["mcp", "get", MCP_NAME], { cwd: root, encoding: "utf8" });
  if (check.error) return "claude não encontrado no PATH; MCP não registrado.";
  if (check.status === 0) return `MCP ${MCP_NAME} já registrado.`;
  const add = spawnSync(
    "claude",
    ["mcp", "add", "--scope", "local", MCP_NAME, "--", ...centralCommand(), "mcp"],
    { cwd: root, encoding: "utf8" },
  );
  if (add.status !== 0) return `Falha ao registrar o MCP: ${add.stderr || add.stdout}`;
  return `MCP ${MCP_NAME} registrado (scope local, não versionado).`;
}

function addLocalRule(root: string): string | null {
  const file = join(root, ".claude", "local", "settings.md");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.includes("## tmux-central")) return null;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${current ? "\n" : ""}${CENTRAL_RULE}`);
  return "regra do tmux-central adicionada a .claude/local/settings.md";
}

/** Prepara o projeto: `.central/`, exclude no git, MCP local e regra no settings.md. */
export function setup(cwd = process.cwd(), opts: { mcp?: boolean } = {}) {
  const root = projectRoot(cwd);
  const dir = join(root, DIR_NAME);
  const log: string[] = [];
  mkdirSync(dir, { recursive: true });
  if (!stateExists(dir)) {
    writeJsonAtomic(paths(dir).state, emptyState(root, basename(root)));
    log.push(`criado ${dir}`);
  }
  if (!existsSync(paths(dir).config)) {
    writeJsonAtomic(paths(dir).config, DEFAULT_CONFIG);
    log.push("criado .central/config.json");
  }
  for (const p of [`/${DIR_NAME}/`, "/.claude/local/"]) {
    const r = excludeFromGit(root, p);
    if (r) log.push(r);
  }
  const rule = addLocalRule(root);
  if (rule) log.push(rule);
  if (opts.mcp !== false) log.push(registerMcp(root));
  return { dir, root, log };
}

export function sessionNameFor(root: string) {
  return basename(root).replace(/[.:]/g, "_");
}

/** Marca o pane como a central do projeto. */
export function registerCentral(dir: string, paneId: string) {
  const windowId = t.display("#{window_id}", paneId);
  const session = t.display("#{session_name}", paneId);
  t.lockName(windowId);
  t.renameWindow(windowId, CENTRAL_WINDOW);
  t.setSessionEnv(session, "CENTRAL_DIR", dir);
  withState(dir, (s) => {
    s.session = session;
    s.central = { paneId, windowId, status: "idle", updatedAt: now() };
  });
  writeFileSync(paths(dir).centralPane, paneId);
  writeStatusMirror(dir, "central", "idle");
  return `Central registrada no pane ${paneId} (janela ${windowId}, sessão ${session}).`;
}

/**
 * `central init`: fora do tmux cria/entra na sessão do projeto; dentro,
 * registra o pane e abre o Claude como central.
 */
export function init(opts: { claude: boolean; extraArgs: string[] }) {
  const { dir, root, log } = setup();
  for (const l of log) console.error(`  · ${l}`);

  if (!t.insideTmux()) {
    const session = sessionNameFor(root);
    const args = ["new-session", "-A", "-s", session, "-c", root, ...centralCommand(), "init"];
    if (!opts.claude) args.push("--no-claude");
    if (opts.extraArgs.length) args.push("--", ...opts.extraArgs);
    const r = spawnSync("tmux", args, { stdio: "inherit" });
    process.exit(r.status ?? 0);
  }

  const pane = t.currentPane();
  if (!pane) throw new Error("TMUX_PANE não definido.");
  const state = readState(dir);
  const other = state.central && state.central.paneId !== pane;
  if (other && t.listWindows().some((w) => w.paneId === state.central!.paneId)) {
    console.error(`A central já está aberta no pane ${state.central!.paneId}; indo até ela.`);
    t.focusWindow(state.central!.windowId);
    return;
  }
  console.error(`  · ${registerCentral(dir, pane)}`);
  if (!opts.claude) return;

  const config = loadConfig(dir);
  const env = { ...process.env, CENTRAL_ROLE: "central", CENTRAL_AGENT_ID: "central", CENTRAL_DIR: dir };
  spawnSync(
    "claude",
    [
      "--name",
      "central",
      "--append-system-prompt",
      centralSystemPrompt(state.name),
      "--allowedTools",
      "mcp__tmux-central",
      ...config.central.extraArgs,
      ...opts.extraArgs,
      "--disallowedTools",
      "Agent",
      "Task",
    ],
    { stdio: "inherit", cwd: root, env },
  );
  setCentralDead(dir);
  spawnSync(process.env.SHELL || "/bin/zsh", ["-l"], { stdio: "inherit", cwd: root });
}

function setCentralDead(dir: string) {
  withState(dir, (s) => {
    if (s.central) s.central.status = "dead";
  });
  writeStatusMirror(dir, "central", "dead");
}

/** Resolve o projeto da sessão do tmux (para a status line e o popup). */
export function dirForSession(session?: string): string | null {
  if (session) {
    const d = t.getSessionEnv(session, "CENTRAL_DIR");
    if (d && existsSync(d)) return d;
  }
  return findCentralDir();
}

export function statusLine(dir: string | null): string {
  if (!dir || !stateExists(dir)) return "";
  const s = readState(dir);
  const counts = new Map<AgentStatus, number>();
  for (const a of s.agents) {
    if (a.status === "dead") continue;
    const key = a.status === "done" ? "idle" : a.status;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order: [AgentStatus, string][] = [
    ["working", "#F5C344"],
    ["waiting", "#E06C75"],
    ["blocked", "#E06C75"],
    ["starting", "#999999"],
    ["idle", "#98C379"],
  ];
  const parts = order
    .filter(([k]) => counts.get(k))
    .map(([k, color]) => `#[fg=${color}]${counts.get(k)}${STATUS_ICON[k]}#[default]`);
  const procs = s.processes.length ? ` ${s.processes.length}⚙` : "";
  return parts.length || procs ? `◆ ${parts.join(" ")}${procs} ` : "";
}

export type ReportKind = "progress" | "done" | "blocked";

/** Relato de um subagente: atualiza tasks/status e avisa a central. */
export function report(dir: string, agentId: string, kind: ReportKind, text: string, taskIds?: number[]) {
  const { windowId, name } = withState(dir, (s) => {
    const a = findAgent(s, agentId);
    a.lastReport = { at: now(), kind, text };
    if (kind === "done" || kind === "blocked") a.status = kind;
    a.updatedAt = now();
    const ids = taskIds?.length ? taskIds : a.taskIds;
    for (const id of ids) {
      updateTask(s, id, {
        status: kind === "done" ? "done" : kind === "blocked" ? "blocked" : "doing",
        comment: text,
        by: a.id,
      });
    }
    return { windowId: a.windowId, name: agentWindowName(s, a) };
  });
  if (kind !== "progress") writeStatusMirror(dir, agentId, kind);
  t.renameWindow(windowId, name);
  t.refreshStatus();
  const header = kind === "done" ? "✓ concluído" : kind === "blocked" ? "! bloqueado" : "● progresso";
  const r = sendMessage(dir, agentId, "central", `${header}\n${text}`);
  return r.delivered ? "Relato entregue à central." : "Relato registrado; a central recebe quando terminar o turno atual.";
}

export { postMessage };
