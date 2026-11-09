import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOCKET = `central-test-${process.pid}`;
process.env.CENTRAL_TMUX_SOCKET = SOCKET;
delete process.env.CENTRAL_DIR;
delete process.env.CENTRAL_AGENT_ID;

const { setup, registerCentral, report, statusLine, pickRows } = await import("../src/core/project.ts");
const agents = await import("../src/core/agents.ts");
const procs = await import("../src/core/procs.ts");
const locks = await import("../src/core/locks.ts");
const { readState } = await import("../src/core/state.ts");
const { pending } = await import("../src/core/inbox.ts");
const t = await import("../src/core/tmux.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(100);
  }
  return false;
}

// "LLM" falsa: imprime o prompt e depois ecoa o que for colado.
const FAKE = `bash -c 'printf "%s" "$1" | tail -c 100; echo; exec cat' fake`;
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

let root: string;
let dir: string;
let centralPane: string;

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "central-proj-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: root });
  t.tmux(["new-session", "-d", "-s", "proj", "-x", "200", "-y", "50", "-c", root, "cat"]);
  centralPane = t.tmux(["display-message", "-p", "-t", "proj", "#{pane_id}"]);
  const r = setup(root, { mcp: false });
  dir = r.dir;
  registerCentral(dir, centralPane);
});

after(() => {
  t.tmuxOk(["kill-server"]);
});

