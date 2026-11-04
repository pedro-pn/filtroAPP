# Research: Conferência semanal de alocação

Levantamento feito em 2026-11-03 sobre a `main` em `ada8ccd9`. Cada decisão cita o código que a
fundamenta.

## R1. Onde gravar a conferência e como ela entra no custo HH

**Decision**: tabelas próprias (`AllocationReviewWeek`, `AllocationReviewRow`,
`AllocationReviewDay`). Os dias de linhas conferidas entram em `buildDailyProjectWeights`
(`backend/src/lib/acompanhamento/labor-cost.js:999`) como **regra de maior precedência**, acima
do ajuste manual (`PontoDayProjectOverride`, LC:1028-1045). Os motivos novos são:

- `REVIEW_CONFIRMED`: um projeto.
- `REVIEW_SHARED_CONFIRMED`: vários projetos, com o mesmo cálculo de peso do ajuste manual
  (LC:1033-1042).
- `REVIEW_IDLE`: Sede, Folga, Férias, Afastamento ou Treinamento. Não gera alocações e entra em
  `NON_ACTIONABLE_ALLOCATION_REASONS` (LC:1230).

**Rationale**:

- `PontoDayProjectOverride` exige `projectId` (FK `Restrict` e unique
  `[collaboratorId, workDate, projectId]`, `schema.prisma:877-893`), então não consegue
  representar "dia sem projeto".
- Esse ajuste é apagado e recriado por dois outros caminhos:
  - `resolveUnallocatedDays`, que faz `deleteMany` por colaborador e data
    (`allocation-audit.js:393-406`);
  - `setDayProjectOverride` (`pontomais/sync.js:1104`).

  Gravar a conferência nele faria um desses fluxos sobrescrever o dia conferido sem aviso.
- Uma fonte única com precedência explícita evita dupla gravação e mantém o ajuste manual
  funcionando nos dias não conferidos (FR-016).

A spec cita "reutilizar o ajuste manual". O efeito para o usuário é o mesmo: horas no projeto
conferido. O que muda é o mecanismo, pelos motivos acima.

**Alternatives considered**:

- Gravar `PontoDayProjectOverride` e adicionar um "kind" nele. Descartado: mistura duas
  responsabilidades e herda os `deleteMany` dos outros fluxos.
- Bloquear os outros fluxos em dias conferidos. Descartado: espalha a regra por três lugares.

**Detalhes**:

- Só os dias de linhas **conferidas** valem. Rascunhos (dias editados com a linha ainda não
  conferida) não afetam custo nem relatório.
- **Dia conferido em projeto sem horas de ponto, em dia útil**: o custo aplica o piso de 8h48
  ao projeto, como já acontece com dia do Efetivo sem RDO (LC:1306-1307). O dia precisa entrar
  no gatilho de `classifyProjectHours` (LC:1277-1278). Sem isso, a conferência de um dia com
  ponto esquecido não teria efeito.
- **Dia conferido como Sede, Folga, Férias, Afastamento ou Treinamento com horas de ponto**: as
  horas vão para o balde Sede (ocioso, LC:1773-1787), que é o comportamento atual de dia sem
  projeto. O balde Folga (dia útil sem ponto) não muda.
- **Viagem**: é gravada com o projeto de destino e entra como `REVIEW_CONFIRMED` daquele
  projeto (decisão do usuário: custo no projeto).

## R2. Sugestão automática e indicadores das fontes

**Decision**: um read-model no backend (`backend/src/lib/efetivo/allocation-review/suggestion.js`)
que, para cada colaborador e dia, combina:

- a **trilha** de `classifyProjectHours`, a mesma usada pela auditoria (`allocation-audit.js`
  `loadTrails`): horas, `tags`, `tagProjectIds`, `rdoProjects` (com `rdoNumber`),
  `effectiveProjectIds`, `travelContext`, `manualProjectIds`;
- `CollaboratorAbsence` no período, que **não** entra no motor de custo (LC só a usa para
  conflitos, LC:1911);
- o feriado corporativo do dia, via `loadCorporateCalendar` (`lib/calendar/corporate-calendar.js:109`).

A regra da FR-004 é aplicada sobre esses dados. O indicador de cada fonte (`confirms`,
`diverges`, `none`) é calculado comparando a situação que a fonte indica com a sugestão.

