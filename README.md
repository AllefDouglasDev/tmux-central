# tmux-central

Subagentes LLM como **abas visíveis do tmux**, coordenados por uma **central** (uma sessão do Claude Code) através de um MCP. Em vez de subagentes ocultos em background, cada subagente é uma janela do tmux onde você pode entrar e conversar direto, e a central é avisada sozinha quando um deles faz uma pergunta, apresenta um plano, pede permissão ou termina.

```
◆ central   ● [#1] TG-123   ? [#2 | #3] TG-456 | TG-457   ✓ [#4] docs da api   ⚙ web      ◆ 1● 1? 1✓ 1⚙ 14:02
```

| Ícone | Significado |
|---|---|
| `○` | iniciando |
| `●` | trabalhando |
| `?` | esperando você (permissão, pergunta ou plano) |
| `✓` | terminou o turno ou relatou `done` |
| `!` | relatou `blocked` |
| `✗` | a CLI saiu ou a aba foi fechada |
| `⚙` | processo gerenciado (dev server, watcher) |

## Instalar com o seu agente

> **Não quer seguir os passos à mão?** Copie o prompt de [docs/prompt-de-instalacao.md](docs/prompt-de-instalacao.md) e cole no seu agente (Claude Code, Codex, Cursor…). Ele procura um clone existente e o usa, ou clona o repositório se não houver; depois instala as dependências, roda o `install.sh`, integra com o tmux e confere se tudo funcionou, pedindo confirmação antes de mexer nos seus arquivos de configuração.

## Instalação manual

Requisitos: `tmux` 3.2+, `node` 23.6+, `claude` (Claude Code), `jq`, `fzf` e `git`.

```sh
git clone <url-do-repositório> tmux-central
cd tmux-central
./install.sh
```

O `install.sh` instala as dependências npm, liga o `central` em `~/.local/bin`, instala o hook e os comandos `/central:*` em `~/.claude` e adiciona os hooks ao `~/.claude/settings.json`, com backup. Para a barra de status e o seletor de abas, acrescente ao `~/.tmux.conf`:

```tmux
set -g status-interval 5
set -g status-right '#(central status --tmux --session "#S")%T'
bind a display-popup -E -w 70% -h 50% -d '#{pane_current_path}' "central pick '#S'"
```

Detalhes, configuração manual dos hooks e desinstalação: [docs/instalacao.md](docs/instalacao.md).

## Uso rápido

```sh
cd meu-projeto
central init        # cria/entra na sessão tmux do projeto e abre o Claude como central
```

Depois é conversar com a central: "crie um subagente para o TG-123 que…". Ela registra a task, cria o subagente e a aba aparece. Já dentro de um Claude aberto no tmux, `/central:init` faz o mesmo papel.

| Comando do Claude | O que faz |
|---|---|
| `/central:init` | torna a sessão atual a central |
| `/central:spawn` | delega trabalho a um novo subagente |
| `/central:subcheck` | status de todos os subagentes |
| `/central:send a1 …` | mensagem para um subagente |
| `/central:tasks` | lista, cria ou atualiza tasks locais |
| `/central:kill a1` | encerra um subagente |

```sh
central spawn -p "prompt" --ticket TG-1 [--worktree] [--cli codex]
central subcheck            # status das abas
central send a1 "mensagem"
central plan a1 approve     # ou approve_manual / change "o que mudar"
central help                # todos os comandos
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/prompt-de-instalacao.md](docs/prompt-de-instalacao.md) | prompt para o seu agente instalar tudo sozinho |
| [docs/instalacao.md](docs/instalacao.md) | requisitos, `install.sh`, tmux, hooks, variáveis de ambiente, desinstalação |
| [docs/uso.md](docs/uso.md) | fluxo de trabalho, avisos à central, mensagens, worktrees, CLI e ferramentas do MCP |
| [docs/comandos-claude.md](docs/comandos-claude.md) | os comandos `/central:*` e o hook, na íntegra |
| [docs/configuracao.md](docs/configuracao.md) | `.central/config.json`, funcionamento interno, limitações e desenvolvimento |

## Desenvolvimento

```sh
npm run check   # tsc
npm test        # node --test (usa um servidor tmux isolado)
```

## Licença

[MIT](LICENSE)
