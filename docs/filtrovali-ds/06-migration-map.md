# 06 — Mapeamento do Projeto Atual → Design System

> **Atualização de 24/09/2026:** a main `10599cf3` introduziu novos fluxos nas
> áreas já migradas. O merge inicial removeu telas DS, recuperadas na correção
> atual com os fluxos da main conciliados. Consulte o
> [delta de integração](main-integration-2026-09-23.md) para as verificações
> ainda necessárias e para as superfícies novas que entram na fila.

Baseado na auditoria inicial de `frontend/src` e atualizado em 11/09/2026 com o
merge `1efe4639` de `origin/main` (`9586579f`). Preserva Efetivo em standby,
Assinaturas e RDO migrados em seu baseline e A1/A2/A3a de Acompanhamento; acrescenta
explicitamente as superfícies novas de manutenção, equipamentos, tokens e contas.
Este documento registra tanto o alvo do Design System quanto o estado efetivamente
implementado. Os módulos ainda pendentes devem ser migrados incrementalmente,
preservando comportamento, rotas e estado.

## 0. Estado após a Fase 1

| Entrega | Estado |
|---------|--------|
| tokens completos + aliases legados | concluído |
| `foundation.css`, `utilities.css` e `legacy.css` | concluído |
| Tailwind v4 sem Preflight, integrado por cascade layers | concluído |
| Inter variável auto-hospedada | concluído |
| tema `light` / `dark` / `system` com persistência | concluído |
| `BrandLogo`, `AppIcon` e `ThemeToggle` | concluído |
| componentes primitivos do DS | concluído para o conjunto usado pelo RDO |
| páginas, shell, Hub e módulos | Hub e RDO concluídos; Efetivo em standby nesta worktree; Assinaturas migrado e validado tecnicamente, com teste físico combinado com o usuário; Acompanhamento com shell/Dashboard/listagem de Projetos migrados; demais superfícies seguem o roadmap |

Detalhes técnicos e contratos da fundação: [`07-foundation-phase-1.md`](./07-foundation-phase-1.md).

## 0.1 Estado do RDO após a implementação

| Superfície | Estado em 04/09/2026 |
| --- | --- |
| Gestor, coordenador, colaborador e cliente autenticado | **Migrado** — shell, navegação, páginas, listagens, cards, seleção e ações responsivas |
| Conta compartilhada dos perfis | **Migrado** — dados de acesso, notificações e privacidade |
| Formulário de criação e edição | **Migrado** — mesmos fluxos, etapas e regras; campos condicionais possuem rótulos programáticos |
| Detalhe e relatório assinado | **Migrado** — leitura/edição, anexos, ações e status assinado informativo |
| Projetos, administração, DDS e dashboards | **Migrado** — incluindo estatísticas e NPS detalhados |
| Loading, vazio, erro e tema escuro | **Migrado no núcleo** — skeleton legado passou a consumir tokens do tema |
| Assinatura e validação públicas do RDO | **Migrado** — shell público DS, estados semânticos, tema escuro e assinatura DS |
| Consentimento inicial do cliente | **Migrado** — barreira responsiva, tokenizada e com confirmação compacta |
| Diálogo de relatórios no Acompanhamento | **Migrado** — consumidor adjacente com opt-in DS para lista, feedback e PDF |
| Limpeza de CSS e budgets arquiteturais | **Concluído para o RDO** — ações sem micro-scroll e `architecture:check` verde sem elevar limites |
| Regressão visual | **Adicionada e verde** — 32 baselines das duas páginas públicas em 390/768/1.024/1.280, claro/escuro, Chromium/Firefox |

Fechamento técnico: `architecture:check`, build, lint, tipagem E2E e diff check
verdes; suíte estática do RDO em 27/27 e suíte visual em 16/16 (32 capturas). Não há diálogo
nativo remanescente no escopo do módulo.

