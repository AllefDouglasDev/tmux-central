# tmux-central

Subagentes LLM como **abas visíveis do tmux**, coordenados por uma **central** (uma sessão do Claude Code) através de um MCP. Em vez de subagentes ocultos em background, cada subagente é uma janela do tmux onde você pode entrar e conversar direto.

```
◆ central   ● [#1] TG-123 || corrige login   ? [#2 | #3] TG-456 | TG-457 || api   ✓ [#4] || docs   ⚙ web      ◆ 1● 1? 1✓ 1⚙ 14:02
```

| Ícone | Significado |
|---|---|
| `○` | iniciando (ou parado no diálogo de confiança da pasta) |
| `●` | trabalhando |
| `?` | esperando você (permissão ou pergunta) |
| `✓` | terminou o turno ou relatou `done` |
| `!` | relatou `blocked` |
| `✗` | a CLI saiu ou a aba foi fechada |

## Instalação

```sh
./install.sh
```

Confere `tmux`, `node ≥ 23.6`, `claude`, `fzf` e `jq`; instala as dependências; liga o `central` do dotfiles, o hook `~/.claude/hooks/central.sh` e os comandos `/central:*`; e garante os hooks no `~/.claude/settings.json`. Não há build: o Node executa o TypeScript direto.

## Uso

Num projeto qualquer:

```sh
central init          # cria/entra na sessão tmux do projeto e abre o Claude como central
```

Na primeira vez ele roda `central setup`, que:
- cria `.central/` (estado, inbox, notas, logs) e o põe em `.git/info/exclude`;
- registra o MCP `tmux-central` com `claude mcp add --scope local` (só para você, nada versionado);
- grava a regra "subagentes só via `agent_spawn`" em `.claude/local/settings.md`.

A central sobe com `--disallowedTools Agent Task`, então não consegue criar subagentes ocultos. Já dentro de um Claude no tmux, `/central:init` faz o mesmo papel (sem o bloqueio da ferramenta, só pela regra).

Depois é conversar com a central: "crie um subagente para o TG-123 que…". Ela usa `task_create` e `agent_spawn`, e a aba aparece.

### Comandos do Claude

| Comando | O que faz |
|---|---|
| `/central:init` | torna a sessão atual a central |
| `/central:spawn` | delega trabalho a um novo subagente |
| `/central:subcheck` | status de todos os subagentes |
| `/central:send a1 …` | mensagem para um subagente |
| `/central:tasks` | lista/cria/atualiza tasks locais |
| `/central:kill a1` | encerra um subagente |

### CLI

`central help` lista tudo. Os principais:

```sh
central spawn -p "prompt" --ticket TG-1 --desc "breve" [--task 1,2] [--worktree] [--cli codex]
central subcheck [--lines 20]
central send a1 "mensagem"       # também: central send central "…"
central out a1                   # últimas linhas da aba
central focus a1 | central pick  # pick: fzf com todas as abas (Ctrl-s a no tmux)
central kill a1 [--remove-worktree]
central plan a1 approve          # ou approve_manual / change "o que mudar"
central resume a1                # reabre a sessão do Claude do subagente
central tasks [add|set]
central proc start web npm run dev | proc logs web | proc up
central locks | central notes
```

## Como funciona

- **Estado**: `.central/state.json` (tasks, agentes, processos, locks) com lock entre processos. O tmux é a fonte da verdade das abas; `subcheck` reconcilia.
- **Status**: hooks globais do Claude Code chamam `~/.claude/hooks/central.sh`, que só age em subagentes (`CENTRAL_AGENT_ID` no env) ou no pane registrado como central; nas demais sessões sai na hora. `UserPromptSubmit`/`PreToolUse` → `●`, `Notification` de permissão → `?`, `Stop` → `✓`, `SessionEnd` → `✗`.
- **Mensagens**: ficam em `.central/inbox/<destino>/`. Se o destino está ocioso, a mensagem é colada no pane (bracketed paste + Enter); se está trabalhando, o hook `Stop` a entrega com `decision: block` e o agente continua com ela (o Claude Code mostra isso como "Stop hook error", mas é a entrega). Um novo prompt seu também entrega a fila como contexto.
- **Avisos automáticos à central** (por hooks, sem depender do subagente lembrar):
  - `❓ PERGUNTAS` quando o subagente usa AskUserQuestion: a central mostra as perguntas e você responde na aba.
  - `📋 PLANO PARA APROVAÇÃO` quando ele chama ExitPlanMode: a central recebe o plano inteiro (cópia em `.central/agents/aN/plan.md`), resume e pergunta se você aprova ou o que mudar; a resposta volta com `agent_plan_decision` (ou `central plan aN approve|approve_manual|change "…"`), que opera o diálogo da aba.
  - `⏸ PERMISSÃO` quando ele para pedindo permissão fora de uma pergunta/plano.
  - `💬 FIM DE TURNO` quando ele termina um turno sem `report`, com a última mensagem dele.
  Enquanto há pergunta/plano pendente, ferramentas paralelas não tiram a aba do `?`.
- **Subagentes**: `claude` com `--append-system-prompt-file` (papel + tasks), `--permission-mode auto` (padrão; troque em `config.json` ou por spawn com `permission_mode`), `--allowedTools mcp__tmux-central`, `--disallowedTools Agent Task`, `--session-id` (para `resume`) e `editorMode: normal` (para a colagem de mensagens não cair no modo normal do vim). Com `--worktree`, o agente trabalha num `git worktree` em `../<projeto>-worktrees/aN`, numa branch `central/<ticket>`.
- **Outras CLIs** (`--cli codex`, etc.): recebem papel + prompt como argumento; sem hooks, o status vem da saída da aba mudando ou não.

## Configuração (`.central/config.json`)

```json
{
  "agent": { "cli": "claude", "permissionMode": "auto", "blockHiddenSubagents": true, "extraArgs": [] },
  "central": { "extraArgs": [] },
  "worktreeDir": "{root}/../{name}-worktrees",
  "processes": { "web": { "command": "npm run dev", "restart": true } }
}
```

`extraArgs` aceita, por exemplo, `["--model", "sonnet"]`. `central proc up` sobe os `processes`.

## Limitações conhecidas

- Uma pasta nunca aberta no Claude (ex.: worktree novo) mostra o diálogo de confiança; a aba fica `?` até você aceitar.
- Colar uma mensagem na central enquanto você digita nela mistura os textos; com a central ocupada, a mensagem espera o fim do turno.
- O MCP adicionado no meio de uma sessão só carrega ao reiniciar o Claude (`central init`).

## Desenvolvimento

```sh
npm run check   # tsc
npm test        # node --test (usa um servidor tmux isolado, -L central-test-<pid>)
```
