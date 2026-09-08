# Quickstart: Validating the VR Ponto Mais integration

## Prerequisites

- Work on branch `feat/integracao-pontomais`.
- Set `PONTOMAIS_API_TOKEN` only in `backend/.env`; keep `backend/.env.example` empty.
- Prefer a dedicated Ponto Mais user token restricted to the employees and journey reports needed by Acompanhamento.
- Have local fixtures with collaborators, projects and RDOs. Do not print personal data in tests.

## 1. Automated validation

From `backend/`:

```bash
npm test
```

Coverage must include pagination, active/inactive history discovery, retry/redaction, cursor resumption, daily due-time behavior, distributed lock, identity matching, explicit HE70/HE100, per-punch tags, atomic publication, idempotency, ambiguous projects and the monthly cost invariant.

From `frontend/`:

```bash
npm test
npm run build
```

Expected: TypeScript/build succeed; helper tests cover period validation and novelty expiration where applicable.

## 2. Safe client validation

Client tests mock `fetch` with fictitious data and prove:

1. `access-token` is added internally.
2. Errors do not contain the token or raw body.
3. Pagination collects every page.
4. `400/401/403` are not retried.
5. Timeout, `429` and `5xx` use bounded retry.

Live access is optional and read-only. Never commit real API responses.

## 3. Automatic bootstrap scenario

1. Start from a database without `PontoSyncState`, with the token configured on the server.
2. Start the backend through the environment's normal operator procedure; do not open the browser to trigger collection.
3. Confirm the job discovers the oldest admission across active and inactive employees.
4. Confirm audit rows use `AUTOMATIC_BOOTSTRAP`, each interval has at most 31 inclusive days, and the same job keeps creating consecutive batches until coverage is contiguous through today.
5. Interrupt after a successful intermediate batch, restart normally and confirm the next run begins at the persisted `nextPeriodStart` and then continues without pausing until today.
6. Open “Ponto (jornada)” as an Acompanhamento manager and verify coverage, progress and pendencies without token, CPF or manual period fields.
7. Confirm labor-cost cards use the synchronized history and no collaborator/day or monthly cost is doubled.

## 4. Automatic daily scenario

1. With bootstrap `SUCCEEDED`, set the injected test clock before 03:00 BRT and confirm no daily sync is due.
2. Move it after 03:00 BRT and confirm exactly one `AUTOMATIC_DAILY` run ends yesterday and starts 30 days earlier.
3. Execute the check again on the same local date and confirm no second effective daily run.
4. Advance one day and confirm a new rolling window is synchronized.
5. Simulate multiple app instances and confirm only one acquires the tracked-job lock.

## 5. Accounting conservation and analytical sharing

Use fictitious fixtures for one collaborator/day:

- Point: 8 normal hours.
- Tags: missions A and B.
- RDO A: 8 hours; RDO B: 4 hours.

With a `VISUAL_ONLY` group (or no group), expected accounting behavior:

- Weights A = `2/3`, B = `1/3`.
- Appropriated point hours A = `5h20`, B = `2h40`.
- RDO total of 12 hours never replaces or increases the point's 8 hours.
- `cost(A) + cost(B) + sede + folga = totalMensal`, exactly in cents.

Repeat with 8 hours in each RDO. Expected weights are 50%/50%, not 8 hours in each project.

Then place A and B in one `SHARED_EXECUTION` group and use a point day with 8 normal hours plus 30 minutes overtime. Expected:

- The Costs tab still contains one 8h30 journey and one monthly payroll total.
- Accounting `byProject` remains normalized and reconciles exactly to payroll.
- Analytical A receives 8h30 and analytical B receives 8h30.
- Individual cards show 8h30 each; the merged card shows 17h and the sum of both analytical costs.
- RDO hours remain separately visible as report hours and do not replace the 8h30 Ponto Mais truth.

Configure the same group as `CONSOLIDATE_PRIMARY` with A as primary. Expected both member RDOs to produce a single 8h30 allocation in A, with no duplicate analytical allocation in B.

Finally, add `EM VIAGEM - exemplo` to the point day without a mission tag. Confirm that it does not resolve A/B by itself, but applies travel context after the shared/consolidated RDO policy chooses the destination.

## 6. Failure preservation

