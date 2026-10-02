# Search regression in a browser

Start the frontend with `npm run dev`. Open `/test/browser/search-race.html` in an
isolated Playwright CLI session, then run:

```sh
playwright-cli run-code --filename frontend/test/browser/search-race.js
```

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

Backend deployment requires the `20261002103000_flexible_weekly_targets` and
`20261002150000_weekly_target_deletion` Prisma migrations before starting the
updated API. Existing percentage targets are preserved.
