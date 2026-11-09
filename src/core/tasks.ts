import { type State, type Task, type TaskStatus, now } from "./state.ts";

export function createTask(
  s: State,
  input: { ticket?: string; title: string; description?: string },
): Task {
  const task: Task = {
    id: s.nextTaskId++,
    ticket: input.ticket?.trim() || undefined,
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    status: "todo",
    comments: [],
    createdAt: now(),
    updatedAt: now(),
  };
  s.tasks.push(task);
  return task;
}

export function updateTask(
  s: State,
  id: number,
  patch: { status?: TaskStatus; title?: string; ticket?: string; comment?: string; by?: string },
): Task {
  const task = s.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task #${id} não existe.`);
  if (patch.status) task.status = patch.status;
  if (patch.title) task.title = patch.title;
  if (patch.ticket) task.ticket = patch.ticket;
  if (patch.comment) task.comments.push({ at: now(), by: patch.by ?? "central", text: patch.comment });
  task.updatedAt = now();
  return task;
}

export function formatTasks(tasks: Task[]): string {
  if (!tasks.length) return "Nenhuma task.";
  return tasks
    .map((t) => {
      const head = `#${t.id} [${t.status}]${t.ticket ? ` ${t.ticket}` : ""} ${t.title}${t.agentId ? ` → ${t.agentId}` : ""}`;
      const last = t.comments.at(-1);
      return last ? `${head}\n    └ ${last.by}: ${last.text}` : head;
    })
    .join("\n");
}