test("setup cria .central e exclui do git", () => {
  assert.ok(existsSync(join(dir, "state.json")));
  assert.match(readFileSync(join(root, ".git", "info", "exclude"), "utf8"), /^\/\.central\/$/m);
  assert.match(readFileSync(join(root, ".claude", "local", "settings.md"), "utf8"), /## tmux-central/);
  assert.equal(t.display("#{window_name}", centralPane), "◆ central");
});

test("spawn cria aba nomeada, status renomeia, mensagens e kill", async () => {
  const a = agents.spawnAgent(dir, { prompt: "faça X", ticket: "TG-123", description: "corrige login", cli: FAKE });
  assert.equal(a.id, "a1");
  assert.equal(t.display("#{window_name}", a.windowId), "○ [#1] TG-123");
  assert.ok(await waitFor(() => t.capture(a.paneId).includes("faça X")), "prompt chegou");

  agents.setStatus(dir, "a1", "working");
  assert.equal(t.display("#{window_name}", a.windowId), "● [#1] TG-123");

  // Trabalhando + CLI claude = fila; simulamos mudando a cli no estado.
  const { withState } = await import("../src/core/state.ts");
  withState(dir, (s) => {
    s.agents[0].cli = "claude";
  });
  const queued = agents.sendMessage(dir, "central", "a1", "mensagem na fila");
  assert.equal(queued.delivered, false);
  assert.equal(pending(dir, "a1").length, 1);

  // Hook Stop entrega a fila como decision=block.
  const out = spawnSync(process.execPath, [CLI, "hook", "stop"], {
    input: "{}",
    encoding: "utf8",
    env: { ...process.env, CENTRAL_DIR: dir, CENTRAL_AGENT_ID: "a1" },
  });
  const decision = JSON.parse(out.stdout);
  assert.equal(decision.decision, "block");
  assert.match(decision.reason, /mensagem na fila/);
  assert.equal(pending(dir, "a1").length, 0);

  // Stop sem mensagens → ocioso (✓); agora a mensagem é colada na hora.
  spawnSync(process.execPath, [CLI, "hook", "stop"], {
    input: "{}",
    env: { ...process.env, CENTRAL_DIR: dir, CENTRAL_AGENT_ID: "a1" },
  });
  assert.equal(readState(dir).agents[0].status, "idle");
  assert.ok(t.display("#{window_name}", a.windowId).startsWith("✓ "));
  const direct = agents.sendMessage(dir, "central", "a1", "olá agente");
  assert.equal(direct.delivered, true);
  assert.ok(await waitFor(() => t.capture(a.paneId).includes("olá agente")), "mensagem colada no pane");

  // report done → task concluída e mensagem para a central (pane ocioso: colada).
  const msg = report(dir, "a1", "done", "feito: arquivo hello.txt");
  assert.match(msg, /entregue/);
  assert.equal(readState(dir).tasks[0].status, "done");
  assert.ok(await waitFor(() => t.capture(centralPane).includes("feito: arquivo hello.txt")));
  assert.match(statusLine(dir), /1✓/);

  assert.match(agents.killAgent(dir, "a1"), /encerrado/);
  assert.equal(t.listWindows().some((w) => w.windowId === a.windowId), false);
  assert.equal(agents.subcheck(dir)[0].status, "dead");
});

test("várias tasks no mesmo agente e subcheck detecta aba fechada", () => {
  const a = agents.spawnAgent(dir, { prompt: "p", ticket: "TG-456", title: "outra", cli: FAKE });
  const b = agents.spawnAgent(dir, { prompt: "p", taskIds: [2, 1], description: "junta", cli: FAKE });
  assert.equal(t.display("#{window_name}", b.windowId), "○ [#2 | #1] TG-456 | TG-123");
  t.killWindow(a.windowId);
  const check = agents.subcheck(dir);
  assert.equal(check.find((x) => x.id === a.id)?.status, "dead");
  agents.killAgent(dir, b.id);
});

test("worktree por agente", () => {
  const a = agents.spawnAgent(dir, { prompt: "p", ticket: "TG-789", cli: FAKE, worktree: true });
  assert.ok(a.worktree);
  assert.ok(existsSync(a.worktree!.path));
  assert.equal(a.worktree!.branch, "central/tg-789");
  assert.ok(existsSync(join(dir, "agents", a.id, "mcp.json")));
  assert.match(agents.killAgent(dir, a.id, { removeWorktree: true }), /removido/);
  assert.equal(existsSync(a.worktree!.path), false);
});

test("processos com logs e locks", async () => {
  procs.startProc(dir, { name: "web", command: "echo servidor-no-ar; sleep 30" });
  assert.ok(await waitFor(() => procs.procLogs(dir, "web", 20).includes("servidor-no-ar")));
  assert.equal(procs.listProcs(dir)[0].alive, true);
  procs.stopProc(dir, "web");
  assert.equal(procs.listProcs(dir).length, 0);

  assert.equal(locks.acquireLock(dir, "db", "a1").ok, true);
  assert.equal(locks.acquireLock(dir, "db", "a2").ok, false);
  assert.match(locks.releaseLock(dir, "db", "a2"), /pertence/);
  assert.match(locks.releaseLock(dir, "db", "a1"), /liberado/);
});

test("exited (CLI saiu) marca o agente como morto", async () => {
  const a = agents.spawnAgent(dir, { prompt: "p", title: "curto", cli: "true" });
  assert.ok(await waitFor(() => readState(dir).agents.find((x) => x.id === a.id)?.status === "dead"));
  assert.ok(await waitFor(() => t.display("#{window_name}", a.windowId).startsWith("✗")));
  agents.killAgent(dir, a.id);
});

test("pick lista só abas vivas e falha claro sem sessão", async () => {
  const a = agents.spawnAgent(dir, { prompt: "p", title: "picker", cli: FAKE });
  procs.startProc(dir, { name: "api", command: "sleep 30" });
  const proc = readState(dir).processes.find((p) => p.name === "api")!;
  const labels = () => pickRows(dir).map((r) => r.split("\t"));
  const rows = labels();
  assert.deepEqual(rows[0], [t.display("#{window_id}", centralPane), "◆ central"]);
  assert.ok(rows.some(([w, l]) => w === a.windowId && l.endsWith(`(${a.id})`)));
  assert.ok(rows.some(([w, l]) => w === proc.windowId && l === "⚙ api  sleep 30"));

  t.killWindow(proc.windowId);
  t.killWindow(a.windowId);
  assert.deepEqual(labels().map(([, l]) => l), ["◆ central"]);

  const out = spawnSync(process.execPath, [CLI, "pick", "nao-existe"], { encoding: "utf8", env: process.env });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /Sessão do tmux não encontrada: nao-existe/);
  procs.stopProc(dir, "api");
});

function hook(event: string, agentId: string, payload: Record<string, unknown>) {
  const out = spawnSync(process.execPath, [CLI, "hook", event], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CENTRAL_DIR: dir, CENTRAL_AGENT_ID: agentId },
  });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

