# Search regression in a browser

For moving photos during RDO review, run:

```sh
cd frontend
npx playwright test --config=playwright.rdo.config.ts rdo-photo-transfer.behavior.spec.ts
```

The production editor uses a simulated API at `/test/browser/rdo-photo-transfer.html`.
Coverage includes transfers between service fields, services and activity photos,
saving/reopening, pending uploads, cancelling, report isolation, signed reports,
keyboard ordering, automatic scrolling and touch at 390 px. No real records change.

For execution start, open `/test/browser/execution-start.html` and run
`playwright-cli run-code --filename frontend/test/browser/execution-start.js`.
It checks hiding the operator selector when no team account is eligible,
the notice about the Contract Manager default, requiring a selection when
eligible operators exist, actual start dates, cancellation and mobile layout.
The production dialog submits to local fixture state; no real project is changed.

For the notification center, open `/test/browser/notification-center.html` and run
`playwright-cli run-code --filename frontend/test/browser/notification-center.js`.
It covers pagination/retry, individual and bulk reads, persistence after reload,
failed reads, account isolation, keyboard focus and mobile layout at 390/320 px.
The API is simulated; no real records or emails are changed. Deployment requires
migration `20261021120000_notification_center` before starting the updated API.

Operational failures also require migration `20261022120000_operational_notifications`.
Run `playwright-cli run-code --filename frontend/test/browser/operational-notifications.js`
for automatic backup popups, read persistence, new incidents, recovery, diagnostics and mobile layout.
Run `playwright-cli run-code --filename frontend/test/browser/project-notification-review.js`
for a notification opening the exact pending project review in Relatórios/Projetos.

For management notes in merged projects, open `/test/browser/project-scopes.html?grupo=1&notas=1`
and run `playwright-cli run-code --filename frontend/test/browser/project-management-notes.js`.
The production dashboard uses a simulated API. It checks notes from visible group members,
chronological order, origin/author/date, creating in the selected mission, reload and individual
views, read-only access, partial load failures, retrying a save and layout at 360/768/1440 px.
No database records are changed.

For additional proposal contributions, open `/test/browser/additional-metrics.html` and run
`playwright-cli run-code --filename frontend/test/browser/additional-metrics.js`.
It checks that the action appears only in Acompanhamento, per-field inclusion, cancellation,
persistence after reload, updating the dashboard, retry after a failed save, reactivating excluded
contributions, read-only access and mobile layout at 390/320 px.
The production dashboard runs with a simulated API. Backend deployment requires migration
`20261016140000_additional_proposal_metrics` before starting the updated API.

For signature batches, open `/test/browser/signature-batch.html` and run
`playwright-cli run-code --filename frontend/test/browser/signature-batch.js`.
The fixture uses the production upload and editor with a simulated API. It checks
multiple PDFs, partial upload failure and retry, continuous scrolling, independent
signer placement, preserving fields when adding signers, reloading the saved
draft, mobile layout, and publishing only the assigned signers per document.
After that regression, run `playwright-cli run-code --filename frontend/test/browser/signature-batch-tracking.js` to check one library card per batch, nested PDFs with mixed statuses, centralized signer links, stable copying, individual downloads, document-to-batch navigation, and mobile layout.
No database records or emails are created.

For the five-day signature batch announcement, run `playwright-cli run-code
--filename frontend/test/browser/signature-batch-novelty.js` in the same fixture.
It checks the production page with a simulated authenticated user: waiting for the
existing tutorial, marking the announcement only after it opens, all three steps,
mobile layout, waiting for the upload dialog, once-per-user display and global
expiration at the end of 20/10/2026 in the corporate timezone.

The batch regression also checks the external document header, previous/next
buttons, direct document selection and scroll tracking. For the public grouped
invitation, run `playwright-cli run-code --filename
frontend/test/browser/signature-group-public.js` in the same fixture session.
It checks one signature confirmation for two documents, navigation on mobile,
and two separate PDF downloads with simulated responses.

For signed RDO batch uploads, open `/test/browser/physical-signature-batch.html` and run
`playwright-cli run-code --filename frontend/test/browser/physical-signature-batch.js`.
The regression uses the production dialog with simulated API responses and covers
selecting a project before upload, querying only its RDOs, filename matching
within that project, manual assignments, duplicate targets, PDF validation,
partial failures, retrying only failed files, load failures and mobile layout.
No database records are changed.

Start the frontend with `npm run dev`. Open `/test/browser/search-race.html` in an
isolated Playwright CLI session, then run:

```sh
playwright-cli run-code --filename frontend/test/browser/search-race.js
```

