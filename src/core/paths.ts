import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export const DIR_NAME = ".central";

/** Procura `.central/` subindo a partir de `start`. */
export function findCentralDir(start = process.cwd()): string | null {
  if (process.env.CENTRAL_DIR && existsSync(process.env.CENTRAL_DIR)) {
    return resolve(process.env.CENTRAL_DIR);
  }
  let dir = resolve(start);
  while (true) {
    const candidate = join(dir, DIR_NAME);
    if (existsSync(join(candidate, "state.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Raiz do projeto: o topo do repositório git, ou a pasta atual. */
export function projectRoot(start = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return resolve(start);
  }
}

export function requireCentralDir(start = process.cwd()): string {
  const dir = findCentralDir(start);
  if (!dir) {
    throw new Error(
      "Este projeto ainda não tem a central configurada. Rode `central setup` (ou `central init`) na raiz do projeto.",
    );
  }
  return dir;
}

export const paths = (dir: string) => ({
  state: join(dir, "state.json"),
  lock: join(dir, "state.lock"),
  config: join(dir, "config.json"),
  inbox: (who: string) => join(dir, "inbox", who),
  inboxRead: (who: string) => join(dir, "inbox", who, "read"),
  status: (who: string) => join(dir, "status", who),
  centralPane: join(dir, "central.pane"),
  agentDir: (id: string) => join(dir, "agents", id),
  notes: join(dir, "notes"),
  logs: join(dir, "logs"),
});