test("perguntas, plano e fim de turno avisam a central", async () => {
  const { pending: pend, takePending } = await import("../src/core/inbox.ts");
  const { withState } = await import("../src/core/state.ts");
  // Central ocupada: os avisos ficam na fila dela para conferirmos o texto.
  withState(dir, (s) => {
    s.central!.status = "working";
  });
  takePending(dir, "central");
  const a = agents.spawnAgent(dir, { prompt: "p", title: "plano", cli: FAKE });
  withState(dir, (s) => {
    s.agents.find((x) => x.id === a.id)!.cli = "claude";
  });

  hook("ask", a.id, {
    tool_name: "AskUserQuestion",
    tool_use_id: "q1",
    tool_input: { questions: [{ header: "Tipos", question: "Só inteiros?", options: [{ label: "Sim" }, { label: "Não" }] }] },
  });
  assert.equal(readState(dir).agents.find((x) => x.id === a.id)!.status, "waiting");
  let msgs = takePending(dir, "central");
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].body, /❓ PERGUNTAS[\s\S]*Só inteiros\?[\s\S]*- Não/);

  // Permissão disparada pelo mesmo diálogo não duplica o aviso; ferramenta paralela não tira o "?".
  hook("waiting", a.id, { notification_type: "permission_prompt", message: "Claude needs your permission" });
  hook("posttool", a.id, { tool_name: "ToolSearch", tool_use_id: "x" });
  assert.equal(pend(dir, "central").length, 0);
  assert.equal(readState(dir).agents.find((x) => x.id === a.id)!.status, "waiting");
  hook("posttool", a.id, { tool_name: "AskUserQuestion", tool_use_id: "q1" });
  assert.equal(readState(dir).agents.find((x) => x.id === a.id)!.status, "working");

  hook("ask", a.id, { tool_name: "ExitPlanMode", tool_use_id: "p1", tool_input: { plan: "# Plano X\n- passo 1" } });
  msgs = takePending(dir, "central");
  assert.match(msgs[0].body, /📋 PLANO PARA APROVAÇÃO[\s\S]*# Plano X/);
  assert.equal(readFileSync(join(dir, "agents", a.id, "plan.md"), "utf8"), "# Plano X\n- passo 1");

  hook("stop", a.id, { last_assistant_message: "Terminei a parte 1, sigo?" });
  msgs = takePending(dir, "central");
  assert.match(msgs[0].body, /💬 FIM DE TURNO[\s\S]*Terminei a parte 1, sigo\?/);
  assert.equal(readState(dir).agents.find((x) => x.id === a.id)!.pendingAsk, undefined);

  // Depois de um report done, o fim de turno não gera aviso repetido.
  report(dir, a.id, "done", "pronto");
  takePending(dir, "central");
  hook("stop", a.id, { last_assistant_message: "pronto" });
  assert.equal(pend(dir, "central").length, 0);

  // Permissão fora de pergunta/plano avisa.
  hook("prompt", a.id, {});
  hook("waiting", a.id, { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
  assert.match(takePending(dir, "central")[0].body, /⏸ PERMISSÃO[\s\S]*Bash/);
  agents.killAgent(dir, a.id);
  withState(dir, (s) => {
    s.central!.status = "idle";
  });
});

test("agent_plan_decision navega no diálogo e envia o feedback", async () => {
  const { planDecision } = await import("../src/core/attention.ts");
  const dialog = [
    "Would you like to proceed?",
    "❯ 1. Yes, and use auto mode",
    "  2. Yes, manually approve edits",
    "  3. Tell Claude what to change",
  ].join("\\n");
  const a = agents.spawnAgent(dir, { prompt: "p", title: "dialogo", cli: `bash -c 'printf "${dialog}\\n"; exec cat -v' fake` });
  assert.ok(await waitFor(() => t.capture(a.paneId).includes("Tell Claude what to change")));
  assert.throws(() => planDecision(dir, "a999", "approve"), /não existe/);
  assert.match(planDecision(dir, a.id, "change", "use one-liner\ne sem docstring"), /Feedback enviado/);
  // Down Down (setas viram ^[[B no cat -v) + texto numa linha só.
  assert.ok(await waitFor(() => /\^\[\[B\^\[\[Buse one-liner e sem docstring/.test(t.capture(a.paneId))));
  assert.throws(() => planDecision(dir, a.id, "change"), /feedback/);
  agents.killAgent(dir, a.id);
});