**Rationale**: reaproveita o cálculo caro e já memorizado (fingerprint em
`allocation-audit.js:20-59`). A sugestão fica coerente com o que o custo faria. A função de
regra é pura e testável sem banco.

**Diferença em relação à prévia**: o app **não guarda horário de entrada e saída** do ponto
(`PontoPeriodSummary` só tem minutos totais e etiquetas, LC:422-432; `normalize.js:243-256`). O
painel do dia mostra horas normais, HE e etiquetas, sem horário. Guardar o horário exigiria
mudar a sincronização do Ponto Mais e o parser de XLSX, o que fica fora do escopo.

**Planejamento**: o Efetivo não tem estado planejado de Sede ou Folga. A situação do dia é só
`ALLOCATED`, `FREE` ou `UNAVAILABLE` (`capacity.js:109`). O indicador "Efetivo" vale
`confirms`/`diverges` quando há alocação em missão no dia, e `none` nos demais casos. "Folga
planejada" da FR-004 é lida da ausência do tipo FOLGA.

**Alternatives considered**: calcular a sugestão no frontend. Descartado: duplica regra, e o
relatório e o custo precisam do mesmo resultado no backend (snapshot ao conferir).

## R3. Quem aparece na grade

**Decision**: colaboradores operacionais ativos em pelo menos um dia da semana, pela mesma regra
de `loadPlanningProjection` (`read-model.js:108-116`, `capacity.js:92-101`: `JobRole.isActive`,
`isOperational` e vínculo ativo na data). Somam-se a eles os colaboradores que tenham ponto ou
RDO na semana, mesmo que não sejam operacionais. Dias fora do vínculo ficam indisponíveis.

**Rationale**: cobre quem o DP precisa sem trazer o administrativo inteiro. Quem bateu ponto ou
aparece em RDO tem custo e alocação e precisa ser conferível.

## R4. Linha conferida, semana fechada e concorrência

**Decision**:

- A **semana** é identificada pela segunda-feira (`weekStart`, DATE). Sem registro, a semana
  está aberta e nada foi conferido.
- A **linha** (`AllocationReviewRow`) guarda `confirmedAt`/`confirmedByUserId`. Ao conferir, os
  sete dias são gravados: os não editados recebem a sugestão daquele momento (FR-010).
- Desfazer a conferência mantém os dias como rascunho.
- Cada semana tem `version` (inteiro). Toda escrita envia `If-Match-Version` e recebe 409 se a
  versão estiver desatualizada, o mesmo padrão de PATCH e DELETE de ausências
  (`routes/workforce.js`).
- Dias futuros (data maior que hoje em America/Sao_Paulo) não podem ser gravados. Fechar a
  semana exige o domingo encerrado e todas as linhas conferidas.
- Reabrir exige `accountType === 'ADMIN'` e grava um evento em `AllocationReviewWeekEvent`.

## R5. "Fonte mudou depois de conferido"

**Decision**: ao conferir, cada dia grava `sourceFingerprint`, um hash curto das fontes do dia
(etiquetas, projetos do RDO, projetos do Efetivo, ausência e horas arredondadas). Na leitura,
o hash é recalculado. Se mudou, o dia mostra o aviso "a fonte mudou depois de conferido", sem
alterar a conferência.

## R6. Relatório Alocação dos colaboradores

**Decision**: em `buildMonthlyAllocationSummary` (`allocation-monthly-report.js:245`), depois de
montar as entradas de RDO, carregar os dias conferidos do mês e, para cada colaborador e data
conferidos:

1. Remover as entradas de RDO daquele colaborador e daquela data.
2. Emitir uma entrada por projeto conferido. O turno é o do RDO quando houver entrada de RDO do
   mesmo projeto naquele dia (inclusive noturno); senão, é "Diurno". `reportId` e
   `sequenceNumber` ficam `null`. Para viagem, o nome do projeto ganha o prefixo "Viagem · ".
3. Para dias sem projeto, emitir uma entrada com `kind` (SEDE, FOLGA, FERIAS, AFASTAMENTO ou
   TREINAMENTO), `projectName` igual ao rótulo da situação e `clientCnpj` vazio.

Campos novos na entrada: `kind`, `source` (`RDO` ou `REVIEW`) e `reviewed: boolean`.
`summary.projectCount` passa a contar só os `projectId` não nulos.

**Rationale**:

