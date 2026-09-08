# Tasks: Integração VR Ponto Mais

**Input**: Design documents from `/specs/010-integracao-pontomais/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required by the constitution because this feature changes backend business rules and financial allocation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it targets a different file and has no unmet dependency.
- **[Story]**: Maps the task to a user story in `spec.md`.
- Tests in each story are written first and must fail before the implementation they specify.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Register the integration configuration and create its isolated code/test locations.

- [X] T001 Add optional `PONTOMAIS_API_TOKEN` parsing and the non-secret `pontomaisApiToken` property in `backend/src/config/env.js`, preserving the empty-token disabled state documented in `backend/.env.example`
- [X] T002 [P] Create the Ponto Mais integration module exports/placeholders in `backend/src/lib/pontomais/client.js`, `backend/src/lib/pontomais/normalize.js`, and `backend/src/lib/pontomais/sync.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the persistent audit/link model and backward-compatible point representation used by every story.

**⚠️ CRITICAL**: No user story work starts until the schema and compatibility layer are ready.

- [X] T003 Extend `PontoImport`/`PontoPeriodSummary` and add `PontoSyncRun`, `PontoExternalEmployeeLink`, and `PontoProjectTagAlias` with relations/indexes in `backend/prisma/schema.prisma`
- [X] T004 Generate the versioned Prisma migration, including the `XLSX` default and safe removal/replacement of the legacy summary uniqueness constraint, in `backend/prisma/migrations/<timestamp>_add_pontomais_sync/migration.sql`
- [X] T005 [P] Add failing compatibility tests for legacy `monthly` JSON and version-2 explicit HE/tag days in `backend/test/acompanhamento-labor-cost.test.js`
- [X] T006 Update daily/monthly readers and `mergePontoPeriods` to preserve version-2 HE70, HE100, night minutes, and tags while retaining legacy behavior in `backend/src/lib/acompanhamento/labor-cost.js`
- [X] T007 Update XLSX production to consolidate duplicate normalized names, set legacy-compatible source keys, and keep existing import results unchanged in `backend/src/lib/acompanhamento/ponto-import.js`
- [X] T008 Run Prisma generation and the focused legacy point/labor-cost tests from `backend/package.json`, fixing only regressions caused by T003–T007

**Checkpoint**: Existing XLSX imports and calculations work unchanged; the database can audit API synchronization safely.

---

## Phase 3: User Story 1 - Sincronizar a jornada sem planilha (Priority: P1) 🎯

**Goal**: A manager synchronizes up to 31 days from Ponto Mais, producing one complete canonical snapshot without file upload.

**Independent Test**: Mock the three external resources, call the sync service/route twice for the same period, and verify one complete effective snapshot with normal, HE70, HE100 and night totals; then mock failure and verify the prior snapshot remains effective.

### Tests for User Story 1

- [X] T009 [P] [US1] Add failing client tests for authentication header, pagination, timeouts, bounded retry, non-retryable errors, and secret/body redaction in `backend/test/pontomais-client.test.js`
- [X] T010 [P] [US1] Add failing normalization tests for employee joins, registration/CPF/name matching, work-day minutes, explicit HE percentages, per-day tags, and deterministic content hash in `backend/test/pontomais-sync.test.js`
- [X] T011 [P] [US1] Add failing sync tests for transactional publication, duplicate snapshots, failed-run audit, overlap rejection, and preservation of the last valid import in `backend/test/pontomais-sync.test.js`
- [X] T012 [P] [US1] Add failing route contract tests for strict dates, 31-day limit, permissions, sanitized errors, and status response in `backend/test/acompanhamento-ponto-routes.test.js`

### Implementation for User Story 1

