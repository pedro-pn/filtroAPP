# Internal API Contract: VR Ponto Mais synchronization

Base path: `/api/acompanhamento/ponto`

All routes require the existing session. Mutations require `acompanhamento:manager` or administrator access. Dates are inclusive ISO calendar dates (`YYYY-MM-DD`) in the application's business timezone.

## POST `/sync`

Contingency-only manager endpoint. Starts and waits for one synchronization limited to 31 inclusive days. The application does not depend on this endpoint for normal daily operation.

### Request

```json
{
  "startDate": "2026-08-01",
  "endDate": "2026-08-14"
}
```

Zod validates strict calendar dates, `endDate >= startDate` and the 31-day limit.

### Success `201`

```json
{
  "runId": "cuid",
  "status": "SUCCEEDED",
  "trigger": "MANUAL",
  "skippedDuplicate": false,
  "importId": "cuid",
  "periodStart": "2026-08-01",
  "periodEnd": "2026-08-14",
  "employeesRead": 59,
  "workDaysRead": 664,
  "timeCardsRead": 1221,
  "collaboratorsTotal": 53,
  "collaboratorsMatched": 52,
  "pendingCount": 2
}
```

An identical complete snapshot may return `200` with `skippedDuplicate: true` and the existing `importId`.

### Errors

| Status | `code` | Meaning |
|--------|--------|---------|
| 400 | `INVALID_PERIOD` | Invalid date/order or more than 31 days |
| 409 | `SYNC_IN_PROGRESS` | Another synchronization is running |
| 424 | `PONTOMAIS_NOT_CONFIGURED` | Server has no token |
| 502 | `PONTOMAIS_AUTH` | External service rejected token |
| 502 | `PONTOMAIS_INVALID_RESPONSE` | Required response is incomplete/invalid |
| 503 | `PONTOMAIS_UNAVAILABLE` | Timeout, exhausted rate limit or transient failure |

```json
{
  "error": "Não foi possível consultar o Ponto Mais. Os dados anteriores foram preservados.",
  "code": "PONTOMAIS_UNAVAILABLE",
  "runId": "cuid"
}
```

Errors never include upstream bodies, headers, token, CPF or stack trace.

## GET `/integration-status`

Requires Acompanhamento read access.

```json
{
  "configured": true,
  "running": false,
  "automation": {
    "bootstrapStatus": "SUCCEEDED",
    "historyStart": "2021-02-01",
    "historyThrough": "2026-08-16",
    "nextPeriodStart": null,
    "lastDailySyncDate": "2026-08-16",
    "lastAttemptAt": "2026-08-17T06:00:00.000Z",
    "lastSuccessfulAt": "2026-08-17T06:00:20.000Z",
    "lastErrorCode": null,
    "lastErrorMessage": null,
    "scheduledTime": "03:00",
    "timeZone": "America/Sao_Paulo"
  },
  "lastSuccessfulRun": {
    "id": "cuid",
    "periodStart": "2026-08-01",
    "periodEnd": "2026-08-14",
    "completedAt": "2026-08-14T14:20:00.000Z",
    "pendingCount": 2
  },
  "lastFailure": null
}
```

Token and external-account details are never returned.

## GET `/sync-runs?limit=50`

Manager-only audit list. `limit` is 1 through 200.

```json
[
  {
    "id": "cuid",
    "status": "SUCCEEDED",
    "trigger": "AUTOMATIC_DAILY",
    "periodStart": "2026-08-01",
    "periodEnd": "2026-08-14",
    "employeesRead": 59,
    "workDaysRead": 664,
    "timeCardsRead": 1221,
    "collaboratorsMatched": 52,
    "pendingCount": 2,
    "errorCode": null,
    "errorMessage": null,
    "startedAt": "2026-08-14T14:19:40.000Z",
    "completedAt": "2026-08-14T14:20:00.000Z"
  }
]
```

## GET `/pending`

Manager-only reconciliation list derived from successful summaries.

