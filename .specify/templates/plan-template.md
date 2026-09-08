# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Server operations/deploy commands are not executed by the agent; any such command is
  documented for the human operator to run on the server.
- UI is pt-BR and mobile-first: wide tables have mobile alternatives, modals have fixed
  action footers and no page-level horizontal scroll. Card grids must fit the useful
  mobile width (e.g., `minmax(min(100%, ...), 1fr)` or equivalent), flex/grid children
  must be allowed to shrink (`min-width: 0`), and long values/badges/actions must not
  widen the viewport. Tabs, segmented controls and tab-like filters must wrap, use a
  responsive grid, scroll internally by design, or switch to a mobile select/menu
  without widening the page.
- Forms and APIs use Zod-compatible validation on frontend and backend.
- Schema changes are represented by Prisma migrations and never by ad hoc database edits.
- Backend business logic has tests in `backend/test` when the feature adds or changes
  rules.
- Visual consistency uses `frontend/src/components/ui/` and design tokens. Native
  `select` fields, custom dropdowns/comboboxes and multiselects must match the app
  standard states (default, focus, disabled, error, mobile), and desktop modules with
  dashboards/tables/forms must use the wide module shell pattern. Required fields must
  use the shared invalid state when save is attempted empty/invalid: `.field-group`
  plus `.field-invalid`, `aria-invalid` where applicable, and a `.field-error` message;
  native browser validation UI is not sufficient.
  *Ported-identity exception*: a module that faithfully reproduces an approved existing
  app may keep its original visual identity if the plan declares it and all four
  conditions hold — CSS fully scoped to a module root with no leakage either way,
  palette/measurements declared as prefixed custom properties in a single block without
  redefining global tokens, mandatory behaviors preserved (`aria-invalid` with visible
  message, select states, shared drag and drop, URL params, first-access tutorial, no
  page-level horizontal scroll on mobile), and the exception re-evaluated once the
  module stops being a port.
- User-facing drag and drop reordering uses the shared app pattern: dedicated drag
  handle, live reordering while dragging, placeholder/space with position legend,
  visual ghost, cancel restores the initial order, drop persists only the final order,
  and mobile/touch works via Pointer Events or equivalent with `touch-action: none`.
- New user-facing functions include the temporary novelty campaign when applicable:
  Driver.js-style centered novelty card, localStorage seen marker per user/browser,
  global expiration exactly 10 days after implementation date, and a guided tutorial
  for the first access to the new function during that same window. New modules keep
  permanent first-access module onboarding; functions inside existing modules do not.
- Module-internal navigation persists across refresh: tabs, side sections, tab-like
  filters and detail views that replace a list are represented by URL/query params
  whenever the state is shareable and non-sensitive, with incompatible params cleaned
  when changing sections.

**Required visual evidence when frontend changes are present:**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| [surface name] | [path + pattern checked] | [e.g., Modal, Button, field-group, admin-inline-form] | [default/focus/disabled/error/empty, including required-empty red highlight] | [handle + live placeholder/ghost + mobile touch, or N/A] | [URL/query params or N/A with reason] | [10-day novelty/tutorial or N/A with reason] | [viewport behavior; tabs/cards/grids/text overflow checked] |

- A plan may reuse or clone an existing component only after checking that the source
  component still complies with the current constitution. If the source component has
  visual debt, the plan must include a task to fix the source or use a better shared
  pattern instead.
- Inline form controls must use shared form structure (`field-group`, `admin-form-grid`,
  `admin-inline-form`, or a documented equivalent). Placeholder text alone is not an
  acceptable label.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