O inventário detalhado do que foi concluído e das lacunas priorizadas está no
[`REDESIGN_ROADMAP.md`](../REDESIGN_ROADMAP.md). O estado específico do formulário
está em [`rdo-form-redesign-study.md`](./rdo-form-redesign-study.md).

## 0.2 Estado do Efetivo

**Standby da migração completa desde 10/09/2026 nesta worktree**, por solicitação
do usuário enquanto o módulo é alterado em outra frente. A main trocou a aba
Missões pelo fluxo de projetos em Evolução e passou a ter oito áreas. Visão geral,
Colaboradores e diálogos DS foram recuperados; o novo Kanban e suas etapas
continuam na fila F2.5/F2.6. A tabela abaixo registra o baseline de 09/09,
com as mudanças atuais indicadas nas linhas afetadas.

| Superfície | Estado em 09/09/2026 |
| --- | --- |
| Shell e navegação | **Migrado na raiz** — `AppShell`, registry, perfil, submenu das oito áreas atuais, navegação local acessível e seletor mobile |
| Filtros executivos | **Migrado** — data e função com `Card`, `Field`, `Input` e `Select`, preservando a URL |
| Visão geral | **Primeira fatia migrada** — métricas, cards, badges e estados principais no DS |
| Calendário | **Migrado visualmente nesta fatia** — largura integral, dias maiores e diálogo diário com eventos/pessoas/vagas/conflitos; visão Dia mostra todas as atividades e títulos completos em colunas responsivas, mantendo o resumo em Semana/Mês; toolbar, estados e seleção tokenizados; navegação, links e recortes mobile/tablet/desktop conferidos com fixtures |
| Disponibilidade | **Primeira fatia migrada** — resumo semântico, feedback e superfícies responsivas |
| Colaboradores e Ausências | **Em migração** — busca e ações no DS, botões na mesma linha e lista responsiva; formulários no DS preservando validações. Falta validar persistência integrada e consolidar estados da listagem |
| Kanban de evolução | **Novo fluxo funcional, migração visual pendente** — cartões de projetos, etapas e gestão de equipe inicial por disponibilidade incorporados da main; revisar hierarquia e estados no DS em F2.5/F2.6. |
| Missões | **Rota substituída pela Evolução na main** — componentes de listagem e diálogos DS continuam usados em Simulações e na programação; a gestão de equipe/ciclos mantém o contrato DS. Não tratar a antiga aba como entrega a reabrir. |
| Simulações, Produtividade e Administração | **Migração estrutural pendente** — cores e controles legados revisados na fronteira compartilhada `EfetivoTheme.css`, incluindo hover, seleção, validação, foco e estados desabilitados; a listagem/programação de missões embutida em Simulações herda os componentes compartilhados migrados |
| Diálogos | **Parcial** — colaborador, ausência, detalhe diário, programação, conclusão, seleção de equipe e alocações/ciclos no DS; confirmações padronizadas, com camada correta sobre a seleção. Escape preserva o formulário por baixo e cancelamento de ciclo devolve o foco ao acionador. Diálogos de F2.4 ainda usam compatibilidade de tema |
| Regressão visual | **Parcial** — nove áreas e diálogos principais conferidos em modo escuro no Chromium com fixtures desktop/mobile; Pessoas/Calendário e Missões têm recortes de 360 a 1440px. Seleção/gestão de equipe conferidas nos dois temas, com filtros, estados de erro/carregamento, gravações simuladas e viewer pela lista/Kanban. Persistência real e matriz completa entre navegadores ainda pendentes |

## 0.3 Estado de Assinaturas — 10/09/2026

