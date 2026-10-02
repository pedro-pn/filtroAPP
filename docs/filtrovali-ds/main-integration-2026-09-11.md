# Integração da main e complemento do escopo de UI — 11/09/2026

## Baseline e limites desta rodada

- Branch: `feat/frontend-redesign-2`; HEAD anterior: `702d8dfe`.
- Main consultada no remoto: `9586579f` (PR #250, consulta por código de projeto).
- Base comum: `183e9b99`; 35 commits recebidos, dos quais 23 não são merges.
- Delta funcional da main desde a base comum: 290 arquivos, incluindo 37 novos
  arquivos em `frontend/src`. Isso não equivale a 37 páginas novas.
- Integração por **merge**, sem reescrever o histórico publicado. Commit: `1efe4639`.
- As alterações locais do redesign foram preservadas fora do commit de merge.
  Backup adicional mantido no stash `7d3c51716fe113d4c5a873b723321bff99f8c49a`.
- Sem push, deploy, migração de banco, importação de histórico, emissão de tokens
  reais ou envio de e-mails. Dependências locais sincronizadas com os lockfiles;
  geração do Prisma Client é apenas local, não aplica migrations.

Este documento complementa o [roadmap](../REDESIGN_ROADMAP.md) e o
[mapa de migração](06-migration-map.md). As specs 014/015 e os contratos atuais
continuam definindo comportamento. O levantamento combinou histórico/diff,
registry, rotas, componentes e testes; o grafo ainda não cobre todas as telas
recém-incorporadas, exigindo leitura direta nesses casos. **Integração funcional
não significa homologação visual dos novos módulos.**

## O que entrou e onde deverá ser adaptado

Todos os caminhos de UI abaixo são relativos a `frontend/src`.

| Frente / origem | Entrada e arquivos | Novidades e limites que a UI deve preservar | Destino no roadmap |
| --- | --- | --- | --- |
| Manutenção/Produção — #233, #235 e correção `873b6113` | `/manutencao-producao`; `pages/MaintenanceProductionPage.tsx`, `components/reports/OperationalReportSummaryCard.tsx` | Módulo próprio com manutenção, produção, programação e histórico; cards de RDO operacional e manutenção avulsa; busca, situação, paginação, consulta de aprovados e entrada de revisão | **M1 pendente**: shell/navegação, cards, filtros e feedback ainda legados |
| Formulários operacionais — #233 | `/manutencao-producao/relatorio/novo?tipo=manutencao\|producao\|manutencao-avulsa`; edição por `editar`, revisão por `revisao`; `pages/collaborator/OperationalReportFormPage.tsx`, `components/reports/ReportCoreFields.tsx` | Cabeçalho, horários/intervalo, equipe diurna/noturna, HE e justificativa, finalização; rascunho local por usuário/tipo; aprovação/devolução e motivo; aprovado somente leitura; manutenção avulsa tem duas etapas | **M2/M3 pendentes**: reaproveitar DS do RDO sem trocar seus fluxos ou seu autosave de servidor pelo rascunho local operacional |
| Registro de manutenção — #233–#235 | Mesmo formulário; `schemas/operationalReport.ts`, `api/operationalReports.ts` | Categoria → equipamento/TAG → checklist do perfil; atributos do equipamento; observações; serviços de terceiros, comprovantes e fotos, remoção/restauração; supervisor válido condiciona aprovação. RDO de manutenção aceita **zero cartões de manutenção**, mas valida os adicionados | **M3 pendente**: campos condicionais, anexos e revisão; não reinstalar a antiga exigência de uma manutenção por RDO |
| Registro de produção — #233 | Mesmo formulário, modo `producao` | Linhas de limpeza química/peças, material e massa em kg; cabeçalho/equipe/HE e revisão existentes; projetos operacionais 5002/5004 não são um seletor de obra comum | **M3 pendente**: agrupamento temático, densidade e leitura das unidades sem mudar cálculos |
| Programação preventiva — #233–#235 | `?tab=programacao-manutencao`; `components/reports/MaintenanceScheduleBoard.tsx` | Agrupamento por categoria, TAG, última/próxima manutenção, vencidas/hoje/em dia/sem histórico/sem configuração; busca/categoria/prazo e paginação; cálculo no backend baseado em aprovados | **M4 pendente**: KPIs e alternativas tabela/cards, sem substituir programação por calendário do Efetivo |
| Histórico técnico — #233–#235 | `?tab=historico-manutencao`; `components/reports/MaintenanceHistoryTable.tsx` | Busca, categoria, ordenação por data/TAG/equipamento/categoria/responsável, paginação e download documental autenticado; visão mobile já existe, mas usa outra linguagem visual | **M4 pendente**: DataTable/cards DS, estados de download e nomes longos |
| Configuração da manutenção — #233–#235 | `/equipamentos?tab=maintenance`; `pages/equipamentos/MaintenanceConfigPanel.tsx` | Supervisor global e assinatura válida; perfis e checklist ordenável; perfil padrão por categoria, intervalo em dias e exceção por equipamento; modal novo/editar perfil e confirmação de remoção | **EQ1/EQ2 pendentes**: formulário/painéis e overlays, em conjunto com o módulo Equipamentos |
| Categorias e histórico do equipamento — #233–#235 | `pages/equipamentos/{EquipamentosPage,CategoryManager,CategoryFormModal,EquipmentCard,ChecklistItemsEditor,MaintenanceHistoryModal}.tsx` | Controle de quais categorias aparecem na manutenção; ações de histórico por equipamento, status, anexos/documentos e modal de consulta; manter os consumidores dos checklists | **EQ2/EQ3 pendentes**: todas essas entradas, incluindo consulta sem gestão |
| Tokens/API — #237, #240, #244–#250 e correções associadas | `/admin/tokens`; `pages/admin/AdminTokensPage.tsx`, `components/admin/api-tokens/` | Área **administrativa**, não um novo módulo para todos os usuários; etapas Meus tokens/Configurar/Playground, filtros e paginação por cursor, credencial selecionada e detalhe em URL | **API1 pendente**: shell/listagem/filtros, contadores, cards e estados |
| Política, segredo e lifecycle — mesmos commits | `ApiCredentialForm`, `ApiScopeCatalog`, `ApiCredentialActions`, `ApiCredentialReductionForm`, `ApiTokenRevealModal` | Escopos/domínios, projetos, validade/perpétuo, IP/restrições e limites; revisão antes de emitir; revelar/copiar segredo uma única vez; reduzir, rotacionar e revogar com confirmação/motivo | **API2 pendente**: formulários e quatro famílias de diálogos; nunca persistir segredo em URL, cache, logs ou screenshots |
| Playground e auditoria — mesmos commits | `ApiOperationSelector`, `ApiOperationParameters`, `ApiRequestConsole`, `ApiCredentialActivity`, `ApiCursorPagination`; `apiOperations.ts` e helpers | Operação/escopo, parâmetros tipados, `projectCode`/`projectId` conforme contrato, detalhes RDO/serviços e demais catálogos; cURL redigido, resposta/status/tempo/requestId, truncamento; verificação de download não transfere arquivo; uso de 30 dias e eventos. IP não é simulado pelo painel | **API3/API4 pendentes**: console legível e auditoria sem alterar a política ou simular sucesso |
| Faturamento Omie — `7b53d59f` | Detalhe individual e agrupado; `components/projects/ProjectInvoicesSection.tsx` | NF-e/NFS-e, emissão, tomador, missão, bruto e recebimento/parcelas; total bruto não é líquido recebido; paginação, sem vínculo, primeira sincronização, atualização/falha e snapshot antigo | **A3a.1 próximo**: novo bloco legado dentro do detalhe migrado, sem reabrir tudo que A3a já entregou |
| TAG de equipamentos e romaneios — #238/#239 | `ProjectOverviewMetrics`, `ProjectDetailDashboard`, `ProjectRomaneiosDialog` | Código de identificação do equipamento em obra antes do nome nos cards/detalhe; diálogo de todos os itens de entrada/saída, projeto/grupo, quantidades/unidades; consulta não exige papel de edição do Romaneio | TAG dos equipamentos já exibida no código atual; **A4 ampliado** para migrar diálogo e gatilho |
| Jornada RDO acionável — #238 | `ProjectDetailPeople`, `ProjectCollaboratorHoursDialog` | Horas do ponto abrem apropriação; fallback azul do RDO agora abre origem/jornadas dos relatórios; não entra no custo, e grupo mantém tratamento de sobreposição | Ação preservada na conciliação; **A4 ampliado** para apresentação das duas fontes |
| Sede e importação de ponto — #233 e #241 | `SedeCostsBoard`, `SedeOperationalCards`, `PontoImportPanel` | Indicadores de manutenção/produção aprovadas (5002/5004), horas/HE/equipe, perfis/equipamentos/materiais; importação mantém contexto de custos e os controles atuais | **A5 ampliado**, integração de ponto continua **A6** |
| Ativação de contas — #230 | `/reset-password?token=…&setup=1`; `pages/{ResetPasswordPage,admin/AdminAccountsPage,gestor/GestorPage}.tsx` | Criar conta sem senha inicial definida pelo gestor; link de uso único, expiração/reenvio quando permitido, cópia manual quando aplicável, sucesso e volta ao login; edição de senha existente permanece | **X1 pendente**: página pública e bordas de criação/cópia; não confundir com assinatura pública já migrada |
| Permissões de emissão e entrada — #233 | `AdminAccountsPage`, `HomePage`, `CoordinatorPage`, `NewReportPage`, `auth/reportPermissions.ts`, `hubModules.ts`, `HubPage`, registry/rotas | `SITE_RDO`, `MAINTENANCE`, `PRODUCTION` independentes; ações de obra só para habilitados; clientes não ganham emissão operacional; separação dos rascunhos de obra e operacional; fallback de emissão não autorizada | **X2 + M1/M2**: validar combinação de perfis e estados sem permissão; fechamento anterior do RDO não cobre automaticamente estas bordas novas |
| Efetivo — #241 | `MissionFormModal`, `MissionTeamSelector`, `MissionAllocationModal`, `utils/missionTeam.ts`; specs 012 | Ativos/inativos/todos, seleção histórica mediante confirmação, sobreposição por período e ciclos, visibilidade de projetos e planejamento. Controles existentes conciliados com os novos payloads | **F2 permanece em standby**; somente compatibilidade do merge, sem começar outra onda visual ou importar branch paralela |
| Componentes/tutoriais compartilhados | `ui/{ConfirmDialog,UploadField,SearchCombobox,Skeleton}`, `utils/uploadAssetUrl.ts`, `ReportCoreFields`, `OperationalReportsNovelty`, `HubTutorial`, `apiTokenPlaygroundNovelty/Tour` | Confirmação com conteúdo filho, remoção/restauração de anexos, URL autenticada, busca digitada ao limpar seleção, skeletons e ancoragem dos tours | **X2/M2/API4**: conferir DS e consumidores legados, mantendo opt-in durante a migração |

## Backlog executável acrescentado

- [x] **A3a.1 (implementado no código em 24/09)** — faturamentos do detalhe
  migrados, com estados de sincronização e bruto/recebido distintos; TAG dos
  equipamentos em obra preservada nos cards e no detalhe. Integração real em A7.
- [ ] **A4 (P1, complemento)** — incluir romaneios, jornada RDO e jornada do ponto
  na onda dos diálogos. Preservar origem, acesso de consulta e retorno de foco.
- [ ] **A5 (P1, complemento)** — incluir os indicadores operacionais de Sede,
  respeitando filtros de período e a origem aprovada dos registros.
- [ ] **EQ1 (P1)** — mapear shell/abas de Equipamentos e preparar os componentes
  reutilizáveis para configuração; não migrar só o link vindo da manutenção.
- [ ] **EQ2 (P1, após EQ1)** — supervisor, perfil/checklist, categoria/intervalo/
  visibilidade, exceção por equipamento, edição/remoção e seus diálogos.
- [ ] **EQ3 (P1, após EQ2)** — histórico/documentos e ações dos cards de equipamento;
  validar claro/escuro, leitura e gestão.
- [ ] **M1 (P1)** — shell, abas/URL, entrada pelo Hub, cards e filtros operacionais
  sem navegação duplicada; manter visibilidade por permissão de emissão.
- [ ] **M2 (P1, após M1)** — adaptar `ReportCoreFields` ao DS e convergir campos
  centrais com o RDO sem reverter a escala/identidade já aprovada; manter intervalo
  com segundos, HE, rótulos, linha do stepper e os dois tipos de rascunho.
- [ ] **M3 (P1, após M2; alinhado a EQ2)** — manutenção, avulsa e produção: criar,
  editar, revisar, devolver, aprovado em consulta, anexos/documentos/restauração,
  terceiro e campos específicos. Testar zero manutenções, supervisor inválido e
  mudanças não salvas antes da aprovação.
- [ ] **M4 (P1, após M1/EQ2)** — programação e histórico; filtros/paginação/ordem
  do servidor, alternativas mobile e download protegido.
- [ ] **M5 (P1, após M3/M4)** — matriz de perfis/estados/navegadores, inclusive
  tela sem autorização, link direto, refresh e volta; fechar só após homologação.
- [ ] **API1 (P1)** — shell administrativo, etapas, lista/filtros/cards e detalhe.
- [ ] **API2 (P1, após API1)** — política/escopos, revisão, segredo único e dialogs
  de reduzir/rotacionar/revogar, preservando confirmações e formulários pendentes.
- [ ] **API3 (P1, após API1/API2)** — seleção/parâmetros/console/cURL, uso/eventos
  e cursores; scroll de código apenas quando intencional, nunca da página/cards.
- [ ] **API4 (P1, após API3)** — responsividade, tema, teclado, dados sintéticos,
  matriz de acesso exclusivo ADMIN e atualização dos tours.
- [ ] **X1 (P1)** — harmonizar criação de senha pública e novas instruções de
  contas; validar link válido/expirado/usado, reenvio e cópia sem registrar tokens.
- [ ] **X2 (P1)** — auditoria transversal das permissões, Hub, shells, anexos,
  confirmações com filhos, busca e loading. Revisar as bordas novas do RDO sem
  declarar sua migração anterior perdida. Efetivo entra apenas após sua retomada.

## Regras e critérios de aceite

Usar AppShell e DS existentes; não recriar botões, dropdowns, stepper ou modal por
módulo. Manter as ações dos cards em uma linha, sem mini-scroll; adaptar tabelas
para cards no mobile; formulários/diálogos compactos; temas claro/escuro/system,
foco sem corte e tipografia sem palavras quebradas em um caractere por linha.
O console JSON/cURL e PDFs podem ter navegação espacial própria, deliberada.

Matriz mínima: 360/390/768/1024/1280 px, Chromium/Firefox/WebKit; conteúdo curto/
longo, loading, vazio, erro/retry, cache desatualizado, sucesso, ação pendente e
somente consulta. Manutenção: combinações de permissões de emissão, autor,
revisor/supervisor e ADMIN conforme contexto do backend. Tokens: somente ADMIN.
Contas públicas: sem sessão. Conferir teclado, toque, foco e back/forward.

Manter APIs, cálculos, permissões e persistência. Não migrar schemas funcionais
para satisfazer um detalhe visual. As integrações de RDO e Efetivo exigem regressão
nos consumidores compartilhados; executar dados sintéticos em ambiente isolado.

## Mudanças sem nova superfície de UI nesta integração

- OAuth2 de e-mail/Exchange, Caddy/WhatsApp, correções de sincronização Omie,
  APIs públicas de integração/Qualidade e suas regras são backend/infra. Não são
  novas páginas de Qualidade nem um módulo de WhatsApp para redesenhar.
- Importação/consolidação do histórico de manutenção e catálogo de equipamentos
  são scripts, não telas. Mapear suas consequências nos vazios, anexos e TAGs,
  sem executá-los nesta rodada.
- Sete migrations Prisma vieram da main (manutenção/produção, perfis/intervalos/
  visibilidade, credenciais e faturamentos). Aplicação em ambiente de implantação
  continua fora deste trabalho de merge/planejamento.
- Atualizações de React Query/ZXing no frontend e PDF/sharp/e-mail no backend
  exigem regressão dos consumidores existentes, não novas fases fictícias de UI.
- A outra worktree de Efetivo não foi incorporada: somente commits já na main.
  Assinaturas mantém seu fechamento técnico anterior e a conferência física com
  o usuário; não houve nova página de assinatura neste delta.

## Evidências desta integração

- `origin/main` (`9586579f`) é ancestral do HEAD de merge; nenhum arquivo com
  conflito pendente no índice, e `git diff --check` aprovado.
- Auditoria do stash: todos os 105 arquivos previamente modificados e os 97
  arquivos anteriormente não rastreados permanecem presentes. As diferenças nos
  pontos de sobreposição foram conciliadas; sem perda de arquivos locais.
- Resoluções: DS do RDO/Hub preservado, novas permissões e criação de senha por
  link mantidas, restauração de anexos e conteúdo filho de confirmação suportados,
  TAG e gatilhos POINT/REPORT transportados aos componentes extraídos. Efetivo
  combina os controles existentes com as confirmações/payloads históricos da main.
- Suíte frontend completa: **516 testes aprovados em 95 arquivos**, incluindo
  contratos de navegação, rascunhos, campos operacionais e testes dos gatilhos de
  jornada/filhos da confirmação. A execução final foi fora do sandbox, que bloqueou
  subprocessos e sockets de alguns testes nas tentativas iniciais.
- Backend: **14 arquivos de testes focados aprovados**, cobrindo contas, TAG,
  faturamentos/romaneios, API, permissões, relatórios operacionais, histórico de
  inativos e Sede. Prisma Client gerado localmente; ambiente de teste com URL de
  banco sintética em porta não utilizável, sem conexão a dados reais.
- Build, lint, tipagem E2E do RDO e `architecture-check` aprovados. O build mantém
  o aviso de bundles acima de 500 kB; otimização de carregamento não foi executada.
- Os testes estruturais que pressupunham a antiga composição do formulário
  foram ajustados sem remover as verificações funcionais. A convergência visual
  de `ReportCoreFields` ficou explicitamente pendente em M2.

Não foi feita homologação em navegador dos novos módulos, suíte E2E comportamental
completa nem aplicação de migrations. Essas coberturas permanecem no backlog;
testes de contrato/SSR não substituem a matriz visual e a persistência isolada.
