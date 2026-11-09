#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import * as agents from "./core/agents.ts";
import { handleHook } from "./core/hooks.ts";
import { formatMessages, takePending } from "./core/inbox.ts";
import { listLocks, releaseLock } from "./core/locks.ts";
import { listNotes, readNote } from "./core/notes.ts";
import { requireCentralDir } from "./core/paths.ts";
import { listProcs, procLogs, procUp, restartProc, startProc, stopProc } from "./core/procs.ts";
import { dirForSession, init, registerCentral, setup, statusLine } from "./core/project.ts";
import { readState, withState } from "./core/state.ts";
import { createTask, formatTasks, updateTask } from "./core/tasks.ts";
import { STATUS_ICON } from "./core/naming.ts";
import * as t from "./core/tmux.ts";
import { centralCommand } from "./core/self.ts";

const HELP = `central — subagentes LLM como abas do tmux

Projeto
  central setup                 prepara o projeto (.central/, MCP local, regra no settings.md)
  central init [-- args]        abre/entra na sessão do projeto e inicia o Claude como central
  central init --no-claude      só registra o pane atual como central
  central register              registra o pane atual como central

Subagentes
  central spawn -p "prompt" [--ticket TG-1] [--title t] [--task 1,2] [--desc d] [--worktree] [--cli claude]
  central subcheck [--lines N] [--all] [--json]
  central send <aN|central> <mensagem...>
  central inbox [aN|central]    lê mensagens pendentes
  central out <aN> [--lines N]  últimas linhas da aba
  central focus <aN|central>
  central kill <aN> [--remove-worktree]
  central resume <aN>           reabre a sessão do Claude do subagente na aba dele
  central pick                  escolhe uma aba com fzf (use no popup do tmux)

Tasks
  central tasks                 lista
  central tasks add "título" [--ticket TG-1] [--desc d]
  central tasks set <id> [--status todo|doing|blocked|done] [--comment c]

Processos, locks e notas
  central proc start <nome> <comando...> [--cwd d] [--no-restart]
  central proc stop|restart|logs <nome> [--lines N]
  central proc list | central proc up
  central locks [release <nome>]
  central notes [nome]

Integração
  central status --tmux [--session S]   resumo para o status-right
  central hook <evento>                 usado pelos hooks do Claude Code
  central mcp                           servidor MCP (stdio)
`;

function opts(args: string[], options: ParseArgsOptionsConfig) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