1. Start with a successful snapshot.
2. Mock timeout or invalid required upstream data.
3. Confirm the new run is `FAILED` with sanitized error.
4. Confirm no new successful import/period exists.
5. Confirm the previous snapshot still feeds Acompanhamento.

## 7. Reconciliation

1. Synchronize fixtures with unknown employee and tag.
2. Confirm both appear only in manager pendencies and are not silently assigned.
3. Link employee to collaborator and tag to project.
4. Confirm existing summaries recalculate/relink and queries refresh.
5. Confirm ordinary viewers cannot mutate links or see reconciliation identifiers.

## 8. UI/mobile checklist

- All text is pt-BR; controls have visible labels and shared components.
- Bootstrap/running/error states use clear pt-BR copy without requiring period input.
- At narrow width, actions stack and no page horizontal scroll appears.
- Long errors/tags wrap or truncate inside their container.
- The novelty points to the automatic status summary and the employee directory, and never promises a manual synchronization action.
- Without token, the panel explains the server configuration requirement; with token, no upload or period selection is necessary.
- “Sincronização e pendências” and “Colaboradores encontrados” persist through `pontoDetalhe` in the URL.
- Pendencies, discovered employees and both history panels have bounded vertical scrolling, keyboard focus and no page-level horizontal overflow.

## 9. Stale pendency and employee scope

1. Seed an old successful run with one ambiguous day, then add current RDO evidence that resolves one or both tagged projects.
2. Confirm `GET /pending` omits that item without rewriting the run summary; a day still lacking evidence remains visible.
3. Open “Colaboradores encontrados” as a manager and ignore a fictitious non-operational employee.
4. Confirm the employee remains visible there as ignored, disappears from pendencies and does not enter a later normalized snapshot or the current labor-cost result.
5. Select “Voltar a considerar” and confirm existing synchronized history becomes eligible again without a new bootstrap.
6. Confirm a viewer receives `403` from both directory/preference endpoints.

## Validation record — 2026-08-17

- Backend suite: 101 test files passed, including client retry/redaction, sync transactionality, identity matching, project weights and cent conservation.
- Frontend suite: 12 test files passed; TypeScript/Vite build and ESLint completed with no errors (two pre-existing hook warnings remain outside this feature).
- Prisma schema validation and client generation passed; `git diff --check` passed.
- The current tenant's external contract was checked read-only for employees, work-day reports, explicit HE70/HE100 and `tag_manager`. No real response or personal data was saved in the repository.
- Interactive browser/server steps were not started in this workspace. They remain the deployment smoke test after applying the migration and configuring the protected token; automated fixtures cover the same success, duplicate, failure, reconciliation and allocation contracts without mutating the external service.

### Convergence follow-up

- Backend suite: 101 test files passed after adding regressions for complete `time_cards` pagination, malformed/incomplete upstream content, last-snapshot preservation and concurrent synchronization admission.
- Route tests now execute the Express route stack and the real Acompanhamento authorization middlewares for viewer/manager access, including the safe reconciliation project catalog and historical projects.
- Frontend suite: 12 test files passed; TypeScript/Vite build passed; ESLint completed with no errors and the same two pre-existing hook warnings outside this feature.
- Prisma schema validation/client generation and `git diff --check` passed. The atomic admission uses a PostgreSQL transaction advisory lock and therefore requires no additional schema migration.
- The stricter client was exercised read-only against the configured tenant for employees, work days and time cards. The live payloads passed validation; no token, raw payload, count or personal data was saved in the repository.
- Per Constitution Principle I, no local application server, Docker environment or deployment was started. The browser interaction remains an operator smoke test after applying the already versioned feature migration; HTTP contracts, configured-token collection and UI compilation were validated without starting server infrastructure.

### Automatic synchronization follow-up — 2026-08-17