- [X] T013 [US1] Implement the authenticated, paginated Ponto Mais client for `/employees`, `/reports/work_days`, and `/reports/time_cards` with injected `fetch`, timeout, retry, and sanitized typed errors in `backend/src/lib/pontomais/client.js`
- [X] T014 [US1] Implement strict external-response parsing, time conversion, collaborator matching precedence, daily consolidation, version-2 monthly payload, and normalized hashing in `backend/src/lib/pontomais/normalize.js`
- [X] T015 [US1] Implement `PontoSyncRun` lifecycle, overlap guard, complete-page collection, atomic `PontoImport` publication, duplicate reuse, and safe failure finalization in `backend/src/lib/pontomais/sync.js`
- [X] T016 [US1] Add Zod-validated `POST /sync` and `GET /integration-status`, keep legacy routes compatible, and expose only sanitized result fields in `backend/src/routes/resources/acompanhamento-ponto.js`
- [X] T017 [P] [US1] Add typed `syncPontoMais` and `getPontoMaisIntegrationStatus` functions plus query invalidation types in `frontend/src/api/acompanhamentoPonto.ts`
- [X] T018 [US1] Replace the primary upload interaction with a react-hook-form + Zod period form and shared `Button`/`ToastContext` controls in `frontend/src/components/projects/PontoImportPanel.tsx`; use visible labels and `.field-group.field-invalid`, `aria-invalid`, `.field-error` on invalid submission
- [X] T019 [US1] Keep the XLSX upload only as an explicitly labeled fallback when integration status is not configured, and distinguish `XLSX` from `PONTOMAIS_API` history rows in `frontend/src/components/projects/PontoImportPanel.tsx`

**Checkpoint**: US1 is independently usable and idempotent; no project-tag allocation change is required to demonstrate synchronization itself.

---

## Phase 4: User Story 2 - Apropriar custo entre projetos sem duplicação (Priority: P1)

**Goal**: Use point tags and RDO evidence to allocate one collaborator/day across one or more projects while conserving point hours and monthly cost.

**Independent Test**: For an 8-hour point day with tags A/B and RDOs 8h/4h, verify 5h20/2h40 and exact monthly cents; for 8h/8h verify 50/50; for unconfirmed ambiguity verify zero invented project allocation.

### Tests for User Story 2

- [X] T020 [P] [US2] Add failing tag normalization/project-resolution tests for canonical “Missão <code>”, aliases, duplicate punch tags, unknown text, and inactive/historical projects in `backend/test/pontomais-project-allocation.test.js`
- [X] T021 [P] [US2] Add failing RDO-weight tests for one tag, 8h/4h, equal RDOs, one confirmed intersection, no tag with one RDO, and unresolved multiple RDOs in `backend/test/acompanhamento-labor-cost.test.js`
- [X] T022 [P] [US2] Add failing conservation tests asserting per-day allocated normal/HE minutes never exceed point minutes and monthly project+sede+folga equals `totalMensal`/`totalMensalBase` exactly in cents in `backend/test/acompanhamento-labor-cost.test.js`

### Implementation for User Story 2

- [X] T023 [US2] Implement accent-insensitive tag normalization, strict mission-code parsing, alias precedence, and project lookup without generic numeric extraction in `backend/src/lib/pontomais/normalize.js`
- [X] T024 [US2] Change RDO aggregation from one `dayProject` winner to all collaborator/date/project entries with deduplicated full RDO minutes and project sleep/offshore metadata in `backend/src/lib/acompanhamento/labor-cost.js`
- [X] T025 [US2] Implement the daily weight precedence and normalized allocation of point normal, HE70, and HE100 minutes in `backend/src/lib/acompanhamento/labor-cost.js`
- [X] T026 [US2] Update `computeCollaboratorCost` inputs/allocation to consume explicit per-project overtime, reject negative/over-limit buckets, and preserve the single monthly folha calculation in `backend/src/lib/acompanhamento/labor-cost.js`
- [X] T027 [US2] Add deterministic cent reconciliation for project, sede, and folga allocations, applying residual order from the plan and exposing no total above the collaborator month in `backend/src/lib/acompanhamento/labor-cost.js`
- [X] T028 [US2] Include unmatched tags and ambiguous collaborator-days in sanitized successful-sync summaries without exposing raw personal data in `backend/src/lib/pontomais/sync.js`

**Checkpoint**: US2 proves the corrected rule: RDO totals affect relative project weights only; collaborator monthly cost remains unique.

---

## Phase 5: User Story 3 - Conferir a qualidade da sincronização (Priority: P2)

**Goal**: Managers can audit runs and correct stable employee/tag links; ordinary viewers retain read-only cost access.

