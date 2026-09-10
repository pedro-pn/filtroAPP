# Data Model: Documentos do projeto

## Enums

### `ProjectDocumentType`

`COMMERCIAL_PROPOSAL`, `TECHNICAL_PROPOSAL`, `PURCHASE_ORDER`, `CONTRACT`, `DRAWING`, `SPECIFICATION`, `CERTIFICATE`, `CLIENT_REQUIREMENT`, `TECHNICAL_EVIDENCE`, `OTHER`.

### `ProjectDocumentRequirementStage`

`HANDOVER`, `MOBILIZATION`, `CLOSEOUT`. Ausência de valor significa documento informativo.

### `ProjectDocumentAcceptanceMode`

`NONE`, `INTERNAL`, `CLIENT`, `SIGNATURE`.

### `ProjectDocumentSource`

`MANUAL`, `CRM`, `SYSTEM`.

### `ProjectDocumentContentKind`

`MANAGED_FILE`, `EXTERNAL_REFERENCE`.

### `ProjectDocumentAcceptanceStatus`

`NOT_REQUIRED`, `PENDING`, `ACCEPTED`, `REJECTED`.

## `ProjectDocument`

Registro lógico que representa um documento de negócio ao longo de suas revisões.

| Field | Type | Rules |
|-------|------|-------|
| `id` | cuid | Primary key |
| `projectId` | string | Required; relation to `Project`; restrict delete |
| `type` | enum | Required |
| `title` | string | Required; trimmed; 1–160 chars |
| `description` | string? | Up to 2000 chars |
| `responsibleUserId` | string? | Existing active user when provided |
| `requirementStage` | enum? | Null means informational |
| `acceptanceMode` | enum | Default `NONE` |
| `currentVersionId` | string? | Must belong to this document |
| `version` | integer | Optimistic concurrency; starts at 1 |
| `archivedAt` | datetime? | Null while active |
| `archivedByUserId` | string? | Required when archived |
| `createdByUserId` | string? | Snapshot survives user deletion through nullable relation |
| `updatedByUserId` | string? | Last metadata author |
| `createdAt` | datetime | Automatic |
| `updatedAt` | datetime | Automatic |

Relations: `Project`, current version, all versions, responsible, creation/update/archive users and optional commercial facts that use the document as evidence.

Indexes: `(projectId, archivedAt, type)`, `responsibleUserId`, `currentVersionId`. `currentVersionId` is unique. Service validation prevents a current version from another document.

## `ProjectDocumentVersion`

Registro imutável do conteúdo e de sua procedência. Somente os campos de aceite e o vínculo de assinatura mudam; o conteúdo nunca é sobrescrito.

| Field | Type | Rules |
|-------|------|-------|
| `id` | cuid | Primary key |
| `documentId` | string | Required; cascade with logical document only if project removal is explicitly supported |
| `sequence` | integer | Monotonic per document |
| `versionLabel` | string? | Up to 80 chars, e.g. `Rev. 02` |
| `source` | enum | Required |
| `contentKind` | enum | Required |
| `originalFileName` | string? | Required for managed file |
| `mimeType` | string? | Required for managed file |
| `fileSizeBytes` | integer? | Required and positive for managed file |
| `storagePath` | string? | Internal only; required for managed file |
| `sha256` | string? | 64 lowercase hex chars for managed file |
| `externalId` | string? | Required for CRM source |
| `externalUrl` | string? | HTTP(S); reference may be considered inaccessible when absent/invalid |
| `sourceVersion` | string? | Required for CRM source |
| `sourceUpdatedAt` | datetime? | Ordering instant from source |
| `lastSyncedAt` | datetime? | Set on CRM processing |
| `signatureDocumentId` | string? | Unique optional relation to `SignatureDocument` |
| `acceptanceStatus` | enum | `NOT_REQUIRED` for mode NONE; otherwise starts `PENDING` |
| `acceptanceOccurredOn` | date? | Business date of acceptance/rejection |
| `acceptanceReference` | string? | Up to 500 chars |
| `acceptanceNote` | string? | Up to 2000 chars |
| `acceptanceRecordedAt` | datetime? | System timestamp |
| `acceptanceRecordedByUserId` | string? | Actor for manual decision |
| `createdByUserId` | string? | Actor for manual/system creation |
| `createdAt` | datetime | Automatic |

