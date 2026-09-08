<!--
Sync Impact Report
- Version change: 1.8.0 → 1.9.0
- Modified principles: Princípio VI ganhou a "Exceção de identidade portada", que permite a um módulo que reproduz fielmente um aplicativo aprovado preservar a identidade visual de origem sob quatro condições
- Added sections: nenhuma
- Removed sections: nenhuma
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — gate visual passou a admitir a exceção de identidade portada
  - ✅ .specify/templates/spec-template.md — contrato visual passou a declarar quando a identidade é portada
  - ✅ .specify/templates/tasks-template.md — tarefas de frontend passaram a auditar escopo de CSS e paleta centralizada
  - ✅ docs/PADRAO_MODULO.md — padrão de frontend atualizado com a exceção
- Follow-up TODOs: reavaliar a exceção quando o módulo Comercial deixar de ser porte; se a identidade portada for promovida a padrão do app, abrir nova emenda atualizando variables.css, components/ui/ e o Princípio VI
-->

# Constitution do NewRDO

## Core Principles

### I. Operação de Servidor é Sagrada (INEGOCIÁVEL)

Agentes de IA e desenvolvedores NUNCA executam comandos de servidor, Docker, deploy ou
manutenção de produção/staging diretamente. Todo comando destinado ao servidor DEVE ser
apresentado como bloco de código acompanhado da instrução explícita "rode no servidor",
para execução manual pelo operador humano.

Racional: os ambientes de produção e staging (deploy/PRODUCTION.md, deploy/STAGING.md)
atendem usuários reais; execução automática de comandos de infraestrutura já causou
incidentes e foi vetada pela equipe.

### II. UI em pt-BR e Mobile-First

Toda interface visível ao usuário DEVE estar em português (pt-BR). Toda tela nova DEVE
funcionar em mobile desde a primeira versão, não como ajuste posterior. Regras mínimas:

- Tabelas largas DEVEM ter alternativa empilhada em telas estreitas (padrão: tabela vira cards).
- Modais DEVEM ter rodapé de ações fixo e corpo rolável.
- Nenhum elemento pode estourar a borda da viewport (sem scroll horizontal de página).
- Grades de cards em mobile DEVEM caber na largura útil do contêiner. Colunas com
  mínimo visual fixo DEVEM usar `minmax(min(100%, <largura>), 1fr)` ou equivalente,
  com `width: 100%`, `min-width: 0` e filhos `min-width: 0` quando houver grid/flex.
- Conteúdo interno de cards (valores monetários, status, badges, links, ações e
  métricas) DEVE quebrar, truncar com ellipsis ou empilhar sem aumentar a largura do
  card. `white-space: nowrap` só é permitido quando acompanhado de `max-width` e
  tratamento de overflow que não gere scroll horizontal de página.
- Abas, segmentos, filtros com aparência de aba e qualquer `tablist` em mobile DEVEM
  caber dentro da largura do módulo. O componente DEVE usar quebra de linha, grid
  responsivo, rolagem interna explícita ou substituir a navegação por `select`/menu
  mobile; rótulos longos DEVEM quebrar/encurtar sem empurrar a viewport.

Racional: a base de usuários acessa majoritariamente por celular em campo; correções
retroativas de responsividade custam ciclos inteiros de retrabalho. Cards que dependem
de `minmax(280px, 1fr)`, valores internos com `nowrap` ou barras de abas com rótulos
longos parecem corretos em desktop, mas cortam bordas e conteúdo nos celulares usados
em obra.

### III. Validação com Zod nas Duas Pontas

Toda entrada de API DEVE ser validada no backend com schemas Zod antes de tocar em regra
de negócio ou banco. Formulários no frontend DEVEM usar react-hook-form com resolver Zod.
Nenhuma rota nova é aceita confiando apenas na validação do cliente.

Racional: validação duplicada e declarada em schema é a única barreira consistente contra
dados inválidos vindos de clientes desatualizados ou chamadas diretas à API.

### IV. Banco de Dados Só Via Prisma

Toda mudança de schema DEVE ser feita por migration Prisma versionada no repositório —
nunca SQL manual direto no banco (exceção: índices de performance documentados em
deploy/, aplicados manualmente pelo operador conforme o Princípio I). Scripts de
backfill/correção de dados existentes DEVEM ser idempotentes e oferecer modo dry-run
antes do modo de aplicação.

Racional: o histórico de migrations é a única fonte confiável do estado do schema entre
dev, staging e produção; backfills sem dry-run já exigiram restauração de backup.

### V. Testes para Lógica de Negócio no Backend

Rotas e serviços novos com regra de negócio DEVEM ganhar testes em `backend/test`,
seguindo o padrão dos testes existentes (arquivos `*.test.js`, executados via
`npm test`). Correções de bug em lógica de negócio DEVEM incluir teste que reproduz o
bug. UI e código puramente apresentacional não têm cobertura obrigatória.