**Independent Test**: A successful fixture with an unknown employee/tag appears in manager pendencies, links can be corrected and recalculated, ordinary viewers receive authorization errors, and no response contains CPF/token.

### Tests for User Story 3

- [X] T029 [P] [US3] Add failing service tests for external-employee relink, project-tag alias upsert, historical summary relink, and manager-safe pending projection in `backend/test/pontomais-sync.test.js`
- [X] T030 [P] [US3] Add failing route tests for `GET /sync-runs`, `GET /pending`, `POST /external-employees/link`, and `POST /project-tags/link` permissions/contracts in `backend/test/acompanhamento-ponto-routes.test.js`

### Implementation for User Story 3

- [X] T031 [US3] Implement run/pending queries and persistent employee/tag link services with audit attribution and recalculation-safe updates in `backend/src/lib/pontomais/sync.js`
- [X] T032 [US3] Add manager-only audit, pending, employee-link, and project-tag-link endpoints with Zod validation in `backend/src/routes/resources/acompanhamento-ponto.js`
- [X] T033 [P] [US3] Add typed audit/pending/link API functions and models in `frontend/src/api/acompanhamentoPonto.ts`
- [X] T034 [US3] Add synchronization result/history and employee/tag reconciliation controls using shared `Button`, global `select` styling, visible labels, and `ToastContext` in `frontend/src/components/projects/PontoImportPanel.tsx`
- [X] T035 [US3] Replace legacy `window.confirm` in the touched panel with shared `ConfirmDialog` if legacy deletion remains visible, and ensure only XLSX rows offer deletion in `frontend/src/components/projects/PontoImportPanel.tsx`

**Checkpoint**: All stories are functional; reconciliation is auditable and permission-scoped.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Complete security, discovery, responsive behavior, documentation, and end-to-end validation.

- [X] T036 [P] Add per-user/browser Ponto Mais novelty key, seen helpers, and a global expiration exactly 10 days after the implementation date in `frontend/src/auth/moduleNavigation.ts`
- [X] T037 Create the centered Driver.js novelty card and guided steps targeting the real period/sync controls in `frontend/src/components/projects/PontoMaisSyncNovelty.tsx`, then mount it for managers from `frontend/src/components/projects/PontoImportPanel.tsx`
- [X] T038 Refactor the touched panel away from inline layout values where shared classes/tokens exist and add only scoped shrink-safe styles needed for sync/pending rows in the existing Acompanhamento stylesheet used by `frontend/src/components/projects/PontoImportPanel.tsx`
- [X] T039 Verify mobile and desktop visual contract: stacked actions, card-like `acp-table`, long tag/error wrapping, `min-width: 0`, no page-level horizontal scroll, and all form default/focus/disabled/error states in `frontend/src/components/projects/PontoImportPanel.tsx`
- [X] T040 [P] Update migration/configuration notes and manual-to-API transition wording in `backend/.env.example`, `backend/src/routes/resources/acompanhamento-ponto.js`, and relevant comments in `backend/prisma/schema.prisma`
- [X] T041 Run backend tests, frontend tests/build, Prisma validation/generation, `git diff --check`, and every scenario in `specs/010-integracao-pontomais/quickstart.md`; record any external-service limitation in `specs/010-integracao-pontomais/quickstart.md`
- [X] T042 Rebuild/update the code-review graph, run change detection, affected-flow analysis, and `tests_for` queries for the changed synchronization/rate functions before final review

---

## Dependencies & Execution Order

### Phase dependencies

```text
Setup → Foundational → US1 → US2 → US3 → Polish
```

- Setup has no dependencies.
- Foundational blocks every user story.
- US1 publishes the API snapshot consumed by US2 and supplies run data displayed by US3.
- US2 depends on version-2 tags from US1 but is independently testable with pure fixtures.
- US3 depends on audit/link entities and sync summaries but does not change the cost algorithm.
- Polish follows the selected stories.

### Within each story

- Write failing tests first.
- Implement low-level client/normalizer before sync service.
- Implement service before route and frontend integration.
- Run the independent checkpoint before starting the next story.

### Parallel opportunities