Constraints and indexes:

- unique `(documentId, sequence)`;
- unique `(documentId, source, sourceVersion)` when a source version exists;
- unique `signatureDocumentId` when present;
- index `(documentId, createdAt)` and `(source, externalId, sourceUpdatedAt)`;
- exactly one content shape: managed file fields or external reference fields;
- versions with source `CRM` cannot be edited by user actions.

## Existing entity changes

### `Project`

Add `documents ProjectDocument[]`.

### `ProjectWorkflowCommercialFact`

Add optional `evidenceDocumentId` and relation to `ProjectDocument`. The evidence document must belong to the same project and have a current accessible version. This link does not alter `status`, `occurredOn` or other CRM provenance fields.

### `SignatureDocument`

Add optional inverse relation to one `ProjectDocumentVersion`. No status, signer, audit or storage field is copied.

### `User`

Add named inverse relations for document responsibility, creation, update, archive and acceptance actors.

## Derived view: `ProjectOperationalDocument`

Not persisted. Returned by aggregation of current modules.

| Field | Meaning |
|-------|---------|
| `id` | Stable source-qualified id |
| `kind` | `RDO` or `TECHNICAL_REPORT` |
| `title` | Display title |
| `status` | Current source status |
| `issuedAt` | Emission date when present |
| `acceptedAt` | Client acceptance/approval when present |
| `sourceRoute` | Authorized application route/download action |

## Readiness calculation

A logical document is ready when all conditions hold:

1. it is active;
2. it has a current version that belongs to it;
3. managed content resolves to a contained file, or external content has a valid accessible reference;
4. `NONE` accepts `NOT_REQUIRED`;
5. `INTERNAL` and `CLIENT` require `ACCEPTED` on the current version;
6. `SIGNATURE` requires a linked `SignatureDocument` with status `CONCLUIDO`.

Only active documents whose `requirementStage` matches the gate are evaluated. Missing rows never create implicit requirements.

## State transitions

### Document

`ACTIVE → ARCHIVED → ACTIVE`. Archiving/restoring increments optimistic `version`. Mutation is forbidden while the project is `FINISHED`.

### Version

`CREATED → CURRENT → SUPERSEDED`. A superseded version is never made current by editing; recovery creates a new version with the desired content.

### Acceptance

- `PENDING → ACCEPTED | REJECTED` for `INTERNAL`/`CLIENT`;
- a correction may change `REJECTED → ACCEPTED` only through a new recorded decision with event history;
- a new current version starts the mode's initial status;
- `SIGNATURE` derives readiness from Assinaturas and does not accept a manual `ACCEPTED` override.

### CRM ordering

An incoming version is current only when its `sourceUpdatedAt` is later than the current external version, or equal with a deterministically greater `sourceVersion`. Equal identity is a replay and updates only `lastSyncedAt`. Older input remains ignored and auditable.

## Authorization matrix

| Action/type | Leader/manager | Commercial | Operations | Admin/RH/QSMS | Assets | Viewer |
|-------------|----------------|------------|------------|---------------|--------|--------|
| View accessible project docs | yes | yes | yes | yes | yes | yes |
| Manage manual commercial proposal/PO/contract | yes | yes | no | no | no | no |
| Manage technical proposal/drawing/spec/evidence | yes | no | yes | no | no | no |
| Manage client requirement/certificate | yes | no | when technical | yes | when equipment-related | no |
| Archive/restore | yes | within type | within type | within type | within type | no |
| Accept internal/client | yes | within type | within type | within type | within type | no |
| Mutate CRM version | no | no | no | no | no | no |

All rows also require the user's existing project visibility. Role matching will reuse the workflow's normalized area/role helpers rather than introduce a new global authorization system.
