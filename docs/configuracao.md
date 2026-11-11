# Configuração e funcionamento

## `.central/config.json`

Criado pelo `central setup` em cada projeto. Todos os campos são opcionais; o que faltar usa o padrão.

```json
{
  "lang": "pt",
  "agent": { "cli": "claude", "permissionMode": "auto", "blockHiddenSubagents": true, "extraArgs": [] },
  "central": { "extraArgs": [] },
  "worktreeDir": "{root}/../{name}-worktrees",
  "processes": { "web": { "command": "npm run dev", "restart": true } }
}
```

| Campo | Padrão | Efeito |
|---|---|---|
| `lang` | `pt` | idioma dos avisos e dos prompts de sistema: `pt` ou `en` |
| `agent.cli` | `claude` | CLI dos subagentes: `claude`, `codex` ou qualquer comando que aceite o prompt como argumento |
| `agent.permissionMode` | `auto` | modo de permissão dos subagentes do Claude (`default`, `acceptEdits`, `plan`, `bypassPermissions`, `auto`); o `agent_spawn` aceita `permission_mode` por subagente |
| `agent.blockHiddenSubagents` | `true` | passa `--disallowedTools Agent Task` aos subagentes |
| `agent.extraArgs` | `[]` | argumentos extras para a CLI dos subagentes, por exemplo `["--model", "sonnet"]` |
| `central.extraArgs` | `[]` | argumentos extras para o Claude da central |
| `worktreeDir` | `{root}/../{name}-worktrees` | onde ficam os worktrees; `{root}` e `{name}` são substituídos |
| `processes` | `{}` | processos que `central proc up` sobe (`command`, `cwd`, `restart`) |

## O que fica em `.central/`

| Caminho | Conteúdo |
|---|---|
| `state.json` | tasks, agentes, processos e locks, gravado com lock entre processos |
| `config.json` | a configuração acima |
| `central.pane` | o pane do tmux registrado como central |
| `status/<id>` | espelho do status de cada aba, lido pelo hook sem subir o Node |
| `inbox/<destino>/` | mensagens pendentes e lidas |
| `notes/` | notas compartilhadas |
| `agents/aN/` | `system.md` (papel e tasks), `prompt.md`, `run.sh` e `plan.md` |

A pasta entra em `.git/info/exclude`, então nunca é versionada.

## Como funciona

- **Estado**: o tmux é a fonte da verdade das abas; o `subcheck` reconcilia o `state.json` com as janelas que existem.
- **Status**: os hooks globais do Claude Code chamam `~/.claude/hooks/central.sh`, que só age em subagentes (`CENTRAL_AGENT_ID` no ambiente) ou no pane registrado como central. `UserPromptSubmit` e `PreToolUse` marcam `●`, a `Notification` de permissão marca `?`, `Stop` marca `✓` e `SessionEnd` marca `✗`. Enquanto há pergunta ou plano pendente, ferramentas paralelas não tiram a aba do `?`.
- **Mensagens**: ficam em `.central/inbox/<destino>/`. Com o destino ocioso, a mensagem é colada no pane (bracketed paste e Enter). Com o destino trabalhando, o hook `Stop` a entrega com `decision: block` e o agente continua com ela. Um prompt novo seu também entrega a fila como contexto.
- **Subagentes do Claude**: sobem com `--append-system-prompt-file` (papel e tasks), `--permission-mode`, `--allowedTools mcp__tmux-central`, `--disallowedTools Agent Task`, `--session-id` (para o `central resume`) e `editorMode: normal`, para a colagem de mensagens não cair no modo normal do vim.
- **Outras CLIs**: recebem papel e prompt como argumento; sem hooks, o status vem de a saída da aba mudar ou não.

## Limitações conhecidas

- Uma pasta nunca aberta no Claude (por exemplo, um worktree novo) mostra o diálogo de confiança; a aba fica `?` até você aceitar.
- Colar uma mensagem na central enquanto você digita nela mistura os textos; com a central ocupada, a mensagem espera o fim do turno.
- Um MCP adicionado no meio de uma sessão só carrega quando o Claude reinicia (`central init`).

## Desenvolvimento

```sh
npm run check   # tsc
npm test        # node --test, com um servidor tmux isolado (-L central-test-<pid>)
```

Não há build: o Node 23.6+ executa o TypeScript direto. O código fica em `src/cli.ts` (CLI), `src/mcp/server.ts` (MCP) e `src/core/` (estado, tmux, agentes, hooks, mensagens).
