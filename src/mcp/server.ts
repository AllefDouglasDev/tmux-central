import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as agents from "../core/agents.ts";
import { formatMessages, takePending } from "../core/inbox.ts";
import { acquireLock, listLocks, releaseLock } from "../core/locks.ts";
import { listNotes, readNote, writeNote } from "../core/notes.ts";
import { findCentralDir, requireCentralDir } from "../core/paths.ts";
import { listProcs, procLogs, restartProc, startProc, stopProc } from "../core/procs.ts";
import { registerCentral, report, setup } from "../core/project.ts";
import { readState, withState } from "../core/state.ts";
import { createTask, formatTasks, updateTask } from "../core/tasks.ts";
import { currentPane } from "../core/tmux.ts";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): Result => ({ content: [{ type: "text", text }] });
const json = (data: unknown) => ok(JSON.stringify(data, null, 2));

function wrap<A>(fn: (args: A) => Result | Promise<Result>) {
  return async (args: A): Promise<Result> => {
    try {
      return await fn(args);
    } catch (err) {
      return { content: [{ type: "text", text: `Erro: ${(err as Error).message}` }], isError: true };
    }
  };
}

export async function runServer() {
  const agentId = process.env.CENTRAL_AGENT_ID;
  const role = agentId && agentId !== "central" ? "agent" : "central";
  const me = role === "agent" ? agentId! : "central";
  const dir = () => requireCentralDir();

  const server = new McpServer(
    { name: "tmux-central", version: "0.1.0" },
    {
      instructions:
        role === "central"
          ? "Orquestra subagentes LLM como abas visíveis do tmux. Use agent_spawn em vez da ferramenta Agent/Task. Se a central ainda não foi registrada neste pane, chame central_register."
          : `Você é o subagente ${me}. Use report para relatar progresso/conclusão à central e message_central para perguntas.`,
    },
  );

  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    schema: S,
    fn: (args: z.infer<z.ZodObject<S>>) => Result | Promise<Result>,
  ) => server.registerTool(name, { description, inputSchema: schema }, wrap(fn) as never);

  // ── Comuns ────────────────────────────────────────────────────────────
  tool("task_list", "Lista as tasks locais do projeto (#id, status, ticket, agente).", {
    status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
  }, ({ status }) => {
    const tasks = readState(dir()).tasks.filter((t) => !status || t.status === status);
    return ok(formatTasks(tasks));
  });

  tool("task_update", "Atualiza status/título/ticket de uma task e/ou adiciona um comentário.", {
    id: z.number().int(),
    status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
    title: z.string().optional(),
    ticket: z.string().optional(),
    comment: z.string().optional(),
  }, ({ id, ...patch }) => {
    const task = withState(dir(), (s) => {
      if (role === "agent") {
        const t = s.tasks.find((x) => x.id === id);
        if (t?.agentId !== me) throw new Error(`A task #${id} não é sua.`);
      }
      return updateTask(s, id, { ...patch, by: me });
    });
    if (task.agentId) {
      try {
        agents.renameAgentWindow(dir(), task.agentId);
      } catch {
        /* aba fechada */
      }
    }
    return ok(formatTasks([task]));
  });

  tool("inbox_read", "Lê (e marca como lidas) as mensagens pendentes para você.", {}, () => {
    const msgs = takePending(dir(), me);
    return ok(msgs.length ? formatMessages(msgs) : "Nenhuma mensagem pendente.");
  });

  tool("note_write", "Grava ou acrescenta numa nota markdown compartilhada (.central/notes).", {
    name: z.string(),
    content: z.string(),
    append: z.boolean().optional().describe("Acrescenta ao fim em vez de substituir."),
  }, ({ name, content, append }) => ok(writeNote(dir(), name, content, { append, by: me })));

  tool("note_read", "Lê uma nota compartilhada; sem nome, lista as notas.", {
    name: z.string().optional(),
  }, ({ name }) => ok(name ? readNote(dir(), name) : listNotes(dir()).join("\n") || "Nenhuma nota."));

  tool("lock_acquire", "Reserva um recurso compartilhado (ex.: migrations, porta 3000, banco).", {
    name: z.string(),
    ttl_seconds: z.number().int().positive().optional(),
    reason: z.string().optional(),
  }, ({ name, ttl_seconds, reason }) => {
    const r = acquireLock(dir(), name, me, ttl_seconds, reason);
    return { ...ok(r.message), isError: !r.ok };
  });

  tool("lock_release", "Libera um recurso reservado.", {
    name: z.string(),
    force: z.boolean().optional().describe("Só a central: libera mesmo sendo de outro dono."),
  }, ({ name, force }) => ok(releaseLock(dir(), name, me, role === "central" && Boolean(force))));

  tool("lock_list", "Lista os locks ativos.", {}, () => json(listLocks(dir())));

  tool("proc_start", "Sobe um processo (dev server, watcher) numa aba ⚙ própria, com auto-restart.", {
    name: z.string(),
    command: z.string(),
    cwd: z.string().optional().describe("Relativo à raiz do projeto."),
    restart: z.boolean().optional().describe("Reinicia ao sair (padrão true)."),
  }, (args) => ok(startProc(dir(), args)));

  tool("proc_stop", "Para um processo.", { name: z.string() }, ({ name }) => ok(stopProc(dir(), name)));
  tool("proc_restart", "Reinicia um processo.", { name: z.string() }, ({ name }) => ok(restartProc(dir(), name)));
  tool("proc_list", "Lista os processos e se estão vivos.", {}, () => json(listProcs(dir())));
  tool("proc_logs", "Últimas linhas da saída de um processo.", {
    name: z.string(),
    lines: z.number().int().positive().optional(),
    grep: z.string().optional().describe("Regex para filtrar linhas."),
  }, ({ name, lines, grep }) => ok(procLogs(dir(), name, lines, grep)));

  if (role === "agent") {
    // ── Subagente ───────────────────────────────────────────────────────
    tool("report", "Relata à central: progress (marco), blocked (precisa de decisão) ou done (resumo final).", {
      kind: z.enum(["progress", "done", "blocked"]),
      summary: z.string(),
      task_ids: z.array(z.number().int()).optional().describe("Padrão: todas as suas tasks."),
    }, ({ kind, summary, task_ids }) => ok(report(dir(), me, kind, summary, task_ids)));

    tool("message_central", "Envia uma mensagem livre à central.", { message: z.string() }, ({ message }) => {
      const r = agents.sendMessage(dir(), me, "central", message);
      return ok(r.delivered ? "Entregue." : "Na fila; a central recebe ao terminar o turno atual.");
    });
  } else {
    // ── Central ─────────────────────────────────────────────────────────
    tool("central_register", "Registra o pane atual do tmux como a central do projeto (cria .central/ se preciso).", {}, () => {
      const pane = currentPane();
      if (!pane) throw new Error("Este Claude não está rodando dentro do tmux.");
      const d = findCentralDir() ?? setup(process.cwd(), { mcp: false }).dir;
      return ok(registerCentral(d, pane));
    });

    tool("task_create", "Cria uma task local (#id) com ticket opcional (ex.: TG-123).", {
      title: z.string(),
      ticket: z.string().optional(),
      description: z.string().optional(),
    }, (args) => ok(formatTasks([withState(dir(), (s) => createTask(s, args))])));

    tool(
      "agent_spawn",
      "Cria um subagente numa nova aba do tmux, nomeada `[#ids] tickets || descrição`. Passe task_ids existentes, ou ticket/title para criar a task na hora. O prompt deve ser autossuficiente.",
      {
        prompt: z.string().describe("Instruções completas para o subagente."),
        task_ids: z.array(z.number().int()).optional(),
        ticket: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional().describe("Breve descrição para o nome da aba."),
        worktree: z.boolean().optional().describe("Trabalha num git worktree próprio."),
        cli: z.string().optional().describe("claude (padrão), codex ou outra CLI."),
        permission_mode: z
          .enum(["default", "acceptEdits", "plan", "bypassPermissions", "auto"])
          .optional()
          .describe("Padrão: auto (ou o permissionMode do .central/config.json)."),
      },
      (a) => {
        const agent = agents.spawnAgent(dir(), {
          prompt: a.prompt,
          taskIds: a.task_ids,
          ticket: a.ticket,
          title: a.title,
          description: a.description,
          worktree: a.worktree,
          cli: a.cli,
          permissionMode: a.permission_mode,
        });
        const s = readState(dir());
        return ok(
          `Subagente ${agent.id} criado na aba "${agents.agentWindowName(s, agent)}" (${agent.windowId}), cwd ${agent.cwd}.`,
        );
      },
    );

    tool("subcheck", "Status de todos os subagentes (reconcilia com o tmux).", {
      lines: z.number().int().nonnegative().optional().describe("Inclui as últimas N linhas de cada aba."),
      all: z.boolean().optional().describe("Inclui encerrados antigos."),
    }, ({ lines, all }) => json(agents.subcheck(dir(), { lines, all })));

    tool("agent_send", "Envia uma mensagem a um subagente (entregue na hora se ocioso, ou ao fim do turno).", {
      agent: z.string().describe("ex.: a1"),
      message: z.string(),
    }, ({ agent, message }) => {
      const r = agents.sendMessage(dir(), "central", agent, message);
      return ok(r.delivered ? `Entregue a ${agent}.` : `Na fila de ${agent} (${r.queued} pendente[s]); entrega ao fim do turno.`);
    });

    tool("agent_read_output", "Lê as últimas linhas da tela de um subagente.", {
      agent: z.string(),
      lines: z.number().int().positive().optional(),
    }, ({ agent, lines }) => ok(agents.readOutput(dir(), agent, lines)));

    tool("agent_focus", "Leva o usuário para a aba de um subagente (ou 'central').", { agent: z.string() }, ({ agent }) => {
      agents.focus(dir(), agent);
      return ok(`Foco em ${agent}.`);
    });

    tool("agent_kill", "Encerra um subagente e fecha a aba.", {
      agent: z.string(),
      remove_worktree: z.boolean().optional(),
    }, ({ agent, remove_worktree }) => ok(agents.killAgent(dir(), agent, { removeWorktree: remove_worktree })));
  }

  await server.connect(new StdioServerTransport());
}