- T002 can proceed while T001 is edited.
- T009–T012 target independent test concerns/files after the foundation.
- T017 can proceed after the contract is fixed while backend implementation continues.
- T020–T022 can be authored together before the cost implementation.
- T029 and T030 can be authored together; T033 can proceed after route shapes are fixed.
- T036 and T040 are independent of the core UI implementation.

## Parallel Examples

### User Story 1

```text
T009: external client failure/pagination tests
T010: normalization and identity tests
T012: internal route contract tests
```

### User Story 2

```text
T020: tag/project resolution tests
T021: RDO weight matrix tests
T022: hour and cent conservation tests
```

### User Story 3

```text
T029: link-service tests
T030: permissions/route tests
T033: frontend contract types
```

## Implementation Strategy

### Safe MVP

The minimum production-safe scope is Setup + Foundational + US1 + US2. Shipping US1 alone is suitable only for a hidden/local integration check because exposing synchronized tags without the agreed multi-project conservation rule would leave the main financial requirement incomplete.

### Incremental delivery

1. Foundation preserves all legacy imports and calculations.
2. US1 provides a hidden/testable synchronized snapshot.
3. US2 makes that snapshot financially correct and enables the primary manager flow.
4. US3 adds audit and correction UX.
5. Polish completes novelty, responsive audit, documentation and graph-assisted review.

## Notes

- The token in `backend/.env` is never read into output, fixtures, docs or commits.
- Real API responses are not committed; automated tests use anonymized fixtures.
- No task executes deployment/server operations.
- Every task above follows checkbox + sequential ID + optional `[P]` + required story label + exact file path.

---

## Phase 7: Convergence Follow-up — Resiliência e Permissões

**Purpose**: Close implementation gaps found by reconciling the completed task list with the current code and the acceptance contracts.

- [X] T043 [P] [US1] Add failing client/sync regression tests for paginated `/reports/time_cards`, malformed report groups/required work-day fields, and preservation of the last valid snapshot when upstream content is incomplete in `backend/test/pontomais-client.test.js` and `backend/test/pontomais-sync.test.js`
- [X] T044 [US1] Implement complete page collection for `/reports/time_cards` and strict validation of required employee/work-day/time-card response shapes, converting incomplete content into sanitized `PONTOMAIS_INVALID_RESPONSE` failures before publication in `backend/src/lib/pontomais/client.js` and `backend/src/lib/pontomais/normalize.js`
- [X] T045 [P] [US1] Add a concurrent-start regression test that holds two synchronization requests at the overlap boundary and proves exactly one run is admitted in `backend/test/pontomais-sync.test.js`
- [X] T046 [US1] Make synchronization admission atomic at the database boundary while preserving stale-run recovery and the `SYNC_IN_PROGRESS` contract in `backend/src/lib/pontomais/sync.js` and, if required, `backend/prisma/schema.prisma` plus a versioned Prisma migration
- [X] T047 [P] [US3] Add HTTP-level route tests that execute authentication/authorization middleware for synchronization, audit, pending, employee-link, project-tag-link, integration-status, and the reconciliation project catalog in `backend/test/acompanhamento-ponto-routes.test.js`
- [X] T048 [US3] Expose a manager-safe project catalog under the Acompanhamento permission boundary, including inactive/historically valid projects needed for tag reconciliation, and switch the panel away from the RDO-protected generic project route in `backend/src/routes/resources/acompanhamento-ponto.js`, `frontend/src/api/acompanhamentoPonto.ts`, and `frontend/src/components/projects/PontoImportPanel.tsx`
- [X] T049 Run the focused and full backend/frontend suites, Prisma validation/generation when T046 changes persistence, build/lint checks, and the interactive configured-token smoke scenarios from `specs/010-integracao-pontomais/quickstart.md`; record the final evidence there without exposing token or tenant data

**Dependencies**: T043 precedes T044; T045 precedes T046; T047 precedes T048; T049 follows T044, T046, and T048.

---

## Phase 8: Automatic History and Daily Synchronization

**Purpose**: Remove the remaining manual trigger and spreadsheet dependency by bootstrapping all available history, resuming safely, and refreshing a rolling window every day.

### Tests and persistence