For planning dialogs, open `/test/browser/planning-signatures.html`. The fixture
uses the production team panel inside the planning modal with a simulated API.
Check adding a collaborator, editing the first open individual cycle to a day
before the general cycle, and saving with no demobilization date. The general
cycle and the other collaborators must keep their dates. Add `?stage=mobilization`
to check editing without exposing new mobilization cycles.

For initial team dates, open `/test/browser/initial-team-dates.html` and run
`playwright-cli run-code --filename frontend/test/browser/initial-team-dates.js`.
It reproduces project 5782 with an old project demobilization before the new
mobilization, checks availability and submitted periods after confirming dates,
complete planning dates, reopening, existing mission return dates and mobile layout.
The production dialog uses simulated API responses; no real records are changed.

For signature navigation, open the same fixture with
`?mode=signatures&q=contrato&status=CONCLUIDO&tab=archived`. Open the document,
reload it and click Voltar: the search, status and archived list must be preserved.
All data and writes in this fixture are simulated.

For active and archived project search, open
`/test/browser/gestor-project-search.html?tab=arquivados`, then run
`playwright-cli run-code --filename frontend/test/browser/gestor-project-search.js`.
The fixture mounts the production manager page and checks `5807 - VILLARIS`
by code and name even when its reports have not been loaded, projects with no
reports, report-only matches, empty results, clearing and restoring the search,
and the active projects tab. All API responses are simulated.

For signature pagination, open the fixture with
`?mode=signatures&pagination=1&status=CONCLUIDO`, then run
`playwright-cli run-code --filename frontend/test/browser/signature-pagination.js`.
The regression checks all 47 completed documents across three pages, filter changes,
mobile scrolling, a next-page failure/retry, and manual loading when the automatic
observer is unavailable. Pending and archived documents remain in their own lists.

Run the CLI command from the repository root, using the same session that opened
the fixture. The fixture uses real React and React Query, with manually resolved
HTTP responses. It deliberately ignores transport cancellation to also test the
hook's stale-response guard. No backend or credentials are needed.

For weekly progress targets, open `/test/browser/weekly-progress.html`. This fixture
uses the production panel with a simulated API shared by Acompanhamento and Efetivo.
The first two fields configure the counting interval, with inclusive start/end days.
Existing targets default to Monday–Sunday; Wednesday–Tuesday crosses the calendar week.
Run `npx playwright test --config=playwright.operational-visual.config.ts weekly-target-period.spec.ts`
to verify persistence, excluded dates, the active period across weeks and mobile layout.
Check creating and editing targets, revision history, switching areas, read-only
access, and the simulated concurrent-edit error. Run `playwright-cli run-code
--filename frontend/test/browser/weekly-progress.js` in that session for the full
regression, including the mobile layout. No database records are changed.

The flexible targets support weekly totals in metres, litres and system units,
or a rate per productive collaborator/day. The target stores the rate and a
reference day in hours, initially filled from the project's weekday workday
(never the weekend workday) and still editable. Saved overrides are preserved
when reopening a target. Crew and productive time come from each RDO
service: 120 person-hours / 8 × 42 m = 630 m; 80 person-hours / 8 × 1,000 L =
10,000 L. Partial days and varying crews are supported. Intervals and stand-by
cap available shift time; any necessary deduction is proportional across service
intervals. Repeated intervals are deduplicated across reports and group members.
Conflicting service assignments or incomplete RDO data leave the comparison
unevaluated. Updating or deleting an RDO invalidates both areas' weekly comparisons
without creating a target revision. Scenarios include ongoing RDO service types,
while actual quantities continue to use finalized services, in this order:
exact combination, service count, general rule. A per-service shortfall is never
offset by another service's surplus. Previous versions retain their original
rates and reference days.

Filtering goals use litres even when the general metric is metres. Scenarios
with cleaning and filtering show each service's own unit and do not sum metres
and litres. Their completion percentage remains the lowest service achievement.

Changing the date inside an open target editor preserves the complete draft,
including unsaved scenarios, values and reference hours. Opening a different
week with its edit/define button loads that week's saved configuration. Saving
uses the latest loaded revision of the destination week, retaining its history.

Run the browser regressions with:

```sh
npx playwright test --config=playwright.operational-visual.config.ts weekly-targets-flexible.spec.ts weekly-progress-visual.spec.ts
```

Deletion is available to managers for each week, with confirmation. It records
an immutable deletion revision and leaves the week without a target, retaining
previous values and the deletion's author/time in history. It never falls back
to an earlier target revision. Recreating a target continues that revision history.
Deletes and saves use the same optimistic revision check in both areas.

