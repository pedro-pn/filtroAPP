# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`

**Created**: [DATE]

**Status**: Draft

**Input**: User description: "$ARGUMENTS"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g., "Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email addresses"]
- **FR-003**: Users MUST be able to [key interaction, e.g., "reset their password"]
- **FR-004**: System MUST [data requirement, e.g., "persist user preferences"]
- **FR-005**: System MUST [behavior, e.g., "log all security events"]

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Visual/UI Contract *(mandatory if feature touches frontend)*

<!--
  If there are no frontend UI changes, write: "N/A - no frontend UI changes."

  For every new or changed screen, modal, card, form, table, select, combobox, dropdown
  or inline editor, fill the table below with concrete existing references and shared
  components/classes. "Clone of X" is not enough unless X was checked against the
  current constitution and visual standard.

  If this feature relies on the ported-identity exception (Princípio VI), state it
  explicitly here: name the source app being reproduced, the module CSS root that scopes
  every selector, the prefix of the module custom properties, and confirm that the
  mandatory behaviors are still delivered. Without that declaration the exception does
  not apply and the standard kit/tokens rules hold.

  For new user-facing functions, describe the 10-day novelty campaign and guided
  tutorial for first access. If this is a new module, describe the permanent first-access
  module tutorial instead. If no novelty/tutorial applies, state the reason.

  For screens with module-internal navigation, describe how tabs, sections, tab-like
  filters and list-replacing detail views persist across refresh. Prefer URL/query params
  unless the state is sensitive or not shareable.

  For responsive surfaces, define how tabs/segments/tab-like filters, card grids, tables
  converted to cards, badges, metric values, links and action rows avoid page-level
  horizontal scroll on narrow phones. Include the expected behavior for long labels and
  large numeric values.

  For forms, define the required-field empty/error behavior: saving with a mandatory
  field empty or invalid must highlight the specific field in red using the shared
  field-group/field-invalid/field-error pattern, not only browser-native validation.

  For user-facing reordering by drag and drop, define the shared interaction pattern:
  dedicated drag handle, live reordering while dragging, placeholder/space with position
  legend, visual ghost, cancel restoring the initial order, final persistence only on
  drop, and mobile/touch support via Pointer Events or equivalent with touch-action none.
-->

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------------|------------------------|---------------------------|------------------------------|
| [e.g., Manager create form] | [file/class inspected] | [ui component or CSS class] | [field-group/admin-inline-form/shared dropdown] | [handle + live placeholder/ghost + mobile touch, or N/A] | [URL/query params, localStorage exception, or N/A] | [10-day novelty/tutorial, permanent module tutorial, or N/A] | [mobile + desktop behavior; no tab/card/grid/text overflow] |

### Key Entities *(include if feature involves data)*

- **[Entity 1]**: [What it represents, key attributes without implementation]
- **[Entity 2]**: [What it represents, relationships to other entities]

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by 50%"]

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- [Assumption about target users, e.g., "Users have stable internet connectivity"]
- [Assumption about scope boundaries, e.g., "Mobile support is out of scope for v1"]
- [Assumption about data/environment, e.g., "Existing authentication system will be reused"]
- [Dependency on existing system/service, e.g., "Requires access to the existing user profile API"]