| Superfície | Estado |
| --- | --- |
| Shell e navegação | **Migrado na raiz** — `AppShell`, registry, breadcrumb, perfil/conta, tema, ativos/arquivados; tutorial compacto acessível sem sobreposição ao logo em 360px |
| Biblioteca | **Migrada** — header, busca, status, lista vertical, progresso e convites expirados; card inteiro clicável por mouse/teclado, sem botão “Abrir” separado |
| Estados e indicadores | **Migrados** — loading, erro/retry, vazio por aba/filtro; métricas explicitamente limitadas ao recorte exibido |
| Novo documento | **Migrado** — modal compacto e centralizado, campos DS, upload com aparência opcional tokenizada, processamento e validações existentes |
| Preparação do PDF | **Migrada (F3.2)** — cadastro/identificação dos assinantes, controles do canvas, loading/erro/retry e publicação compacta; geometria normalizada e fluxo preservados |
| Moldura do documento | **Migrada com F3.2** — cabeçalho, status, datas, abas, downloads e confirmações gerais de ciclo de vida |
| Acompanhamento e auditoria | **Migrados (F3.3)** — resumo do progresso, cards/status dos convites, ações por assinante em linha, revogação compacta, timeline paginada e estados de loading/vazio/erro/finalização |
| Assinatura pública | **Migrada (F3.4)** — shell/tema, leitura contínua de todas as páginas, marcações normalizadas, identificação/aceite, assinatura em diálogo compacto, links legíveis e estados finais/erro/retry |
| Prévia de PDF | **Corrigida no fechamento** — fontes padrão incluídas no PDF.js, sem depender das fontes do servidor; cache versionado sem alterar documentos originais; testes de glifos/rotação/cache |
| Verificação visual | Chromium, Firefox e WebKit, claro/escuro: biblioteca/acompanhamento/auditoria/público em 360–1920px, preparação em 360–1440px. Foco, teclado, geometria, desenho/limpeza, upload/remoção, consentimento, paginação, erros/retry e estados finais conferidos |
| Integração | **Validada em ambiente isolado** — PostgreSQL e API desta branch, contas/PDFs fictícios, sem e-mail: upload até PDF final, duas assinaturas, evidências, auditoria, lifecycle, renovação/revogação e isolamento entre contas |
| Pendente de conferência | Aparelho físico com o usuário: touch emulado não substitui desenho/limpeza/upload/confirmação no celular. WebKit Linux não é Safari iOS físico. SMTP real não foi disparado nesta rodada |

O `PdfDropzone` compartilhado mantém aparência legada por padrão. Apenas o novo
documento fez opt-in nesta entrega, sem alterar upload nos módulos em standby.
Regras de acesso, isolamento, APIs, query keys e normalização de URL preservadas.
O suporte a cursor da biblioteca continua sendo uma melhoria funcional separada;
os indicadores não representam um total global quando há mais páginas.
O editor mantém rolagem apenas no PDF, nunca nas ações. Seu seletor se limita à
área visível, inclusive ao rolar; o modo escuro não inverte a imagem do documento.
O público reutiliza `SignatureDialog` com opções visuais explícitas, sem mudar os
padrões dos demais consumidores. Token, consentimento, endpoints e polling mantidos;
sem reenvio automático da assinatura nem reload da mesma imagem na finalização.
No fechamento: 424 testes frontend e 60 testes backend de Assinaturas aprovados,
lint, build, arquitetura e diff check verdes. A correção de fontes requer publicar/reiniciar também o backend,
sem novas dependências nem mudanças no banco. Detalhes na F3.5 do roadmap.
Próximo módulo visual: F4/Acompanhamento, iniciado abaixo; Efetivo continua em standby.

## 0.4 Estado de Acompanhamento — 10/09/2026

**Migração em andamento, ainda parcial.** A1/A2/A3a cobrem entrada, Dashboard,
listagem de Projetos e detalhe do projeto; não representam o fechamento de Sede,
Custo ou dos editores/diálogos de apoio.

