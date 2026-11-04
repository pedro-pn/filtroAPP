# Contrato: API da Conferência de alocação

- **Base**: `/efetivo/conferencia-alocacao`. É um router novo,
  `backend/src/routes/resources/allocation-review.js`, montado em `routes/index.js` **antes** de
  `/efetivo`.
- **Autenticação**: `requireAuth` + `requireAllocationReviewer` (ADMIN ou
  `efetivo:allocation-review`), salvo quando indicado.
- **Validação**: toda entrada é validada com Zod (Princípio III). As datas usam `YYYY-MM-DD`.
- **Concorrência**: toda escrita exige o header `If-Match-Version: <week.version>`. Se a versão
  estiver desatualizada, a resposta é `409 { code: 'WEEK_VERSION_CONFLICT', currentVersion }`.
- **Erros**: `{ error: string (pt-BR), code: string }`.

## GET `/semanas/:weekStart`

Retorna a semana completa para a grade. `weekStart` precisa ser uma segunda-feira; caso
contrário, `400 INVALID_WEEK_START`.

```text
200 {
  week: { weekStart, weekEnd, status: OPEN|CLOSED, version, closedAt, closedBy: {id,name}|null,
          canClose: boolean, closeBlockers: string[], canReopen: boolean },
  days: [{ date, weekday, isWeekend, isHoliday, holidayName|null, isFuture }],
  summary: { agreeDays, divergenceDays, noInformationDays, editedDays,
             confirmedRows, totalRows, readyRows },
  rows: [{
    collaborator: { id, name, jobRole },
    mainProjectId|null,
    confirmed: boolean, confirmedAt|null, confirmedBy|null,
    pendingCount: number,
    days: [ReviewDayView]          // 7 itens, ver data-model.md
  }],
  projects: [{ id, code, name, clientName, clientCnpj|null, isActive }]
}
```

`projects` traz os projetos citados pelas fontes da semana e os ativos, para o "outro projeto".

## PUT `/semanas/:weekStart/dias`

Grava um ou mais dias como rascunho. É usado pelo painel do dia, pelo "repetir nos dias
seguintes" e pela edição em massa.

```text
body {
  items: [{ collaboratorId, date, kind: PROJECT|TRAVEL|SEDE|FOLGA|FERIAS|AFASTAMENTO|TREINAMENTO,
            projectIds: string[], note?: string }]   // 1..200
}
200 { version, rows: [RowView] }   // só as linhas afetadas
```

As requisições abaixo são recusadas:

| Situação | Resposta |
|---|---|
| Semana fechada | `409 WEEK_CLOSED` |
| Linha conferida | `409 ROW_CONFIRMED` (é preciso desfazer antes) |
| Data futura ou fora da semana | `400 INVALID_DAY` |
| Dia fora do vínculo do colaborador | `400 COLLABORATOR_NOT_ACTIVE` |
| Combinação inválida de `kind` e projetos | `400 INVALID_KIND_PROJECTS` |
| Projeto inexistente ou excluído | `404 PROJECT_NOT_FOUND` |
| Projeto inativo que não é fonte do dia | `400 PROJECT_INACTIVE` |

## DELETE `/semanas/:weekStart/dias`

Descarta rascunhos e volta os dias para a sugestão.

```text
body { items: [{ collaboratorId, date }] }
200 { version, rows: [RowView] }
```

Regras de bloqueio iguais às do PUT.

## POST `/semanas/:weekStart/linhas/conferir`

Confere uma ou mais linhas. Os dias não editados são gravados com a sugestão atual. Também cria
os avisos de ausência (research R8).

```text
body { collaboratorIds: string[] }  |  { allReady: true }   // allReady = todas as linhas sem pendência
200 { version, confirmed: number, alertsCreated: number, rows: [RowView] }
409 ROW_HAS_PENDING { collaboratorIds }   // quando alguma linha pedida tem pendência
```

## POST `/semanas/:weekStart/linhas/desconferir`

```text
body { collaboratorIds: string[] }
200 { version, alertsCancelled: number, rows: [RowView] }
```

Com a semana fechada, a resposta é `409 WEEK_CLOSED`.

## POST `/semanas/:weekStart/fechar`

```text
200 { version, week }
409 WEEK_NOT_ENDED | ROWS_NOT_CONFIRMED { pendingCollaboratorIds }
```

## POST `/semanas/:weekStart/reabrir`

Exige ADMIN. Para quem não é, a resposta é `403 ADMIN_REQUIRED`.

```text
body { note?: string }
200 { version, week }
```

## GET `/pendencias/contagem`

Alimenta o badge da navegação do Efetivo.

```text
200 { openWeeks: [{ weekStart, pendingRows }], absenceAlertsOpen: number }
```

---

## Mudanças em contratos existentes

### GET `/statistics/allocation-report` e `/pdf`

Cada `AllocationReportDay` e `AllocationReportEntry` passa a ter:

```text
kind: PROJECT|TRAVEL|SEDE|FOLGA|FERIAS|AFASTAMENTO|TREINAMENTO   // RDO = PROJECT
source: 'RDO' | 'REVIEW'
projectId: string | null
projectCode: string          // '' quando não há projeto
reportId: string | null
sequenceNumber: number | null
```

`summary.projectCount` conta só os projetos não nulos. Um campo novo, `summary.reviewedDayCount`,
conta os dias conferidos.

### POST `/statistics/allocation-report/send` e job automático

O envio manual não muda. No job automático, `processMonthlyAllocationReport()` pode devolver
duas razões novas:

```text
{ skipped: true, reason: 'outside_send_window' }
{ skipped: true, reason: 'awaiting_review', yearMonth, deadline: 'YYYY-MM-DD', openWeeks: string[] }
```

A razão `not_first_day` deixa de existir.

### Central de notificações

Novo kind `ALLOCATION_REVIEW_ABSENCE_MISSING`:

- **Escopo**: gestores do Efetivo e ADMIN.
- **Texto**: "Cadastrar <férias|folga|afastamento> de <nome> de <dd/mm> a <dd/mm>".
- **Destino**: `/efetivo?section=colaboradores&colaborador=<id>&cadastrarAusencia=1&tipo=<FERIAS|FOLGA|AFASTAMENTO>&de=<data>&ate=<data>`.

### Ausências (`POST/PATCH /workforce/absences`)

O contrato não muda. Como efeito colateral, a gravação resolve os avisos abertos cobertos pela
ausência.
