import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Socket alternativo (usado nos testes): CENTRAL_TMUX_SOCKET=nome → `tmux -L nome`. */
function base(): string[] {
  const socket = process.env.CENTRAL_TMUX_SOCKET;
  return socket ? ["-L", socket] : [];
}

export function tmux(args: string[], input?: string): string {
  return execFileSync("tmux", [...base(), ...args], {
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  }).replace(/\n$/, "");
}

export function tmuxOk(args: string[]): boolean {
  try {
    tmux(args);
    return true;
  } catch {
    return false;
  }
}

export const insideTmux = () => Boolean(process.env.TMUX) || Boolean(process.env.CENTRAL_TMUX_SOCKET);

export function currentPane(): string | undefined {
  return process.env.TMUX_PANE || undefined;
}

export function display(format: string, target?: string): string {
  return tmux(["display-message", "-p", ...(target ? ["-t", target] : []), format]);
}

export interface WindowInfo {
  windowId: string;
  paneId: string;
  session: string;
  name: string;
  dead: boolean;
  command: string;
}

export function listWindows(): WindowInfo[] {
  let out: string;
  try {
    out = tmux([
      "list-panes",
      "-a",
      "-F",
      "#{window_id}\t#{pane_id}\t#{session_name}\t#{window_name}\t#{pane_dead}\t#{pane_current_command}",
    ]);
  } catch {
    return [];
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [windowId, paneId, session, name, dead, command] = line.split("\t");
      return { windowId, paneId, session, name, dead: dead === "1", command };
    });
}

export function newWindow(opts: {
  session: string;
  name: string;
  cwd: string;
  env: Record<string, string>;
  command: string;
}): { windowId: string; paneId: string } {
  const envArgs = Object.entries(opts.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const out = tmux([
    "new-window",
    "-d",
    "-P",
    "-F",
    "#{window_id} #{pane_id}",
    "-t",
    `${opts.session}:`,
    "-n",
    opts.name,
    "-c",
    opts.cwd,
    ...envArgs,
    opts.command,
  ]);
  const [windowId, paneId] = out.trim().split(" ");
  lockName(windowId);
  return { windowId, paneId };
}

/** Impede que o tmux ou o programa troquem o nome da aba. */
export function lockName(windowId: string) {
  tmux(["set-option", "-w", "-t", windowId, "automatic-rename", "off"]);
  tmux(["set-option", "-w", "-t", windowId, "allow-rename", "off"]);
}

export function renameWindow(windowId: string, name: string) {
  tmuxOk(["rename-window", "-t", windowId, name]);
}

export function capture(paneId: string, lines = 60): string {
  return tmux(["capture-pane", "-p", "-J", "-t", paneId, "-S", `-${lines}`]).replace(/\s+$/, "");
}

export function outputHash(paneId: string): string | undefined {
  try {
    return createHash("sha1").update(capture(paneId, 40)).digest("hex");
  } catch {
    return undefined;
  }
}

const sleepSync = (ms: number) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Cola texto (multilinha) no pane com bracketed paste e envia Enter. */
export function pasteAndSubmit(paneId: string, text: string) {
  const buffer = `central-${process.pid}-${Date.now()}`;
  tmux(["load-buffer", "-b", buffer, "-"], text);
  tmux(["paste-buffer", "-p", "-d", "-b", buffer, "-t", paneId]);
  sleepSync(250);
  tmux(["send-keys", "-t", paneId, "Enter"]);
}

export function killWindow(windowId: string) {
  tmuxOk(["kill-window", "-t", windowId]);
}

export function focusWindow(windowId: string) {
  const session = display("#{session_name}", windowId);
  if (process.env.TMUX) tmuxOk(["switch-client", "-t", session]);
  tmux(["select-window", "-t", windowId]);
}

export function refreshStatus() {
  tmuxOk(["refresh-client", "-S"]);
}

export function sessionExists(name: string) {
  return tmuxOk(["has-session", "-t", `=${name}`]);
}

export function setSessionEnv(session: string, key: string, value: string) {
  tmuxOk(["set-environment", "-t", session, key, value]);
}

export function getSessionEnv(session: string, key: string): string | undefined {
  try {
    const line = tmux(["show-environment", "-t", session, key]);
    const idx = line.indexOf("=");
    return idx > 0 ? line.slice(idx + 1) : undefined;
  } catch {
    return undefined;
  }
}