Racional: o backend concentra cálculo, permissão e persistência; é onde regressão causa
dano real a relatórios e dados de obra.

### VI. Consistência Visual e Componentes Padrão

Nenhuma página, modal ou card pode nascer fora da formatação padrão do app. Regras:

- Modais, botões, diálogos de confirmação, toasts, busca e skeletons DEVEM usar os
  componentes de `frontend/src/components/ui/` (Modal, Button, ConfirmDialog, Toast,
  SearchBar, Skeleton, etc.) — é proibido criar variante local de componente que já
  existe no kit.
- Cores, raios de borda, sombras e espaçamentos DEVEM vir dos tokens de
  `frontend/src/styles/variables.css` (`--g`, `--r`, `--rs`, `--shadow`, ...); valores
  hex/px hardcoded que dupliquem um token existente são vetados.
- Campos de formulário (`input`, `select`, `textarea`) DEVEM herdar o estilo global de
  `frontend/src/styles/base.css`. `select` nativo e listas suspensas customizadas
  DEVEM aparecer formatados com borda, raio, padding, foco e indicador visual de
  abertura consistentes com o app; dropdown com aparência padrão crua do navegador é
  violação bloqueante.
- Ao tentar salvar formulário com campo obrigatório vazio ou inválido, o campo DEVE
  receber o estado visual de erro do app: wrapper `.field-group.field-invalid`, controle
  com `aria-invalid` quando aplicável e mensagem `.field-error` abaixo do campo. A
  validação nativa do navegador não pode substituir esse padrão visual.
- Toda reordenação visível ao usuário por drag and drop DEVE seguir o padrão compartilhado
  do app: handle dedicado de arraste, item original substituído por placeholder com
  espaço e legenda da posição atual, fantasma visual acompanhando o cursor/toque,
  reorganização ao vivo durante o arraste, suporte mobile/touch via Pointer Events ou
  equivalente com `touch-action: none`, cancelamento restaurando a ordem inicial e
  persistência apenas da ordem final ao soltar. Drag and drop nativo do navegador não
  pode ser o único mecanismo quando houver uso em mobile.
- Listas suspensas customizadas (combobox, multiselect, filtros com menu) DEVEM usar
  componente existente do kit ou uma classe compartilhada baseada nos tokens. É
  proibido criar dropdown local sem estados de foco, disabled, erro e mobile definidos.
- Módulo novo com dashboard, tabelas/cards ou formulários de múltiplas colunas DEVE
  optar por um shell largo no desktop, seguindo o padrão de Equipamentos e
  Acompanhamento (`.equip-page` ou classe equivalente documentada). Campos não podem
  ficar comprimidos em 420/540px quando houver largura disponível.
- Página nova DEVE seguir a estrutura visual das páginas existentes do mesmo tipo
  (cabeçalho, cards, tabela/lista) — copiar o padrão de uma tela análoga em
  `frontend/src/pages/` antes de inventar layout novo.
- Função nova visível ao usuário DEVE incluir um aviso de novidade no padrão de card
  centralizado do tutorial (`driver.js`), equivalente ao aviso de DDS: aparece no
  primeiro acesso do usuário impactado, grava "visto" em `localStorage` por usuário e
  navegador, e possui data-limite global de expiração exatamente 10 dias corridos após
  a data de implementação registrada no código. Depois da data-limite, o aviso NÃO
  pode aparecer para ninguém, mesmo em navegador que nunca acessou a função.
- Função nova com interação não óbvia DEVE incluir tutorial guiado temporário no mesmo
  fluxo do aviso de novidade, também limitado a 10 dias e ao primeiro acesso do público
  impactado. Esse tutorial DEVE apontar os controles reais da função e terminar sem
  bloquear o uso normal.
- Tutorial permanente de primeiro acesso é obrigatório apenas para módulo novo. Para
  função nova dentro de módulo existente, o tutorial é campanha temporária de novidade,
  não onboarding permanente do módulo.
- Navegação interna de módulo (abas, seções laterais, filtros com aparência de aba e
  detalhes que substituem a lista, como cards abertos) DEVE sobreviver a atualização
  da página. O padrão preferencial é refletir o estado navegacional em URL/query params
  (`?tab=...`, `?section=...`, `?project=...`) e limpar parâmetros incompatíveis ao
  trocar de seção. Persistência em `localStorage` só é aceita quando a URL exporia dado
  sensível ou quando o estado não representa navegação compartilhável.

**Exceção de identidade portada.** Um módulo que reproduz fielmente um aplicativo já
existente e aprovado pela diretoria PODE preservar a identidade visual de origem, desde
que:

- (a) todo o CSS fique escopado sob uma raiz do módulo, sem vazar seletor para o
  restante do app e sem ser afetado por `base.css`;