| Superfície | Estado |
| --- | --- |
| Shell e navegação | **Migrados** — `AppShell`, registry, quatro áreas, perfil/conta, tema e breadcrumb; navegação somente na lateral/menu hambúrguer, sem submenu duplicado no conteúdo; Custo restrito a gestor/administrador |
| Dashboard: filtros | **Migrados** — `FilterBar`, busca e selects DS, sheet mobile, chips/limpeza; filtros continuam disponíveis quando o recorte fica vazio |
| Dashboard: indicadores e gráficos | **Migrados** — `MetricCard` e `BarList`; preservados os 20 indicadores, somas e ranking positivo; gastos globais explicitamente separados do recorte filtrado |
| Dashboard: listagem | **Migrada** — tabela agrupada por tema no desktop, cards mobile/tablet, valores original/adicional e execução preservados; botão nativo no nome abre cronograma |
| Dashboard: estados | **Migrados** — skeleton, vazio, erro/retry, falha de atualização com cache e falha das categorias; links e barras usam tokens legíveis no escuro |
| Cronograma e edição do escopo previsto | **Pendente A3b** — após o complemento A3a.1 da main, editor/modal e propostas adicionais/revisões devem migrar juntos nos consumidores compartilhados; gravação e permissões preservadas |
| Projetos: listagem e filtros | **Migrados em A2** — cards em 1/2/3 colunas, dados por tema, barras DS, busca por membros/CNPJ, quatro situações e contagens; loading, vazio, erro/retry e cache tokenizados |
| Projetos: grupos e ações | **Migrados em A2** — card inteiro clicável sem botão Detalhes; unificação, renomeação inline, apropriação de MO e missão principal; ações em linha, Arquivar/Restaurar com ícone e texto; conferência e confirmações compactas com erro dentro da caixa |
| Detalhe: indicadores, custos e propostas | **Migrados em A3a** — painéis DS por tema, progresso/horas, gráfico semanal, metas, ranking, composição das propostas e impostos; cálculos e valores preservados |
| Detalhe: notas, desvios e custos manuais | **Migrados em A3a** — campos/ações DS, mensagens de validação/envio, leitura/expansão, autoria/data e estados de carregamento/erro/retry |
| Detalhe: equipe, equipamentos e escopo | **Migrados em A3a** — tabela/cards responsivos, horas do RDO como referência azul sem custo inferido, deslocamento e auditoria dos grupos preservados; escopo em consulta |
| Diálogos de apoio, Sede e Custo | **Pendentes A4–A6** — conferir também consumidores adjacentes já migrados no RDO; manter o PDF como área espacial deliberada |

Sem modificações de backend, endpoints, query keys, atualização periódica ou regras
de cálculo. Busca por membros de grupos/CNPJ/proposta e limpeza seletiva dos
parâmetros de URL têm testes. `RealizedCategoryBreakdown` mantém aparência legada
por padrão; o Dashboard é o primeiro consumidor de `appearance="design-system"`.
O editor continua com a permissão anterior (`hasAcompanhamentoAccess`), sem bloquear
ações que já existiam para visualizadores. Efetivo não foi alterado nesta entrega.

Validação de A1: 14 testes de renderização/contrato/navegação (incluindo os
dois contratos compartilhados de shell) aprovados; suíte frontend completa (79
arquivos), lint, build e arquitetura verdes. API interceptada com projetos/grupos,
valores monetários elevados e nomes longos, sem gravações reais. Em Chromium:
360/390/768/1024/1280/1440px, claro/escuro, sem overflow horizontal na página ou
scroll acidental nas novas listagens; conferidos filtros mobile, limpeza após
categoria vazia, erro/retry, skeleton, vazio, abertura/cancelamento do cronograma
por teclado, Escape/foco e tutorial. Perfis gestor, visualizador e sem acesso
conferidos, incluindo ausência de consulta de pendências para visualizador.
Firefox 155: 390/768/1280px em claro/escuro e os mesmos checks comportamentais de
busca, filtros, recuperação de categoria vazia, teclado/foco e perfis aprovados.
Capturas locais em `output/playwright/acompanhamento-*`. Testes integrados de
gravação, aparelhos físicos e matriz completa dos demais lotes seguem pendentes.