- Backend suite: 102 test files passed, including active/inactive employee discovery, resumable 31-day chunks, cursor preservation on failure, daily BRT cutoff/window, shared distributed job lock, trigger audit and historical pendency aggregation.
- Frontend suite: 12 test files passed; TypeScript/Vite build passed. ESLint completed with zero errors and the same two pre-existing hook warnings outside this feature.
- Prisma schema validation and client generation passed for `PontoSyncState` and `PontoSyncRun.trigger`; `git diff --check` passed.
- The configured tenant was consulted read-only through the production client. Active and inactive employees produced a valid automatic history start date; no token, date, count, raw payload or personal data was printed or stored.
- Code-review graph change detection reported broad financial/dashboard impact already covered by the labor-cost and project-card suites; affected-flow analysis found seven flows. The graph could not associate untracked feature test files structurally, so the explicit 102-file backend suite and focused Ponto Mais tests were used as the coverage evidence.
- No backend server, Docker service, migration deployment or external write was executed. After the versioned migration is applied and the deployed backend restarts, the job begins after its non-blocking boot delay and persists progress after each completed lot.

### Immediate full-history bootstrap follow-up — 2026-08-17

- The artificial 12-batch cycle limit was removed. One successful bootstrap job now keeps issuing consecutive windows of at most 31 inclusive days until the current business date is covered.
- The current day is provisional only in the first bootstrap. `lastDailySyncDate` remains yesterday so the next eligible daily window rereads that day after it has closed.
- Cursor updates remain per successful batch. An upstream or internal failure still preserves `nextPeriodStart`, and the next automatic attempt resumes from that exact day.
- Backend suite: 102 test files passed. Frontend suite: 12 test files passed; production build succeeded and ESLint reported zero errors with the same two unrelated pre-existing hook warnings.
- `git diff --check` passed. Graph change/flow analysis completed; the untracked Ponto Mais feature files still have no structural flow association, so the focused orchestration regression and full suites remain the coverage evidence.
- No backend server, Docker service, migration deployment or external write was executed.

### Pending revalidation and employee scope follow-up — 2026-08-17

- Read-only database checks disproved the proposed missing-report explanation: both 5761 and 5794 have reports, and all 151 stored ambiguous records involving both codes occur on dates with reports for both projects. The current RDO-weight rule resolves every inspected record; the visible issue was stale historical pendency state. The later merged-project fallback therefore does not alter those records and is limited to a distinct unique-RDO case.
- Added current-evidence revalidation for ambiguous pendencies while preserving immutable sync-run summaries.
- Added `PontoExternalEmployee`, a versioned backfill migration, manager-only list/ignore contracts, exclusion from new snapshots and filtering of existing API periods before cost consolidation.
- Added the URL-persisted “Colaboradores encontrados” subtab, reversible actions, tutorial coverage and local keyboard-scroll regions for pendencies and employee/history lists.
- Backend suite: 102 test files passed. Frontend suite: 12 test files passed; production build succeeded and ESLint reported zero errors with the same two unrelated pre-existing hook warnings.
- Prisma schema validation/client generation passed. No backend server, Docker service, migration deployment or external write was executed.
- The refreshed code-review graph classified the combined Ponto Mais/cost/UI change as high impact (57 dependent files within two hops). The full suites cover those consumers; as in earlier follow-ups, the graph did not associate the untracked feature tests to symbols, so focused sync, labor-cost and route regressions remain the explicit coverage evidence.

## 10. Generic overtime and manual day reconciliation

1. Normalize a work-day fixture containing `extra_time` with `percent: null`, explicit 70% and explicit 100%; confirm no minute is lost and only the generic bucket is subject to the monthly cap.
2. Create a day whose single Ponto Mais tag resolves to project A while the collaborator RDO resolves only to project B; confirm project B receives the complete normal/HE journey and no pending item remains.
3. Repeat with RDOs in projects B and C; confirm one `TAG_RDO_CONFLICT` pending item, select one candidate as manager and verify the item disappears without changing the collaborator monthly total.
4. Confirm a viewer receives `403`, an unrelated project is rejected, and the immutable synchronization run remains unchanged.

### Validation evidence — 2026-08-17

- A regression now starts from an old successful run with no recorded ambiguity and proves that `GET /pending` reconstructs the tag × RDO conflict from the stored API snapshot; the audited manager choice then removes it without another synchronization.
- Backend suite: 102/102 tests passed. Frontend suite: 12/12 tests passed; production build succeeded.
- ESLint completed with zero errors and the same two unrelated pre-existing hook warnings in `OmieCostCategoriesPanel.tsx` and `ProjectTrackingNovelties.tsx`.
- Prisma schema validation and client generation passed; `git diff --check` passed.
- The refreshed code-review graph rated the combined integration/cost/UI surface as high impact (`0.75`) and did not map execution flows or tests for the new untracked feature files; the focused regressions plus both full suites are therefore the concrete coverage evidence.
- No backend server, Docker service, migration deployment or external write was executed.

