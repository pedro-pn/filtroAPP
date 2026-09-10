# API Contract: Documentos do projeto

Base path: `/api/efetivo/project-workflow/:projectId/documents`

All endpoints require authentication and project visibility. Mutation endpoints reject finished projects with `409 PROJECT_FINISHED`, enforce the authorization matrix and accept an `expectedVersion` where the logical document can change concurrently.

## Shared representations

### `ProjectDocumentSummary`

```json
{
  "id": "doc_123",
  "projectId": "project_123",
  "type": "CONTRACT",
  "title": "Contrato principal",
  "description": null,
  "responsible": { "id": "user_1", "name": "Pessoa" },
  "requirementStage": "MOBILIZATION",
  "acceptanceMode": "CLIENT",
  "version": 3,
  "archivedAt": null,
  "currentVersion": {
    "id": "ver_2",
    "sequence": 2,
    "versionLabel": "Rev. 01",
    "source": "MANUAL",
    "contentKind": "MANAGED_FILE",
    "originalFileName": "contrato-rev-01.pdf",
    "mimeType": "application/pdf",
    "fileSizeBytes": 123456,
    "sha256": "<64 hex>",
    "externalId": null,
    "externalUrl": null,
    "sourceVersion": null,
    "sourceUpdatedAt": null,
    "signature": null,
    "acceptanceStatus": "PENDING",
    "acceptanceOccurredOn": null,
    "acceptanceReference": null,
    "acceptanceNote": null,
    "acceptanceRecordedAt": null,
    "acceptanceRecordedBy": null,
    "createdAt": "2026-09-10T15:00:00.000Z",
    "createdBy": { "id": "user_1", "name": "Pessoa" },
    "downloadUrl": "/api/efetivo/project-workflow/project_123/documents/doc_123/versions/ver_2/file"
  },
  "readiness": {
    "ready": false,
    "reasonCode": "ACCEPTANCE_PENDING",
    "reason": "O contrato vigente aguarda aceite do cliente."
  },
  "permissions": {
    "update": true,
    "addVersion": true,
    "recordAcceptance": true,
    "prepareSignature": false,
    "archive": true
  }
}
```

Never return `storagePath`. `externalUrl` is returned only when the user may access the document; the frontend labels it “Abrir na origem”.

## GET `/`

Returns the document category payload.

Query:

- `includeArchived`: coerced boolean, default false;
- `includeHistory`: coerced boolean, default false.

Response `200`:

```json
{
  "documents": [],
  "requirements": {
    "HANDOVER": { "ready": true, "blockers": [] },
    "MOBILIZATION": { "ready": false, "blockers": [{ "documentId": "doc_123", "reasonCode": "ACCEPTANCE_PENDING", "reason": "O contrato vigente aguarda aceite do cliente." }] },
    "CLOSEOUT": { "ready": true, "blockers": [] }
  },
  "operationalDocuments": [],
  "projectReadOnly": false,
  "allowedTypes": ["COMMERCIAL_PROPOSAL", "TECHNICAL_PROPOSAL"]
}
```

## POST `/`

Creates a logical document and optionally its first manual version in one transaction boundary plus managed-file rollback.

Request:

```json
{
  "type": "TECHNICAL_PROPOSAL",
  "title": "Proposta técnica",
  "description": "Escopo aprovado para planejamento",
  "responsibleUserId": "user_1",
  "requirementStage": "HANDOVER",
  "acceptanceMode": "INTERNAL",
  "initialVersion": {
    "versionLabel": "Rev. 00",
    "fileName": "proposta-tecnica.pdf",
    "dataUrl": "data:application/pdf;base64,..."
  }
}
```

Response `201`: `{ "document": ProjectDocumentSummary, "workflowVersion": 4 }`.

## PATCH `/:documentId`

Updates logical metadata. CRM content provenance is untouched.

Request:

```json
{
  "expectedVersion": 3,
  "title": "Contrato principal",
  "description": null,
  "responsibleUserId": "user_2",
  "requirementStage": "MOBILIZATION",
  "acceptanceMode": "SIGNATURE"
}
```

Response `200`: `{ "document": ProjectDocumentSummary, "workflowVersion": 5 }`.

## POST `/:documentId/versions`