Em A2, o controller de cards foi separado de `ProjectOverviewCard`,
`ProjectOverviewMetrics`, `ProjectCardsToolbar` e formatação. A aparência DS não
envolve `ProjectDetailDashboard`; em A3a o detalhe recebeu sua própria fronteira
DS, que exclui os editores e diálogos ainda legados. Permissões de grupo/conferência/arquivamento
continuam exclusivas de gestores; o acesso ao detalhe mantém as permissões
anteriores. Os dados e as operações existentes foram preservados, incluindo
arquivamento exclusivo do Acompanhamento e avisos de finalização recente.

Validação de A2: 15 testes direcionados de cards/conferência/notas aprovados;
suíte frontend completa (444 testes em 80 arquivos), lint, tipagem, build e arquitetura verdes. Chromium:
360/390/768/1024/1280/1440/1536px, claro/escuro, sem overflow na página, scroll local
nas ações ou quebra de linha dos botões. Unificar/desmesclar, renomear (Escape,
erro e reenvio), política de MO/missão principal, arquivar/restaurar e conferir
foram exercitados também no Firefox com API interceptada. Firefox: 390/768/1280px
em claro/escuro. Nos dois navegadores: loading, vazio, erro/retry, atualização com
cache, cinco ações em 360px, confirmação compacta com teclado/Escape/retorno de
foco, entrada/retorno do detalhe preservando URL e perfis gestor/viewer/sem acesso.
O detalhe foi validado somente na navegação, não em seus editores ainda legados.
No refinamento solicitado, `Card.surfaceAction` substitui o título-botão/Detalhes;
`Button.counter` separa os contadores dos rótulos e avisos passam a `Badge.multiline`
compactas, sem alterar o padrão de uma linha das ações. Tutorial acompanha a
navegação na lateral/menu hambúrguer. Nenhuma gravação real ou alteração de backend nesta
rodada. Evidências locais em `output/playwright/acp-projects-*`.
Integração persistida e matriz completa dos lotes restantes seguem como gates de A7.
Os testes existentes ainda emitem avisos de fechamento do scanner de dependências
e conflito de porta HMR entre servidores de teste; não houve falha de teste.
O build mantém o aviso de bundles grandes, sem aumento de budget arquitetural.

Refinamento posterior de A2: 31 testes direcionados e a suíte frontend completa
(80 arquivos) passaram novamente, assim como lint, tipagem, build e arquitetura.
Chrome e Firefox conferidos com cards clicáveis por mouse/Enter/espaço, seleção
independente, campos/ajuda/ações sem abrir o detalhe acidentalmente e navegação
pela lateral/drawer. Grupo arquivado agora contém quatro ações em linha, incluindo
Restaurar com texto, em 360px. Avisos curtos ocupam somente uma tag; mensagens
longas quebram dentro dela. Matriz de larguras/temas repetida; capturas locais em
`output/playwright/acp-refine-*`. Gravações permaneceram simuladas.

Entregue em A3a (10/09/2026): detalhe individual e agrupado com cabeçalho legível,
execução e finanças separados por tema, progresso/metas e histórico tokenizados,
ranking de categorias, composição das propostas, impostos, notas e custos manuais.
Colaboradores usam tabela/cards compartilhados e mantêm distinção entre ponto,
jornada RDO e deslocamento; equipamentos e escopo continuam em consulta.
`ProjectDetailDashboard` passou a compor cinco arquivos de modelo/apresentação,
sem modificar as APIs, cálculos, polling ou permissões.