Daily attendance targets use the distinct collaborators recorded in each RDO,
including enabled night shifts, independently of service progress, hours or job
role. Select the contracted workdays for each week (Monday to Friday initially).
Each elapsed workday must meet the minimum; surplus on another day does not
change its daily status. Missing RDOs leave attendance pending, while a recorded
RDO with an empty team counts zero. Imported teams inferred from a point workbook
require confirmation. The cumulative balance adds attendance minus the daily
minimum across all weeks with attendance targets, using each week's latest active
revision and selected days. For a minimum of six, eight people produce +2 and
four on the next day bring the balance to zero. Daily statuses remain independent
of the balance. Missing RDOs leave the cumulative balance pending. Run
`playwright-cli run-code --filename frontend/test/browser/weekly-attendance.js`
in the same fixture to check registration, daily results, surplus/deficit,
recalculation, access permissions and mobile layout.

Backend deployment requires the `20261002103000_flexible_weekly_targets` and
`20261002150000_weekly_target_deletion` Prisma migrations before starting the
updated API. Existing percentage targets are preserved.

For "Adequar para relatório", open `/test/browser/adequar-anotacao.html`. The OpenAI call is simulated (700 ms):
click the button, edit the adapted text and apply it (the field receives exactly the edited text) or discard it (the
field is unchanged). `?modo=erro` simulates a timeout with "Tentar novamente"; `?modo=aviso` returns an invented value
and must show the warning above the text, also at 390 px wide.

For the Data Book text editor, open `/test/browser/databook-texto.html`: the field must show bold/italic instead of
raw `<b>` tags; type, press Enter (plain line break), select text and press Ctrl+B or the B button, paste rich text
(only plain text is inserted) and click "Simular aplicar" — the `<pre>` shows the markup sent to the PDF generator.
`?tela=revisao` mounts the full Data Book review form with the "Adequar para relatório" buttons (manager role).

For the editable Data Book preview, open `/test/browser/databook-previa.html` and run the following
scripts from the repository root in the same Playwright CLI session. All API writes are simulated.

- `playwright-cli run-code --filename frontend/test/browser/databook-previa.js`: initial preparation,
  editing directly on the cover, returning to settings without losing edits, saving an immutable new
  revision, cancelling, retrying an initial failure and a 42-page document (`?longo=1`) at 320 px.
- `playwright-cli run-code --filename frontend/test/browser/databook-campos.js`: inline editing of
  execution days, progress tables, chart values, independent identical measurements, empty cells,
  Escape to cancel, automatic PDF updates, mobile focus and saving without leaving the last field.
- `playwright-cli run-code --filename frontend/test/browser/databook-interativo.js`: continuous scroll,
  zoom and scroll retention, delayed preview responses while typing another field (`?lento=1`), saving
  the most recent text, preserving the draft after automatic update failures (`?falha-auto=1`), retry
  and multiline editing with Shift+Enter.
- `playwright-cli run-code --filename frontend/test/browser/databook-abertura.js`: the menu opens
  without loading PDF.js; a renderer import failure keeps navigation, settings and the direct PDF link.

The default fixture uses a synthetic three-page PDF with real editing annotations and appearance
metadata. Python tests separately cover the real generator, blank-cell annotation geometry, unchanged
preview/final page text, edits that cause repagination, and final PDFs without editing links. Frontend
unit tests cover serial preview generation, reuse when saving and recovery after failures/cache reset.

For ComercialAPP v3 additional proposals, start Vite on `127.0.0.1:5193`, open
`/test/browser/commercial-additionals.html` and run
`playwright-cli run-code --filename frontend/test/browser/commercial-additionals.js`.
This UI fixture simulates HTTP responses and checks independent revision selection, metric inclusion,
explicit rollback/removal with reason and selection version, document identity, querying and responsive
layout at 360/768/1440 px. Operational composition is tested separately against the real producer in
`backend/test/commercial-additional-real.integration.test.js`; see `docs/COMERCIALAPP_EXTRA_ESCOPO.md`.

For independent proposal scopes/Data Books, open `/test/browser/databook-previa.html?propostas=1`
and run `playwright-cli run-code --filename frontend/test/browser/databook-propostas.js`.
It checks an audited, versioned assignment in the tracking panel and carries the selected additional
and scope version through preparation, preview and save at 360/768/1440 px. Database/generator
coverage lives in `backend/test/proposal-scope-databook.integration.test.js`.

For project scope tabs in merged groups, open `/test/browser/project-scopes.html?grupo=1`
and run `playwright-cli run-code --filename frontend/test/browser/project-scopes.js`.
The production dashboard uses a simulated API. The regression checks the same scope
screen for individual and grouped projects, keyboard navigation, isolated reads/writes,
inline editing, pending/search filters, cancellation and focus, read-only access,
retry after errors and refreshing a concurrent-edit version at 360/768/1440 px.
Screenshots are saved under `output/playwright/project-scopes-*.png`; no real records change.
