// Exemplo sintético de planning-1.0, sem dependências do backend.
export const CRM_PLANNING_EXAMPLE = {
  "contractVersion": "planning-1.0",
  "eventId": "2a9b7110-424a-52bc-9266-21726dd866c4",
  "sourceSystem": "prismaCRM",
  "environment": "sandbox",
  "tenantId": "filtrovali",
  "externalId": "deal-synthetic-primary-100",
  "sourceVersion": 1,
  "sourceUpdatedAt": "2026-10-20T09:00:00-03:00",
  "change": {
    "kind": "PLANNING_REQUESTED",
    "occurredAt": "2026-10-20T09:00:00-03:00",
    "reason": "Reservar capacidade preliminar para a negociação.",
    "actor": {
      "id": "user-synthetic-joao",
      "name": "João — exemplo fictício",
      "type": "USER"
    }
  },
  "opportunity": {
    "title": "Serviço industrial — oportunidade principal fictícia",
    "description": "Escopo comercial preliminar para planejamento.",
    "planningRequested": true,
    "planningDecision": {
      "requestedAt": "2026-10-20T09:00:00-03:00",
      "withdrawnAt": null,
      "reason": "Reservar capacidade preliminar para a negociação.",
      "actor": {
        "id": "user-synthetic-joao",
        "name": "João — exemplo fictício",
        "type": "USER"
      }
    },
    "commercialStatus": "OPEN",
    "sourceCommercialStatus": "open",
    "commercialStatusDecision": {
      "occurredAt": null,
      "reason": null,
      "actor": null
    },
    "commercialOwner": {
      "id": "owner-synthetic-1",
      "name": "Vendedor fictício"
    },
    "client": {
      "externalId": "company-synthetic-1",
      "name": "Cliente Exemplo Ltda.",
      "legalName": null,
      "taxId": null
    },
    "proposal": {
      "system": "COMERCIALAPP",
      "id": "proposal-local-synthetic-main-r0",
      "externalId": "proposal-external-synthetic-main-r0",
      "code": "910001",
      "revision": 0,
      "acceptedAt": null
    },
    "scope": {
      "kind": "PRIMARY",
      "primaryOpportunityExternalId": null,
      "primaryProposal": null,
      "additionalProposalId": null,
      "contributionKey": null
    },
    "project": null,
    "location": "Unidade industrial fictícia, Itajaí/SC",
    "value": {
      "amount": "125000.00",
      "currency": "BRL"
    },
    "expectedDates": {
      "closeOn": "2026-11-05",
      "executionStartOn": "2026-11-20",
      "executionEndOn": null
    },
    "closedAt": null,
    "sourceRecordDeleted": false,
    "recordUrl": "https://prismacrm.filtrovali.com.br/#deals?deal=deal-synthetic-primary-100"
  }
};