Validação de A3a: 15 testes focados de renderização/contratos, suíte frontend
completa (81 arquivos), lint, build e arquitetura aprovados. Chrome e Firefox
em 360/390/640/768/1024/1280/1536px nos dois temas, sem overflow nos painéis.
API interceptada para custos (sucesso, falha preservando campos, exclusão), notas,
desvios, composição/impostos, volta e reabertura por teclado, entrada/cancelamento
de cronograma e horas, skeleton, erro/retry, vazios e erro independente de notas.
Falha de atualização preservando o cache e formulário em 360/390/768/1280px também
conferidos, com campos rotulados e sem overflow.
Perfis gestor, viewer e sem acesso e detalhe agrupado conferidos nos dois
navegadores. Nenhuma gravação real. Capturas locais: `output/playwright/acp-detail-*`.

**Próximo após o merge de 11/09: A3a.1**, faturamentos Omie no detalhe e conferência
das TAGs, com romaneios e origem das jornadas RDO em A4. A3b continua com cronograma,
escopo e propostas/revisões; A5 inclui indicadores operacionais de Sede e A6 mantém
Custo. Persistência real, aparelhos físicos e retirada do CSS legado seguem em A7.

## 0.5 Complemento da main — 11/09/2026

O estado de conclusão nas seções anteriores se refere às entregas datadas, não
a todas as superfícies que chegaram depois. Inventário completo de rotas,
arquivos, perfis, fluxos e critérios no
[levantamento da integração](main-integration-2026-09-11.md).

| Superfície nova/alterada | Situação atual | Alvo / lote |
| --- | --- | --- |
| Faturamentos do projeto/grupo | Novo `ProjectInvoicesSection` legado, integrado funcionalmente | Cards/DataTable/StatusPill, sincronização/recebimento e paginação — A3a.1 |
| TAG, romaneios e jornadas RDO | TAG e ações preservadas nos componentes extraídos; diálogos ainda legados | Gatilhos/Modal, ambas as fontes de jornada e todos os itens de romaneio — A4 |
| Indicadores de Sede | Novos `SedeOperationalCards`, com manutenção/produção aprovadas | StatCard/BarList/DataTable e filtros — A5 |
| Manutenção/Produção: entrada/listas | Novo módulo com Shell/TopBar e cards legados | AppShell/PageHeader, navegação/URL, Card/FilterBar/feedback — M1 |
| Manutenção/Produção: formulários | `OperationalReportFormPage`/`ReportCoreFields` legados; RDO DS mantido | Convergência com DS do RDO, etapas, campos, anexos/revisão — M2/M3 |
| Programação e histórico de manutenção | Tabela e alternativa mobile existentes, sem migração DS | KPIs, DataTable/cards, filtros/ordenação/paginação — M4/M5 |
| Equipamentos: manutenção | Supervisor, perfis/checklists, categoria/intervalo/visibilidade, exceções e histórico não migrados | Shell, campos e Modal/ConfirmDialog DS — EQ1–EQ3 |
| Admin: API/Tokens | Novo painel/etapas, formulários, lifecycle, console e auditoria legados | AppShell, DS/Modal, console com scroll deliberado, nunca segredo persistido — API1–API4 |
| Contas/ativação pública | Novo fluxo funcional por link; bordas ainda por harmonizar | X1; não confundir com páginas públicas de assinatura já concluídas |
| Permissões de emissão e rascunhos | Main incorporada; Hub/ações de obra conciliados com DS | X2/M1/M2, validar permissão por tipo e tela não autorizada |
| Anexos, confirmação com filhos, busca e loading | Compatibilidade funcional preservada e opt-in DS mantido | Auditoria de consumidores e tours — X2/M2/API4 |
| Efetivo: inativos/histórico e visibilidade | Main conciliada, sem iniciar nova migração | F2 em standby até liberação da frente paralela |

Não há novo módulo visual de WhatsApp, novas páginas de Qualidade nem migração
visual automática por causa das APIs/infra incorporadas. A listagem completa e
as exclusões justificadas estão no levantamento. Nenhuma migration de banco ou
homologação visual dos módulos novos foi executada nesta integração.


## 1. Fundação de estilo

