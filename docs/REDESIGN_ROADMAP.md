# Roadmap do redesign do frontend

> **Fechamento de 02/10/2026:** carregamentos, arquitetura e persistência isolada
> foram publicados. A revisão transversal está na seção de encerramento abaixo.
>
> **Auditoria de 01/10/2026:** os 12 módulos ativos têm as telas principais no
> design system. F5.4 (EPI) e F5.5 (Privacidade) estão visualmente concluídas;
> os quadros históricos abaixo não devem ser usados como fila atual. O estado
> verificável e as próximas entregas estão em [Fechamento transversal atual](#fechamento-transversal-atual).

> **Entrega transversal seguinte:** as frentes 1–3 do fechamento atual foram
> implementadas. As páginas de demonstração locais estão em `/visualizar`
> durante o desenvolvimento; os links usam dados fictícios e não gravam na API.

> **Fechamento X3 em 28/09/2026:** liberação individual, revogação e assinatura
> física foram validadas com gestor e cliente em banco isolado. Gestor, detalhe
> e portal do cliente passaram no Chromium em 390 e 1280 px, nos temas claro e
> escuro. O diálogo de upload ficou compacto no celular e o estado de liberação
> passou a ficar legível no card e no detalhe.

> **Conciliação de 28/09/2026:** `origin/main` até `2adc706e` foi incorporada.
> Metas das divisões do Acompanhamento agora aceitam percentual do total do
> projeto no diálogo DS. O cálculo e a gravação foram conferidos em banco isolado
> no Chromium a 390 e 1280 px, sem overflow horizontal ou erro de JavaScript.

> **Fechamento de 28/09/2026:** `origin/main` até `31865b08` foi conciliada.
> Efetivo F2 e Acompanhamento A7 passaram na matriz técnica com banco isolado,
> Chromium/Firefox, permissões e persistência. A regressão WebKit fica em F6.

> **Integração de 25/09/2026:** `origin/main` até `9df822c7` foi incorporada
> à branch de redesign. O delta e as tarefas visuais estão em
> [Novidades da main em 25/09](#novidades-da-main-em-25092026).

> **Retomada do Efetivo em 27/09/2026:** `origin/main` até `62a3dd6a` foi
> conciliada com o redesign. O diálogo de planejamento de missão foi preservado;
> as novas superfícies de disponibilidade, execução, resumo legado e equipe/ciclos
> receberam adaptação visual. A validação integrada de F2 permanece pendente.

> **Conferência de 27/09/2026:** `origin/main` já estava integralmente no
> histórico desta branch. Corrigidas as ações de liberação e assinatura física
> que faltavam na listagem DS; a aba Simulações já tinha sido removida da
> `main` em `d078d960` e foi restaurada por engano na conciliação com o DS.
> A navegação e o redirecionamento de links antigos foram alinhados à `main`.

> **Migração F2.4 em 27/09/2026:** Produtividade e Administração, seus
> diálogos, o tutorial e os avisos de novidade receberam apresentação DS.
> A validação integrada com dados reais e perfis continua na matriz F2.

> **Delta corrigido em 24/09/2026:** o merge de `origin/main` em `10599cf3`
> havia substituído telas já migradas por versões legadas. RDO, Conta, Cliente,
> Estatísticas, Acompanhamento, Assinaturas e partes do Efetivo foram restaurados
> no código DS e conciliados com os fluxos novos da main. O
> [plano desta integração](filtrovali-ds/main-integration-2026-09-23.md)
> registra as correções, o gate de homologação e as superfícies novas ainda na fila.

Atualizado em 11/09/2026 após integrar `origin/main` em `9586579f`, pelo merge
`1efe4639` na branch `feat/frontend-redesign-2`. O trabalho local de redesign foi
preservado, com backup em stash. A integração anterior (`703cb0f6`, merge
`c573efbd`) e as entregas abaixo permanecem como histórico.

Inventário completo desta rodada, rotas, arquivos, permissões e tarefas:
[Integração da main — 11/09/2026](filtrovali-ds/main-integration-2026-09-11.md).
Integração validada com 516 testes frontend, 14 arquivos de testes backend focados,
build, lint, tipagem E2E e gate arquitetural. Homologação visual das páginas novas
permanece pendente nos lotes acrescentados.

## Objetivo

Levar todo o frontend para a linguagem visual e para os contratos responsivos já
adotados no Hub e no piloto do RDO, sem alterar regras de negócio, permissões,
URLs públicas ou contratos de API.

Este roadmap passa a ser a fonte de escopo do redesign. As specs funcionais de
cada módulo continuam sendo a fonte de verdade para comportamento e dados.

## Novidades da main em 25/09/2026

Esta integração acrescentou comportamento funcional já implementado na `main`.
O quadro abaixo registra o levantamento e o estado das tarefas em 25/09; os
fechamentos atuais de F2 e A7 estão nas seções próprias. Os contratos,
permissões e cálculos da `main` continuam válidos no redesign.

| Lote | Mudança recebida | Adaptação necessária no redesign |
| --- | --- | --- |
| **A3c — Acompanhamento: metragens realizadas** | Conciliação de RTH/RLQ/FLU por dia e serviço, comparação RDO × valor validado, histórico, revisão, restauração, aviso quando a origem muda e permissão de gestão. O painel novo foi encaixado no avanço físico DS e legado. | **Apresentação DS implementada** para leitura, histórico, estados e formulário, mantendo o consumidor legado. A7 ainda deve conferir persistência real, revisão concorrente, refresh do avanço e perfis em projeto/grupo. |
| **A3b/A7 — Acompanhamento: contratos existentes** | A conciliação de sistemas e o escopo planejado passaram a exibir “Equipamento do cliente” e ajustes de nomes; a API de avanço considera as novas metragens validadas. | Revisar `ProjectSystemInput`, `ProjectSystemAliases`, `ProjectSystemReconciliation`, `ProjectPlannedScopeEditor`, `ProjectProgressBreakdown` e o detalhe já migrado para refletir os novos rótulos e dados. Revalidar consumo de metas, totais e permissões em projeto/grupo. |
| **F2.1/F2.5 — Efetivo: disponibilidade por período** | Filtro de data final, API diária por intervalo, KPIs de pico/falta, cargos com déficit, riscos planejados e alternância Kanban/Calendário; status “Indisponível” e “Fora do vínculo”. | **Adaptação visual implementada:** cards DS, cores semânticas nos riscos e faixas do calendário, Kanban responsivo e estados de loading/erro/vazio. Falta validar com dados e perfis reais na matriz F2. |
| **F2.5/F2.6 — Efetivo: evolução e execução** | Resumo inicial para obras legadas, equipe/datas/equipamentos, verificação semanal, desvios recolhíveis e ajustes de calendário, capacidade e tooltip. | **Adaptação visual implementada:** resumo legado com campos DS; execução com cartões, campos e relatórios DS; equipe/ciclos embutidos no fluxo com controles DS e regras novas da main. O diálogo de planejamento de missão foi preservado. Falta validar persistência, permissões e navegadores na matriz F2. |
| **X3 — Relatórios de serviço e assinatura física** | Liberação individual de relatórios de serviço, revogação, registro de RDO assinado em papel com PDF, status próprio no detalhe e visibilidade no portal do cliente. | **Concluído tecnicamente em 28/09:** ações, status, upload, revogação e permissões conferidos com API e banco isolado; gestor e cliente validados em claro/escuro a 390 e 1280 px. |
| **X2 — Componentes compartilhados** | `Modal` recebeu proteção de teclado/propagação para painéis aninhados; o catálogo de API foi atualizado. | Revalidar diálogos de Cronograma, assinatura física e demais consumidores DS/legados. O catálogo de API não cria superfície visual nova nesta rodada. |

Após A3c, X3 recebeu adaptação visual nesta branch. `origin/main` já era
ancestral da branch em 27/09/2026; a remoção da aba Simulações havia sido
perdida na conciliação visual e agora segue a navegação da main. O serviço de
cenários permanece disponível no backend, como na main.
**F2.1/F2.5/F2.6** foram retomadas em 27/09. Em 28/09, a matriz integrada de
F2 e A7 passou em banco isolado, Chromium e Firefox. A regressão WebKit do
fechamento transversal continua em F6, pois o host local não tem suas bibliotecas.

## Estado após a integração

- A fundação do design system, o `AppShell`, o Hub e o núcleo autenticado do RDO
  estão implementados para gestor, coordenador, colaborador e cliente. A barra
  lateral desktop pode ficar recolhida, usa a `LOGO_TAB` e expande ao passar o
  mouse; Equipamentos usa ícone de engrenagem, distinto de Manutenção.
- O Efetivo foi retomado nesta worktree em 27/09, após a pausa solicitada em
  10/09. As sete seções e os diálogos ativos estão no DS. A matriz F2 foi
  validada em 28/09 com gestor, visualizador, Comercial, Operações, Ativos,
  Suprimentos, Administrativo e QSMS; o Kanban bloqueado abre a etapa com as
  pendências e apresenta apenas a contagem no aviso.
- Assinaturas: shell, biblioteca, preparação, acompanhamento, auditoria e
  assinatura pública migrados em F1 + F3.1–F3.4. A prévia contínua da main foi
  incorporada ao editor e à página pública. Backend real isolado, Chromium,
  Firefox e WebKit validados na F3.5; conferência em celular físico combinada com o usuário.
- Acompanhamento concluiu A1–A7 em 28/09. O fechamento cobriu as quatro áreas,
  detalhe individual e agrupado, divisões por escopo/equipamento, persistência e
  perfis. Estoque, Romaneio, Qualidade e EPI continuam com as pendências já
  inventariadas.
- A main acrescentou Manutenção/Produção, configuração/histórico em Equipamentos,
  API/Tokens no Admin e ativação de contas por link. Esses fluxos já receberam
  os lotes M1–M5, EQ1–EQ3, API1–API4 e X1 nesta branch.
- O fechamento anterior do RDO permanece válido para seu baseline. As novas
  bordas de permissão de emissão, rascunhos e criação de contas entram em X1/X2;
  os novos relatórios operacionais entram em M1–M5, separadamente.
- O Hub preserva o DS, agora com acesso e ícone de Manutenção/Produção e campanhas
  de novidade integradas. Revisão transversal das novas entradas segue em X2.

## Gate arquitetural antes do PR final

Status em 04/09/2026: **verde**, sem aumento dos budgets. A correção incluiu:

- extração de apresentação e tipos compartilhados do gestor para
  `GestorPage.shared.tsx`;
- extração das ações do detalhe para `ReportDetailActions.tsx`;
- extração das regras de formatação/identidade do novo relatório para
  `newReportFormatting.ts`;
- associação explícita de IDs/rótulos nos campos condicionais, conta, gestor,
  dashboard NPS e harness do design system;
- manutenção dos limites originais de `GestorPage.tsx`, `ReportDetailPage.tsx` e
  `NewReportPage.tsx`.

## Contratos obrigatórios do redesign

Todas as fases devem preservar os seguintes contratos:

1. Usar tokens e componentes compartilhados; estilos específicos devem ficar
   escopados pela raiz do módulo.
2. Usar `AppShell`, navegação consistente, breadcrumb, perfil e ações utilitárias.
3. Manter em URL o estado navegável de abas, seções, filtros e detalhes.
4. Não criar scroll horizontal de página no mobile. Linhas de ações de cards devem
   permanecer em uma única linha, sem mini-scroll; quando necessário, reduzir
   texto, espaçamento ou usar ações iconográficas acessíveis.
5. Diálogos de formulário devem aparecer no mobile como caixas compactas. Apenas
   fluxos espaciais, como edição de PDF, podem ocupar uma superfície ampliada de
   forma intencional.
6. Formulários mobile devem usar densidade compacta sem reduzir a área de toque,
   com rótulo, foco, erro, disabled e tipografia padronizados.
7. Preservar foco, `Escape`, foco inicial, devolução de foco, leitor de tela e
   navegação por teclado em drawers, menus, tabs, tabelas e diálogos.
8. Cobrir loading, vazio, erro, sucesso, somente leitura e falta de permissão.

## Inventário incorporado ao escopo

| Área | Superfícies que agora fazem parte do redesign | Situação |
| --- | --- | --- |
| Hub e navegação global | Efetivo, Assinaturas, Manutenção/Produção e novidades de API/Tokens; ícones e acesso por perfil/permissão | X2 concluído; auditoria transversal F6 pendente |
| Efetivo | Visão geral, Calendário, Colaboradores/Ausências, Disponibilidade, Missões, Kanban de evolução, Produtividade e Administração | **F2 concluído tecnicamente** — matriz de oito perfis, conta sem acesso e persistência em banco isolado |
| Assinaturas | Lista de ativos/arquivados, novo documento, configuração do PDF, assinantes, publicação, acompanhamento, auditoria e assinatura pública | **Migrado e validado tecnicamente** — F3.1–F3.5; teste em celular físico com o usuário |
| Acompanhamento | Dashboard/cards/detalhe; novos faturamentos Omie, TAGs, romaneios, origem das jornadas RDO e indicadores operacionais em Sede | **A1–A7 concluídos tecnicamente** — perfis, divisões e persistência conferidos |
| Estoque | Resumo expansível por lote, devolução com múltiplos itens, documentos do item e ordenação de movimentações | Harmonizado em F4; novas tabelas de itens e categorias aguardam reconciliação dos testes estáticos |
| Romaneio | Impressão de etiquetas QR, scanner por câmera e continuação da inclusão do item após leitura | Harmonizado em F4; gravação integrada não repetida após a migração visual |
| RDO e gestão | Histórico de cargos, upload manual, equipe/justificativas, núcleo e bordas públicas; novas permissões de emissão e criação de senha por link | Baseline e X1–X3 concluídos tecnicamente |
| Manutenção/Produção | Listagem, criação/edição/revisão de RDOs e manutenção avulsa, programação preventiva e histórico | M1–M5 concluídos tecnicamente; fluxo visual, permissões e rascunho isolado conferidos |
| Equipamentos | Supervisor, perfis/checklists, categorias/intervalos/visibilidade, exceções e histórico/documentos | EQ1–EQ3 concluídos; dependência dos fluxos de manutenção |
| Administração — Gestão de Contas | Lista, filtros, criação/edição, papéis e permissões, vínculo com colaborador, ativação, exclusão e link de senha | **Migração visual F5.2 concluída**; persistência com banco isolado segue na validação F6 |
| Administração — API/Tokens | Lista/filtros, política/escopos, segredo único, redução/rotação/revogação, Playground, uso e eventos | API1–API4 concluídos, acesso exclusivo ADMIN |
| Ativação de contas | Criação sem senha inicial, link manual, página pública de criar/redefinir senha e reenvio | X1 migrado visualmente; regras e chamadas da main preservadas |
| Qualidade | Registros, filtros, evidências, exportação, Naturezas, reordenação e formulários | Visual F5.3 migrado; validação por toque e persistência isolada pendentes |
| EPI | Fichas por colaborador, catálogo, entregas/devoluções, arquivo, assinatura e PDF | **F5.4 visualmente concluída**; persistência isolada pendente em F6 |
| Privacidade | Solicitações LGPD, verificação de identidade, respostas e páginas públicas | **F5.5 visualmente concluída**; persistência isolada pendente em F6 |
| Administração — ajustes pontuais | Visibilidade de categorias Omie | Ajuste localizado concluído em F5 |
| Onboarding | Tutoriais e campanhas de Efetivo, Assinaturas, QR, standby e controles operacionais | Auditoria visual e mobile pendente |

## Auditoria de fechamento do RDO — 04/09/2026

A auditoria combinou inventário de rotas e dependências, contratos automatizados,
`architecture:check` e inspeção em navegador a 390 px no tema escuro. Cliente,
coordenador e colaborador foram exercitados com contas de demonstração. A conta de
gestor disponível na suíte não autenticou no backend local atual; as superfícies
exclusivas desse perfil foram conferidas pelo código, pelos testes de contrato e
pelos testes comportamentais já versionados.

### Superfícies concluídas

| Área | Entregue |
| --- | --- |
| Shell e navegação | `AppShell`, menu mobile suave, navegação por perfil, tema e conta compartilhada |
| Gestor | Pendentes, aprovados, arquivados, projetos, equipe, usuários, estatísticas, apropriação mensal, DDS e NPS |
| Coordenador | Listagens, criação, estatísticas, apropriação, DDS e NPS com opt-in DS |
| Colaborador | Home, pendentes/aprovados, arquivados, serviços em andamento e ações rápidas |
| Cliente autenticado | Portal, métricas, busca, seleção, assinatura/reprovação, cards compactos e contraste escuro |
| Conta | E-mail, senha, notificações e privacidade no mesmo padrão para todos os perfis |
| Formulário | Criação e edição, três etapas, variante somente serviço, serviços, uploads, campos condicionais e ações responsivas |
| Detalhes | Leitura, edição, anexos, downloads, relatório assinado e status assinado informativo |
| Gestão | Projetos ativos/arquivados, equipe, edição, revisão, sequência, upload manual e confirmações migradas principais |
| Dashboards | Visão resumida, estatística detalhada e NPS detalhado reorganizados para leitura responsiva |
| Estados e tema | Loading, vazio, erro, skeleton tokenizado e correções de contraste claro/escuro nas superfícies migradas |

### Correções aplicadas após a auditoria

| Lacuna anterior | Fechamento |
| --- | --- |
| Assinatura e validação públicas | Migradas para a fronteira DS, `BrandLogo`, `Card`, estados semânticos, upload tokenizado e `SignatureDialog` DS |
| Consentimento inicial do cliente | Migrado para card público responsivo, tema escuro e diálogo compacto de eliminação |
| Campos condicionais sem nome acessível | DDS, tema personalizado, standby e turno noturno agora têm associação programática de rótulo |
| Confirmações nativas | Fluxos auditados e as duas ocorrências adicionais encontradas na segunda varredura usam `ConfirmDialog` DS |
| Relatórios no Acompanhamento | `ProjectReportsDialog`, lista, feedback, botões e visualizador fizeram opt-in no DS |
| Gate arquitetural | Verde após decomposição, sem alterar os budgets |
| Micro-scroll em ações | Removido das ações genéricas de card/lista e do gestor; botões compactam na mesma linha |
| Prova visual | Suíte determinística criada e validada em 16 cenários/32 capturas para assinatura e validação públicas: 390/768/1.024/1.280, claro/escuro, Chromium/Firefox |

### Lacunas após a varredura final

Não restou lacuna funcional confirmada dentro do escopo da migração do módulo RDO.
Permanecem como trabalho futuro transversal, sem bloquear o RDO:

- remoção física das regras legadas somente quando os módulos vizinhos que ainda as
  consomem forem migrados;
- ampliação opcional dos snapshots para todas as páginas autenticadas e estados de
  dados, além da matriz pública determinística já versionada;
- execução visual com gestor contra um backend local cuja conta de demonstração
  esteja válida; a cobertura dessa superfície permanece apoiada por contratos e
testes comportamentais mockados.

Validação de fechamento em 04/09/2026: build de produção, check arquitetural,
tipagem E2E e `git diff --check` verdes; lint sem avisos; 27/27 arquivos da suíte
estática do RDO e 16/16 cenários visuais (32 capturas) aprovados. A varredura do escopo também
não encontrou confirmações ou prompts nativos remanescentes. Os únicos overflows
horizontais preservados são deliberados em tabela, chips de filtro e navegação de
abas, não em cards ou linhas de ação.

### Refinamento de Projetos no desktop — 09/09/2026

- A aba Projetos reutiliza o card existente em uma grade de colunas com largura
  mínima de 26rem, incluindo cadastros pendentes e esqueletos. Na matriz
  conferida, há duas colunas em 1280/1440px e três em 1920px; uma busca com
  resultado único não estica o card novamente.
- Resumo, cabeçalho, detalhes e rótulos das ações adaptam-se à largura do card.
  Edição/revisão ocupa a linha inteira enquanto aberta, preservando o espaço
  dos campos; ao fechar, o projeto retorna à grade. Mantidos ordenação, busca,
  estado dos detalhes, permissões e contratos de API. Arquivados foi tratado no
  refinamento seguinte.
- Conferência visual em Chromium com fixtures, claro/escuro, 360, 390, 768,
  1024, 1280, 1440 e 1920px; testes direcionados, lint e build aprovados.
  As regras da grade são exclusivas de desktop, preservando a composição mobile.

### Refinamento de Arquivados no desktop — 09/09/2026

- Arquivados compartilha a grade de Projetos, inclusive nos esqueletos: cards
  com largura mínima de 26rem, duas colunas em 1280/1440px e três em 1920px.
  O cabeçalho mantém Relatórios à esquerda e as três ações à direita.
- Os relatórios internos reutilizam a apresentação em cards da `DataTable`, por
  meio de `layout="cards"`. O padrão responsivo das demais tabelas não muda.
  Mantidos agrupamento por tipo, seleção, ordenação, status, detalhes, pesquisa
  NPS e handlers existentes; botões de seleção continuam na mesma linha e o
  rótulo Selecionar todos permanece completo. Títulos dos relatórios usam o
  token de texto principal nos cards desktop para manter contraste no escuro.
- Conferência em Chromium com fixtures nas larguras 360, 390, 768, 1024, 1280,
  1440 e 1920px, claro/escuro, com relatórios e detalhes abertos e seleção ativa:
  sem overflow horizontal nos cards nem quebra das linhas de ação. Composição
  mobile preservada; sem alterações de endpoints ou regras de negócio.
  Busca com resultado único mantém a largura do card; conferidos seleção
  individual/em lote, recolhimento dos grupos, ordenação, projeto vazio e
  abertura/cancelamento da confirmação de exclusão com dados simulados.
- Lint, build e os 404 testes do frontend aprovados. A suíte completa ainda
  emite avisos de inicialização/encerramento dos servidores Vite usados por
  outros testes; o teste novo da `DataTable` usa servidor SSR isolado sem HMR.

### Relatórios de Arquivados em diálogo e ação de fotos — 09/09/2026

- O botão Relatórios e o título do projeto agora abrem um único `Modal` DS,
  seguindo a interação de Acompanhamento. A lista deixa de expandir dentro da
  grade; detalhes e pesquisa NPS continuam disponíveis no card. O diálogo é
  centralizado também no mobile, com cabeçalho fixo e rolagem vertical do corpo.
- Reutilizados os grupos por tipo e a `ManagerReportListing`, com seleção,
  ordenação, paginação, downloads e demais handlers. Só o projeto aberto carrega
  páginas por tipo; a abertura é transitória e a seleção é limpa ao fechar/trocar
  o projeto. Preferências anteriores continuam legíveis, sem abrir diálogos
  automaticamente. O diálogo de numeração passou ao nível compartilhado da
  página para também atender às ações de Arquivados.
- A lixeira de fotos do `UploadField` DS reutiliza `IconButton` secundário,
  com fundo neutro, ícone vermelho e hover suave. As dimensões não herdam mais
  o botão legado de 18px: ícone de 20px, área de 32px no desktop e 44px no mobile.
  Alteração compartilhada entre criação/edição; confirmação e exclusão somente
  após salvar permanecem inalteradas.
- Validação local com dados simulados no navegador: diálogo sem expandir os
  cards, responsividade de 360 a 1920px e leitura nos temas claro/escuro; ação de
  fotos conferida no formulário real de edição em 360/390/768/1440px. Contratos
  automatizados de Arquivados, numeração e anexos atualizados.

## Início da migração do Efetivo — 04/09/2026

A primeira entrega da F1 + F2.1 começou sem alterar API, permissões ou regras de
planejamento:

- a página-raiz passou de `Shell`/`TopBar` legados para `AppShell`, usando o
  registry existente, perfil compartilhado e submenu das nove áreas;
- a navegação local passou a ter comportamento por teclado no tablet e seletor
  compacto no mobile, mantendo seção e filtros na URL;
- cabeçalho, filtros de data/função, métricas da Visão geral e Disponibilidade,
  estados de loading/erro/vazio e superfície principal do Calendário passaram a
  usar os componentes e tokens do Design System;
- as demais seis áreas permanecem funcionais dentro de uma fronteira de
  compatibilidade tokenizada, para permitir migração progressiva sem regressão.

O detalhe diário e a primeira fatia de Pessoas foram implementados na revisão
abaixo; a matriz completa das demais áreas continua pendente.

### Revisão de Colaboradores e Calendário — 08/09/2026

- Colaboradores: busca e botões Novo, Editar e Indisponibilidade usam componentes
  compartilhados do DS. Programar indisponibilidade, Editar e Remover da lista de
  ausências seguem o mesmo padrão; ações permanecem em uma linha em mobile/tablet.
- Formulários de colaborador e ausência usam `Modal`, `Field`, `Input`, `Select`,
  `Textarea` e `Button` do DS, preservando valores, validações e submissões.
- Portais do Efetivo recebem seus próprios tokens de superfície, texto, campos,
  estados e foco. Confirmações adotam o DS e o destaque compartilhado deixou de
  ter fundo claro fixo no tema escuro; no mobile ficam centralizadas e compactas.
- Calendário ocupa toda a largura disponível, sem painel lateral. Os dias foram
  ampliados; clicar abre um diálogo com eventos, pessoas, vagas e conflitos,
  preservando os links para as entidades e a navegação por data/função.
- Complemento da visão Dia: todas as atividades aparecem na célula, com títulos
  completos e colunas adaptadas à largura disponível. Semana e Mês mantêm três
  eventos e o contador restante; o diálogo continua disponível. Cobertura de
  renderização para 0, 3, 4 e 12 eventos nas três visões.
- Validação: Playwright/Chromium com dados fictícios em 360, 390, 768, 1024, 1280
  e 1440px nas áreas de Pessoas; grade do Calendário em 360, 390, 768, 1024 e
  1440px. Sem overflow horizontal nos recortes testados. Conferidos temas,
  valores da edição, busca, confirmação/cancelamento, foco, Escape, fundo,
  dia/semana/mês, links diretos e perfil viewer. Nenhum cadastro real foi alterado.
- Gates: lint, build, architecture check e suíte de 359 testes aprovados. O Vite
  ainda emite avisos de ciclo de vida dos servidores de teste e tamanho do bundle.

Restam o fechamento visual de Visão geral/Disponibilidade, a validação integrada
de persistência de Pessoas com contas do Efetivo e as ondas de Missões e
Planejamento avançado/Administração. A compatibilidade de cores dos diálogos
legados não equivale à migração completa desses fluxos.

### Revisão transversal do tema no Efetivo e equipe permanente — 08/09/2026

- `EfetivoTheme.css` centraliza a compatibilidade de cores da página, dos portais
  e da prévia de arraste, eliminando aliases incompletos/duplicados. Campos,
  listas suspensas, placeholders, botões, estados desabilitados, validação e
  foco usam os tokens do DS sem alterar fluxos ou regras de negócio.
- Corrigidos fundos fixos de hover/seleção, abas da Administração, avisos de
  pendência, links e indicadores de etapa. As cores configuradas pelo usuário
  para as funções foram preservadas.
- Kanban: `MissionKanbanTeam` exibe líder, participantes e cargos sem expansão,
  tanto nas missões ativas quanto nas canceladas. Removido “Ver líder e equipe”;
  “Equipe e ciclos” e os controles de movimentação permanecem. Nomes/cargos se
  ajustam às colunas, métricas estreitas se empilham e tablets maiores exibem
  três colunas para não comprimir a equipe.
- Conferência com Playwright/Chromium e fixtures: nove abas e as três áreas da
  Administração em desktop/mobile; edição da programação, seleção de equipe,
  ciclos, colaborador, indisponibilidade, cenário, referência, detalhe mensal,
  confirmação de remoção, detalhe diário e tutorial. Inclui estados inválidos,
  Escape e cores calculadas, sem alterações em cadastros reais.
- Kanban conferido de 360 a 1440px, incluindo 768, 1024 e 1280px, sem cortes
  nos participantes; conclusão/cancelamento e prévia de arraste também conferidos.
  O tema claro preserva o layout; seu texto auxiliar sobre a superfície de coluna
  ainda apresenta contraste marginal (4,39:1), a tratar na revisão de acessibilidade
  desse tema, fora do fechamento noturno.
- Lint, build, architecture check e suíte completa aprovados. Acrescentada
  cobertura de renderização da equipe com 0, 1 e 8 participantes, diferentes
  situações e dados incompletos, além de contratos da fronteira de tema.
- Limite: esta revisão fecha as inconsistências de tema observadas, não a
  migração estrutural das áreas legadas. Persistência com contas reais e a
  matriz completa Firefox/WebKit continuam no fechamento das próximas ondas.

### Missões: listagem, programação e conclusão — 09/09/2026

- `MissionsBoard` usa busca, filtro de situação, indicadores, cards, badges e
  ações compartilhados do DS. Pendências preservam a semântica de alerta sem
  pintar o card inteiro; os estados de carregamento, falha com nova tentativa
  e vazio são explícitos. Indicadores não exibem zeros durante erro/carregamento.
- Equipe, Alocar disponíveis, Editar e Remover permanecem em uma linha, sem
  scroll local, de mobile a desktop; também conferido durante a alocação.
  A seleção por URL e o comparativo Planejado × realizado permanecem, com
  acesso ao detalhe pelo teclado no título da missão.
- Programação usa o modal DS com liderança, programação e equipe separadas,
  campos compactos e rodapé fixo. Preservados busca de líder, seletor de equipe,
  validações, preenchimento inicial, períodos individuais, confirmação de
  sobreposição e payload/versionamento das operações existentes.
- Conclusão usa diálogo pequeno e centralizado, com data opcional, limite
  mínimo e preenchimento inicial preservados. O mesmo formulário de programação
  atende à lista, Kanban e missões de cenários.
- Corrigido no `Modal` compartilhado o tratamento de teclado de diálogos
  aninhados: eventos do portal interno não são tratados novamente pelo pai.
  Escape no seletor de equipe fecha apenas o seletor, mantendo a programação.
- Validação com Playwright/Chromium e fixtures: listagem em 360, 390, 768, 1024,
  1280 e 1440px, claro/escuro; programação em mobile/tablet/desktop; conclusão
  em mobile/desktop. Conferidos foco/Escape, formulário inválido, erro sem perda
  dos valores, gravação simulada, atualização dos períodos individuais e
  conclusão sem data. Viewer não recebe ações de gestão na listagem e acessa
  o detalhe pelo teclado. Nenhum registro real foi alterado.
- Novos testes de renderização cobrem manager/viewer, vazio/busca, erro,
  carregamento e seleção no plano oficial/cenário. A lista de superfícies
  habilitadas para os componentes de listagem foi atualizada. Lint, build,
  architecture check e suíte frontend aprovados (73 arquivos de teste).

Próximo lote definido nesta entrega (implementado abaixo): seleção/gestão de equipe e ciclos,
incluindo períodos individuais, conflitos/sobreposições e somente leitura nos
diálogos; finalizar os componentes/estados ainda legados do Kanban e do
comparativo. A compatibilidade de cores desses componentes não encerra sua
migração. Persistência integrada e matriz Firefox/WebKit permanecem pendentes.

### Missões: seleção de equipe, alocações e ciclos — 09/09/2026

- Seleção por disponibilidade recomposta com busca, filtro por cargo, cards,
  contagem de selecionados e ações do DS. Mantidos os quatro grupos, seleção
  temporária, pessoas fora do quadro e confirmação de sobreposição. Colunas
  adaptam-se a desktop/tablet/mobile sem rolagens internas por coluna.
- Gestão direta usa modal DS centralizado, com ciclos do projeto, inclusão de
  colaboradores e participação individual claramente separados. Cada pessoa
  possui um card; seus ciclos são linhas simples, sem novos cards aninhados.
  Badges distinguem herança, ciclos individuais, sobreposição e ciclo em aberto.
- Refinamento do diálogo de equipe: resumo, datas e ações de cada ciclo
  aproximados, com inclusão de ciclo na mesma linha dos campos em desktop.
  Formulários usam `surface-2`/`line-strong`, separados da equipe alocada por
  títulos e divisórias, sem cards adicionais para cada ciclo. No mobile,
  ações permanecem em linha e os campos de datas alinhados. Conferidos
  contraste claro/escuro, foco e overflow em Chromium com fixtures (360–1440px);
  testes direcionados, lint e build aprovados. Fluxos e regras preservados.
- `MissionPeriodFields` compartilha campos de mobilização/desmobilização entre
  programação individual, alocação e criação/edição de ciclos. Preservados
  datas, limites, fim opcional, herança, endpoints e payloads. Quando não há
  ciclos próprios registrados, o período efetivo de participação é apresentado
  com a mesma função de cálculo já usada pelo planejamento.
- Ações ficam em linha; controles e botões de confirmação recebem estado de
  processamento. Falhas preservam os valores e a seleção. Cancelar uma edição
  de ciclo devolve o foco ao acionador. O seletor usa a camada de portais do DS,
  permitindo que a confirmação de sobreposição apareça acima dele.
- `MissionAllocationModal` recebe explicitamente `canManage` da lista e do
  Kanban. Viewer consulta equipe e ciclos sem campos/botões de alteração nem
  consulta de candidatos à alocação; permissões do servidor não foram alteradas.
- Playwright/Chromium com fixtures: dois diálogos, claro/escuro, 360, 390, 768,
  1024, 1280 e 1440px, sem overflow nas ações; foco/Escape, filtros, cancelamento,
  falta de período, carregamento, erro e nova tentativa conferidos. Operações
  simuladas cobriram edição/criação de ciclos gerais e individuais, fim opcional,
  personalização por herança, remoção de ciclos/pessoas e alocação com e sem
  sobreposição. Viewer conferido na lista e no Kanban. Sem escrita em dados reais.
- Cobertura de renderização para manager/viewer, vazio/fechado e ciclos
  herdados/individuais; contratos de campos compartilhados e camadas de diálogo.
  Lint, build, architecture check e suíte frontend aprovados (74 arquivos).

Restam em F2.3 a consolidação estrutural dos componentes/estados do Kanban e do
comparativo Planejado × realizado, a validação de persistência/permissões com o
backend real e a matriz completa Firefox/WebKit. Cenários, Produtividade e
Administração continuam na onda F2.4, sem alteração de suas regras nesta entrega.

## Inventário de diálogos e overlays

### Efetivo

- ausência;
- cadastro operacional de colaborador;
- programação de missão;
- seleção de equipe por disponibilidade;
- alocação e períodos individuais;
- conclusão de missão;
- criação de cenário;
- detalhe de produtividade do colaborador;
- configuração da referência de produtividade;
- cadastro de feriado.

### Assinaturas

- envio de novo PDF;
- publicação e validade dos convites;
- confirmações de arquivar, cancelar e excluir;
- seletor contextual de assinante sobre o PDF;
- fluxo público de leitura e assinatura.

### Demais módulos

Complemento de 11/09: incluir `ProjectRomaneiosDialog`, as fontes POINT/REPORT de
`ProjectCollaboratorHoursDialog`, modal de perfil e remoção de manutenção,
`MaintenanceHistoryModal`, devolução operacional e os diálogos de revelar,
reduzir, rotacionar e revogar credenciais. Inventário/contratos no
[levantamento da main](filtrovali-ds/main-integration-2026-09-11.md).

- Acompanhamento: relatórios da missão, visualizador de PDF, histórico de standby
  e horas por colaborador;
- Estoque: documentos do item e formulários ampliados de item/movimentação;
- Romaneio: etiquetas QR e leitor por câmera;
- Gestor: edição do histórico de cargos e cards do upload manual;
- Qualidade: formulário de registro com destino interno/SGQ.

## Fases de implementação

### F0 — Integração e baseline

Status: concluída neste ciclo.

- integrar a `main` sem perder o redesign existente;
- conciliar Hub, TopBar, cargos e colaboradores;
- atualizar dependências de PDF e QR;
- manter testes de contrato dos dois lados do merge.

Saída: build de produção e suíte estática do frontend verdes.

### F1 — Fundação compartilhada para os módulos novos

Prioridade: P0.

Status: **em andamento** — Efetivo, Assinaturas e Acompanhamento usam `AppShell`; a consolidação
dos demais diálogos continua pendente. Os ajustes do Efetivo foram retomados
nesta worktree em 27/09. No mobile, a barra inferior agora mostra as subabas
do módulo ativo e oferece "Mais" quando há mais de quatro; módulos seguem
acessíveis pelo menu superior.

- migrar Efetivo e Assinaturas de `Shell`/`TopBar` legados para `AppShell`;
- criar modelos de navegação dos dois módulos sem duplicar regras do registry;
- padronizar cabeçalho, filtros, tabs/segmentos, cards, métricas, tabelas e estados;
- consolidar um contrato visual de diálogo sobre o `Modal` existente;
- criar variantes compactas para filtros, selects e formulários no mobile;
- adicionar exemplos dos novos padrões ao harness do design system.
- corrigir os rótulos estruturais apontados pelo check arquitetural;
- iniciar a extração do `GestorPage.tsx`, priorizando blocos já encapsulados e sem
  mudar contratos funcionais.

Critério de saída: as páginas-raiz usam o shell novo e nenhuma navegação funcional
é perdida em refresh, back/forward ou troca de perfil.

### F2 — Efetivo Operacional

Prioridade: P0. Executar em quatro ondas para limitar regressões.

**Concluído tecnicamente em 28/09/2026**, após a retomada de 27/09. Os
componentes e fluxos foram conciliados com `origin/main`. A matriz integrada
usou banco isolado com os oito perfis do módulo e conta sem acesso. No Chromium,
as sete áreas passaram em 390 px para todos os perfis e em 1280 px para gestor,
visualizador, Comercial e Operações. O visualizador também passou no Firefox em
360 e 768 px. Persistência e limites de escrita foram conferidos para gestor,
Operações, Ativos, Suprimentos, Administrativo e QSMS. A execução WebKit fica no
fechamento transversal F6 por dependências ausentes neste host.

#### F2.1 — Navegação e leitura executiva

Status: **validado** — shell, sete áreas, seletor mobile, filtros, métricas e
estados principais de Visão geral, Calendário e Disponibilidade implementados na
primeira entrega. Detalhe diário em diálogo, vagas/conflitos e calendário ampliado
implementados em 08/09; a matriz de leitura e acesso passou em 28/09.

- navegação das sete seções e seletor mobile;
- filtros de data e função;
- Visão geral, Calendário e Disponibilidade;
- detalhe do dia, vagas e conflitos.

#### F2.2 — Pessoas

Status: **validado** — botões, busca e formulários de colaborador/ausência
adequados ao DS em 08/09; responsividade, perfis e estados conferidos na matriz
integrada de 28/09.

- Colaboradores e Ausências;
- lista, busca, disponibilidade e estados selecionados pela URL;
- diálogos de colaborador e ausência;
- histórico e períodos que impactam capacidade.

#### F2.3 — Missões

Status: **validado** — listagem/pendências, programação, conclusão e diálogos
de seleção/alocação/ciclos no DS em 09/09. Sobreposição e somente consulta
conferidos com fixtures; Kanban mantém líder/equipe visíveis. A matriz integrada
confirmou leitura, movimentação bloqueada e ações por área com API real.

- lista de missões e pendências;
- Kanban de evolução;
- programação, equipe, alocações individuais e conclusão;
- estados de conflito, confirmação e somente leitura.

#### F2.4 — Planejamento avançado e administração

Status: **validado** — filtros, indicadores, evolução,
resultados, pendências, regras, acessos, feriados, notificações e atividade usam
controles e estados DS. Detalhe mensal e edição da referência/feriados usam os
diálogos DS; a tabela de produtividade vira cartões em tablet e celular. O
tutorial permanente e os avisos de novidade usam a paleta e os controles do DS.
Operações reais, permissões e navegadores disponíveis passaram na matriz F2.

- Produtividade, pendências e detalhe individual;
- regras, referência, feriados e atividade/auditoria;
- tutorial permanente e campanha de novidade.

Critério de saída: todas as sete seções e os diálogos ativos passam na matriz
desktop/mobile, inclusive com usuário viewer e manager.

### F3 — Assinaturas

Prioridade: P0.

**Migração e validação técnica concluídas em 10/09/2026**, com Efetivo em standby.
Conferência em celular físico combinada com o usuário; detalhes na F3.5.

#### F3.1 — Biblioteca de documentos

- [x] Shell compartilhado, breadcrumb, perfil/conta e navegação de ativos/arquivados.
- [x] Lista vertical, busca e filtro de status com componentes DS, preservando a URL.
- [x] Cards, progresso de assinaturas, status semântico e aviso de convites expirados.
- [x] Card inteiro clicável via `Card` interativo compartilhado, sem botão “Abrir”
  separado ou controles aninhados; clique, Enter e Espaço mantêm a navegação
  existente (rascunho abre na preparação, demais documentos no acompanhamento).
- [x] Métricas do recorte exibido, loading, vazio, busca sem resultado, erro e nova tentativa.
- [x] Diálogo compacto de novo documento e upload de PDF com opt-in DS.
- [x] Refinar espaço entre logo e ação “Ver tutorial” no cabeçalho autenticado
  em 360px: `IconButton` com nome acessível no mobile, texto preservado no desktop.
- [x] Validação integrada com backend isolado e matriz Firefox/WebKit — F3.5.

Entrega inicial: `DocumentLibrary` isola a apresentação sem mover consultas ou
mutations. `AssinaturasAppShell` usa o registry existente. `PdfDropzone` ganhou
aparência DS opcional, com tokens, ícones compartilhados e remoção acessível;
os consumidores legados mantêm o padrão anterior. PDF até 20 MB, título opcional,
payload de criação e encaminhamento ao editor permanecem iguais. O formulário
bloqueia fechamento/submissão duplicada enquanto lê ou envia o arquivo.

Os indicadores são calculados **somente sobre os itens exibidos**, inclusive após
filtros. O endpoint já oferece `nextCursor`, mas a listagem anterior não navegava
por cursor: esse contrato não foi ampliado nesta migração visual. Quando há mais
itens, a biblioteca identifica o recorte e orienta o uso dos filtros. Paginação
do acervo fica registrada como melhoria funcional separada, não como total global
artificial nos indicadores.

Validação desta fatia: biblioteca e upload conferidos com Playwright/Chromium e
fixtures em 360, 390, 768, 1024, 1280 e 1440px, claro/escuro, sem overflow nos
cards/ações. Conferidos diálogo compacto, Escape/retorno de foco, busca/status,
arquivados, menu lateral com filtros, refresh/histórico, abertura de documento,
arquivo obrigatório, remoção por teclado e falha de envio sem perda do
formulário/payload. Criação simulada sem título confirmou a abertura da
configuração na página 1 e o fechamento do diálogo. Sem escrita
em registros reais. Suíte frontend (75 arquivos), lint, build de produção e
`architecture:check` aprovados; avisos existentes de Vite/bundle permanecem.

O lote de preparação F3.2 foi implementado na continuação abaixo. A migração da
biblioteca não representa o fechamento visual do módulo inteiro.

#### F3.2 — Preparação

- [x] Cadastro e identificação dos assinantes com `Card`, `Field`, `Input`,
  `Button`, `Badge` e remoção por `IconButton`; erros de envio visíveis sem apagar
  o formulário. Mantidos cadastro próprio, e-mail opcional e ordem dos assinantes.
- [x] Editor com cabeçalho, paginação, instruções e ações DS em uma linha,
  inclusive mobile/tablet; formulário lateral no desktop e empilhado nas telas
  menores, sem alterar payloads ou coordenadas normalizadas.
- [x] PDF com superfície tokenizada, skeleton e erro/retry de download/decodificação;
  controles só são posicionáveis após carregar a imagem. Bounds acompanham a
  altura real do PDF, inclusive em paisagem. Rolagem espacial restrita ao PDF.
- [x] Seletor contextual com identificação por número/cor, nomes legíveis,
  foco inicial e Escape; lixeira compartilhada, contraste e foco visível.
- [x] Publicação em modal compacto, campos DS, validade predefinida/personalizada,
  lista de assinantes e erros semânticos; submissão bloqueada durante o salvamento
  dos campos e a publicação, mantendo a persistência antes do envio dos convites.
- [x] Validação integrada com backend isolado e matriz Firefox/WebKit — F3.5.
- [ ] Conferência em aparelho touch físico, combinada com o usuário na F3.5.

O cabeçalho comum do documento, abas, datas, downloads e confirmações de
arquivar/cancelar/excluir também passaram ao DS, para não deixar uma moldura
legada em torno do editor. A lista de status/convites e a auditoria ficaram para
a F3.3, implementada na continuação abaixo.

Estilos locais em `AssinaturasPreparation.ds.css`, sem alterar o CSS global, a
assinatura pública, APIs, hooks de consulta ou permissões. A paleta de identificação
dos assinantes é reutilizada; superfícies e textos usam tokens claro/escuro.
Efetivo permanece sem novas alterações nesta rodada.

Validação da F3.2: Chromium com fixtures em 360, 390, 768, 1024, 1280 e 1440px,
claro/escuro, sem overflow de página nem quebra nas ações do editor. Conferidos
seletor junto às bordas e após rolagem do PDF, foco/Escape, cadastro próprio,
adição/remoção e erro sem perda do formulário; uma/múltiplas assinaturas,
movimentação por teclado, arraste, resize, cancelamento do gesto e paginação
com PDF em paisagem. Loading, falha de download/decodificação e retry preservam
os campos. Publicação bloqueada quando faltam campos ou seu salvamento falha;
PUT de campos antes do POST de publicação e payloads conferidos com respostas
simuladas. Confirmadas caixa compacta de arquivamento, proteção na finalização e
confirmação digitada para excluir concluído, sem executar ações em registros reais.
Suíte frontend (76 arquivos), lint, build de produção, `architecture:check` e
`git diff --check` aprovados. Permanecem os avisos existentes de Vite/bundle.

Os lotes F3.3 e F3.4 foram implementados nas continuações abaixo.
Backend real e Firefox/WebKit foram conferidos na F3.5. A interação em dispositivo
touch físico fica com o usuário, sem reimplementação do fluxo funcional.

#### F3.3 — Acompanhamento e auditoria

- [x] Resumo do progresso usando `document.progress`, downloads com estado de
  processamento e avisos semânticos de finalização, conclusão e cancelamento.
- [x] Cards de assinantes no DS, com duas colunas no desktop e uma nas telas
  menores; nome/e-mail legíveis, status da assinatura separado da entrega do
  e-mail e assinatura concluída em azul informativo, não verde de aprovação.
- [x] Copiar, renovar, reenviar e revogar em uma linha, sem mini-scroll. Rótulos
  compactos têm nomes acessíveis completos; processamento evita repetir ações.
  Mantidas condições por status/e-mail, renovação de 15 dias e cópia do link.
- [x] Revogação em `ConfirmDialog` compacto DS, com confirmação, erro/sucesso e
  proteção contra repetição. Escape devolve o foco à ação; após revogar, o foco
  vai ao nome do assinante, pois o botão deixa de existir. Confirmações gerais
  já tinham sido migradas na F3.2.
- [x] Auditoria em linha do tempo com datas de São Paulo, descrições completas,
  identificação semântica dos eventos e fallback para tipos ainda desconhecidos.
  Ordem da API, query key e cursor preservados; sem filtro/paginação local parcial.
- [x] Loading tokenizado, vazio, erro e retry; retorno à primeira página mantido
  mesmo quando a página seguinte está vazia ou indisponível. Cursor reiniciado ao
  mudar de documento; contagem identificada como eventos **nesta página**.
- [x] Validação integrada com backend isolado e matriz Firefox/WebKit — F3.5.

Estilos isolados em `AssinaturasTracking.ds.css`; `DocumentTrackingSummary`
reutiliza os componentes do DS e não faz consultas próprias. APIs, permissões,
normalização de URL e polling de finalização não foram alterados. Efetivo e
assinatura pública permanecem fora das alterações desta rodada.

Validação visual da F3.3 com Playwright/Chromium e dados simulados em 360, 390,
768, 1024, 1280, 1440 e 1920px, nos temas claro/escuro: cards, ações e timeline
sem overflow horizontal, inclusive com nomes/e-mails e descrições extensas.
Conferidos copiar/renovar (mantendo 15 dias), reenvio com erro/retry, revogação
com erro, confirmação compacta, bloqueio durante processamento e foco; auditoria
com cursor, página seguinte vazia, erro/retry e skeleton; estados de finalização,
conclusão/cancelamento, downloads e ausência de assinantes. Nenhum convite real
foi enviado ou documento real foi alterado.

Validação automatizada final: 421 testes frontend aprovados, lint, build de
produção, `architecture:check` e `git diff --check` sem falhas. Permanece o aviso
de tamanho dos chunks no build; Firefox/WebKit e backend real não foram exercitados
nesta rodada.

A assinatura pública foi implementada na F3.4 abaixo. A validação integrada com
backend real e Firefox/WebKit está registrada na F3.5; touch físico fica com o usuário.

#### F3.4 — Assinatura pública

- [x] Shell público com `BrandLogo` adaptativo e `ThemeToggle`; cards e tipografia
  DS para documento, solicitante, assinante, validade e progresso informado pela API.
- [x] Leitura paginada com ações em linha abaixo da página, PDF nas cores originais
  e campos em coordenadas normalizadas. Loading/erro/retry HTTP e de decodificação
  da imagem; respostas antigas descartadas e URLs temporárias liberadas.
- [x] `SignatureDialog` compartilhado com opt-in DS e caixa compacta no mobile;
  nome completo, desenho/limpeza ou envio/remoção de PNG/JPG e consentimento
  existentes preservados. Links do aviso de privacidade em azul com contraste.
- [x] Erros de envio dentro do diálogo; fechamento bloqueado durante envio,
  estado de processamento e foco devolvido ao título após a assinatura.
- [x] Link inválido, expirado ou indisponível, erro de conexão com retry, assinatura
  registrada aguardando demais, finalização e conclusão com download. Status
  “Assinado” informativo azul; sem alertas de sucesso duplicados.
- [x] Fragmento removido da URL e token mantido somente em memória/header;
  cache nominal desativado no público. Payload/versão do consentimento, endpoints,
  query key opaca e polling de 2s preservados, sem reenviar assinatura nem recarregar
  a mesma imagem durante a finalização.
- [x] Validação integrada com PDF de teste, API real e Firefox/WebKit — F3.5.
- [ ] Conferência em aparelho físico, combinada com o usuário na F3.5.

Apresentação isolada em `PublicSignatureView.tsx` e
`AssinaturasPublicSignPage.ds.css`; controlador público mantém as requisições.
O diálogo compartilhado ganhou apenas opções de moldura mobile e rótulo acessível
de processamento; valores padrão dos outros consumidores não foram alterados.
Efetivo, fluxos autenticados e contratos de API permanecem fora desta alteração,
exceto pelo refinamento solicitado do card clicável da biblioteca.

Playwright/Chromium com fixtures: página pública em 360, 390, 768, 1024, 1280,
1440 e 1920px, nos dois temas, sem overflow horizontal e com geometria dos campos
conferida. Verificados paginação, loading, falhas HTTP/imagem inválida e retry,
convites expirados/revogados, validação do nome, aceite obrigatório, desenho/limpeza,
upload/remoção, erro e nova tentativa de assinatura, finalização por polling,
foco e download com falha/retry. Acesso público sem login e link ausente conferidos.
Cards da biblioteca verificados em 360/768/1440px nos dois temas, com clique no
fundo, Enter, Espaço e encaminhamento do rascunho ao editor. Nenhum documento real
foi assinado. Validação automatizada final: 423 testes frontend, lint, build,
`architecture:check` e `git diff --check` aprovados. Permanece o aviso de tamanho
dos chunks no build.

#### F3.5 — Validação técnica final

Status: **concluída em 10/09/2026**, com conferência física combinada com o usuário.
Esta rodada complementa as validações com fixtures descritas nas entregas anteriores.

- [x] Cabeçalho autenticado sem sobreposição em 360px; tutorial continua acessível
  por botão compacto no mobile e rótulo completo no desktop. Nenhum ajuste global
  de tamanho do logo ou do `TopBar` foi necessário.
- [x] Chromium, Firefox e WebKit: biblioteca, preparação, acompanhamento, auditoria
  e assinatura pública nos temas claro/escuro. Biblioteca/acompanhamento/público
  conferidos em 360, 390, 768, 1024, 1280, 1440 e 1920px; preparação até 1440px.
  Ações em linha, ausência de overflow, geometria, foco/Escape, paginação, teclado,
  arraste/resize, consentimento, desenho/limpeza e envio/remoção de imagem verificados.
  Erros HTTP/decodificação, convite expirado/revogado, retry e estados finais também
  exercitados com respostas controladas. WebKit Linux não equivale a Safari em iPhone físico.
- [x] Integração real no Chromium com backend desta branch, PostgreSQL descartável,
  migrações aplicadas, três contas sintéticas e e-mail desativado. PDF fictício com
  duas páginas (retrato/paisagem): upload, dois assinantes, campos, publicação,
  assinatura por touch emulado e por PNG, progresso, auditoria e download final.
  PDF baixado tem as duas páginas assinadas e uma folha de evidências; nomes e
  posições conferidos. Nenhum documento ou conta de outras worktrees foi alterado.
- [x] Arquivar/restaurar pela interface; cancelamento/exclusão/restauração e
  renovação/revogação pela API real nos registros de teste. Token anterior inválido
  após renovar (404), novo token funcional (200), revogado inválido (404). Conta sem
  permissão recebe 403; outra conta não vê nem acessa documento do proprietário (404).
- [x] Corrigida falha encontrada na prévia de PDFs com fontes padrão não instaladas
  no servidor: o renderizador usa as fontes incluídas no PDF.js. Cache de prévia
  versionado ignora imagens antigas sem apagar arquivos; PDF original, hashes,
  coordenadas e APIs permanecem intactos. Dois testes reproduziram as falhas antes
  da correção e passaram depois, incluindo fonte acentuada, rotação e cache.
- [ ] Teste manual em celular físico pelo usuário: desenhar, limpar, enviar/remover
  PNG/JPG e confirmar em um documento de teste; conferir rolagem do diálogo e
  leitura nos dois temas. Quando possível, verificar também posicionamento dos
  campos por toque na preparação. Não tratado como concluído por emulação.

Validação final: **424 testes frontend e 60 testes backend de Assinaturas aprovados**;
lint, build, arquitetura e `git diff --check` verdes. Permanecem avisos de tamanho
dos chunks no build e mensagens de encerramento de `vite:dep-scan` nos testes SSR,
sem falha na suíte. Capturas locais em `output/playwright/`, incluindo
`final-real-corrected-preview-dark-mobile.png` e `final-real-assinado.pdf`.
Os testes de erro de e-mail são controlados: entrega SMTP real não foi disparada
nem homologada nesta rodada. A correção de prévia exige publicar/reiniciar também
o backend desta branch; não há nova dependência nem alteração de schema.

Próxima frente visual na ordem do roadmap: **F4, começando por Acompanhamento**.
Efetivo permanece em standby. Nenhuma implementação da F4 foi iniciada nesta validação.

Critério de saída: configuração por mouse e toque, assinatura pública e lifecycle
funcionam sem overflow e com o mesmo vocabulário visual do app.

### F4 — Acompanhamento, Estoque e Romaneio

Prioridade: P1.

Status em 11/09/2026: **Acompanhamento com A1/A2/A3a implementados no baseline
anterior**. O merge amplia o detalhe, diálogos e Sede; as novas superfícies ainda
precisam de UI. Efetivo em standby; Estoque e Romaneio ainda não iniciados.

- Acompanhamento: concluir detalhe/faturamentos, cronograma, diálogos de apoio,
  Sede e Custo; manter o PDF como overlay espacial deliberado;
- Estoque: harmonizar tabela expansível, lotes, devolução em lote, documentos e
  filtros/ordenação;
- Romaneio: harmonizar gatilhos, prévia/impressão de etiquetas e scanner; garantir
  fallback quando câmera ou permissão não estiver disponível.

Critério de saída: novas ações permanecem em uma linha nos cards e não introduzem
scroll localizado acidental em 360 px de largura.

#### F4.1 — Acompanhamento: lotes e fronteiras de migração

| Lote | Superfícies | Estado |
| --- | --- | --- |
| A1 — Entrada e visão consolidada | Shell, navegação das quatro áreas, filtros, indicadores, comparativos, categorias e listagem do Dashboard | **Implementado** |
| A2 — Projetos | Cards, agrupamento/desagrupamento, renomeação, apropriação de mão de obra, filtros, conferência e arquivamento/restauração | **Implementado** |
| A3a — Detalhe do projeto | `ProjectDetailDashboard`, custos previstos/realizados, composição das propostas, notas, desvios, progresso/metas, equipe e leitura do escopo | **Implementado** |
| A3a.1 — Complemento da main | `ProjectInvoicesSection`: faturamentos, recebimento e sincronização; preservar a TAG dos equipamentos em obra já exibida nos cards/detalhe | **Implementado no código; integração real em A7** |
| A3a.2 — Dashboard do projeto | Resumo visual aprovado: destaque do avanço, indicadores de prazo/custo/desvios/equipamentos, histórico, composição por serviço e navegação para os detalhes, com dados reais e recortes existentes | **Implementado no código; validação integrada em A7** |
| A3b — Edição do planejamento | `ProjectScheduleEditor`, propostas adicionais/revisões e editor de escopo previsto, incluindo consumidores compartilhados | **Implementado no código; novos rótulos da main e integração real em A7** |
| A3c — Conciliação do realizado | Novo `ProjectRealizedCorrections` no avanço físico, histórico, ajuste e restauração de metragens RTH/RLQ/FLU | **Migração visual implementada no código; integração real em A7** |
| A4 — Diálogos de apoio | Relatórios/PDF, standby, jornadas POINT/REPORT e novo `ProjectRomaneiosDialog` com seus gatilhos | **Migração visual implementada; validação completa em A7** |
| A5 — Sede | Períodos, gastos globais, categorias, detalhamento e novos indicadores aprovados de manutenção/produção em `SedeOperationalCards` | **Migração visual implementada; validação completa em A7** |
| A6 — Custo | Motor/simulação, cargos/perfis, parâmetros/EPI, importação e conciliação de ponto, pendências e auditoria de alocação | **Migração visual implementada; validação completa em A7** |
| A7 — Fechamento | Matriz de perfis/navegadores/estados, persistência em ambiente isolado e retirada de CSS sem consumidores | **Concluído em 28/09; WebKit em F6** |

Atualização de 27/09/2026: A6 removeu as regras globais sem outros consumidores
do Ponto e passou pendências, auditoria, cargos e simulador para estilos locais
com tokens do design system. As tabelas largas de Custos usam cartões também no
tablet. A navegação por dez telas/subabas foi conferida no Chromium com conta
gestora em banco isolado e respostas simuladas de Custo/Ponto em 360, 390,
820 e 1440 px, sem overflow horizontal ou erros de JavaScript; o tema escuro
foi conferido no Simulador. Em 28/09, A7 validou gestor, visualizador e gestor
interno com permissão fiscal em banco isolado; a API confirmou recortes, custos,
nome local do card, agrupamento e proteção financeira. Chromium e Firefox
cobriram 390, 768 e 1280 px sem overflow ou erro de JavaScript. Foram retiradas
328 regras globais do Acompanhamento sem consumidores. A suíte passou com 652
testes frontend e 1.771 backend aprovados (9 ignorados), além de build e lint
sem erros. WebKit permanece em F6.

A TAG mencionada em A3a.1 é o código de identificação do **equipamento em obra**,
exibido antes do nome quando disponível. A exibição já existe em
`ProjectOverviewMetrics` e `ProjectDetailDashboard`; ela não é uma tag de status
do projeto nem exige um novo campo de status.

No A3a.2, o gráfico usa o histórico semanal de avanço disponível na API. Ritmo
diário, último quantitativo lançado e demais números ilustrativos da prévia não
foram transportados como dados do projeto. O recorte de escopo/equipamento altera
avanço, meta, histórico e composição; prazos, gastos, equipe e desvios permanecem
identificados como totais da missão. Faturamentos e impostos mantêm a permissão
financeira existente. Em projetos sem meta semanal, a composição geral usa o
avanço por serviço já calculado pela API. A7 conferiu dados, estados vazios,
agrupamentos, perfis e interações no ambiente integrado em 28/09.

O refinamento visual de A3a.2 aproxima a tela da prévia aprovada: histórico
semanal em colunas, cartões de serviço com realizado/meta/excedente, linha do
tempo de marcos, indicadores do uso do tempo, composição gráfica dos custos e
resumo de faturamento. Cálculos, gastos manuais, metas e conferências detalhadas
continuam disponíveis em seções expansíveis. O mesmo arranjo se adapta ao
desktop e ao celular sem criar valores demonstrativos na aplicação.

Prévia aprovada: [HTML interativo](filtrovali-ds/project-dashboard-preview.html),
[captura desktop](filtrovali-ds/project-dashboard-preview-desktop.png) e
[captura mobile](filtrovali-ds/project-dashboard-preview-mobile.png). Os valores
do protótipo são ilustrativos; o dashboard implementado usa os dados disponíveis
na aplicação.

Entregue em A1:

- `AcompanhamentoAppShell` usa o registry compartilhado, perfil/conta, tema,
  breadcrumb e subnavegação. Após refinamento, as áreas ficam apenas na barra
  lateral/menu hambúrguer, sem submenu duplicado no conteúdo.
- Parâmetros `section`, `project`, `group`, `cards` e `cost` preservam as regras
  anteriores de entrada e troca de área; demais parâmetros não são descartados.
- `FilterBar` com busca, modalidade, situação, categoria e os mesmos 20 indicadores;
  controles em sheet no mobile, com limpeza de filtros e retorno de foco.
- KPIs mantêm as somas existentes; o contador identifica **projetos e grupos**, não
  o total de missões contidas em grupos. O indicador percentual continua sendo soma,
  explicitamente rotulada, sem introduzir uma média ou novo cálculo financeiro.
- Comparativo dos até 15 maiores valores positivos e categorias globais usam o novo
  `BarList` compartilhado. O painel global informa que não acompanha os filtros.
- `DataTable` consolidada por tema no desktop; cards em mobile e em duas colunas no
  tablet. Valores original/adicional, realizado **pago**, margem, dias, RDOs e avanço
  preservados. O nome do projeto abre o cronograma por controle nativo; grupos não
  abrem o editor de uma missão individual.
- Loading tokenizado, vazio inicial/filtrado, erro/retry e aviso de falha na
  atualização com dados em cache. Filtros permanecem disponíveis após categoria sem
  resultados. Tutorial usa o breakpoint e as âncoras visíveis atuais.
- `RealizedCategoryBreakdown` recebe aparência DS opcional; demais consumidores
  continuam legados. O modal/editor de cronograma **não foi migrado neste lote** e
  permanece fora da fronteira `.fv-ds`, mantendo os comandos e a permissão existentes.

Contratos: sem alterações de backend, APIs, query keys, polling, cálculos ou
persistência. A permissão existente de planejamento é mantida inclusive para quem
possui `acompanhamento:viewer`; a área Custo e seus avisos continuam exclusivos de
gestores/administradores. Esta etapa não redefine permissões por interpretação do
nome do perfil. Em A1, `.fv-ds` cobre apenas a navegação e o Dashboard; em A2 a
fronteira passa a incluir a listagem de Projetos, sem envolver o detalhe legado.

Validação de A1: testes de contrato/renderização, suíte frontend, lint, build e
`architecture:check`; conferência por navegador com API interceptada e dados fictícios,
sem gravar no backend. Detalhes e limites estão no mapa de migração. Integração real
dos editores permanece como gate de A3/A7, não como entrega de A1.

Entregue em A2:

- Cards DS em uma coluna no mobile, duas a partir de 768px e três a partir de
  1536px. Informações separadas por execução, custos, jornada/equipe, equipamentos
  e datas, sem empilhar cards internos. Valores original/adicional, impostos,
  offshore, horas normais/HE e membros dos grupos preservados.
- `ProgressBar` compartilhada substitui as barras locais; texto mantém os valores
  reais (inclusive acima de 100%), limitando somente a geometria decorativa.
- Busca por código/nome/cliente/CNPJ e membros; quatro situações e contagens
  preservadas, com seletor mobile. Skeleton, vazio inicial/filtrado, erro/retry e
  aviso de dados em cache mantêm os filtros disponíveis.
- Card inteiro clicável por botão de superfície compartilhado (`Card.surfaceAction`),
  com teclado e foco visível; campos, seleção, ajuda e ações permanecem independentes,
  sem controles aninhados. Botão Detalhes removido. Ações rápidas em uma única linha
  à direita; Arquivar/Restaurar exibem ícone e texto.
- Avisos operacionais em tags compactas que acomodam mensagens longas, sem a caixa
  expandida de alerta. Contadores das situações usam `Button.counter`, com espaço
  próprio e aparência arredondada integrada ao botão ativo/inativo.
- Unificação conserva a seleção durante filtros; renomeação inline mantém
  validação, Escape e erro junto ao campo. Política de mão de obra e missão
  principal conservam as opções e os payloads existentes. Ajuda de renomeação
  acompanha a nova posição do lápis.
- Confirmações de desmesclagem e arquivamento/restauração usam o diálogo DS
  compacto, bloqueiam duplo envio e apresentam falha dentro da caixa.
  `ConfirmDialog.errorMessage` é opcional, sem mudar os demais consumidores.
- Arquivamento continua exclusivo do Acompanhamento. Missão arquivada apenas em
  Relatórios não ganha restauração indevida; conferência mantém a separação das
  abas Arquivados/Conferidas. Permissões, APIs, query keys e polling preservados.

A revisão de código localizou propostas adicionais/revisões no detalhe/editor,
não nos cards. Esse item foi explicitamente transferido de A2 para A3; formulários
do RDO não foram alterados. Ao encerrar A2, detalhe, cronograma, diálogos de apoio,
Sede e Custo continuavam pendentes; a entrega A3a está registrada abaixo.
Efetivo permanece em standby. Validação e limites de A2 no mapa de migração.

Entregue em A3a — detalhe do projeto (10/09/2026):

- Cabeçalho com missão/cliente, metadados e avisos compactos; indicadores organizados
  por tema. Execução, prazo e escopo ficam juntos; custos e impostos ocupam a segunda
  coluna no desktop. Mobile/tablet mantêm leitura linear sem scroll horizontal local.
- Reutilizados `Card`, `ProgressBar`, `BarList`, `Badge`, `Button`, `Field`,
  `Input`, `Textarea`, `Alert`, `Skeleton` e `DataTable`. Gráfico semanal,
  metas e informações auxiliares consomem tokens, incluindo contraste no modo escuro.
- Custos manuais, notas, desvios, composição de propostas e impostos mantêm
  os mesmos payloads, permissões, cálculos e expansões. Notas têm campo proporcional
  e autoria/data; validação e falhas de envio aparecem junto ao formulário.
- Colaboradores usam tabela no desktop e cards em telas menores. Apropriação do
  ponto continua acionável; jornada dos RDOs aparece em azul como referência,
  sem ser convertida em custo. Deslocamento e sobreposição dos grupos preservados.
- Carregamento, indisponibilidade, erro inicial com retry e falha de atualização
  com dados em cache são distintos. Planejamento, escopo, desvios e notas recebem
  feedback e recuperação de falhas independentes.
- Detalhe de agrupamentos mantém membros/cronogramas individuais, sem consultas
  ou formulários de notas/desvios/custos individuais indevidos.
- Separados `projectDetailModel`, `ProjectDetailVisuals`, `ProjectDetailHistory`,
  `ProjectDetailCosts` e `ProjectDetailPeople`. A fronteira `.fv-ds` termina
  antes do cronograma e dos diálogos compartilhados ainda legados naquele lote.

A3 foi dividido após verificar que o cronograma compartilha edição de escopo,
propostas e regras de mão de obra com outros consumidores. A migração A3b está
registrada abaixo, preservando o fluxo de gravação. A4 mantém histórico
de standby/horas e revisão integrada dos relatórios/PDF; Sede, Custo e A7 continuam
na sequência. Nenhuma alteração de backend ou do módulo Efetivo nesta etapa.

Validação de A3a: 15 testes focados de renderização, valores monetários, metas,
validação de formulário, permissões e contratos dos relatórios; suíte frontend
completa (81 arquivos), lint, build e gate arquitetural aprovados. Chrome e Firefox
em 360/390/640/768/1024/1280/1536 px, claro/escuro, sem overflow nos painéis.
Custos (sucesso/falha/exclusão), notas, expansão de desvios/propostas/impostos,
entrada dos diálogos e volta/reabertura por teclado conferidos com API interceptada.
Loading, vazio, erro/retry, falha de atualização preservando o cache, formulários
em quatro larguras e perfis gestor/viewer/sem acesso passaram nos dois navegadores.
Capturas locais em `output/playwright/acp-detail-*`. Persistência real, aparelhos
físicos e validação completa das superfícies ainda legadas permanecem em A3b/A4/A7.

Entregue em A3a.1 (24/09/2026): faturamentos do projeto e do grupo usam `Card`,
`DataTable` responsiva, `Badge`, `Alert`, `Skeleton` e `Pagination` do DS. A UI
mantém bruto/recebimento separados, parcelas, vínculo Omie, primeira sincronização,
snapshot antigo e consulta periódica. Falha de atualização com dados em cache
preserva o histórico visível. O detalhamento de avanço por UG/sistema recebe
aparência DS no detalhe; Cronograma e Conciliação seguem com a aparência legada
até seus próprios lotes. O indicador de equipe planejada no detalhe usa `Badge`
DS. A TAG do equipamento em obra já estava exibida nos cards e no detalhe e foi
preservada. O CSS legado exclusivo de faturamentos foi removido.

Validação de A3a.1: testes focados, build, lint sem erros e gate arquitetural
aprovados; conferência visual com dados fictícios em 360 px claro, 768/1280 px
escuro, sem rolagem horizontal. Persistência e respostas reais do Omie seguem
para A7.

Entregue em A3b (24/09/2026): as duas entradas do Cronograma usam `Modal` DS
com ações fixas, e `ProjectScheduleEditor` usa campos, cartões, alertas e estados
DS. Escopo previsto mantém grupos, pesos, sistemas, diâmetros e horas, agora com
controles DS; a comparação de horas usa `DataTable` responsiva. Avanço físico e
categorias usam a aparência DS apenas no Cronograma, mantendo os consumidores
legados de Conciliação. O seletor de revisões no Gestor usa `Select` DS, sem
alterar escolha, aplicação ou remoção das propostas adicionais. Salvar único,
estado de alteração, permissões e bloqueio da conciliação até salvar foram
preservados. Conferência visual com dados fictícios em 360 px claro e 768/1280 px
escuro, inclusive serviço expandido, sem rolagem horizontal. A edição de data
habilita Salvar e bloqueia a conciliação. Persistência real, respostas da API e
matriz completa de perfis permanecem no fechamento A7.
Validação técnica de A3b: suíte frontend completa (118 arquivos de teste), build
e gate arquitetural aprovados; lint sem erros, com dois avisos anteriores em
Efetivo e Romaneio.

Entregue em A3c (25/09/2026): `ProjectRealizedCorrections` usa a aparência DS
no detalhe e no Cronograma, com cartões, badges, alertas, campos, botões e estados
de loading/erro/vazio. Histórico, aviso de origem alterada, edição e restauração
continuam ligados ao fluxo recebido da main. O consumidor legado mantém a
apresentação anterior. O teste com dados sintéticos cobriu leitura e permissão
de gestão; conferência visual em 390 px claro e escuro foi realizada. Persistência
real, revisão concorrente e matriz completa de perfis seguem em A7.

#### F4.2 — Equipamentos e configuração de manutenção (novo escopo)

- [x] **EQ1:** shell/abas, entrada de configuração e componentes compartilhados.
- [x] **EQ2:** supervisor, perfis/checklists, categorias/intervalo/visibilidade e
  exceção por equipamento; formulário de perfil e confirmação de remoção.
- [x] **EQ3:** cards/ações, histórico e downloads; consulta e gestão nos dois temas.

Equipamentos não estava explicitamente coberto na fila anterior. Sua configuração
é dependência de M3/M4; migrar conjuntamente os consumidores de checklists e
categorias, sem alterar a política herdada/explícita de cada equipamento.

#### F4.3 — Manutenção/Produção (novo módulo)

- [x] **M1:** AppShell, Hub, abas/URL, cards/listagens e filtros por permissão.
- [x] **M2:** campos centrais e stepper DS alinhados ao formulário RDO aprovado,
  preservando os autosaves distintos e os cálculos compartilhados de horas.
- [x] **M3:** manutenção, avulsa, produção, terceiros/anexos e revisão/devolução;
  aprovado em consulta; zero manutenções no RDO é permitido pelo contrato atual.
- [x] **M4:** programação preventiva e histórico com ordenação, paginação e
  documentos; alinhamento com EQ2 sem introduzir cálculos no frontend.
- [x] **M5:** fechamento de perfis/estados/temas/navegadores e persistência isolada.

`ReportCoreFields` foi adaptado com stepper, cartões, campos e ações do DS sem
alterar o editor RDO. O rascunho operacional continua separado por usuário e
tipo de relatório.

EQ1/M1: Equipamentos e Manutenção/Produção agora usam o AppShell, com subabas
conforme a permissão no menu lateral e na barra inferior mobile. Filtros, ações
e listagens iniciais usam superfícies e controles do DS; o seletor mobile legado
de Equipamentos foi retirado. Rotas, busca, ordenação e política de acesso foram
preservadas. Build, lint dos arquivos alterados e testes estáticos dos módulos
passaram; a inspeção visual em navegador ficou pendente naquele momento por
falta de `libnspr4.so` e foi retomada na validação de EQ2 abaixo.

M2–M5: formulário operacional, manutenção avulsa, produção, terceiros, anexos,
revisão e consulta aprovada usam o shell e os controles do DS. Programação e
histórico usam indicadores, cards, badges e estados de carregamento, vazio e
erro do DS; filtros, paginação, ordenação e downloads preservam as chamadas à
API. A inspeção com respostas sintéticas cobriu oito telas em Chromium a 390,
768 e 1280 px, e cinco telas em Firefox e WebKit a 390 px, sem rolagem
horizontal; 768 px foi conferido no tema escuro. Conta interna com permissão
apenas para manutenção não mostrou Produção, e a consulta aprovada permaneceu
desabilitada. O rascunho de manutenção restaurou os dados após atualização e
não preencheu o formulário de produção. Build, lint, 22 testes frontend focados
e 32 testes backend de contratos operacionais passaram. A persistência de um
relatório sintético de manutenção e outro de produção foi conferida no banco
local em transação revertida, sem registros remanescentes. A suíte frontend ampla
teve 648 de 660 testes aprovados; os 12 resultados com falha apontam para
assertivas estáticas em superfícies não alteradas nesta rodada.

Revisão de EQ1: as categorias foram reunidas em uma única subaba. A lista mostra
uma tabela por categoria no desktop e cards em telas menores, com busca e ordem
globais. Cadastro, histórico, dados técnicos, downloads e envio de PDFs foram
mantidos; URLs antigas `tab=cat:<id>` ainda abrem a categoria correspondente.

EQ2: configuração de manutenção e categorias usam superfícies, botões e diálogos
do DS. Foram migrados supervisor, lista/edição/remoção de perfis e seus serviços,
perfil e prazo por categoria, exceções por equipamento, visibilidade e checklist
da categoria, além dos vínculos com RDO. Estados vazios/erro e layout responsivo
foram harmonizados. Regras de herança, validação e mutations foram preservadas.
Após instalar as bibliotecas do browser, Configurações e Manutenção foram
conferidas em Chromium, Firefox e WebKit nas larguras de 390, 768 e 1280 px,
com abertura e fechamento dos diálogos sem rolagem horizontal. Edição de
categoria e perfil, confirmação de remoção de perfil e os temas claro/escuro
também foram conferidos. A validação encontrou e corrigiu o fundo claro do
controle “Perfil ativo” no diálogo escuro; build de produção passou.

EQ3: cards mobile, status de calibração, ações e links de documentos usam o DS.
Gestores podem escolher PDFs para envio também nos cards mobile; arrastar e
soltar continua disponível. Cadastro, dados técnicos, históricos de calibração,
revisões e manutenção usam diálogos DS, incluindo estados vazios e download de
manutenção. O editor de checklist usa o novo visual em Equipamentos e mantém a
apresentação anterior nos consumidores de Estoque. Gestor e visualizador foram
conferidos em claro/escuro com Chromium, Firefox e WebKit entre 320 e 1280 px,
sem rolagem horizontal. O download da manutenção e as URLs PDF de certificado e
datasheet foram verificados no banco local; build, lint e 26 testes focados passaram.

#### F4.4 — Estoque e Romaneio

Estoque foi harmonizado no lote anterior. Romaneio usa o AppShell com subabas de
Romaneios, Equipamentos e E-mails conforme a permissão, além da navegação do
formulário de saída/entrada. Listagem, catálogo, destinatários, formulário e
ações seguem os tokens e controles do DS. Os diálogos de revisão, item extra,
quantidade, checklist, assinatura, scanner e etiquetas QR usam a apresentação
do DS. O fluxo de câmera mantém a opção de foto quando a câmera ao vivo não
está disponível. O tour de QR aponta para a navegação nova.

As telas principais e os diálogos foram conferidos com dados sintéticos em
390 e 1440 px, sem rolagem horizontal. A prévia de etiqueta QR foi gerada na
versão compilada. Os testes focados de Romaneio passaram. A gravação integrada
com o backend não foi repetida nesta etapa visual.

### F5 — RDO, Gestão e ajustes transversais

Prioridade: P1.

Baseline RDO concluído em 04/09: histórico de cargos, upload manual, planejamento,
detalhes, bordas públicas e decomposição arquitetural não voltam à fila como se
estivessem por fazer. Os deltas de 11/09 e 25/09 acrescentaram:

- [x] **X1:** criação/cópia de link em contas e página pública de criar/redefinir
  senha, inclusive expiração, uso único, reenvio e retorno ao login.
- [x] **X2:** permissões de emissão, Hub/tours, rascunhos, fallback não autorizado,
  anexos com restauração, confirmações com conteúdo filho, busca e loading;
  regressão dos consumidores DS/legados sem retomar Efetivo.
- [x] **X3:** liberação individual e revogação de relatórios de serviço, assinatura
  física com PDF e estados correspondentes em Gestor, Detalhe e Cliente.
- [x] Ajustes de Qualidade/EPI/Admin previamente inventariados, independentes do RDO.

X1 concluído em 01/10/2026: Contas e Gestão do RDO compartilham o card DS de
link manual, com aviso de uso único/validade, campo selecionável e ação de cópia.
As páginas públicas de criação, redefinição e recuperação de senha usam campos,
botões e alertas do DS, com logo adaptado ao tema. Foram conferidos link válido,
expirado, reenvio, erro de confirmação e sucesso com API simulada; claro/escuro
em 390 e 1280 px, sem rolagem horizontal. Autenticação, validade do token,
redirecionamento e chamadas da API não foram alterados.

X2 e os ajustes localizados de F5 concluídos em 01/10/2026: a seleção do editor
agora respeita o tipo solicitado; um link para relatório sem permissão mostra
"Emissão não autorizada" em vez de abrir outro editor. As permissões independentes
de RDO, manutenção e produção ganharam cartões compactos no formulário de contas.
O formulário de Qualidade explicita se o registro irá para Interno/SGQ ou para
uma obra, e o perfil de EPI distingue o cargo específico do cargo sincronizado.
A visibilidade das categorias Omie já usava controles DS, tabela responsiva e
restrição a administradores; foi conferida sem alteração de contrato.

Passaram 53 testes focais de permissões, rascunhos, Hub, confirmações, anexos,
busca, Qualidade e Omie, além do fluxo de busca concorrente em navegador. O
build e o lint passaram (um aviso preexistente em `ScenariosBoard`). Em 360,
390, 768 e 1280 px, os novos controles não criaram rolagem horizontal. A suíte
geral terminou com 653/664 testes passando; as 11 falhas restantes são
asserções de outras superfícies migradas anteriormente e entram na limpeza de F6.

#### F5.1 — Administração: API/Tokens

- [x] **API1:** shell/etapas, listagem/filtros/status e detalhe da credencial.
- [x] **API2:** política/escopos/projetos, limites/validade, revisão, segredo único,
  redução, rotação e revogação com confirmação/motivo.
- [x] **API3:** parâmetros por operação, consulta por código de projeto, console
  redigido/resultado, uso e histórico de eventos, paginação por cursor.
- [x] **API4:** validação exclusiva ADMIN, dados sintéticos, temas/responsividade,
  teclado e tours. Nenhum segredo em logs, cache, URL ou screenshots.

API1 concluído em 30/09: shell administrativo com navegação para Contas/Tokens,
etapas visuais, filtros responsivos com URL, cards e status DS, resumo da
credencial e acesso direto aos detalhes. Os fluxos de emissão e política foram
migrados em API2; Playground e validação geral seguem em API3–API4.

API2 concluído em 30/09: campos de política e limites, catálogo de escopos,
revisão, segredo de exibição única e diálogos de redução, rotação e revogação
alinhados ao DS. Contratos de confirmação e segurança preservados.

API3 concluído em 30/09: seletor de operação, campos definidos pelo catálogo,
orientação para consulta por código de projeto, console de requisição e resposta,
uso, eventos e navegação por cursor no DS. A prévia de autorização aceita apenas
o formato mascarado esperado.

API4 concluído em 30/09: acesso ADMIN e seletores do tour conferidos, fluxos
visuais de criação, revisão, listagem, detalhes, ciclo de vida, segredo único e
Playground verificados com dados sintéticos em temas claro/escuro e larguras de
celular, tablet e desktop. Chromium, Firefox e WebKit cobriram os estados
inválidos e diálogos; foco, Escape e ausência de rolagem horizontal foram
confirmados. Campos inválidos, barra de ações e contraste das permissões no
tema escuro foram ajustados. Nenhum segredo real foi usado na validação.

#### F5.2 — Administração: Gestão de Contas

Migração visual concluída em 01/10/2026. `AdminAccountsPage` usa o shell de
Administração e os controles do design system. A lista de contas agora usa
tabela no desktop/tablet e cartões compactos no celular; o formulário,
os filtros e as ações foram conferidos em 360, 390, 768 e 1280 px, nos temas
claro e escuro. A edição abre sob a conta selecionada sem rolagem automática.
A operação de criar, editar, ativar/desativar e excluir foi
validada com API sintética que preserva os contratos e atualiza a lista após
cada resposta. A persistência com banco isolado continua pendente na F6 porque
as credenciais de demonstração locais não deram acesso autenticado.

- [x] Migrar a rota para `AdminModuleAppShell`, com navegação Contas/Tokens,
  breadcrumb, perfil e tema consistentes.
- [x] Migrar listagem, busca e filtros para controles DS, com apresentação
  responsiva e ações alinhadas no desktop, tablet e celular.
- [x] Migrar criação/edição, papéis, permissões, vínculo com colaborador, link
  de senha, ativação e exclusão, preservando validações e contratos da API.
- [x] Validar perfis ADMIN e sem acesso, estados de carregamento/vazio/erro,
  teclado, temas e contratos de API com respostas sintéticas isoladas.
- [ ] Validar persistência contra banco isolado com uma conta ADMIN de teste.

#### F5.3 — Qualidade

Visual implementado, validação incompleta. `QualidadePage` usa `AppShell` com Registros/Naturezas na
navegação responsiva e preserva `?tab=` e tutorial. Registros tem tabela DS no
desktop, cartões no celular e filtros recolhidos no celular. O formulário usa
controles DS, inclusive seleções, anexos e links; o envio Interno/SGQ com link
e PDF passou com API sintética. Naturezas tem ações e diálogo DS e permite
reordenar por arraste ou pelas setas do teclado. Gestor e visualizador, temas,
larguras, navegação, evidências e exportação passaram em Chromium/WebKit com
API sintética. Faltam validar a reordenação por toque e a persistência em banco
isolado.

- [x] Migrar para `AppShell`, com Registros/Naturezas na navegação responsiva,
  mantendo os links diretos com `?tab=` e o tutorial.
- [x] Migrar busca, filtros, tabela responsiva, estados, ações, exportação e
  visualização de evidências dos Registros.
- [x] Migrar cadastro, edição, inativação, exclusão e reordenação das Naturezas,
  inclusive os diálogos e a interação por teclado.
- [x] Corrigir e validar reordenação com toque emulado no Chromium, incluindo
  gravação da ordem, limpeza da prévia e rolagem durante o arraste.
- [ ] Conferir o gesto em aparelho físico.
- [x] Migrar o formulário de Registro, inclusive projeto ou Interno/SGQ,
  anexos/links, validação e envio.
- [x] Validar gestor e visualizador, temas, larguras e API sintética sem alterar
  regras de recorrência ou permissões.
- [ ] Validar persistência em banco isolado.

#### F5.4 — EPI

Migração visual concluída. `EpiPage` usa `AppShell` com Colaboradores/Catálogo na navegação
responsiva. Fichas, catálogo, campos, estado de assinatura, abas
Ativos/Arquivados e confirmação de arquivo/restauração usam controles DS.
A página pública e seu diálogo de assinatura usam a apresentação DS do RDO.
Técnico, colaborador e acesso negado foram validados com API sintética; perfil,
entrega, devolução, catálogo, assinatura pública, arquivo/restauração e PDF
passaram em Chromium/WebKit. A persistência em banco isolado fica para a F6.

- [x] Migrar shell, navegação Colaboradores/Catálogo, fichas, filtros e ações
  para o DS em desktop, tablet e celular.
- [x] Migrar formulários de perfil, entrega/devolução, catálogo, arquivo,
  confirmações, solicitação de assinatura e download de PDF.
- [x] Harmonizar a página pública de assinatura de EPI; validar técnico,
  colaborador e acesso negado, sem alterar o contrato da assinatura.

#### F5.5 — Privacidade

Concluída em 01/10/2026. A administração de solicitações usa o shell e os
controles do DS, com pedidos recolhíveis e diálogos para evidências de
identidade e de atendimento. Política e exercício de direitos seguem o mesmo
visual, sem alteração do texto legal ou do protocolo. Os testes isolados em
Chromium/WebKit cobrem permissão, teclado, filtros, temas, três tamanhos de tela
e os contratos de envio, verificação e conclusão da API. A persistência em
banco isolado permanece na F6.

- [x] Migrar listagem, filtros, estados e ações de solicitações LGPD para o DS,
  preservando verificação de identidade, respostas e evidências de atendimento.
- [x] Harmonizar as páginas públicas de política e de exercício de direitos,
  sem alterar seu texto legal ou o fluxo de protocolo.
- [x] Validar permissão administrativa, responsividade, teclado, temas e API
  em ambiente isolado.

Critério de saída de F5: Gestão de Contas, Qualidade, EPI e Privacidade
integralmente migrados e validados; os fluxos novos recebidos da main e os
contratos do piloto do RDO continuam verdes.

### F6 — Consolidação e retirada do legado

Prioridade: P2, após F2–F5, incluindo EQ1–EQ3, M1–M5, API1–API4 e X1–X3.

- [x] Reconciliar as asserções antigas com os controles atuais e recuperar a
  suíte frontend completa.
- [x] Substituir confirmações nativas remanescentes nas superfícies DS e ajustar
  o breakpoint divergente do histórico de relatórios.
- [x] Registrar referências visuais do Hub autenticado com dados sintéticos em
  Chromium, Firefox e WebKit, e ampliar a validação pública do RDO ao WebKit.
- [ ] Remover regras CSS e componentes legados comprovadamente sem consumidores;
  reduzir duplicação entre `Button`, campos, busca, modal e componentes DS.
- [ ] Dividir páginas críticas quando a migração permitir, sem ampliar arquivos
  acima dos budgets arquiteturais.
- [ ] Concluir auditoria de acessibilidade, responsividade e contraste nos fluxos
  autenticados principais, incluindo WebKit e estados de permissão.

Primeira rodada F6 em 01/10/2026: a suíte frontend voltou a passar integralmente
(665/665). Os testes antigos foram ajustados para a lixeira padronizada, os
controles atuais do Efetivo e o diálogo de revisão do orçamento. O teste de
revisão comercial passou a carregar as duas fontes de dados exigidas pela tela.
As confirmações de troca de orçamento Access/ComercialAPP e de POST real no
Playground agora usam `ConfirmDialog` com a mesma condição de segurança.
O breakpoint do histórico de relatórios usa a escala oficial de 768 px e o
aviso de dependências do efeito em Cenários foi corrigido.

O Hub tem capturas reproduzíveis em 360, 768 e 1280 px, claro/escuro, nos três
navegadores, com conta e resposta de autenticação sintéticas. As páginas
públicas de validação e assinatura do RDO têm referências adicionais em WebKit
para 390, 768, 1024 e 1280 px, claro/escuro. Nenhuma dessas capturas apresentou
rolagem horizontal; os cards do Hub também responderam a foco e Enter nos três
navegadores. A busca por arquivos CSS sem importadores em `frontend/src`
não encontrou candidatos seguros para remoção; `Button`, `SearchBar` e
`Skeleton` legados ainda têm consumidores. Os testes autenticados antigos de
WebKit pararam no login porque as credenciais de demonstração do projeto foram
recusadas pelo banco local; a cobertura autenticada repetível seguirá com
contas isoladas ou respostas sintéticas.

Segunda rodada F6 em 01/10/2026: a listagem de Manutenção e produção ganhou
cenários autenticados sintéticos para permissões isoladas de manutenção e
produção em 360, 768 e 1280 px, com referências visuais em Chromium, Firefox
e WebKit. A validação percorre a navegação própria de cada largura, verifica
ausência de rolagem horizontal, abre os formulários por teclado e confirma que
uma conta sem a permissão exigida recebe uma saída clara. O botão de criar o
relatório 5004 passou a usar a mesma ênfase do 5002. As respostas sintéticas
evitam dependência das credenciais locais; persistência e dados reais ainda
precisam de uma conta isolada válida para completar a auditoria autenticada.

## Matriz mínima de validação por entrega

- larguras: 360, 390, 768 e 1280 px;
- temas: claro e escuro quando a superfície estiver no shell novo;
- perfis: sem acesso, somente leitura e gestor/editor;
- estados: loading, vazio, erro, conteúdo curto, conteúdo longo e ação pendente;
- entrada: teclado, mouse e toque;
- navegação: refresh, back/forward e link direto com query params;
- automação: teste de contrato estático, teste comportamental do fluxo crítico,
  `npm run lint`, `npm test` e `npm run build`.

## Fechamento transversal atual

Auditoria do código e das rotas ativas em 01/10/2026. `origin/main` é ancestral
da branch de redesign. Os lotes F2, A7, F3, F4, F5.1, F5.2, F5.4, F5.5,
EQ1–EQ3, M1–M5, API1–API4 e X1–X3 já têm migração visual implementada.
F5.3 tem interface migrada, com validação por toque e persistência pendentes.

### Próximas frentes de implementação

1. [x] **Páginas independentes:** harmonizar Login, Pesquisa de satisfação,
   Preferências de notificações, Confirmação de e-mail e Operações; disponibilizar
   links de demonstração locais para as páginas dependentes de token ou dados.
2. [x] **Efetivo, diálogos ativos:** harmonizar formulários de documentos,
   encerramento de projeto legado e checklist de contato, verificando temas,
   tamanhos de tela, foco e ações.
3. [x] **Qualidade, Naturezas:** conferir e corrigir a reordenação por toque;
   preservar setas de teclado, permissões e persistência.
4. [x] **F6, limpeza:** retirar CSS e componentes sem consumidores, reduzir
   duplicação de controles e dividir páginas que ultrapassam os limites.

### Validações e gates pendentes

- [x] Validar persistência em banco isolado para Gestão de Contas, Qualidade,
  EPI e Privacidade; repetir gravação integrada do Romaneio após F4.
- [x] Concluir a auditoria de acessibilidade, contraste, responsividade e
  permissões nos fluxos autenticados, incluindo WebKit. Matriz de 02/10:
  18 testes passaram; 14 telas × 3 tamanhos × 2 temas × 2 navegadores.
- [ ] Conferir Assinaturas em celular físico; envio SMTP real não foi homologado.
- [x] Atualizar os testes estáticos para as tabelas do Estoque, o calendário
  do Efetivo e os novos controles dos diálogos. A suíte frontend passou
  integralmente (669/669); lint e build passaram.
- [x] Recuperar `architecture:check`: os limites de `reports.js` e
  `ReportDetailPage` e os seis controles sinalizados foram corrigidos em
  02/10/2026, sem ampliar budgets. O gate passou.
- [x] Conferir as páginas de demonstração em Chromium a 390, 768 e 1280 px e
  WebKit a 390 px, nos temas claro/escuro; conferir os seis diálogos do
  Efetivo no Chromium a 390 e 1280 px. Não houve rolagem horizontal ou erro
  de JavaScript nesses recortes. O arraste de Naturezas e as setas do
  teclado passaram em testes de navegador com API sintética. Os links de
  pesquisa, preferências, confirmação de e-mail e assinatura RDO estão em
  `/visualizar`; o painel também inclui login, Operações e os diálogos do
  Efetivo. Respostas sintéticas não substituem gravação em banco isolado.

### Próximo lote recomendado

Arquitetura e persistência isolada concluídas. O encerramento de 02/10 abaixo
registra a revisão em WebKit, a limpeza F6 e a conferência final. O teste de toque em aparelho físico e a entrega SMTP real exigem
ambiente externo ao navegador de desenvolvimento.

O inventário mais antigo acima fica preservado como histórico. O
[delta de 23/09](filtrovali-ds/main-integration-2026-09-23.md) também registra
as decisões de conciliação anteriores.

## Encerramento solicitado em 02/10/2026

Ordem de execução e publicação: carregamentos → gate de arquitetura →
persistência isolada → auditoria transversal → limpeza F6 → conferência final.
Cada lote recebe commit e push antes de iniciar o seguinte.

- [x] Carregamentos: as duas animações aprovadas usam o desenho original da
  logo. Páginas, diálogos, listas, tabelas, buscas e controles compartilham a
  implementação. A escolha aleatória permanece estável enquanto o componente
  está montado; progresso numérico só é anunciado quando existe valor real.
  Movimento reduzido desativa a animação. Prévia: `/visualizar/carregamento`.
- [x] Etapa 1: zeradas oito ocorrências do gate atual (limites de `reports.js`
  e `ReportDetailPage`, seis campos com placeholder sinalizados pelo gate,
  incluindo as duas identificações de versão de documentos do Efetivo).
- [x] Etapa 2: gravação e leitura posterior em PostgreSQL isolado para Contas,
  Qualidade, EPI, Privacidade e Romaneio.
- [x] Etapa 3: acessibilidade, permissões, temas, responsividade, WebKit e
  onboarding nos fluxos autenticados.
- [x] Etapa 4: remover legado comprovadamente sem consumidores e duplicações.
- [ ] Conferência final por página em celular, tablet e desktop, claro e escuro.

A lista de cinco ocorrências da auditoria de 01/10 fica preservada como
histórico; o inventário acima a substitui para o fechamento atual.


### Etapa 1 — gate recuperado

`architecture:check` passou sem ampliar limites. `ReportDetailPage` agora
importa a miniatura de anexos e `reports.js` delega as abas do cliente ao
handler de domínio. Guardas de autenticação, restrição de projeto, seleção
de dados e limpeza de URLs temporárias foram preservadas. Os seis controles
possuem IDs explícitos associados aos rótulos existentes. Testes de anexos,
documentos e autorização do handler passaram; lint e build passaram.


### Etapa 2 — persistência isolada validada

Os cinco fluxos passaram por formulários reais, API sem mocks e consulta
direta ao PostgreSQL. Contas e Romaneio também tiveram edição conferida;
Qualidade e EPI tiveram recarga; Privacidade teve evidências e conclusão.
O Romaneio produziu PDF real. A edição fica bloqueada enquanto os dados
iniciais carregam. SMTP foi capturado localmente, sem envio externo.
Comandos, isolamento e limites estão no
[registro do fechamento](filtrovali-ds/redesign-closure-2026-10-02.md).
Typecheck de E2E, lint e gate passaram; a suíte de persistência passou 5/5.


### Etapa 3 — revisão transversal validada

Os 18 testes passaram em Chromium e WebKit. A matriz cobriu 14 telas
autenticadas a 390, 768 e 1280 px, em claro/escuro, com banco isolado.
Foram conferidos rótulos, imagens, overflow, erros de JavaScript e contraste
de texto sobre fundos planos. Guardas de leitura e contas sem acesso
rejeitaram chamadas reais; diálogo manteve foco, Escape e retorno ao acionador;
onboarding do Hub e aceite de privacidade do cliente passaram nos dois motores.

Correções: vínculo dos rótulos de duas datas do Efetivo; contraste do texto
secundário claro e dos links escuros; aliases de texto herdados em EPI/Estoque;
contagem da navegação de equipamentos. A revisão usa as duas variantes
aprovadas da logo. Gate, 40 testes focados, tipagem E2E, lint e build passaram.

A medição automática de contraste não cobre gradientes, imagens ou elementos
com opacidade herdada. A conferência página a página e dos demais estados
é o último lote, após a limpeza. WebKit foi executado neste host; as notas
anteriores sobre dependências ausentes ficam somente como histórico.


### Etapa 4 — legado sem consumidores retirado

Removidos 20 arquivos frontend não alcançados pelas rotas/imports atuais:
CRUDs e hooks de catálogos substituídos, shim de autenticação, Placeholder,
badge antigo de projetos, equivalências substituídas por reconciliação e
telas de Missões/Simulações retiradas da navegação da main. Nenhuma rota de
backend foi removida. As três entradas HTML de demonstração DS foram incluídas
na análise e preservadas. Ao final, 509 arquivos TS/TSX são alcançáveis a partir
dessas quatro entradas, sem órfãos.

Foram retiradas 62 regras completas de CSS e 33 seletores órfãos em regras
compartilhadas, além do shimmer antigo. O CSS do formulário de missão
permanece. A normalização de serviços do detalhe usa o módulo já existente
e testado; o tipo de sistema passa a ser preservado também no editor ativo.
Os testes de componentes aposentados foram retirados e as asserções de
consumidores ativos foram atualizadas. A suíte passou com 645/645 testes.

Na conferência dos fluxos afetados, foram associados os rótulos dos horários
operacionais e do serviço e nomeados os seletores de fotos. O botão Voltar no
projeto não pode mais encolher e cortar o texto no celular. Gate, tipagem E2E,
lint, build e o recorte integrado de celular passaram. Adaptadores e aliases
com consumidores reais foram preservados; não foi aplicada remoção global
por aparência de legado.

A conferência final usa `redesign-pages.spec.ts`, com inventário de páginas,
subabas, formulários e estados públicos em Chromium/WebKit, celular/tablet/
desktop, claro/escuro. Os PDFs e os registros autenticados vêm do banco isolado;
Pesquisa, Preferências, Confirmação de e-mail e assinatura RDO usam as prévias
fictícias autorizadas. Código inválido também é um estado explícito do teste.