- (b) a paleta e as medidas próprias sejam declaradas como custom properties
  prefixadas na raiz do módulo, em um bloco único, sem redefinir tokens globais de
  `variables.css`. Valor hex/px solto espalhado pelos seletores não atende esta
  alínea;
- (c) os comportamentos obrigatórios sejam preservados — `aria-invalid` com mensagem
  visível em campo inválido, `select` com estados de foco/disabled/erro, reordenação
  no padrão compartilhado de drag and drop, navegação em URL/query params, tutorial
  permanente de primeiro acesso e ausência de scroll horizontal de página em mobile;
- (d) a exceção seja registrada no `plan.md` da feature e reavaliada quando o módulo
  deixar de ser um porte e passar a evoluir por conta própria.

Divergência visual entre módulos é estado transitório, nunca permanente. Só existem
dois desfechos aceitáveis: o módulo converge para o kit, ou a identidade portada é
promovida a padrão do app por nova emenda que atualize `variables.css`,
`frontend/src/components/ui/` e este princípio. Enquanto a promoção não acontecer, esta
exceção NÃO autoriza outro módulo a inventar identidade própria — ela vale apenas para
porte fiel de aplicativo aprovado.

Racional: forçar o kit sobre um porte fiel produziria retrabalho sem ganho para o
usuário, que já conhece a tela de origem, e destruiria a paridade que torna a migração
verificável. A exceção é de aparência; nenhuma garantia de acessibilidade,
responsividade ou consistência funcional é dispensada. A exigência de paleta
centralizada na alínea (b) existe para que a promoção a padrão do app, se ocorrer, seja
uma troca de tokens e não uma reescrita.

Racional: divergências visuais quase nunca são intencionais — surgem quando uma tela é
construída sem olhar o kit e os tokens existentes, e depois custam passadas inteiras de
padronização. Novidades sem divulgação deixam usuários sem descobrir fluxos novos; aviso
e tutorial temporários tornam a adoção previsível sem criar pop-ups permanentes para
funções pontuais. Reordenações diferentes entre módulos geram erro em telas de campo,
especialmente no toque; por isso todo drag and drop de ordenação precisa usar a mesma
interação com handle, placeholder, fantasma e reorganização ao vivo. Abas que voltam
para o início após F5 quebram o contexto operacional do usuário em campo e tornam a
experiência inconsistente entre módulos. A regra torna a checagem objetiva em review:
componente do kit usado? token usado? tela análoga seguida? novidade temporária
implementada quando aplicável? drag and drop segue o padrão? refresh preserva a página?

## Restrições de Stack

A stack é fixa; introduzir tecnologia fora dela exige emenda a esta constitution:

- **Backend**: Node.js + Express, Prisma + PostgreSQL, validação com Zod.
- **Frontend**: React + Vite + TypeScript, estado servidor com @tanstack/react-query,
  estado cliente com zustand, formulários com react-hook-form + Zod.
- **Processamento de imagens**: exclusivamente no backend, via sharp e heic-convert.
- **Geração de documentos**: pdf-lib e pipeline DOCX→PDF existentes no backend.

Bibliotecas utilitárias pequenas podem ser adicionadas sem emenda, desde que não
substituam nem dupliquem papel de item listado acima.

## Workflow de Desenvolvimento

- Features de porte médio ou grande (novo módulo, nova entidade, mudança de fluxo que
  toca backend + frontend) DEVEM passar pelo fluxo spec-kit:
  specify → clarify → plan → tasks → implement, com artefatos em `specs/`.
- Fixes pequenos, ajustes visuais e manutenção seguem o fluxo normal de branch + PR,
  sem exigência de spec.
- Todo trabalho ocorre em branch de feature (`feat/...`) ou fix (`fix/...`); `main` é a
  base de PRs e reflete o que pode ir a produção.
- Exploração de código DEVE priorizar as ferramentas do grafo (code-review-graph)
  antes de varredura manual de arquivos, conforme CLAUDE.md.

## Governance

Esta constitution prevalece sobre qualquer outra prática documentada. Em conflito com
CLAUDE.md ou docs de deploy, a constitution vence; o documento conflitante deve ser
corrigido.

- **Emendas**: qualquer alteração DEVE ser feita por PR que atualize este arquivo,
  com justificativa no corpo do PR e aprovação do mantenedor do projeto (Pedro Paulo).
- **Versionamento**: semântico. MAJOR para remoção/redefinição incompatível de
  princípio; MINOR para princípio ou seção nova, ou expansão material de orientação;
  PATCH para clarificação e correção de texto.
- **Conformidade**: revisões de código e o gate "Constitution Check" do plan-template
  DEVEM verificar aderência aos Princípios I–VI; violações exigem justificativa
  registrada na seção Complexity Tracking do plano da feature.

**Version**: 1.9.0 | **Ratified**: 2026-07-03 | **Last Amended**: 2026-07-28