```json
{
  "employees": [
    {
      "externalEmployeeId": "external-id",
      "registrationNumber": null,
      "externalName": "Nome para conferência",
      "reason": "NO_UNIQUE_MATCH"
    }
  ],
  "projectTags": [
    {
      "rawTag": "Texto não reconhecido",
      "normalizedTag": "texto nao reconhecido",
      "reason": "PROJECT_NOT_FOUND"
    }
  ],
  "ambiguousDays": [
    {
      "externalEmployeeId": "external-id",
      "externalName": "Nome para conferência",
      "date": "2026-08-05",
      "projectCodes": ["5745", "5752", "5761"],
      "tagProjectCodes": ["5745"],
      "rdoProjectCodes": ["5752", "5761"],
      "reason": "TAG_RDO_CONFLICT"
    }
  ]
}
```

Ordinary viewers do not receive this endpoint; CPF is never returned.

Stored ambiguous items are revalidated against current collaborator links, projects, active mission groups and RDO reports before this response is built. A sole divergent RDO resolves automatically and is omitted. If normal rules fail, tags from one active mission group resolve only when exactly one RDO project belongs to that group. Divergence against two or more eligible RDOs, including days with no recognized tag, remains selectable. The original sync-run summary remains unchanged for audit. Ignored external employees are omitted from every pending category.

If two or more RDO candidates belong exclusively to one `SHARED_EXECUTION` group, the day is automatically resolved and omitted: every candidate receives the full analytical point journey while the accounting axis remains normalized. For `CONSOLIDATE_PRIMARY`, member evidence resolves once to the configured primary project. `VISUAL_ONLY` groups retain the previous ambiguity behavior.

Travel-only days are also revalidated against project mobilization. If the point date equals a project's `mobilizationDate` and the same collaborator appears in a later RDO, that project is a destination candidate. A unique candidate is omitted from pendencies; compatible shared/consolidated candidates follow their group policy; incompatible multiple candidates are returned in `projectCodes` with reason `MOBILIZATION_RDO_AMBIGUOUS`, `travelContext: true` and empty same-day `rdoProjectCodes`. No later RDO hours are moved into the travel day.

## POST `/day-project-overrides`

Manager-only manual resolution of an ambiguous collaborator/day. The selected project must belong to the candidate set exposed by `GET /pending`.

```json
{
  "externalEmployeeId": "external-id",
  "date": "2026-08-05",
  "projectIds": ["project-cuid-a", "project-cuid-b"]
}
```

Success `200`:

```json
{
  "externalEmployeeId": "external-id",
  "date": "2026-08-05",
  "projectIds": ["project-cuid-a", "project-cuid-b"]
}
```

The choice is audit-attributed to the authenticated manager, removes the item from current pendencies and is applied before tag/RDO rules in the labor-cost calculation. One selected project preserves the legacy behavior; multiple projects conserve the accounting axis and repeat the full analytical point journey in each selected card. `projectId` remains accepted for backward compatibility. Invalid dates, missing pendencies and projects outside the candidate set are rejected without changing allocation.

## POST `/day-project-overrides/batch`

Manager-only shortcut that applies one or more project selections to up to 200 pending collaborator/days. The UI offers this for pendencies with the same candidate set.

```json
{
  "items": [
    { "externalEmployeeId": "external-a", "date": "2026-08-05", "projectIds": ["project-a", "project-b"] },
    { "externalEmployeeId": "external-b", "date": "2026-08-05", "projectIds": ["project-a", "project-b"] }
  ]
}
```

Each item receives the same validation and audit attribution as the single endpoint. The response reports `updated` and the applied items.

## GET `/external-employees`

Manager-only directory of all active and inactive employees discovered through the external employee endpoint.

```json
[
  {
    "externalEmployeeId": "external-id",
    "registrationNumber": "42",
    "externalName": "Nome para conferência",
    "isActive": true,
    "ignored": false
  }
]
```