## 11. Single-RDO precedence over a divergent tag

1. For `Ponto Mais: 5752 · RDO: 5761`, confirm 5761 receives weight 1 and the day is absent from current pendencies, including when the mismatch exists only in a historical snapshot.
2. With tag 5752 and two divergent RDOs, confirm no automatic project allocation occurs and the manager selector still lists the tag and both RDO projects.
3. Confirm manual overrides already stored retain precedence and normal/HE hours plus monthly cost remain conserved.

### Validation evidence — 2026-08-17

- Focused allocation/synchronization regressions passed, including complete normal, HE70 and HE100 transfer to the sole divergent RDO and preservation of manual reconciliation for two divergent RDOs.
- Backend suite: 102/102 tests passed. Frontend suite: 12/12 tests passed; production build succeeded.
- ESLint completed with zero errors and the same two unrelated pre-existing hook warnings in `OmieCostCategoriesPanel.tsx` and `ProjectTrackingNovelties.tsx`; `git diff --check` passed.
- The refreshed code-review graph reported a medium focused review risk with 11 impacted nodes in 7 files. Its `tests_for` relation did not associate the untracked feature tests, so the focused regressions and full suites remain the concrete coverage evidence.
- No schema/API/UI change, backend server, Docker service, migration deployment or external write was required or executed.

## 12. Historical repair, visible no-tag ambiguity and mission-group fallback

1. Start with a completed `PontoSyncState` at data revision 1 and history already covered through today. Confirm the next cycle replays from `historyStart` in windows of at most 31 days, records target revision 2 and promotes it only after the final window.
2. Fail a middle replay window and confirm the next cycle resumes at the failed window instead of restarting the historical range. After completion, run another cycle and confirm there is no second replay.
3. Revalidate a day with no recognized point tag and two RDO projects. Confirm it remains in `GET /pending` and is available for the existing manual selection.
4. With point tag A and RDOs B/C, where only A/B belong to the same active mission group, confirm B receives weight 1 after normal rules fail. Repeat with two grouped RDOs and confirm the day remains pending.
5. Confirm manual overrides and normal tag/RDO rules retain precedence and that normal, HE70 and HE100 hours remain conserved.

### Validation evidence — 2026-08-17

- Focused regressions for automation, synchronization pendencies and labor allocation passed.
- Backend suite: 102/102 test files passed. Frontend suite: 12/12 test files passed; production build succeeded.
- ESLint completed with zero errors and the same two unrelated pre-existing hook warnings in `OmieCostCategoriesPanel.tsx` and `ProjectTrackingNovelties.tsx`.
- Prisma schema validation and client generation passed; `git diff --check` passed.
- The refreshed code-review graph rated the combined change as high risk (`0.75`) with 54 impacted files. It reported no associated execution flows and no `tests_for` links for the still-untracked Ponto Mais job/sync files, so the focused regressions and full suites are the concrete coverage evidence.
- No backend server, Docker service, migration deployment or external write was executed.

## 13. Dual accounting and analytical labor allocation

1. Configure a mission group such as 5694/5810/5813 as `SHARED_EXECUTION`. On a day with two member RDOs, confirm each project receives the complete Ponto Mais journey and its corresponding hourly cost in the project card/detail.
2. Confirm the same day remains conserved once in the Costs tab and in the collaborator monthly payroll total; only the analytical project views may repeat it.
3. Configure the exceptional merged group 5761/5788/5794/5805 as `CONSOLIDATE_PRIMARY`, with 5761 as primary. Confirm member evidence is appropriated once to 5761.
4. Confirm `EM VIAGEM`, including a mistakenly registered project alias, remains visible as travel context but never becomes a project allocation or unresolved project-tag pending item.
5. On an unrelated ambiguous day, select two or more projects and apply the choice to equivalent pendencies. Confirm each selected project receives the full analytical journey while the accounting total remains unique.

### Validation evidence — 2026-08-17

