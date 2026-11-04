# Data Model: Conferência semanal de alocação

Todas as mudanças são feitas por migration Prisma (Princípio IV). Não há backfill: nenhuma semana
anterior à implantação fica conferida.

## Enums novos

```text
AllocationReviewKind        PROJECT | TRAVEL | SEDE | FOLGA | FERIAS | AFASTAMENTO | TREINAMENTO
AllocationReviewWeekStatus  OPEN | CLOSED
AllocationReviewEventType   CLOSED | REOPENED
AllocationReviewAlertStatus OPEN | RESOLVED | CANCELLED
ModuleRoleCode              + EFETIVO_ALLOCATION_REVIEW   (ALTER TYPE ... ADD VALUE)
```

`NONE` ("Sem informação") só existe na sugestão e nunca é gravado. Um dia não pode ser salvo
como "sem informação".

## AllocationReviewWeek

| Campo | Tipo | Regra |
|---|---|---|
| id | cuid | |
| weekStart | Date, unique | sempre uma segunda-feira (validado no Zod e no serviço) |
| status | AllocationReviewWeekStatus | default OPEN |
| version | Int | default 1; incrementa a cada escrita na semana (linhas, dias, fechar, reabrir) |
| closedAt / closedByUserId | DateTime? / String? | preenchidos ao fechar; limpos ao reabrir |
| createdAt / updatedAt | | |

É criada sob demanda na primeira escrita. Uma semana sem registro equivale a OPEN sem conferência.

**Transições**: OPEN → CLOSED exige o domingo encerrado em São Paulo e todas as linhas
elegíveis conferidas. CLOSED → OPEN só com conta ADMIN.

## AllocationReviewWeekEvent

| Campo | Tipo | Regra |
|---|---|---|
| id | cuid | |
| weekId | FK → AllocationReviewWeek (Cascade) | |
| type | AllocationReviewEventType | |
| actorUserId | String? | |
| note | String? | motivo da reabertura, opcional |
| createdAt | | |

Índice: `[weekId, createdAt]`.

## AllocationReviewRow

Situação de conferência de um colaborador numa semana.

| Campo | Tipo | Regra |
|---|---|---|
| id | cuid | |
| weekId | FK → AllocationReviewWeek (Cascade) | |
| collaboratorId | FK → Collaborator (Cascade) | |
| confirmedAt / confirmedByUserId | DateTime? / String? | null = linha não conferida |
| createdAt / updatedAt | | |

Unique `[weekId, collaboratorId]`. Conferir exige que nenhum dia elegível da linha esteja
pendente depois de aplicar os rascunhos.

## AllocationReviewDay

Situação gravada para um colaborador num dia. Pode ser rascunho (linha não conferida) ou dia
conferido (linha conferida).

| Campo | Tipo | Regra |
|---|---|---|
| id | cuid | |
| rowId | FK → AllocationReviewRow (Cascade) | |
| collaboratorId | FK → Collaborator (Cascade) | redundante, para consulta por data |
| workDate | Date | dentro da semana da linha; não pode ser futuro |
| kind | AllocationReviewKind | |
| note | String? | até 500 caracteres |
| differsFromSuggestion | Boolean | calculado no servidor ao gravar |
| suggestionSnapshot | Json | `{ kind, projectIds }` sugerido no momento da gravação |
| sourceFingerprint | String? | hash das fontes, gravado ao conferir (research R5) |
| updatedByUserId | String? | |
| createdAt / updatedAt | | |

Unique `[collaboratorId, workDate]`. Índices `[workDate]` e `[rowId]`.

**Validação por kind**:

- `PROJECT`: um ou mais projetos.
- `TRAVEL`: exatamente um projeto, o de destino.
- Demais kinds: nenhum projeto.

Os projetos precisam existir e não estar excluídos. Um projeto inativo só é aceito se já for
fonte do dia (spec, casos especiais).

## AllocationReviewDayProject

| Campo | Tipo | Regra |
|---|---|---|
| dayId | FK → AllocationReviewDay (Cascade) | |
| projectId | FK → Project (Restrict) | |

Chave primária `[dayId, projectId]`. O peso entre vários projetos não é gravado: é calculado
na leitura com a mesma regra do ajuste manual (`labor-cost.js:1033-1042`).

## AllocationReviewAbsenceAlert

| Campo | Tipo | Regra |
|---|---|---|
| id | cuid | |
| collaboratorId | FK → Collaborator (Cascade) | |
| absenceType | CollaboratorAbsenceType | só FOLGA, FERIAS ou AFASTAMENTO |
| startDate / endDate | Date | período de dias consecutivos do mesmo tipo |
| status | AllocationReviewAlertStatus | default OPEN |
| sourceWeekId | FK → AllocationReviewWeek (Cascade) | |
| notificationEventId | String? | evento na central de notificações |
| resolvedAt / resolvedByAbsenceId | DateTime? / String? | |
| createdAt / updatedAt | | |

Índices `[status, collaboratorId]` e `[sourceWeekId]`.

**Transições**:

- **OPEN → RESOLVED**: uma ausência do mesmo tipo cobre o período inteiro.
- **OPEN → CANCELLED**: a linha é desconferida, ou algum dia do período deixa de ter aquele kind.

## Tipos de leitura (não persistidos)

**DaySuggestion** (por colaborador e dia):

```text
{ date, eligible, suggestion: { kind | 'NONE', projectIds[] },
  sources: {
    ponto:   { state: confirms|diverges|none, normalHours, he70Hours, he100Hours, tags[] },
    rdo:     { state, reports: [{ reportId, number, projectId, status }] },
    efetivo: { state, projectIds[] },
    absence: { type, absenceId } | null },
  pending: boolean, pendingReason: DIVERGENCE | NO_INFORMATION | null,
  reasons: string[], isHoliday, isWeekend }
```

**ReviewDayView** = DaySuggestion + gravado
`{ kind, projectIds, note, differsFromSuggestion, sourceChangedAfterReview, absenceAlert }`.

## Relação com dados existentes

- **Custo HH** (`labor-cost.js`): lê os dias de linhas conferidas com precedência máxima
  (research R1).
- **Relatório mensal** (`allocation-monthly-report.js`): lê os dias de linhas conferidas do mês
  (research R6).
- **Envio mensal**: lê `AllocationReviewWeek.status` das semanas que tocam o mês (research R7).
- **Ausências**: criar ou editar ausência resolve os avisos abertos (research R8).
- **Não são alterados**: `Report`, `PontoPeriodSummary`, `EfetivoMissionAllocation` e
  `PontoDayProjectOverride`.
