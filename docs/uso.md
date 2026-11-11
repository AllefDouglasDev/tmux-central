# Uso

## Primeira vez num projeto

```sh
cd meu-projeto
central init
```

O `central init` cria (ou reaproveita) a sessão do tmux com o nome do projeto, abre o Claude Code como **central** e, na primeira vez, roda `central setup`, que:

- cria `.central/` (estado, inbox, notas, logs, `config.json`) e o adiciona a `.git/info/exclude`;
- registra o MCP `tmux-central` com `claude mcp add --scope local`, só para você e sem nada versionado;
- grava em `.claude/local/settings.md` a regra "subagentes só via `agent_spawn`".

A central sobe com `--disallowedTools Agent Task`, então não consegue criar subagentes ocultos. Se você já está num Claude aberto dentro do tmux, `/central:init` faz o mesmo papel, mas apenas pela regra, sem o bloqueio da ferramenta. Um MCP registrado no meio de uma sessão só carrega quando o Claude reinicia: nesse caso, saia e rode `central init`.

## Trabalhando com a central

Converse com a central normalmente:

> Crie um subagente para o TG-123 que implemente o endpoint de exportação em CSV, com testes.

Ela registra a task (`task_create`), cria o subagente (`agent_spawn`) e uma nova aba aparece:

```
◆ central   ● [#1] TG-123   ? [#2 | #3] TG-456 | TG-457   ✓ [#4] docs da api   ⚙ web      ◆ 1● 1? 1✓ 1⚙ 14:02
```

| Ícone | Significado |
|---|---|
| `◆` | a central |
| `○` | iniciando (ou parado no diálogo de confiança da pasta) |
| `●` | trabalhando |
| `?` | esperando você (permissão, pergunta ou plano) |
| `✓` | terminou o turno ou relatou `done` |
| `!` | relatou `blocked` |
| `✗` | a CLI saiu ou a aba foi fechada |
| `⚙` | processo gerenciado (dev server, watcher) |

A aba se chama `[#ids] tickets` quando há ticket, ou `[#id] descrição` quando não há. Você pode entrar em qualquer aba e falar direto com o subagente.

### O que chega à central sozinho

Os hooks avisam a central sem depender de o subagente lembrar:

| Aviso | Quando | O que a central faz |
|---|---|---|
| `📋 PLANO PARA APROVAÇÃO` | o subagente chama ExitPlanMode | resume o plano e pergunta se você aprova; responde com `agent_plan_decision` |
| `❓ PERGUNTAS` | o subagente usa AskUserQuestion | mostra as perguntas e diz em qual aba responder |
| `⏸ PERMISSÃO` | o subagente para pedindo permissão | diz qual aba precisa de você |
| `💬 FIM DE TURNO` | o subagente termina um turno sem `report` | resume a última mensagem dele |
| `✓ concluído` / `! bloqueado` | o subagente chama `report` | resume o relato ou o bloqueio |

O plano completo fica em `.central/agents/aN/plan.md`. Para responder pelo terminal: `central plan a1 approve`, `central plan a1 approve_manual` ou `central plan a1 change "use a tabela existente"`.

### Mensagens

A central fala com um subagente com `agent_send` (ou `/central:send a1 …`, ou `central send a1 "…"`). Se o destino está ocioso, a mensagem é colada na aba na hora; se está trabalhando, ela espera o fim do turno e o hook `Stop` a entrega. O Claude Code mostra essa entrega como "Stop hook error", mas é o comportamento esperado.

### Worktrees

Quando dois subagentes podem editar os mesmos arquivos, peça `--worktree` (ou `worktree: true`). O subagente trabalha num `git worktree` em `../<projeto>-worktrees/aN`, numa branch `central/<ticket>`. Para encerrar e apagar o worktree: `central kill a1 --remove-worktree` (falha de propósito se houver mudanças não commitadas).

### Recursos compartilhados

- **Locks**: `lock_acquire`/`lock_release` para migrations, portas, banco. `central locks` lista; `central locks release <nome>` força a liberação.
- **Notas**: `note_write`/`note_read` gravam markdown em `.central/notes/` para contexto comum. `central notes [nome]` lê.
- **Processos**: `proc_start web npm run dev` sobe o processo numa aba `⚙` com auto-restart; `proc_logs` lê a saída. `central proc up` sobe os processos do `config.json`.

### Outras CLIs

`--cli codex` (ou qualquer comando que aceite o prompt como argumento) abre o subagente com outra CLI. Ele recebe o papel e o prompt como argumento; sem hooks, o status vem de a saída da aba mudar ou não.

## Comandos do Claude

Instalados pelo `install.sh` em `~/.claude/commands/central/`. O conteúdo completo está em [comandos-claude.md](comandos-claude.md).

| Comando | O que faz |
|---|---|
| `/central:init [instrução]` | torna a sessão atual a central e, opcionalmente, já age na instrução |
| `/central:spawn <trabalho> [TG-1] [#2] [--worktree] [--cli x]` | delega trabalho a um novo subagente |
| `/central:subcheck [--lines N] [--all]` | status de todos os subagentes |
| `/central:send <aN> <mensagem>` | mensagem para um subagente |
| `/central:tasks [add <título> [TG-1] \| <#id> <status\|comentário>]` | lista, cria ou atualiza tasks locais |
| `/central:kill <aN> [--remove-worktree]` | encerra um subagente |

## CLI

```text
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
  central plan <aN> approve|approve_manual|change ["feedback"]
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
```

Argumentos depois de `central init --` vão para o Claude da central, por exemplo `central init -- --model opus`.

## Ferramentas do MCP

| Ferramenta | Quem tem | O que faz |
|---|---|---|
| `central_register` | central | registra o pane atual como central |
| `task_create` | central | cria uma task local `#N`, com ticket opcional |
| `agent_spawn` | central | cria um subagente numa nova aba (`prompt`, `task_ids`, `ticket`, `title`, `description`, `worktree`, `cli`, `permission_mode`) |
| `subcheck` | central | status de todos os subagentes |
| `agent_send` | central | mensagem para um subagente |
| `agent_read_output` | central | últimas linhas da aba de um subagente |
| `agent_plan_decision` | central | `approve`, `approve_manual` ou `change` com feedback |
| `agent_focus` | central | leva você para a aba de um subagente |
| `agent_kill` | central | encerra um subagente (e o worktree, se pedido) |
| `report` | subagente | relata `progress`, `blocked` ou `done` |
| `message_central` | subagente | mensagem livre para a central |
| `task_list`, `task_update` | ambos | lê e atualiza tasks |
| `inbox_read` | ambos | lê as mensagens pendentes |
| `note_write`, `note_read` | ambos | notas compartilhadas |
| `lock_acquire`, `lock_release`, `lock_list` | ambos | locks de recursos |
| `proc_start`, `proc_stop`, `proc_restart`, `proc_list`, `proc_logs` | ambos | processos gerenciados |
