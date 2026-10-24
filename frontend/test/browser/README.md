# Search regression in a browser

For public RDO project signatures, open `/assinar/exemplo?visualizar=1` with the frontend
development server running. It shows four example PDFs and simulates individual or joint
signatures without recording real signatures. Run `npx playwright test
--config=playwright.rdo.config.ts rdo-public-signature-batch.behavior.spec.ts` from `frontend`
to check document switching, individual and joint confirmation, partial failures and retry,
the single-report flow, mobile signing, and layout in both themes. Production links only
include available pending RDOs assigned to the same client email within the same project.

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
uses the production card ("Meta da semana"), history panel and target dialog with a
simulated API shared by Acompanhamento and Efetivo. No database records are changed.

The card opens on the last closed counting period (the one reviewed in the Friday
meeting) and switches to the current one. The dialog has one line per goal: what to
measure (a service, project progress in p.p. or a minimum crew per day), the amount
and how it counts ("por colaborador por dia" or "no total da semana"), plus a sentence
describing the goal. With two or more goals, "Todas" (AND) or "Pelo menos uma" (OR)
decides the week; AND with only some goals met is "Meta parcial". A service goal
without any RDO of that service in the period counts 0; a period with no RDO at all
stays unevaluated. New targets count Friday to Thursday ("Alterar dias" changes it)
and start in the period that contains today (or the clicked history week).

Per-collaborator goals count each person on the RDO team (day and night shifts,
once per day even across several RDOs) as 1 on each day with an RDO of that service;
service times and workdays do not matter. Example: 20 m per collaborator with 3, 2 and
4 people on the RDOs = 180 m. "Qualquer serviço" (any service) sums the amount of every
service and counts the day's team once, so one line replaces a service-by-service OR.
Targets saved with scenarios or a reference day keep being read; the dialog replaces
their rules on save. Deletion stays in the history panel, with confirmation and an
immutable deletion revision.

Run the browser regressions with:

```sh
npx playwright test --config=playwright.operational-visual.config.ts weekly-targets-dialog.spec.ts
```

In Efetivo, the project planning's Execution stage shows the same card above the
execution dashboard; open `/test/browser/efetivo-weekly-target.html` (add `?leitor`
for read-only, `?dark` for the dark theme). It edits the same project target as
Acompanhamento, and the target dialog and history open above the planning dialog.

Daily attendance goals ("Equipe mínima no dia") use the distinct collaborators
recorded in each RDO on the project's workdays (Monday to Friday, plus Saturday or
Sunday when the project includes them). The cumulative balance and daily statuses
work as before.

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
