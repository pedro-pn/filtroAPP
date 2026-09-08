# Data Model: Integração VR Ponto Mais

## Overview

A API passa a ser mais um produtor do modelo canônico de ponto. `PontoSyncRun` registra cada tentativa; um sucesso aponta para um `PontoImport` completo. Vínculos externos e aliases de etiqueta tornam correções persistentes. Os cálculos continuam lendo `PontoPeriodSummary`.

```text
PontoSyncState ──cursor/audit──> PontoSyncRun ──N..0..1── PontoImport ──1..N── PontoPeriodSummary ──0..1── Collaborator
      │                                      │
      └── requestedByUserId                  └── monthly.days[].tags

PontoExternalEmployeeLink ──N..1── Collaborator
PontoProjectTagAlias       ──N..1── Project
PontoExternalEmployee     ──preference──> synchronized PontoPeriodSummary (by externalEmployeeId)
PontoDayProjectOverride    ──N..1── Collaborator / Project
AcompanhamentoMissionGroup ──labor policy──> member Projects / optional primary Project
```

## PontoSyncRun (new)

Audit of one requested synchronization, including failures that must never enter the financial calculation.

| Field | Type | Rules |
|-------|------|-------|
| `id` | String | CUID primary key |
| `periodStart` | Date | Inclusive, required |
| `periodEnd` | Date | Inclusive, same or after start, maximum 31 days |
| `status` | String | `RUNNING`, `SUCCEEDED`, or `FAILED` |
| `requestedByUserId` | String? | Authenticated manager |
| `trigger` | String | `MANUAL`, `AUTOMATIC_BOOTSTRAP` or `AUTOMATIC_DAILY` |
| `importId` | String? | Optional relation to published `PontoImport`; duplicate no-op runs may reuse it |
| `employeesRead` | Int | Non-negative |
| `workDaysRead` | Int | Non-negative |
| `timeCardsRead` | Int | Non-negative |
| `collaboratorsMatched` | Int | Non-negative |
| `pendingCount` | Int | Non-negative |
| `summary` | Json? | Sanitized pendencies/counts; no token or unnecessary CPF |
| `errorCode` | String? | Stable internal category |
| `errorMessage` | String? | Sanitized pt-BR text |
| `startedAt` | DateTime | Creation timestamp |
| `completedAt` | DateTime? | Required in terminal state |

### State transitions

```text
RUNNING ──validated snapshot committed──> SUCCEEDED
RUNNING ──collection/validation failure──> FAILED
```

Terminal rows are immutable in application code. A failed row never acquires an import.

## PontoSyncState (new)

Singleton persistent state for automatic history and daily synchronization.

| Field | Type | Rules |
|-------|------|-------|
| `id` | String | Fixed key `pontomais`; primary key |
| `bootstrapStatus` | String | `PENDING`, `RUNNING`, `SUCCEEDED`, or `FAILED` |
| `historyStart` | Date? | Earliest valid admission discovered from active/inactive employees |
| `historyThrough` | Date? | Last contiguous historical day published |
| `nextPeriodStart` | Date? | First day not yet published during bootstrap |
| `dataRevision` | Int | Canonical snapshot revision fully published; migrated existing rows start at `1` |
| `targetDataRevision` | Int? | Revision being replayed; remains set across failures until full completion |
| `lastDailySyncDate` | Date? | Reference end date of the last daily window |
| `lastAttemptAt` | DateTime? | Last automatic attempt |
| `lastSuccessfulAt` | DateTime? | Last successful automatic batch/window |
| `lastErrorCode` | String? | Sanitized stable category |
| `lastErrorMessage` | String? | Sanitized pt-BR message |
| `createdAt` / `updatedAt` | DateTime | Audit timestamps |

### Bootstrap transitions

```text
PENDING ──history start discovered──> RUNNING
RUNNING ──batch succeeds──> RUNNING (advance cursor)
RUNNING ──historyThrough reaches current business date──> SUCCEEDED
RUNNING ──batch/discovery fails──> FAILED ──next cycle retries──> RUNNING
SUCCEEDED + older dataRevision ──revision upgrade──> RUNNING from historyStart
RUNNING + target revision ──all history replayed──> SUCCEEDED + promote dataRevision
```

`historyThrough` and `nextPeriodStart` change in the same state update only after a successful immutable sync run. A failure preserves both values. While successful batches remain, the same bootstrap execution immediately starts the next window until the current business date is covered.

`targetDataRevision` is written before the repair cursor is reset. Therefore, a failed replay resumes at `nextPeriodStart` instead of restarting from `historyStart`; only its final successful batch copies the target into `dataRevision` and clears the target.

