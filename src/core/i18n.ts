import { loadConfig } from "./config.ts";

export type Lang = "pt" | "en";

/** Textos que aparecem na tela da central e dos subagentes. */
const TEXTS = {
  pt: {
    cut: "… (cortado)",
    multiSelect: " (várias opções)",
    planTitle: (who: string, tab: string) => `📋 PLANO PARA APROVAÇÃO — ${who} (aba "${tab}")`,
    planWaiting: "O subagente terminou o plano e está parado esperando aprovação.",
    planHowTo: "Resuma o plano para o usuário e pergunte se aprova ou o que mudar; depois use agent_plan_decision.",
    planFile: (file: string, original?: string) => `Plano completo: ${file}${original ? ` (original: ${original})` : ""}`,
    planEmpty: "(plano vazio)",
    questionsTitle: (who: string, tab: string) => `❓ PERGUNTAS — ${who} (aba "${tab}")`,
    questionsWaiting: "O subagente está parado esperando respostas, que o usuário dá na própria aba (Ctrl-s a ou agent_focus).",
    permission: (who: string, tab: string, message?: string) =>
      `⏸ PERMISSÃO — ${who} (aba "${tab}") está parado pedindo permissão${message ? `: ${message}` : ""}. O usuário aprova na aba.`,
    turnEnd: (who: string, tab: string) => `💬 FIM DE TURNO — ${who} (aba "${tab}") parou sem report e aguarda.`,
    lastMessage: "Última mensagem dele:",
    noText: "(sem texto)",
    reportHeader: { done: "✓ concluído", blocked: "! bloqueado", progress: "● progresso" },
    reportDelivered: "Relato entregue à central.",
    reportQueued: "Relato registrado; a central recebe quando terminar o turno atual.",
    newMessages: "Novas mensagens chegaram pelo tmux-central:",
  },
  en: {
    cut: "… (truncated)",
    multiSelect: " (multiple choice)",
    planTitle: (who: string, tab: string) => `📋 PLAN FOR APPROVAL — ${who} (tab "${tab}")`,
    planWaiting: "The subagent finished its plan and is waiting for approval.",
    planHowTo: "Summarize the plan for the user and ask whether to approve or what to change; then use agent_plan_decision.",
    planFile: (file: string, original?: string) => `Full plan: ${file}${original ? ` (original: ${original})` : ""}`,
    planEmpty: "(empty plan)",
    questionsTitle: (who: string, tab: string) => `❓ QUESTIONS — ${who} (tab "${tab}")`,
    questionsWaiting: "The subagent is waiting for answers, which the user gives in its own tab (Ctrl-s a or agent_focus).",
    permission: (who: string, tab: string, message?: string) =>
      `⏸ PERMISSION — ${who} (tab "${tab}") is waiting for permission${message ? `: ${message}` : ""}. The user approves it in the tab.`,
    turnEnd: (who: string, tab: string) => `💬 TURN ENDED — ${who} (tab "${tab}") stopped without a report and is waiting.`,
    lastMessage: "Its last message:",
    noText: "(no text)",
    reportHeader: { done: "✓ done", blocked: "! blocked", progress: "● progress" },
    reportDelivered: "Report delivered to the central.",
    reportQueued: "Report saved; the central gets it when its current turn ends.",
    newMessages: "New messages arrived through tmux-central:",
  },
} as const;

export function langOf(dir: string): Lang {
  return loadConfig(dir).lang === "en" ? "en" : "pt";
}

export function texts(dir: string) {
  return TEXTS[langOf(dir)];
}
