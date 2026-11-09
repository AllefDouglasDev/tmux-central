import { existsSync, readFileSync } from "node:fs";
import { paths } from "./paths.ts";

export interface ProcessConfig {
  command: string;
  cwd?: string;
  restart?: boolean;
}

export interface Config {
  agent: {
    /** CLI padrão dos subagentes: claude, codex ou qualquer comando que aceite o prompt como argumento. */
    cli: string;
    permissionMode: string;
    /** Bloqueia a ferramenta de subagente oculto (Agent/Task) nos subagentes. */
    blockHiddenSubagents: boolean;
    /** Argumentos extras passados à CLI do subagente. */
    extraArgs: string[];
  };
  central: {
    extraArgs: string[];
  };
  /** Pasta dos worktrees; `{root}` e `{name}` são substituídos. */
  worktreeDir: string;
  /** Processos que `central proc up` sobe. */
  processes: Record<string, ProcessConfig>;
}

export const DEFAULT_CONFIG: Config = {
  agent: {
    cli: "claude",
    permissionMode: "auto",
    blockHiddenSubagents: true,
    extraArgs: [],
  },
  central: { extraArgs: [] },
  worktreeDir: "{root}/../{name}-worktrees",
  processes: {},
};

export function loadConfig(dir: string): Config {
  const file = paths(dir).config;
  if (!existsSync(file)) return DEFAULT_CONFIG;
  const user = JSON.parse(readFileSync(file, "utf8")) as Partial<Config>;
  return {
    ...DEFAULT_CONFIG,
    ...user,
    agent: { ...DEFAULT_CONFIG.agent, ...user.agent },
    central: { ...DEFAULT_CONFIG.central, ...user.central },
    processes: { ...user.processes },
  };
}
