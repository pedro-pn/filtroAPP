# Search regression in a browser

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