- [X] T050 [P] [US1] Add failing client tests proving `/employees` collects and deduplicates active plus inactive pages, requests `admission_date`/`initial_date`, parses the earliest `DD/MM/YYYY` admission safely, and rejects history discovery without any valid date in `backend/test/pontomais-client.test.js`
- [X] T051 [P] [US1] Add failing orchestration tests for 31-day inclusive chunking, persisted-cursor resumption, no cursor advance on failure, bootstrap completion through yesterday, 03:00 `America/Sao_Paulo` due-time, a rolling 31-day daily window, and one daily execution per reference date in `backend/test/pontomais-job.test.js`
- [X] T052 [US1] Add `PontoSyncState` plus the defaulted `PontoSyncRun.trigger` audit field in `backend/prisma/schema.prisma` and a versioned migration in `backend/prisma/migrations/<timestamp>_add_pontomais_automation/migration.sql`

### Automatic backend implementation

- [X] T053 [US1] Extend `backend/src/lib/pontomais/client.js` to list active and inactive employees without duplication and expose the earliest valid admission date needed by the bootstrap
- [X] T054 [US1] Propagate `MANUAL`, `AUTOMATIC_BOOTSTRAP`, and `AUTOMATIC_DAILY` through run admission/results/audit and add the safe automation projection to integration status in `backend/src/lib/pontomais/sync.js`
- [X] T055 [US1] Implement the resumable bootstrap and daily-window orchestrator with a bounded number of batches per cycle, atomic cursor updates, sanitized failure state, `runTrackedJob` distributed locking, periodic due checks, and boot kickoff in `backend/src/lib/pontomais/job.js`
- [X] T056 [US1] Start the Ponto Mais automation from `backend/src/server.js` only when the protected token is configured, without blocking HTTP startup and without requiring a browser request

### Automatic status experience

- [X] T057 [P] [US3] Extend status/run types and formatter tests for automation progress and trigger labels in `frontend/src/api/acompanhamentoPonto.ts` and `frontend/test/pontomais-novelty.test.mjs`
- [X] T058 [US3] Replace period selection, manual sync, and upload fallback in `frontend/src/components/projects/PontoImportPanel.tsx` with automatic bootstrap/daily status, coverage, last success/failure and reconciliation; update `frontend/src/components/projects/PontoMaisSyncNovelty.tsx` to describe the automatic flow
- [X] T059 [US3] Extend route/service contract tests for the safe automation status, trigger audit, viewer/manager permissions, and backward-compatible contingency endpoint in `backend/test/acompanhamento-ponto-routes.test.js` and `backend/test/pontomais-sync.test.js`

### Validation

- [X] T060 Run focused and full backend/frontend tests, Prisma validation/generation, frontend build/lint, `git diff --check`, read-only external contract validation for active/inactive admission fields, and the code-review graph change/flow/test analysis; record evidence in `specs/010-integracao-pontomais/quickstart.md`

**Dependencies**: T050 precedes T053; T051 and T052 precede T054–T056; T054 precedes T055; T055 precedes T056; T057 and T059 precede T058 where their contracts apply; T060 follows all implementation tasks.

---

## Phase 9: Immediate Full-History Bootstrap

**Purpose**: Remove the artificial pause between historical groups so the first automatic execution reaches the current business date before entering the daily schedule.

- [X] T061 [US1] Replace the bounded-cycle orchestration test with a failing regression proving one bootstrap execution processes every consecutive 31-day window through the current business date, while preserving cursor recovery in `backend/test/pontomais-job.test.js`
- [X] T062 [US1] Remove the per-cycle historical batch cap, complete bootstrap through today in the same job execution, and preserve yesterday as the daily reconciliation reference in `backend/src/lib/pontomais/job.js`
- [X] T063 Update the bootstrap behavior in `spec.md`, `plan.md`, `research.md`, `data-model.md`, the internal contract and `quickstart.md`; then run focused/full validation and graph impact analysis

**Dependencies**: T061 precedes T062; T063 follows T062.

---

## Phase 10: Pending Revalidation and Employee Scope

**Purpose**: Remove stale allocation pendencies, keep reconciliation panels bounded, and let managers exclude non-operational Ponto Mais employees without deleting audit history.

