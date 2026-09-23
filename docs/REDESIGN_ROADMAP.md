# Roadmap do redesign do frontend

> **Delta de 23/09/2026:** `origin/main` em `10599cf3` foi incorporada à
> `feat/frontend-redesign-2`. O [plano desta integração](filtrovali-ds/main-integration-2026-09-23.md)
> separa a revisão das telas já migradas da entrada de superfícies novas. O
> histórico de entregas abaixo descreve o baseline anterior ao merge; R1–R3,
> A0, S1 e X0 são agora a primeira fila para restaurar o visual com os fluxos
> novos. O build passa, mas a suíte visual anterior ainda tem falhas.

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

## Estado após a integração

- A fundação do design system, o `AppShell`, o Hub e o núcleo autenticado do RDO
  estão implementados para gestor, coordenador, colaborador e cliente.
- A migração do Efetivo está em **standby nesta worktree**, por solicitação do
  usuário em 10/09: o módulo está sendo alterado em outra worktree. As entregas
  existentes são preservadas. Nesta integração houve somente conciliação dos
  conflitos funcionais da main, sem retomar sua campanha de UI.
- Assinaturas: shell, biblioteca, preparação, acompanhamento, auditoria e
  assinatura pública migrados em F1 + F3.1–F3.4. Backend real isolado, Chromium,
  Firefox e WebKit validados na F3.5; conferência em celular físico combinada com o usuário.
- Acompanhamento tem A1/A2/A3a implementados; faturamentos, romaneios, jornadas
  RDO acionáveis e indicadores operacionais de Sede ampliam A3a/A4/A5. Estoque,
  Romaneio, Qualidade e EPI continuam com as pendências já inventariadas.
- A main acrescentou Manutenção/Produção, configuração/histórico em Equipamentos,
  API/Tokens no Admin e ativação de contas por link. São superfícies pendentes
  de migração, não entregas automáticas do redesign.
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
| Hub e navegação global | Efetivo, Assinaturas, Manutenção/Produção e novidades de API/Tokens; ícones e acesso por perfil/permissão | Integração preserva DS; revisão transversal X2 pendente |
| Efetivo | Visão geral, Calendário, Colaboradores/Ausências, Disponibilidade, Missões, Kanban de evolução, Simulações, Produtividade e Administração | **Standby nesta worktree** — entregas preservadas; retomada após conciliar o desenvolvimento paralelo |
| Assinaturas | Lista de ativos/arquivados, novo documento, configuração do PDF, assinantes, publicação, acompanhamento, auditoria e assinatura pública | **Migrado e validado tecnicamente** — F3.1–F3.5; teste em celular físico com o usuário |
| Acompanhamento | Dashboard/cards/detalhe; novos faturamentos Omie, TAGs, romaneios, origem das jornadas RDO e indicadores operacionais em Sede | A1/A2/A3a implementados no baseline anterior; complemento A3a.1 e A3b–A7 pendentes |
| Estoque | Resumo expansível por lote, devolução com múltiplos itens, documentos do item e ordenação de movimentações | Novos fluxos; harmonização pendente |
| Romaneio | Impressão de etiquetas QR, scanner por câmera e continuação da inclusão do item após leitura | Novos fluxos; harmonização pendente |
| RDO e gestão | Histórico de cargos, upload manual, equipe/justificativas, núcleo e bordas públicas; novas permissões de emissão e criação de senha por link | Baseline migrado e validado; somente as novas bordas reabertas em X1/X2 |
| Manutenção/Produção | Listagem, criação/edição/revisão de RDOs e manutenção avulsa, programação preventiva e histórico | Novo módulo legado; M1–M5 pendentes |
| Equipamentos | Supervisor, perfis/checklists, categorias/intervalos/visibilidade, exceções e histórico/documentos | EQ1–EQ3 pendentes; dependência dos fluxos de manutenção |
| Administração — API/Tokens | Lista/filtros, política/escopos, segredo único, redução/rotação/revogação, Playground, uso e eventos | API1–API4 pendentes, acesso exclusivo ADMIN |
| Ativação de contas | Criação sem senha inicial, link manual, página pública de criar/redefinir senha e reenvio | X1 pendente, preservando fluxos da main |
| Qualidade | Registros internos/SGQ no formulário de registros | Ajuste localizado pendente |
| Administração e EPI | Visibilidade de categorias Omie, cargo operacional e cargo temporário de EPI | Ajustes localizados pendentes |
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
dos demais diálogos continua pendente. Novos ajustes do Efetivo estão suspensos
nesta worktree.

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