| Atual | Ação | Novo |
|-------|------|------|
| `styles/variables.css` (~15 vars no baseline) | **Concluído na Fase 1** | Tokens completos + temas + aliases temporários |
| `styles/base.css` (13.284 linhas) | **Em transição** | Importado por `legacy.css` em `layer(legacy)`; desmontar incrementalmente |
| (sem fronteira de migração) | **Concluído na Fase 1** | `.fv-ds` / `[data-fv-ds]` delimita conteúdo novo |
| (sem Tailwind) | **Concluído na Fase 1** | Tailwind v4, sem Preflight, tokens em `@theme` |
| 151 cores hex | Consolidar | ~5 famílias tokenizadas (marca + neutros + 4 feedback) |
| 70 `!important` | Remover | Corrigir especificidade via componente/props |
| 50 `box-shadow` distintos | Mapear | `--shadow-e0..e3` |
| 20+ `border-radius` | Mapear | `--radius-sm/md/lg/xl/pill` |
| 23 breakpoints | Consolidar | `sm/md/lg/xl/2xl` |
| `font-family: Segoe UI` | Em transição | `Inter Variable` (`--font-sans`) nas fronteiras `.fv-ds` |
| fontes 9–13px + fracionárias | Normalizar | escala `--text-*` (mín. 12px) |
| sem dark mode | Fundação concluída | `.light` / `.dark` / `system`; telas adotam ao migrar |

## 2. Layout / shell

| Atual | Ação | Novo |
|-------|------|------|
| `.app-shell { max-width: 420px }` | **Remover teto** | Shell fluido (`max-width: 1280px`) |
| `layout/Shell.tsx` | Refatorar | Shell responsivo (Sidebar ≥ lg / BottomBar < lg) |
| `layout/TopBar.tsx` | Consolidar | `TopBar` do DS (breadcrumb + search + ações) |
| `layout/BottomBar.tsx` | Consolidar | `BottomBar` do DS (tabs + FAB) |
| (sem sidebar desktop) | Adicionar | `Sidebar` do DS (≥ lg) |
| `HubPage` + `hubModules.ts` | Recompor | Hub/Dashboard do doc 04 (mantendo `moduleRegistry`) |

## 3. Componentes de UI existentes

| Atual (`components/ui/*`) | Ação | Novo |
|---------------------------|------|------|
| `Button.tsx` (4 variantes, 8px/12px) | Ampliar | `Button` (5 variantes, sm/md/lg, loading) |
| `Modal.tsx` (a11y boa) | **Manter a11y + padronizar** | `Modal` com tamanhos sm/md/lg/full; → BottomSheet no mobile |
| `Toast.tsx` (4s fixo) | Evoluir | `Toast` com pausa no hover + ação/undo |
| `Skeleton.tsx` | Generalizar | `Skeleton` (text/block/circle/table-rows/card) |
| `SearchBar.tsx` + hooks | Consolidar | `Search` (mantém debounce/URL/persistência) |
| `ConfirmDialog` | Padronizar | `Modal size="sm"` com ação `danger` |
| (inputs espalhados) | Criar | `Input` / `Select` unificados |

## 4. Cards (consolidar ~102 classes → 1 componente)

Substituir todas as variações por `Card` + props. Exemplos de classes a aposentar:

| Classes atuais (amostra) | Novo |
|--------------------------|------|
| `acp-pcard`, `admin-card`, `auth-card`, `client-report-card`, `equip-card`, `stats-card`, `colab-card`, … | `Card variant/padding` |
| toolbars de card (`admin-card-toolbar`, `acp-pcards-filters`) | `FilterBar` |

## 5. Badges / status (consolidar → Badge + StatusPill)