- [X] T064 [P] [US2] Add failing regression tests proving an ambiguous historical pending item is hidden once current RDO evidence resolves it, while unresolved days remain visible, in `backend/test/pontomais-sync.test.js`
- [X] T065 [P] [US1] Add failing normalization and labor-cost tests proving ignored external employees are omitted from new snapshots and from existing synchronized periods in `backend/test/pontomais-sync.test.js` and `backend/test/acompanhamento-labor-cost.test.js`
- [X] T066 [US1] Add the persistent Ponto Mais employee directory and ignore preference to `backend/prisma/schema.prisma` with a versioned migration under `backend/prisma/migrations/`
- [X] T067 [US1] Discover/update the employee directory during synchronization, exclude ignored employees from publication and current cost reads, revalidate ambiguous pendencies against current RDO evidence, and expose manager-only list/ignore services in `backend/src/lib/pontomais/normalize.js`, `backend/src/lib/pontomais/sync.js`, and `backend/src/lib/acompanhamento/labor-cost.js`
- [X] T068 [US3] Add failing route contract/authorization tests and implement manager-only employee-directory endpoints in `backend/test/acompanhamento-ponto-routes.test.js` and `backend/src/routes/resources/acompanhamento-ponto.js`
- [X] T069 [US3] Add a URL-persisted employee directory tab with reversible ignore actions plus bounded, keyboard-scrollable regions for pendencies and employees in `frontend/src/api/acompanhamentoPonto.ts`, `frontend/src/components/projects/PontoImportPanel.tsx`, and `frontend/src/styles/base.css`
- [X] T070 Document the verified 5761/5794 diagnosis and the then-current no-fallback decision in the feature artifacts, then run focused/full tests, Prisma validation/generation, frontend checks, `git diff --check`, and code-review graph impact/test analysis; record evidence in `specs/010-integracao-pontomais/quickstart.md`

**Dependencies**: T064 and T065 precede T067; T066 precedes T067; T068 precedes its route implementation; T069 follows the endpoint contract; T070 follows all implementation tasks.

---

## Phase 11: Generic Overtime and Manual Day Reconciliation

**Purpose**: Preserve overtime returned without a percentage and require a manager decision when a Ponto Mais project conflicts directly with RDO evidence.

- [X] T071 [P] [US1] Add failing normalization/labor-cost regressions for `extra_time.percent = null`, mixed generic/explicit overtime and monthly cap preservation in `backend/test/pontomais-sync.test.js` and `backend/test/acompanhamento-labor-cost.test.js`
- [X] T072 [P] [US2] Add failing conflict, manual-override, pending-service and HTTP authorization/validation tests in `backend/test/acompanhamento-labor-cost.test.js`, `backend/test/pontomais-sync.test.js`, and `backend/test/acompanhamento-ponto-routes.test.js`
- [X] T073 [US1] Preserve generic daily overtime through normalization, merge and monthly cost classification without changing explicit 70/100 buckets in `backend/src/lib/pontomais/normalize.js` and `backend/src/lib/acompanhamento/labor-cost.js`
- [X] T074 [US2] Add `PontoDayProjectOverride` with a versioned Prisma migration, detect tag/RDO conflicts, expose safe pending candidates, persist manager selections and apply them before automatic allocation in `backend/prisma/schema.prisma`, `backend/src/lib/pontomais/sync.js`, `backend/src/lib/acompanhamento/labor-cost.js`, and `backend/src/routes/resources/acompanhamento-ponto.js`
- [X] T075 [US3] Add the typed manual-day endpoint and project selector/action to ambiguous pending rows using the existing local scroll, shared `Button`, global `select` and toast patterns in `frontend/src/api/acompanhamentoPonto.ts` and `frontend/src/components/projects/PontoImportPanel.tsx`
- [X] T076 Run focused/full backend and frontend validation, Prisma validation/generation, `git diff --check`, refresh the code-review graph and review affected flows/tests; record the evidence in `specs/010-integracao-pontomais/quickstart.md`

**Dependencies**: T071 precedes T073; T072 precedes T074; T074 precedes T075; T076 follows all implementation tasks.

---

## Phase 12: Single-RDO Precedence over a Divergent Tag

**Purpose**: Treat one collaborator RDO as decisive when the only recognized Ponto Mais tag points elsewhere, while keeping genuinely multiple-RDO days under manual reconciliation.