The response contains no CPF, token, raw external payload or internal collaborator assignment.

## POST `/external-employees/ignore`

Manager-only reversible scope preference.

```json
{
  "externalEmployeeId": "external-id",
  "ignored": true
}
```

Success `200` returns the same safe directory projection with the new `ignored` value. `404 EXTERNAL_EMPLOYEE_NOT_FOUND` is returned for an ID not yet discovered. Ignored employees remain visible in this directory so the manager can restore them, but they are omitted from new snapshot periods, reconciliation pendencies and current labor-cost reads. Existing audit rows and periods are not deleted.

## POST `/external-employees/link`

Manager-only stable collaborator link.

```json
{
  "externalEmployeeId": "external-id",
  "collaboratorId": "internal-cuid"
}
```

Success `200`:

```json
{
  "externalEmployeeId": "external-id",
  "collaboratorId": "internal-cuid",
  "relinked": 3
}
```

## POST `/project-tags/link`

Manager-only project-tag alias.

```json
{
  "rawTag": "Equipe especial Ilha",
  "projectId": "project-cuid"
}
```

Success `200`:

```json
{
  "normalizedTag": "equipe especial ilha",
  "projectId": "project-cuid"
}
```

Changing either link invalidates Acompanhamento queries so existing snapshots are recalculated.

## PATCH `/api/acompanhamento/comercial/grupos-missoes/:groupId`

Existing manager-only group mutation, extended to update its display name and/or labor policy.

```json
{
  "laborAllocationMode": "SHARED_EXECUTION",
  "primaryLaborProjectId": null
}
```

For consolidation:

```json
{
  "laborAllocationMode": "CONSOLIDATE_PRIMARY",
  "primaryLaborProjectId": "member-project-cuid"
}
```

The payload is strict Zod input. `CONSOLIDATE_PRIMARY` requires a primary project belonging to the active group; other modes clear `primaryLaborProjectId`. The response adds:

```json
{
  "laborAllocationMode": "SHARED_EXECUTION",
  "primaryLaborProjectId": null
}
```

Changing the policy invalidates project cards, group details, Ponto pendencies and collaborator cost projections. It never changes the synchronized Ponto Mais snapshot or duplicates the accounting total in the Costs tab.

## GET `/reconciliation-projects`

Manager-only safe catalog for project-tag reconciliation. It uses the Acompanhamento permission boundary and includes inactive or historically deleted projects without exposing client or contract details.

```json
[
  {
    "id": "project-cuid",
    "code": "5745",
    "name": "Projeto Ilha",
    "isActive": false,
    "historical": true
  }
]
```

## Existing routes

- `GET /imports` remains and adds `source`; API snapshots appear alongside historical XLSX.
- `GET /colaboradores` remains backward-compatible and may add pendency counts.
- `POST /import` and `POST /vincular` remain backward-compatible for historical/operator recovery, but are not exposed as the normal UI flow. Existing XLSX rows remain readable.
- Deletion of API snapshots is not exposed; deletion of legacy imports keeps confirmation and permissions.

## External contract used by the backend

Base URL: `https://api.pontomais.com.br/external_api/v1`, header `access-token` only on the server.

- `GET /employees`: active and inactive lists queried separately; external ID, registration, CPF, name, `admission_date` and `initial_date`.
- `POST /reports/work_days`: daily normal total, explicit extras by `percent`, generic extras with no percentage, night time and identity.
- `POST /reports/time_cards`: punches with registration, date, time and `tag_manager`.

All pages are collected before normalization. Required shapes are validated, `per_page` is capped at 500, calls time out, and only `429`/`5xx`/network timeout are retried up to three times.

The scheduler invokes the same internal sync service in consecutive inclusive windows of at most 31 days. The initial bootstrap keeps processing windows in the same job until its final `end_date` is today. After bootstrap, the automatic daily window is `[yesterday - 30 days, yesterday]`; the daily flow never sends the current day.