**Standby desde 10/09/2026 nesta worktree.** O usuário informou desenvolvimento
paralelo do módulo em outra worktree. O inventário abaixo registra o último
estado entregue, não uma autorização para continuar F2. Antes da retomada,
conciliar os componentes e fluxos da outra frente e revalidar as lacunas.

#### F2.1 — Navegação e leitura executiva

Status: **em andamento** — shell, nove áreas, seletor mobile, filtros, métricas e
estados principais de Visão geral, Calendário e Disponibilidade implementados na
primeira entrega. Detalhe diário em diálogo, vagas/conflitos e calendário ampliado
implementados em 08/09; falta fechar a matriz das demais superfícies desta onda.

- navegação das nove seções e seletor mobile;
- filtros de data e função;
- Visão geral, Calendário e Disponibilidade;
- detalhe do dia, vagas e conflitos.

#### F2.2 — Pessoas

Status: **em andamento** — botões, busca e formulários de colaborador/ausência
adequados ao DS em 08/09; responsividade e perfis conferidos com fixtures. Falta
validar a persistência integrada e consolidar todos os estados da listagem.

- Colaboradores e Ausências;
- lista, busca, disponibilidade e estados selecionados pela URL;
- diálogos de colaborador e ausência;
- histórico e períodos que impactam capacidade.

#### F2.3 — Missões

Status: **em andamento** — listagem/pendências, programação, conclusão e diálogos
de seleção/alocação/ciclos no DS em 09/09. Sobreposição e somente consulta
conferidos com fixtures; Kanban mantém líder/equipe visíveis. Restam sua
consolidação estrutural, o comparativo e o fechamento integrado de persistência,
permissões e navegadores.

- lista de missões e pendências;
- Kanban de evolução;
- programação, equipe, alocações individuais e conclusão;
- estados de conflito, confirmação e somente leitura.

#### F2.4 — Planejamento avançado e administração

- Simulações e comparação de cenários;
- Produtividade, pendências e detalhe individual;
- regras, referência, feriados e atividade/auditoria;
- tutorial permanente e campanha de novidade.

Critério de saída: todas as nove seções e os dez diálogos passam na matriz
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
| A3a.1 — Complemento da main | `ProjectInvoicesSection`: faturamentos, recebimento e sincronização; conferir TAG nos cards/detalhe | **Próximo lote visual** |
| A3b — Edição do planejamento | `ProjectScheduleEditor`, propostas adicionais/revisões e editor de escopo previsto, incluindo consumidores compartilhados | **Pendente após o complemento do detalhe** |
| A4 — Diálogos de apoio | Relatórios/PDF, standby, jornadas POINT/REPORT e novo `ProjectRomaneiosDialog` com seus gatilhos | **Pendente de consolidação e revisão integrada** |
| A5 — Sede | Períodos, gastos globais, categorias, detalhamento e novos indicadores aprovados de manutenção/produção em `SedeOperationalCards` | **Pendente; escopo ampliado** |
| A6 — Custo | Motor/simulação, cargos/perfis, parâmetros/EPI, importação e conciliação de ponto, pendências e auditoria de alocação | **Pendente** |
| A7 — Fechamento | Matriz completa de perfis/navegadores/estados, persistência em ambiente isolado e retirada de CSS sem consumidores | **Pendente** |

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
  antes do cronograma e dos diálogos compartilhados ainda legados.

A3 foi dividido após verificar que o cronograma compartilha edição de escopo,
propostas e regras de mão de obra com outros consumidores. **A3b segue pendente**:
migrar esse conjunto completo, sem mudar o fluxo de gravação. A4 mantém histórico
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

#### F4.2 — Equipamentos e configuração de manutenção (novo escopo)

- [ ] **EQ1:** shell/abas, entrada de configuração e componentes compartilhados.
- [ ] **EQ2:** supervisor, perfis/checklists, categorias/intervalo/visibilidade e
  exceção por equipamento; formulário de perfil e confirmação de remoção.
- [ ] **EQ3:** cards/ações, histórico e downloads; consulta e gestão nos dois temas.

Equipamentos não estava explicitamente coberto na fila anterior. Sua configuração
é dependência de M3/M4; migrar conjuntamente os consumidores de checklists e
categorias, sem alterar a política herdada/explícita de cada equipamento.

#### F4.3 — Manutenção/Produção (novo módulo)

- [ ] **M1:** AppShell, Hub, abas/URL, cards/listagens e filtros por permissão.
- [ ] **M2:** campos centrais e stepper DS alinhados ao formulário RDO aprovado,
  preservando os autosaves distintos e os cálculos compartilhados de horas.
