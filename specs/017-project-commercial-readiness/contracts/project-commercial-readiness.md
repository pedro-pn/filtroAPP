# API contract: prontidão comercial

## Papel

`efetivo:commercial` dá acesso de leitura ao módulo e `canEditCommercial: true`. Não concede `canEdit`, `canAcceptHandover`, início de gestão, troca de líder ou mudança de etapa.

## `GET /api/efetivo/project-workflow`

Cada item passa a incluir:

```json
{
  "commercialReadiness": {
    "status": "NOT_RELEASED",
    "resolvedCount": 3,
    "totalCount": 8,
    "blockedOperations": ["PURCHASE", "HIRING", "MOBILIZATION"]
  }
}
```

A lista não devolve referências ou observações comerciais.

## `GET /api/efetivo/project-workflow/:projectId`

Acrescenta os fatos normalizados, `commercialReadiness`, `transitionOptions` e `permissions.canEditCommercial`. Fatos CRM incluem metadados externos e `readOnly: true`.

## `PATCH /api/efetivo/project-workflow/:projectId`

Nova ação manual:

```json
{
  "version": 4,
  "action": "commercial_fact",
  "key": "CONTRACT_SIGNED",
  "status": "NOT_APPLICABLE",
  "reference": null,
  "note": "Atendimento coberto pelo pedido de compra",
  "occurredOn": null
}
```

Regras:

- O corpo é estrito e não aceita `source`, `externalId`, `externalUrl`, `sourceVersion`, `sourceUpdatedAt` ou `lastSyncedAt`.
- `CONFIRMED` exige `occurredOn` e a evidência definida pelo catálogo.
- `NOT_APPLICABLE` só é permitido nos fatos aplicáveis e exige `note`.
- Fato persistido com `source: CRM` retorna conflito `409 PROJECT_WORKFLOW_CRM_FACT_READ_ONLY`.
- Versão divergente retorna o conflito otimista já existente.
- Sucesso incrementa a versão, registra o evento e devolve o detalhe recalculado.

## Integração futura

Nenhuma rota externa é criada. O adaptador futuro deve chamar um serviço interno idempotente autenticado, usando `[projectId, key]` e `sourceVersion`, e nunca reutilizar o PATCH de usuário.