function print(text: string) {
  if (text) process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

async function main(argv: string[]) {
  const [cmd = "help", ...rest] = argv;
  const dir = () => requireCentralDir();

  switch (cmd) {
    case "help":
    case "-h":
    case "--help":
      return print(HELP);

    case "mcp": {
      const { runServer } = await import("./mcp/server.ts");
      return runServer();
    }

    case "hook": {
      try {
        print(handleHook(rest[0] ?? ""));
      } catch (err) {
        process.stderr.write(`central hook: ${(err as Error).message}\n`);
      }
      return;
    }

    case "setup": {
      const r = setup();
      return print([`Projeto: ${r.root}`, ...r.log.map((l) => `  · ${l}`)].join("\n"));
    }

    case "init": {
      const sep = rest.indexOf("--");
      const own = sep >= 0 ? rest.slice(0, sep) : rest;
      const extra = sep >= 0 ? rest.slice(sep + 1) : [];
      const { values } = opts(own, { "no-claude": { type: "boolean" } });
      return init({ claude: !values["no-claude"], extraArgs: extra });
    }

    case "register": {
      const pane = t.currentPane();
      if (!pane) throw new Error("Rode dentro do tmux.");
      return print(registerCentral(dir(), pane));
    }

    case "spawn": {
      const { values } = opts(rest, {
        prompt: { type: "string", short: "p" },
        ticket: { type: "string" },
        title: { type: "string" },
        task: { type: "string" },
        desc: { type: "string" },
        worktree: { type: "boolean" },
        cli: { type: "string" },
        mode: { type: "string" },
      });
      if (!values.prompt) throw new Error("Informe o prompt com -p.");
      const a = agents.spawnAgent(dir(), {
        prompt: values.prompt as string,
        ticket: values.ticket as string | undefined,
        title: values.title as string | undefined,
        description: values.desc as string | undefined,
        taskIds: values.task ? String(values.task).split(",").map(Number) : undefined,
        worktree: Boolean(values.worktree),
        cli: values.cli as string | undefined,
        permissionMode: values.mode as string | undefined,
      });
      return print(`${a.id} → ${agents.agentWindowName(readState(dir()), a)}`);
    }

    case "subcheck": {
      const { values } = opts(rest, { lines: { type: "string" }, all: { type: "boolean" }, json: { type: "boolean" } });
      const list = agents.subcheck(dir(), { lines: values.lines ? Number(values.lines) : undefined, all: Boolean(values.all) });
      if (values.json) return print(JSON.stringify(list, null, 2));
      if (!list.length) return print("Nenhum subagente.");
      return print(
        list
          .map((a) => {
            const lines = [`${STATUS_ICON[a.status]} ${a.id}  ${a.status.padEnd(8)} ${a.window.slice(2)}`];
            if (a.lastReport) lines.push(`    └ ${a.lastReport.split("\n")[0]}`);
            if (a.pendingMessages) lines.push(`    ✉ ${a.pendingMessages} mensagem(ns) na fila`);
            if (a.tail) lines.push(a.tail.split("\n").map((l) => `    │ ${l}`).join("\n"));
            return lines.join("\n");
          })
          .join("\n"),
      );
    }

    case "send": {
      const [to, ...words] = rest;
      if (!to || !words.length) throw new Error("Uso: central send <aN|central> <mensagem>");
      const from = process.env.CENTRAL_AGENT_ID || "user";
      const r = agents.sendMessage(dir(), from, to, words.join(" "));
      return print(r.delivered ? "Entregue." : `Na fila (${r.queued}).`);
    }

    case "inbox": {
      const who = rest[0] || process.env.CENTRAL_AGENT_ID || "central";
      const msgs = takePending(dir(), who);
      return print(msgs.length ? formatMessages(msgs) : "Nenhuma mensagem pendente.");
    }

    case "out": {
      const { values, positionals } = opts(rest, { lines: { type: "string" } });
      return print(agents.readOutput(dir(), positionals[0], values.lines ? Number(values.lines) : 80));
    }

    case "focus":
      return agents.focus(dir(), rest[0]);

    case "kill": {
      const { values, positionals } = opts(rest, { "remove-worktree": { type: "boolean" } });
      return print(agents.killAgent(dir(), positionals[0], { removeWorktree: Boolean(values["remove-worktree"]) }));
    }

    case "resume": {
      const d = dir();
      const a = agents.findAgent(readState(d), rest[0]);
      if (!a.sessionId) throw new Error("Só subagentes do Claude podem ser retomados.");
      const windowAlive = t.listWindows().some((w) => w.paneId === a.paneId);
      const cmd = `cd '${a.cwd}' && claude --resume ${a.sessionId}`;
      if (windowAlive) t.pasteAndSubmit(a.paneId, cmd);
      else throw new Error(`A aba de ${a.id} foi fechada; rode no terminal: ${cmd}`);
      return print(`Retomando ${a.id}.`);
    }

    case "pick": {
      const d = dirForSession(rest[0]);
      if (!d) throw new Error("Nenhuma central neste projeto/sessão.");
      const s = readState(d);
      const rows: string[] = [];
      if (s.central) rows.push(`${s.central.windowId}\t◆ central`);
      for (const a of agents.subcheck(d)) {
        const ag = s.agents.find((x) => x.id === a.id)!;
        if (a.status !== "dead") rows.push(`${ag.windowId}\t${a.window}  (${a.id})`);
      }
      for (const p of s.processes) rows.push(`${p.windowId}\t⚙ ${p.name}  ${p.command}`);
      const r = spawnSync("fzf", ["--delimiter", "\t", "--with-nth", "2", "--prompt", "central> ", "--reverse"], {
        input: rows.join("\n"),
        stdio: ["pipe", "pipe", "inherit"],
        encoding: "utf8",
      });
      const choice = r.stdout?.trim();
      if (choice) t.focusWindow(choice.split("\t")[0]);
      return;
    }

    case "tasks": {
      const [sub, ...args] = rest;
      if (!sub || sub === "list") return print(formatTasks(readState(dir()).tasks));
      if (sub === "add") {
        const { values, positionals } = opts(args, { ticket: { type: "string" }, desc: { type: "string" } });
        const task = withState(dir(), (s) =>
          createTask(s, { title: positionals.join(" "), ticket: values.ticket as string, description: values.desc as string }),
        );
        return print(formatTasks([task]));
      }
      if (sub === "set") {
        const { values, positionals } = opts(args, { status: { type: "string" }, comment: { type: "string" } });
        const task = withState(dir(), (s) =>
          updateTask(s, Number(positionals[0]), { status: values.status as never, comment: values.comment as string, by: "user" }),
        );
        if (task.agentId) agents.renameAgentWindow(dir(), task.agentId);
        return print(formatTasks([task]));
      }
      throw new Error(`Subcomando desconhecido: tasks ${sub}`);
    }

    case "proc": {
      const [sub, ...args] = rest;
      const d = dir();
      switch (sub) {
        case "start": {
          const { values, positionals } = opts(args, { cwd: { type: "string" }, "no-restart": { type: "boolean" } });
          const [name, ...command] = positionals;
          return print(startProc(d, { name, command: command.join(" "), cwd: values.cwd as string, restart: !values["no-restart"] }));
        }
        case "stop":
          return print(stopProc(d, args[0]));
        case "restart":
          return print(restartProc(d, args[0]));
        case "logs": {
          const { values, positionals } = opts(args, { lines: { type: "string" }, grep: { type: "string" } });
          return print(procLogs(d, positionals[0], values.lines ? Number(values.lines) : 100, values.grep as string));
        }
        case "up":
          return print(procUp(d));
        case "list":
        case undefined:
          return print(
            listProcs(d)
              .map((p) => `${p.alive ? "●" : "✗"} ${p.name}  ${p.command}  (${p.cwd})`)
              .join("\n") || "Nenhum processo.",
          );
        default:
          throw new Error(`Subcomando desconhecido: proc ${sub}`);
      }
    }

    case "locks": {
      if (rest[0] === "release") return print(releaseLock(dir(), rest[1], "user", true));
      const locks = listLocks(dir());
      return print(
        Object.entries(locks)
          .map(([k, l]) => `${k}: ${l.owner} até ${l.expiresAt}${l.reason ? ` — ${l.reason}` : ""}`)
          .join("\n") || "Nenhum lock.",
      );
    }

    case "notes":
      return print(rest[0] ? readNote(dir(), rest[0]) : listNotes(dir()).join("\n") || "Nenhuma nota.");

    case "status": {
      const { values } = opts(rest, { tmux: { type: "boolean" }, session: { type: "string" } });
      try {
        return print(statusLine(dirForSession(values.session as string | undefined)));
      } catch {
        return;
      }
    }

    case "self":
      return print(centralCommand().join(" "));

    default:
      throw new Error(`Comando desconhecido: ${cmd}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`✗ ${(err as Error).message}\n`);
  process.exit(1);
});