| Classes atuais | Novo | tone |
|----------------|------|------|
| `badge-ok`, `equip-badge-ok`, `privacy-status-ok`, `*-signed`, `*-active` | `StatusPill` | `success` |
| `badge-pen`, `equip-badge-expiring`, `*-pending` | `StatusPill` | `warning` |
| `badge-rej`, `equip-badge-expired`, `*-rejected`, `*-cancelled` | `StatusPill` | `danger` |
| `badge-rev`, `rtype-badge`, `*-draft`, `*-info` | `StatusPill` | `info` |
| `equip-badge-none`, `*-na` | `StatusPill` | `neutral` |
| `ops-pill` e chips de categoria | `Badge tone` | conforme categoria |

> Novos status → entrada no mapa central `statusToTone`. Nunca nova classe por módulo.

## 6. Feedback / erros

| Atual | Novo |
|-------|------|
| `field-error`, `inline-error`, `form-error`, `ops-error` | `Alert` (inline) ou `errorText` do Input |
| mensagens de sucesso ad-hoc | `Toast` / `Alert success` |
| `error` genérico em blocos | `EmptyState variant="error"` + retry |

## 7. Estados vazios / loading

| Atual | Novo |
|-------|------|
| `colab-empty`, `stats-empty`, `tech-summary-empty`, etc. | `EmptyState` (variants) |
| `.spinner` / `.loading` avulsos | `Skeleton` (conteúdo) ou spinner do `Button` (ação) |

## 8. Tabelas

| Atual | Novo |
|-------|------|
| 11 páginas com `<table>` ad-hoc dentro de 420px | `DataTable` responsivo (tabela ≥ md → cards < md) |
| filtros de tabela heterogêneos | `FilterBar` |

## 9. Onboarding / tutoriais

| Atual | Ação |
|-------|------|
| 20+ chaves de `localStorage` de "novelty", `driver.js` (`HubTutorial`, `ClientTutorial`, `*Novelty.tsx`) | **Reduzir dependência**: a clareza do novo DS (hierarquia, estados vazios, rótulos) deve tornar a maioria dispensável. Manter apenas tours de real valor; não migrar pop-ups que só compensavam baixa affordance. Não é remoção obrigatória — é meta de redução. |

## 10. Ordem sugerida de migração (para o agente de programação)

1. **Fundação — concluída:** tokens, Inter, Tailwind sem Preflight, layers, tema,
   `BrandLogo`, `AppIcon`, `ThemeToggle` e compatibilidade legada.
2. **Primitivos de UI — concluídos para o piloto RDO:** `Button`, `Input`, `Select`,
   `Textarea`, `Card`, `Badge`, `StatusPill`, `Alert`, `EmptyState`, `Skeleton`,
   `Spinner`, `Modal`, `FormStepper` e `Switch`. A apresentação responsiva do
   seletor de serviço foi resolvida sem mudar o fluxo.
3. **Shell responsivo — concluído no Hub e no RDO autenticado:** `Sidebar`, drawer,
   `BottomBar` e `TopBar` compartilhados; expansão para os demais módulos segue o
   roadmap.
4. **DataTable + FilterBar:** migrar as 11 telas de tabela.
5. **Hub/Dashboard:** recompor conforme doc 04.
6. **Módulo a módulo:** RDO autenticado concluído; trocar classes `*-card`/`*-badge`/erros/vazios nos demais módulos;
   remover `!important`; aposentar breakpoints extras.
7. **Limpeza final:** deletar CSS morto do `base.css` à medida que cada módulo migra.

> Regra de segurança: **não** alterar backend, APIs, rotas, autenticação (`RoleRoute`,
> `PrivateRoute`, `rolePath`), stores (`zustand`) nem queries (`react-query`). O redesign é
> estritamente da camada de apresentação.

Fila operacional atual: **A3a.1/A4 → A3b–A7 → EQ1–EQ3/M1–M5 → Estoque/Romaneio →
API1–API4/X1/X2 → F6**. F2 só após retomada autorizada; conferir o roadmap antes
de usar a ordem histórica acima. O merge funcional da main é uma integração
solicitada à parte, não autorização para reescrever suas regras durante a migração.