- Nada consome `reportId` ou `sequenceNumber` hoje: o PDF e a UI os ignoram e só usam
  `date-projectId-shift-index` como chave (SD:3031, 3088). Torná-los nulos é seguro.
- O PDF trata `null` como texto vazio (AMR:344, 356). Basta trocar "Local da obra" por "—" e
  exibir o rótulo quando não houver projeto.
- Fakes de teste: todo `client` falso usado nos testes do relatório passa a precisar de
  `allocationReviewDay.findMany`. Os testes existentes ganham esse stub retornando `[]`.

## R7. Envio automático espera a conferência

**Decision**: em `processMonthlyAllocationReport` (AMR:626), no caminho automático (sem
`yearMonth` informado):

1. Trocar o gate `not_first_day` (AMR:627) por uma **janela de envio**, que vai do dia 1º ao
   3º dia útil do mês, inclusive. Fora dela, o retorno é `outside_send_window`.
2. Depois de `assertClosedMonth` e da checagem do mailer, e **antes** de `claimDelivery`
   (AMR:632): se alguma semana que toca o mês não estiver fechada e ainda não for o 3º dia útil,
   o retorno é `{ skipped: true, reason: 'awaiting_review', yearMonth, deadline }`.
3. No 3º dia útil, envia de qualquer forma.

O 3º dia útil é calculado por uma função pura `nthBusinessDayOfMonth(yearMonth, n, holidayDates)`,
com `isBusinessDay` (`lib/efetivo/planning/business-days.js:12`) e feriados de
`loadCorporateCalendar`. O dia 1º conta se for útil.

**Rationale**: nada é gravado antes do claim, então as execuções de hora em hora continuam
idempotentes. Restringir a janela evita que o fim do gate do dia 1 dispare envio de meses
antigos nunca enviados. O script `retry-allocation-monthly-report.js:23-33` já trata qualquer
`skipped` que não seja `already_processed` como falha, então a nova razão não é mascarada.

**Envio manual** (`POST /statistics/allocation-report/send`, `statistics.js:829`): passa
`yearMonth`, não entra na espera e continua como hoje (FR-020). A UI ganha mensagens para
`awaiting_review` e `outside_send_window`, e o texto "O envio automático ocorre no dia 1…"
(SD:3473 e cerca de 3626) é atualizado.

**Limite conhecido**: se o servidor ficar fora do ar durante toda a janela, o envio automático
daquele mês não acontece. A recuperação é o script de retry ou o envio manual. É o mesmo risco
de hoje com o dia 1º.

## R8. Aviso aos administradores do Efetivo

**Decision**:

- Tabela `AllocationReviewAbsenceAlert`, com colaborador, tipo (`FOLGA`, `FERIAS` ou
  `AFASTAMENTO`), `startDate`, `endDate`, `status` (`OPEN`, `RESOLVED` ou `CANCELLED`), semana
  de origem e `notificationEventId`.
- A notificação aparece na central existente (`NotificationEvent`,
  `lib/notifications/center.js`), com kind `ALLOCATION_REVIEW_ABSENCE_MISSING`, `dedupeKey` por
  colaborador, tipo e início, escopo dos gestores do Efetivo e destino
  `/efetivo?section=colaboradores&colaborador=<id>&cadastrarAusencia=1&tipo=<t>&de=<d>&ate=<d>`.
- O precedente desse uso é `report-team.js:45`.

**Ciclo de vida**:

- **Criação**: ao conferir a linha, os dias consecutivos do mesmo tipo, editados, sem ausência
  cadastrada e diferentes da sugestão viram um período.
- **Cancelamento**: ao desfazer a conferência ou alterar o dia.
- **Resolução**: ao criar ou editar uma ausência (`lib/efetivo/absences.js` /
  `workforce` service), uma chamada `resolveAllocationReviewAbsenceAlerts(collaboratorId, range)`
  encerra os avisos cobertos pelo mesmo tipo.

**TREINAMENTO**: o enum de ausência tem `TREINAMENTO`, mas o schema Zod da API o rejeita
(`lib/workforce/schemas.js:34-48`). Por isso Treinamento **não** gera aviso, como já está na spec.

**Abrir o formulário pela URL**: hoje não existe. Será criado o parâmetro `cadastrarAusencia`
(mais `tipo`, `de` e `ate`) em `PARAMS_BY_SECTION.colaboradores`
(`utils/planningNavigation.ts:9-17`). Ele abre `AbsenceFormModal` com colaborador, tipo e
período preenchidos.

