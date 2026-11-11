import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentWindowName, findAgent, sendMessage, setStatus } from "./agents.ts";
import { texts } from "./i18n.ts";
import { paths } from "./paths.ts";
import { type Agent, now, readState, withState } from "./state.ts";
import * as t from "./tmux.ts";

const ASK_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
const MAX_PLAN = 15_000;
const MAX_TURN = 3_000;

interface Question {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label?: string; description?: string }[];
}

const clip = (text: string, max: number, cut: string) => (text.length > max ? `${text.slice(0, max)}\n${cut}` : text);

function tabLabel(dir: string, agent: Agent) {
  return agentWindowName(readState(dir), agent).slice(2);
}

function formatQuestions(questions: Question[], multi: string) {
  return questions
    .map((q, i) => {
      const head = `${i + 1}. ${q.header ? `[${q.header}] ` : ""}${q.question ?? ""}${q.multiSelect ? multi : ""}`;
      const opts = (q.options ?? []).map((o) => `   - ${o.label}${o.description ? ` — ${o.description}` : ""}`);
      return [head, ...opts].join("\n");
    })
    .join("\n");
}

/** PreToolUse de AskUserQuestion/ExitPlanMode num subagente: avisa a central. */
export function onAsk(dir: string, who: string, toolName: string, toolInput: Record<string, unknown>, toolUseId?: string) {
  if (!ASK_TOOLS.has(toolName)) return;
  const kind = toolName === "ExitPlanMode" ? "plan" : "question";
  let planFile: string | undefined;
  if (kind === "plan") {
    planFile = join(paths(dir).agentDir(who), "plan.md");
    writeFileSync(planFile, String(toolInput.plan ?? ""));
  }
  const agent = withState(dir, (s) => {
    const a = findAgent(s, who);
    a.pendingAsk = { kind, toolUseId, at: now(), planFile };
    return structuredClone(a);
  });
  setStatus(dir, who, "waiting");

  const tab = tabLabel(dir, agent);
  const T = texts(dir);
  const body =
    kind === "plan"
      ? [
          T.planTitle(who, tab),
          T.planWaiting,
          T.planHowTo,
          T.planFile(planFile!, toolInput.planFilePath as string | undefined),
          "",
          clip(String(toolInput.plan ?? T.planEmpty), MAX_PLAN, T.cut),
        ].join("\n")
      : [
          T.questionsTitle(who, tab),
          T.questionsWaiting,
          "",
          formatQuestions((toolInput.questions as Question[]) ?? [], T.multiSelect),
        ].join("\n");
  sendMessage(dir, who, "central", body);
}

/**
 * Eventos de ferramenta. Enquanto há uma pergunta/plano pendente, só o
 * PostToolUse da própria ferramenta (resposta dada) reabre o status;
 * ferramentas paralelas não podem tirar a aba do "?".
 */
export function onTool(dir: string, who: string, phase: "pre" | "post", toolName?: string, toolUseId?: string) {
  if (toolName && ASK_TOOLS.has(toolName) && phase === "pre") return;
  if (who === "central") return setStatus(dir, who, "working", { soft: true });
  const s = readState(dir);
  const pendingAsk = s.agents.find((a) => a.id === who)?.pendingAsk;
  if (pendingAsk) {
    const answered = phase === "post" && (pendingAsk.toolUseId ? pendingAsk.toolUseId === toolUseId : ASK_TOOLS.has(toolName ?? ""));
    if (!answered) return;
    clearAsk(dir, who);
  }
  setStatus(dir, who, "working", { soft: true });
}

export function clearAsk(dir: string, who: string) {
  if (who === "central") return;
  withState(dir, (s) => {
    const a = s.agents.find((x) => x.id === who);
    if (a) delete a.pendingAsk;
  });
}

/** Notification de permissão: avisa a central, exceto quando já é uma pergunta/plano avisado. */
export function onPermission(dir: string, who: string, message?: string) {
  setStatus(dir, who, "waiting");
  if (who === "central") return;
  const agent = findAgent(readState(dir), who);
  if (agent.pendingAsk) return;
  sendMessage(
    dir,
    who,
    "central",
    texts(dir).permission(who, tabLabel(dir, agent), message),
  );
}

/** Fim de turno sem report: a central recebe a última mensagem do subagente. */
export function onTurnEnd(dir: string, who: string, lastMessage?: string) {
  if (who === "central") return;
  const before = findAgent(readState(dir), who);
  clearAsk(dir, who);
  setStatus(dir, who, "idle", { soft: true });
  if (before.status === "done" || before.status === "blocked") return; // já relatou
  const T = texts(dir);
  sendMessage(
    dir,
    who,
    "central",
    [T.turnEnd(who, tabLabel(dir, before)), T.lastMessage, "", clip(lastMessage?.trim() || T.noText, MAX_TURN, T.cut)].join("\n"),
  );
}

export type PlanAction = "approve" | "approve_manual" | "change";

/** Responde o diálogo "Would you like to proceed?" do plano na aba do subagente. */
export function planDecision(dir: string, who: string, action: PlanAction, feedback?: string) {
  const agent = findAgent(readState(dir), who);
  const screen = t.capture(agent.paneId, 60);
  if (!/Would you like to proceed/i.test(screen)) {
    throw new Error(`${who} não está com um plano aguardando aprovação na tela.`);
  }
  const lines = screen.split("\n");
  const options = lines
    .map((l) => /^\s*(❯)?\s*(\d)\.\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ cursor: Boolean(m![1]), n: Number(m![2]), label: m![3] }));
  if (!options.length) throw new Error("Não encontrei as opções do diálogo do plano.");
  const pick = (re: RegExp, fallback: number) => options.find((o) => re.test(o.label))?.n ?? fallback;
  const target =
    action === "approve" ? pick(/auto mode|auto-accept|Yes, and/i, 1)
    : action === "approve_manual" ? pick(/manually approve/i, 2)
    : pick(/Tell Claude|change/i, options.length);
  const current = options.find((o) => o.cursor)?.n ?? 1;
  const delta = target - current;
  for (let i = 0; i < Math.abs(delta); i++) t.tmux(["send-keys", "-t", agent.paneId, delta > 0 ? "Down" : "Up"]);
  if (action === "change") {
    if (!feedback?.trim()) throw new Error("Informe o feedback para o plano.");
    t.tmux(["send-keys", "-t", agent.paneId, "-l", feedback.replace(/\s*\n\s*/g, " ").trim()]);
  }
  t.tmux(["send-keys", "-t", agent.paneId, "Enter"]);
  clearAsk(dir, who);
  setStatus(dir, who, "working");
  return action === "change"
    ? `Feedback enviado a ${who}; ele vai revisar o plano.`
    : `Plano de ${who} aprovado (${action === "approve" ? "auto mode" : "aprovação manual de edições"}).`;
}