## PontoImport (existing, extended)

| New/changed field | Type | Rules |
|-------------------|------|-------|
| `source` | String | `XLSX` default for legacy rows; `PONTOMAIS_API` for API snapshots |
| `fileName` | String | Legacy name or `VR Ponto Mais — YYYY-MM-DD a YYYY-MM-DD` |
| `contentHash` | String | SHA-256 of normalized snapshot; excludes token/raw response |
| `syncRuns` | PontoSyncRun[] | Reverse audit relation; identical successful runs may reuse this snapshot |

An identical normalized hash reuses the successful import and marks the new run successful without duplicate periods.

## PontoPeriodSummary (existing, extended)

| New/changed field | Type | Rules |
|-------------------|------|-------|
| `sourceKey` | String? | Stable source key; API uses `pontomais:<externalEmployeeId>` |
| `externalEmployeeId` | String? | Stable Ponto Mais employee ID; restricted from ordinary viewers |
| `registrationNumber` | String? | Normalized registration for audit/reconciliation |
| uniqueness | Constraint | Unique `(importId, sourceKey)`; legacy name uniqueness removed after importer-side consolidation |
| `monthly` | Json | Backward-compatible daily payload |

### `monthly` JSON version 2

```json
{
  "schemaVersion": 2,
  "months": {
    "2026-08": {
      "normalMinutes": 10560,
      "genericOvertimeMinutes": 30,
      "he70Minutes": 120,
      "he100Minutes": 60,
      "nightMinutes": 0,
      "workedDates": ["2026-08-03"],
      "days": [
        {
          "date": "2026-08-03",
          "workedMinutes": 528,
          "genericOvertimeMinutes": 30,
          "he70Minutes": 30,
          "he100Minutes": 0,
          "nightMinutes": 0,
          "tags": ["Missão 5745"]
        }
      ]
    }
  }
}
```

The reader accepts this wrapper and the current shape keyed directly by month. Legacy days with `extrasMinutes` and API days with `genericOvertimeMinutes` retain cap-based split; explicit `he70Minutes`/`he100Minutes` are preserved without reclassification.

## PontoDayProjectOverride (new)

Manual resolution of one collaborator/day whose Ponto Mais tag conflicts with RDO evidence.

| Field | Type | Rules |
|-------|------|-------|
| `id` | String | CUID primary key |
| `collaboratorId` | String | Required internal collaborator |
| `workDate` | Date | Business day, unique with collaborator |
| `projectId` | String | One project selected from the pending candidates; multiple rows may exist for the same collaborator/day |
| `externalEmployeeId` | String? | External identity observed when the choice was made, for audit |
| `createdByUserId` | String? | Manager who selected the project |
| `createdAt` / `updatedAt` | DateTime | Audit timestamps |

The unique key is `(collaboratorId, workDate, projectId)`, allowing one or more confirmed projects for the same day. Multiple selections use normalized weights on the accounting axis and full weight 1 on the analytical axis. The override has precedence only for its collaborator/day and does not rewrite immutable synchronization summaries.

## AcompanhamentoMissionGroup (existing, extended)

An active visual grouping now also declares how labor evidence is projected into its member projects.

| New/changed field | Type | Rules |
|-------------------|------|-------|
| `laborAllocationMode` | Enum | `VISUAL_ONLY` (default), `SHARED_EXECUTION`, or `CONSOLIDATE_PRIMARY` |
| `primaryLaborProjectId` | String? | Required only for `CONSOLIDATE_PRIMARY`; must reference an active member of the same group |
| `primaryLaborProject` | Project? | Restrict deletion while selected as the group's primary labor destination |

`VISUAL_ONLY` keeps the legacy normalized allocation. `SHARED_EXECUTION` authorizes a non-conserved analytical projection, but the persisted point snapshot and accounting allocation remain unique. `CONSOLIDATE_PRIMARY` redirects member evidence once to the primary project and is intended for explicit data-quality exceptions such as parallel RDOs historically entered under the wrong mission.

### Calculated projections (not persisted)

`computeCollaboratorRates` publishes two maps:

- `byProject`: accounting allocation used by the Costs tab. Project weights total at most 1 per employee/day and monetary totals reconcile to the monthly payroll.
- `analyticalByProject`: project-consumption allocation used by cards/details. Shared group members each receive the full Ponto Mais journey and independent analytical cost; its sum is intentionally not reconciled against payroll.

Both projections retain the Ponto Mais normal/overtime source. RDO hours confirm participation but never replace point hours. A normalized `EM VIAGEM` tag sets the day travel context after the destination projects are known and never creates a project relation.