- [ ] **M3:** manutenção, avulsa, produção, terceiros/anexos e revisão/devolução;
  aprovado em consulta; zero manutenções no RDO é permitido pelo contrato atual.
- [ ] **M4:** programação preventiva e histórico com ordenação, paginação e
  documentos; alinhamento com EQ2 sem introduzir cálculos no frontend.
- [ ] **M5:** fechamento de perfis/estados/temas/navegadores e persistência isolada.

`ReportCoreFields` entrou com visual legado. Não reverter o RDO concluído para
reutilizá-lo: sua adaptação e convergência visual são trabalho explícito de M2.

### F5 — RDO, Gestão e ajustes transversais

Prioridade: P1.

Baseline RDO concluído em 04/09: histórico de cargos, upload manual, planejamento,
detalhes, bordas públicas e decomposição arquitetural não voltam à fila como se
estivessem por fazer. Em 11/09 o escopo foi ampliado somente pelas novidades:

- [ ] **X1:** criação/cópia de link em contas e página pública de criar/redefinir
  senha, inclusive expiração, uso único, reenvio e retorno ao login.
- [ ] **X2:** permissões de emissão, Hub/tours, rascunhos, fallback não autorizado,
  anexos com restauração, confirmações com conteúdo filho, busca e loading;
  regressão dos consumidores DS/legados sem retomar Efetivo.
- [ ] Ajustes de Qualidade/EPI/Admin previamente inventariados, independentes do RDO.

#### F5.1 — Administração: API/Tokens

- [ ] **API1:** shell/etapas, listagem/filtros/status e detalhe da credencial.
- [ ] **API2:** política/escopos/projetos, limites/validade, revisão, segredo único,
  redução, rotação e revogação com confirmação/motivo.
- [ ] **API3:** parâmetros por operação, consulta por código de projeto, console
  redigido/resultado, uso e histórico de eventos, paginação por cursor.
- [ ] **API4:** validação exclusiva ADMIN, dados sintéticos, temas/responsividade,
  teclado e tours. Nenhum segredo em logs, cache, URL ou screenshots.

Critério de saída: todo fluxo novo que entrou pelo merge está visualmente coberto e
os contratos do piloto do RDO continuam verdes.

### F6 — Consolidação e retirada do legado

Prioridade: P2, após F2–F5, incluindo EQ1–EQ3, M1–M5, API1–API4 e X1/X2.

- remover CSS e componentes legados sem consumidores;
- reduzir duplicação entre `Button`, campos, busca, modal e componentes DS;
- dividir páginas críticas quando a migração permitir, sem ampliar arquivos acima
  dos budgets arquiteturais;
- executar auditoria de acessibilidade, responsividade e contraste;
- registrar screenshots de referência e testes de regressão visual dos fluxos
  principais.

## Matriz mínima de validação por entrega

- larguras: 360, 390, 768 e 1280 px;
- temas: claro e escuro quando a superfície estiver no shell novo;
- perfis: sem acesso, somente leitura e gestor/editor;
- estados: loading, vazio, erro, conteúdo curto, conteúdo longo e ação pendente;
- entrada: teclado, mouse e toque;
- navegação: refresh, back/forward e link direto com query params;
- automação: teste de contrato estático, teste comportamental do fluxo crítico,
  `npm run lint`, `npm test` e `npm run build`.

## Ordem recomendada dos próximos lotes

Antes da ordem histórica abaixo, executar os lotes **P0 R1–R3, A0, S1 e X0**
do [delta de 23/09](filtrovali-ds/main-integration-2026-09-23.md). A nova
gestão de projetos F2.5/F2.6 segue o standby do Efetivo; as demais novidades
estão vinculadas às fases A3b/A4/A5/A6, Estoque, Romaneio, M3/EQ2 e X1/X2.

1. **A3a.1** e os novos gatilhos/diálogos de **A4**, para fechar as inserções da main
   nas telas de Acompanhamento já redesenhadas.
2. **A3b**, restante de **A4**, **A5/A6/A7**: concluir Acompanhamento.
3. **EQ1–EQ3 + M1–M5**, respeitando a dependência de configuração da manutenção.
4. Estoque e Romaneio (F4) com suas pendências anteriores.
5. **API1–API4 + X1/X2** e ajustes localizados de Qualidade/EPI/Admin (F5).
6. Retomar **F2** somente após liberação e conciliação da outra worktree; a
   conferência de assinatura em celular físico continua combinada com o usuário.
7. **F6**: remoção de legado e regressão visual final, após as frentes acima.

Erros funcionais de integração têm precedência sobre essa fila. Esta rodada
realizou merge/conciliação/planejamento, não a implementação dos novos lotes.
