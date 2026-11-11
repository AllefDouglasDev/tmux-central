# Prompt de instalação para o seu agente

Copie o bloco abaixo e cole no seu agente de código (Claude Code, Codex, Cursor…), aberto num terminal desta máquina. Ele encontra ou clona o repositório, instala tudo, integra com o tmux e com o Claude Code e confere se funcionou, sempre perguntando antes de mexer em arquivos seus.

````text
Instale e integre o tmux-central nesta máquina. O tmux-central é um MCP + CLI que transforma o
Claude Code numa "central" que delega trabalho a subagentes, cada um numa janela visível do tmux.

Repositório: https://github.com/AllefDouglasDev/tmux-central.git

Siga os passos em ordem. Antes de editar qualquer arquivo de configuração meu (~/.tmux.conf,
~/.zshrc, ~/.bashrc, ~/.claude/settings.json), mostre o trecho que vai adicionar e peça a minha
confirmação. Não use sudo sem me perguntar. Ao final, me dê um resumo curto do que foi feito e do
que ficou pendente.

1. Encontrar o projeto
   - Procure um clone existente antes de clonar: rode `command -v central` e, se existir, siga o
     symlink (readlink) até a raiz do projeto; procure também pastas chamadas `tmux-central` ou
     `mcp-tmux` em ~, ~/Development, ~/dev, ~/code, ~/projects e ~/src (até 3 níveis), e confirme
     que é o projeto certo pelo `package.json` com `"name": "tmux-central"`.
   - Se achar, use esse clone: rode `git status` e `git pull --ff-only` se a árvore estiver limpa;
     se houver mudanças locais, não faça pull e me avise.
   - Se não achar, pergunte onde clonar (sugira ~/Development/tmux-central) e rode
     `git clone https://github.com/AllefDouglasDev/tmux-central.git <pasta>`.

2. Dependências
   - Confira: tmux (3.2+), node (23.6+), claude (Claude Code), jq, fzf e git.
   - Para o que faltar, sugira o comando de instalação do sistema (no macOS, `brew install …`;
     no Linux, o gerenciador de pacotes da distro) e rode só depois que eu confirmar.
   - Se o node do PATH for mais antigo que 23.6 mas houver outro mais novo instalado, use
     `CENTRAL_NODE=<caminho>` em vez de trocar o node do sistema.

3. Instalação
   - Na raiz do projeto, rode `./install.sh`. Ele roda `npm ci`, cria os links de
     `~/.local/bin/central`, `~/.claude/hooks/central.sh` e `~/.claude/commands/central/*.md`, e
     mescla os hooks do tmux-central no `~/.claude/settings.json` (com backup).
   - Leia a saída: qualquer linha com `✗` ou `!` precisa ser resolvida ou reportada para mim.
   - Se `command -v central` falhar, adicione `export PATH="$HOME/.local/bin:$PATH"` ao rc do meu
     shell (com confirmação) e use o PATH ajustado no resto da sessão.

4. Integração com o tmux
   - Veja se o ~/.tmux.conf já tem `central status`. Se não tiver, proponha acrescentar:
       set -g status-interval 5
       set -g status-right '#(central status --tmux --session "#S")%T'
       bind a display-popup -E -w 70% -h 50% -d '#{pane_current_path}' "central pick '#S'"
     Se eu já tiver um status-right próprio, proponha encaixar `#(central status --tmux --session "#S")`
     nele em vez de substituí-lo. Se a tecla `a` já estiver em uso com o prefixo, sugira outra.
   - Se o tmux estiver rodando, recarregue com `tmux source-file ~/.tmux.conf`.

5. Verificação
   - `central help` imprime a ajuda.
   - `jq '.hooks | keys' ~/.claude/settings.json` lista UserPromptSubmit, PreToolUse, PostToolUse,
     Notification, Stop e SessionEnd, e `grep -c central.sh ~/.claude/settings.json` é maior que 0.
   - `ls ~/.claude/commands/central` mostra init, spawn, subcheck, send, tasks e kill.
   - Na raiz do tmux-central, `npm run check` e `npm test` passam (os testes usam um servidor tmux
     isolado e não tocam nas minhas sessões).

6. Fechamento
   - Não rode `central init` por mim: ele abre uma sessão interativa do tmux.
   - Termine dizendo, em poucas linhas, o que foi instalado, o que ficou pendente e como começar:
     entrar num projeto e rodar `central init`; dentro de um Claude já aberto no tmux, usar
     `/central:init`; para ver as abas, `<prefixo do tmux> a`. A documentação está em
     `docs/uso.md` dentro do repositório.
````