- [X] T077 [P] [US2] Add failing allocation and pending-service regressions proving a sole divergent RDO receives the full point journey, while two divergent RDOs remain pending and selectable, in `backend/test/acompanhamento-labor-cost.test.js` and `backend/test/pontomais-sync.test.js`
- [X] T078 [US2] Make the sole RDO override a divergent single tag through the shared daily-weight rule, preserve manual-override precedence and multiple-RDO pendencies, and update the feature decisions in `backend/src/lib/acompanhamento/labor-cost.js` and `specs/010-integracao-pontomais/`
- [X] T079 Run focused/full backend and frontend validation, `git diff --check`, refresh the code-review graph and record evidence in `specs/010-integracao-pontomais/quickstart.md`

**Dependencies**: T077 precedes T078; T079 follows T078.

---

## Phase 13: Historical Repair, Visible Ambiguity and Mission-Group Fallback

**Purpose**: Rebuild snapshots produced before generic overtime support, keep every genuinely unresolved day selectable, and use an active mission group only when it provides one unique RDO project.

- [X] T080 [P] [US1] Add a failing automation regression proving an existing completed bootstrap with an older data revision is replayed from `historyStart`, resumes after failure, and is not replayed again after reaching the current revision in `backend/test/pontomais-job.test.js`
- [X] T081 [P] [US3] Add a failing pending regression proving a no-tag day with two current RDO projects remains visible instead of treating the candidate union as point tags in `backend/test/pontomais-sync.test.js`
- [X] T082 [P] [US2] Add failing allocation regressions proving an active mission group selects its sole RDO member only after normal rules fail, while two grouped RDOs remain pending and normalized monthly totals stay conserved in `backend/test/acompanhamento-labor-cost.test.js` and `backend/test/pontomais-sync.test.js`
- [X] T083 [US1] Version the canonical Ponto Mais snapshot data in `PontoSyncState`, add a Prisma migration, and make the automatic job replay all historical 31-day windows exactly once when the normalizer revision increases in `backend/prisma/schema.prisma`, `backend/prisma/migrations/`, and `backend/src/lib/pontomais/job.js`
- [X] T084 [US2] [US3] Fix current-pendency revalidation to preserve empty point tags and pass active mission-group evidence through the shared allocation rule used by synchronization and labor cost in `backend/src/lib/pontomais/sync.js` and `backend/src/lib/acompanhamento/labor-cost.js`
- [X] T085 Update the feature decisions/contracts and run focused/full backend tests, Prisma validation/generation, `git diff --check`, code-review graph change/flow analysis and `tests_for` queries; record the evidence in `specs/010-integracao-pontomais/quickstart.md`

**Dependencies**: T080 precedes T083; T081 and T082 precede T084; T085 follows T083 and T084.

---

## Phase 14: Dual Labor Axes and Explicit Mission-Group Policies

**Purpose**: Preserve one real monthly payroll while allowing project cards to repeat the full Ponto Mais journey and analytical cost for explicitly shared executions.