## R9. Permissão

**Decision**: novo papel de módulo `efetivo:allocation-review`:

- `ModuleRoleCode.EFETIVO_ALLOCATION_REVIEW`, com migration
  `ALTER TYPE "ModuleRoleCode" ADD VALUE`;
- entrada em `shared/modules/registry.json` (roles, `hub.roles` e `allowedModuleRoles` do
  Efetivo, para o papel sozinho abrir o módulo);
- regeneração de `frontend/src/modules/registry.generated.ts`;
- helpers `canReviewAllocation` e `requireAllocationReviewer` em `lib/efetivo/access.js`.

Acesso: ADMIN ou o papel novo. Reabrir semana: só ADMIN. Quem tem só esse papel vê no Efetivo
apenas a seção Conferência: `SECTIONS` passa a ser filtrado por permissão (`EfetivoPage.tsx:34-42`).

**Alternatives considered**: `rdoExtraPermissions`, como `REVIEW_REPORTS`. Descartado: é uma
permissão de RDO, e o Efetivo já usa papéis de módulo.

## R10. Frontend

**Decision**:

- **Seção nova** `conferencia` no Efetivo (`EFETIVO_SECTIONS` e `PARAMS_BY_SECTION`:
  `semana`, `mostrar`, `agrupar`, `q`), com o componente
  `pages/efetivo/components/AllocationReviewBoard.tsx`.
- **Layout**: shell fluido existente (`EfetivoAppShell`, `contentWidth="fluid"`).
- **Kit**: `components/ui/ds` (Card, Badge, Button, Field, Select, MetricCard, ProgressBar,
  Alert, EmptyState), `Modal` para o painel do dia, `SearchCombobox` para "outro projeto" e
  `ConfirmDialog` para fechar e reabrir.
- **Estado do servidor**: react-query, com invalidação da semana depois de cada escrita.
- **Celular**: um card por colaborador com os dias empilhados e o modo "Selecionar dias" no
  lugar do Shift + clique.
- **Novidade**: `AllocationReviewNovelty.tsx`, no padrão de `ProjectWorkflowNovelty.tsx`
  (constante `ALLOCATION_REVIEW_NOVELTY_IMPLEMENTED_AT` e expiração em 10 dias), coordenada por
  `efetivoGuideCoordinator`.
- **Auditoria existente**: `allocationReasons.ts` ganha rótulos para `REVIEW_*` (FR-017).

## R11. Caches

**Decision**: o `currentFingerprint` da auditoria (`allocation-audit.js:20-59`) passa a
incluir a contagem e o `updatedAt` máximo de `AllocationReviewDay` e `AllocationReviewRow`.
Toda escrita da conferência chama `invalidateAllocationAudit()` e `clearProjectDerivedCaches()`
(`lib/resource-list-cache.js:32-38`), como faz `resolveUnallocatedDays`.

## Decisões tomadas na implementação

- **Ajuste manual existente na sugestão**: o `PontoDayProjectOverride` (resolvido em Acompanhamento ›
  pendências) entra na regra logo depois da ausência cadastrada. É uma decisão humana anterior e
  costuma resolver exatamente o conflito etiqueta × RDO.
- **"Só o planejamento indica"** (`PLAN_ONLY`): dia útil sem ponto e sem RDO, mas com missão no
  Efetivo, sugere o projeto planejado (igual ao custo automático, que já apropria 8h48) e fica
  pendente para confirmar, em vez de "Sem informação".
- **Linha só pode ser conferida depois do domingo**: com dias futuros na semana, a linha não é
  conferível; rascunhos dos dias passados podem ser gravados durante a semana.
- **Papel de conferência não dá leitura do Efetivo**: `efetivo:allocation-review` abre o módulo
  (registry), mas não entra em `EFETIVO_ACCESS_ROLES`; quem só tem esse papel vê apenas a seção
  Conferência, e as demais APIs do Efetivo continuam 403.
- **Viagem detectada pela etiqueta "em viagem"** do Ponto Mais (`isPontoTravelTag`), com destino
  pelo Efetivo quando há uma única missão; sem destino único, o dia fica sem informação.
- **Notificação resolvida = evento apagado**: a central não tem estado de encerrado; resolver ou
  cancelar o aviso apaga o `NotificationEvent` correspondente.