Adds a new manual managed version and makes it current. Only one content input is accepted per call.

Request:

```json
{
  "expectedVersion": 3,
  "versionLabel": "Rev. 02",
  "fileName": "contrato-rev-02.pdf",
  "dataUrl": "data:application/pdf;base64,..."
}
```

Response `201`: `{ "document": ProjectDocumentSummary, "workflowVersion": 5, "authorizationInvalidated": true }`.

## GET `/:documentId/versions`

Returns immutable history newest first, including acceptance and signature summary. Response `200`: `{ "versions": [] }`.

## GET `/:documentId/versions/:versionId/file`

Streams a managed file after checking authentication, project visibility, document/version ownership and path containment. Uses safe inline disposition for PDF/images and attachment for other allowlisted formats. Returns `404` for missing/inaccessible content without exposing filesystem details.

## POST `/:documentId/acceptance`

Records a decision for the current version. Rejects mode `NONE` and `SIGNATURE`.

Request:

```json
{
  "expectedVersion": 3,
  "versionId": "ver_2",
  "status": "ACCEPTED",
  "occurredOn": "2026-09-10",
  "reference": "Aceite por e-mail do cliente",
  "note": null
}
```

Response `200`: `{ "document": ProjectDocumentSummary, "workflowVersion": 5 }`.

## POST `/:documentId/signature`

Creates and links a draft in the existing Assinaturas module from the current managed PDF. It is idempotent while a non-canceled linked document exists.

Request: `{ "expectedVersion": 3, "versionId": "ver_2" }`.

Response `201` or `200`:

```json
{
  "signatureDocumentId": "signature_1",
  "status": "RASCUNHO",
  "openUrl": "/assinaturas?doc=signature_1"
}
```

## POST `/:documentId/archive` and POST `/:documentId/restore`

Request: `{ "expectedVersion": 3 }`.

Response `200`: `{ "document": ProjectDocumentSummary, "workflowVersion": 5, "authorizationInvalidated": true }`.

## Internal CRM adapter contract

No public webhook is added. `upsertCrmProjectDocument(prisma, input)` receives validated internal input:

```json
{
  "projectId": "project_123",
  "type": "PURCHASE_ORDER",
  "title": "Pedido de compra 450001",
  "externalId": "crm-document-55",
  "externalUrl": "https://crm.example/documents/55",
  "sourceVersion": "4",
  "sourceUpdatedAt": "2026-09-10T15:00:00.000Z",
  "versionLabel": "Rev. 04"
}
```

Outcomes: `CREATED`, `CURRENT_UPDATED`, `REPLAYED`, `IGNORED_OLDER`. Only `CREATED` and `CURRENT_UPDATED` may alter document readiness. The adapter never sets a commercial fact to `CONFIRMED` unless a future, separate fact event explicitly carries that status.

## Error contract

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | Invalid enum, date, URL, file or inconsistent content shape |
| 401 | `UNAUTHENTICATED` | No valid session |
| 403 | `PROJECT_DOCUMENT_FORBIDDEN` | No project visibility or type/action permission |
| 404 | `PROJECT_DOCUMENT_NOT_FOUND` | Project, document, version or file unavailable |
| 409 | `PROJECT_DOCUMENT_VERSION_CONFLICT` | `expectedVersion` is stale |
| 409 | `PROJECT_FINISHED` | Mutation requires reopening the project |
| 409 | `CRM_DOCUMENT_READ_ONLY` | User attempted to mutate CRM content |
| 409 | `SIGNATURE_NOT_ELIGIBLE` | Current version is not an eligible managed PDF |
| 413 | `PROJECT_DOCUMENT_TOO_LARGE` | File exceeds configured limit |
| 415 | `PROJECT_DOCUMENT_TYPE_UNSUPPORTED` | Extension/MIME/content is not allowlisted |

## Side effects and audit

Every create, metadata change, version addition, acceptance decision, signature link, archive/restore, CRM current-version change and authorization invalidation creates a `ProjectWorkflowEvent` with ids and before/after metadata but never file contents or data URLs. A change that affects mobilization readiness increments `ProjectWorkflow.version`; if authorization was valid for the previous version, it is cleared by the existing invalidation rule.