### MobilizationTravelEvidence (derived, not persisted)

For each collaborator/project, a later `Report` of type `RDO` can confirm the project on its configured `Project.mobilizationDate`. The derived index is keyed by collaborator and mobilization date and contains only project IDs; it never carries the later report's worked minutes into the travel day. `buildDailyProjectWeights` consults this index only for a Ponto Mais day containing a travel tag and only after every same-day/manual rule has failed. Multiple candidates follow the existing mission-group labor policy or produce an auditable manual pendency.

## PontoExternalEmployeeLink (new)

| Field | Type | Rules |
|-------|------|-------|
| `id` | String | CUID primary key |
| `externalEmployeeId` | String | Unique, required |
| `registrationNumber` | String? | Last observed normalized registration |
| `externalName` | String | Last observed name |
| `collaboratorId` | String | Required relation; restrict deletion |
| `matchSource` | String | `MANUAL`; automatic matches need no row |
| `createdByUserId` | String? | Manager who linked |
| `createdAt` / `updatedAt` | DateTime | Audit timestamps |

Manual links take priority over automatic matching. Relinking updates API summaries for that external ID without changing legacy name aliases.

## PontoExternalEmployee (new)

Directory of every active or inactive employee discovered through the Ponto Mais API. The row is operational metadata, not a replacement for the immutable synchronized summaries.

| Field | Type | Rules |
|-------|------|-------|
| `externalEmployeeId` | String | Stable external ID and primary key |
| `registrationNumber` | String? | Last observed normalized registration |
| `externalName` | String | Last observed display name; manager-only API |
| `isActive` | Boolean? | Last observed external state, nullable when omitted upstream |
| `ignoredAt` | DateTime? | Non-null means excluded from publication, pendencies and current cost reads |
| `ignoredByUserId` | String? | Manager who last enabled the exclusion; cleared when restored |
| `firstSeenAt` | DateTime | First discovery or migration backfill time |
| `lastSeenAt` | DateTime | Last employee-list refresh containing this ID |
| `createdAt` / `updatedAt` | DateTime | Audit timestamps |

Ignoring never deletes `PontoPeriodSummary`. New normalizations discard that external ID, and the cost reader filters prior API summaries before the latest-day merge. Restoring the employee makes existing snapshots eligible again immediately.

## PontoProjectTagAlias (new)

| Field | Type | Rules |
|-------|------|-------|
| `id` | String | CUID primary key |
| `normalizedTag` | String | Unique, accent-insensitive and whitespace-collapsed |
| `rawTag` | String | Last observed value |
| `projectId` | String | Required relation; restrict deletion |
| `createdByUserId` | String? | Manager who linked |
| `createdAt` / `updatedAt` | DateTime | Audit timestamps |

Alias explicit takes priority; otherwise only the canonical mission-code parser resolves a tag.

## Derived structures

### DailyProjectWeight

| Field | Type | Rules |
|-------|------|-------|
| `date` | YYYY-MM-DD | Collaborator day |
| `projectId` | String | Confirmed internal project |
| `weight` | Number | `0 < weight <= 1`; daily sum is 0 or 1 |
| `evidence` | String | `SINGLE_TAG`, `TAG_RDO`, `SINGLE_RDO_FALLBACK`, `SINGLE_RDO_OVERRIDES_TAG`, `MOBILIZATION_FUTURE_RDO`, or `MANUAL_OVERRIDE` |
| `rdoMinutes` | Number? | Full RDO journey used only as ambiguous-day weight |

### MonthlyCostAllocation

Monetary output is reconciled as integer cents:

```text
sum(project.costCents) + sede.costCents + folga.costCents = totalMensalCents
```

Validation rejects negative buckets or project-hour sums above point hours beyond calculation tolerance.

## Migration and compatibility

1. Add tables and optional/defaulted columns through versioned Prisma migrations.
2. Existing imports receive `source = XLSX` by default.
3. Existing summaries keep `sourceKey = null` and legacy JSON; no backfill is required.
4. XLSX producer consolidates duplicate normalized names before insert and may set `xlsx:<normalizedName>`.
5. Readers accept both JSON formats.
6. Historical cost is unchanged until read again, when backward-compatible logic reproduces legacy behavior.
7. The automation migration adds `PontoSyncState` and defaults pre-existing `PontoSyncRun.trigger` rows to `MANUAL`; no bootstrap row is pre-created, so the first configured job discovers history atomically.
8. The employee-preference migration creates `PontoExternalEmployee` and backfills one latest name/registration record per non-null external ID already present in `PontoPeriodSummary`; all rows start considered.