- [x] T086 [P] [US2] Add failing allocation regressions for `VISUAL_ONLY`, `SHARED_EXECUTION`, `CONSOLIDATE_PRIMARY`, accounting conservation, analytical duplication and `EM VIAGEM` context in `backend/test/acompanhamento-labor-cost.test.js`
- [x] T087 [P] [US2] Add failing mission-group service and route tests for policy serialization, Zod validation, primary-member enforcement and manager authorization in `backend/test/acompanhamento-mission-groups.test.js` and the commercial route tests
- [x] T088 [US2] Extend `AcompanhamentoMissionGroup` with the labor policy and optional primary project through `backend/prisma/schema.prisma` and a versioned migration under `backend/prisma/migrations/`
- [x] T089 [US2] Implement policy creation/update/serialization and cache-safe reads in `backend/src/lib/acompanhamento/mission-groups.js` and `backend/src/routes/resources/acompanhamento-comercial.js`
- [x] T090 [US2] Split accounting and analytical daily allocation/cost projections, preserve Ponto normal/overtime as truth, and apply travel tags only as context in `backend/src/lib/acompanhamento/labor-cost.js` and `backend/src/lib/pontomais/normalize.js`
- [x] T091 [US2] Make pending revalidation honor shared and consolidated group policies without globally auto-resolving unrelated multiple-RDO days in `backend/src/lib/pontomais/sync.js`
- [x] T092 [US2] Switch project cards and project/group collaborator details to analytical allocations while keeping the Costs tab on accounting totals in `backend/src/lib/acompanhamento/project-cards.js`, `backend/src/lib/acompanhamento/project-detail.js`, and `backend/src/lib/acompanhamento/project-detail-groups.js`
- [x] T093 [US3] Add pt-BR group policy controls with primary-project selection, explanatory copy and responsive field states in `frontend/src/api/acompanhamentoComercial.ts` and `frontend/src/components/projects/ProjectCardsBoard.tsx`
- [x] T094 [US3] Extend day overrides to select multiple candidate projects and apply the same selection in batch to equivalent pendencies in `backend/prisma/schema.prisma`, `backend/src/lib/pontomais/sync.js`, `backend/src/routes/resources/acompanhamento-ponto.js`, `frontend/src/api/acompanhamentoPonto.ts`, and `frontend/src/components/projects/PontoImportPanel.tsx`
- [x] T095 Run focused/full backend and frontend validation, Prisma validate/generate, `git diff --check`, refresh the code-review graph and inspect affected flows/tests; record evidence in `specs/010-integracao-pontomais/quickstart.md`

**Dependencies**: T086 and T087 precede T088–T094; T088 precedes T089–T094; T089 precedes T093; T090 precedes T091, T092, and T094; T095 follows all implementation tasks.

---

## Phase 15: Travel Destination from Mobilization

**Purpose**: Associate a travel-tagged Ponto Mais day to the project whose exact mobilization date and later nominal RDO jointly confirm the destination.

- [x] T096 [P] [US2] Add failing pure allocation regressions for one mobilization candidate, absent travel tag/date mismatch, shared/consolidated multiple candidates and same-day/manual precedence in `backend/test/acompanhamento-labor-cost.test.js`
- [x] T097 [P] [US3] Add failing pendency regressions proving a unique future-RDO destination is hidden, incompatible multiple destinations are selectable, and later RDO hours are not reinterpreted as same-day hours in `backend/test/pontomais-sync.test.js`
- [x] T098 [US2] Derive collaborator/mobilization-date candidates exclusively from later RDOs, apply them as the final daily allocation fallback on both accounting and analytical axes, and preserve Ponto Mais hours as truth in `backend/src/lib/acompanhamento/labor-cost.js`
- [x] T099 [US3] Load project mobilization and later nominal RDO evidence during current-pendency reconstruction and use the shared allocation rule in `backend/src/lib/pontomais/sync.js`
- [x] T100 Update the feature contracts and run focused/full backend validation, `git diff --check`, refresh the code-review graph and inspect affected flows/tests; record evidence in `specs/010-integracao-pontomais/quickstart.md`

**Dependencies**: T096 and T097 precede T098 and T099; T100 follows all implementation tasks.

---

## Phase 16: Missing Project Isolation

**Purpose**: Keep historical or absent project references consultable without crowding the operational reconciliation queue.

- [x] T101 [P] [US2] Add a partition regression proving a day moves out of the operational queue only when every candidate code is absent, while mixed and unidentified cases remain actionable, in `backend/test/pontomais-sync.test.js`
- [x] T102 [US2] Partition unresolved project tags and fully absent candidate days in the pending service while retaining current project, inactive-project and historical-project recognition in `backend/src/lib/pontomais/sync.js`
- [x] T103 [US3] Add a URL-persisted “Projetos não encontrados” tab with independent counts, optional tag linking, explanatory empty state, responsive layout and local scrolling in `frontend/src/api/acompanhamentoPonto.ts`, `frontend/src/components/projects/PontoImportPanel.tsx`, and `frontend/src/styles/base.css`
- [x] T104 Update feature contracts and run focused/full backend and frontend validation, audits, lint, build, `git diff --check`, refresh the code-review graph and inspect affected flows/tests; record evidence in `specs/010-integracao-pontomais/quickstart.md`

**Dependencies**: T101 precedes T102; T102 precedes T103; T104 follows all implementation tasks.