- Backend suite: 102/102 test files passed after the final policy-parser, authorization, analytical group-sum, travel-context and multi-project override regressions.
- Frontend suite: 12/12 test files passed; production TypeScript/Vite build succeeded. ESLint completed with zero errors and the same two pre-existing hook warnings in `OmieCostCategoriesPanel.tsx` and `ProjectTrackingNovelties.tsx`.
- Prisma schema validation and client generation passed; `git diff --check` passed. The versioned migration adds the mission-group policy, primary-project relation and multi-project day-override uniqueness.
- The implementation keeps Ponto Mais normal/overtime minutes as the daily truth, uses RDO/group/manual evidence only to select destinations, conserves payroll on the accounting axis and repeats full hours/cost only on the analytical project axis.
- The refreshed code-review graph contains 10,416 nodes, 54,778 edges and 826 execution flows. It rated the financial/synchronization surface as high risk (`0.85`) and found 37 affected flows; both full suites plus focused allocation, policy, route, group-card and sync regressions cover the changed behavior despite incomplete automatic `tests_for` associations.
- No backend server, Docker service, migration deployment or external write was executed.

## 14. Travel destination from mobilization

1. Configure project A with mobilization on 2026-07-16, create an `EM VIAGEM` Ponto day for collaborator X on that date, and place X in an A RDO on 2026-07-18. Confirm the complete Ponto journey from 16 July is appropriated to A with travel context; the 18 July RDO hours are not copied to 16 July.
2. Add unrelated project B with the same mobilization date and a later RDO for X. Confirm the day becomes a manual pendency listing A/B instead of choosing by report proximity.
3. Put A/B in `SHARED_EXECUTION` and confirm accounting remains one journey while each analytical card receives the full travel journey. Repeat with `CONSOLIDATE_PRIMARY` and confirm a single destination.
4. Remove the travel tag, change the mobilization date, or use a later RDO belonging to another collaborator. Confirm the fallback does not allocate a project.
5. Add a manual override or decisive same-day evidence and confirm it retains precedence over the mobilization fallback.

### Validation evidence — 2026-08-17

- The focused labor-cost and synchronization files passed 30/30 and 24/24 tests after first demonstrating the expected failures for the new rule.
- The full backend suite passed 102/102 test files. `git diff --check` also passed.
- Regressions cover exact mobilization date, strictly later nominal RDO, rejection of same-day/RTP evidence, unique and incompatible destinations, group sharing/consolidation, manual/same-day precedence and zero later-RDO hours copied into the travel date.
- The refreshed code-review graph classified the combined financial/synchronization files as high impact, with 54 dependent files within two hops. Its `tests_for` relation still does not associate every untracked Ponto Mais test, but caller analysis identifies the direct allocation tests and the full backend suite covers all consumers.
- No schema migration, frontend change, backend server, Docker service, external API write or deployment operation was required or executed.

## 15. Missing project isolation

1. Synchronize an unknown project tag and confirm it appears only under `pontoDetalhe=missing-projects`, without increasing the operational-pendency badge.
2. Reconstruct an ambiguous historical day whose only candidate code is absent from every current, inactive and soft-deleted project. Confirm it appears in the same separated tab and remains out of the operational queue.
3. Repeat with one absent code and one registered candidate; confirm the day remains under “Sincronização e pendências” so the registered project can still be selected.
4. Link an unknown tag to a registered project and confirm it disappears from “Projetos não encontrados” after query invalidation.
5. Confirm the separated list has localized keyboard-accessible scrolling and the three-tab selector stacks on mobile.

### Validation evidence — 2026-08-17

- Focused synchronization/service and HTTP route tests passed, including the absent-only, mixed known/unknown and unidentified-candidate partitions.
- Backend suite: 103/103 test files passed. Frontend suite: 12/12 test files passed; production TypeScript/Vite build succeeded.
- Backend and frontend audits reported zero vulnerabilities. ESLint completed with zero errors and the same two unrelated pre-existing hook warnings in `OmieCostCategoriesPanel.tsx` and `ProjectTrackingNovelties.tsx`; `git diff --check` passed.
- The refreshed code-review graph rated the eight-file change as medium risk (`0.40`) and reported no affected execution flows. Its automatic `tests_for` relation did not connect the new pure regression to `partitionMissingProjectPendencies`, so the focused test plus both full suites are the concrete coverage evidence.
- No schema migration, synchronization replay, backend server, Docker service, external API write or deployment operation was required or executed.
