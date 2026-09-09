# Data model: prontidão comercial

## `ProjectWorkflowCommercialFact`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `String @id @default(cuid())` | Identidade interna |
| `projectId` | `String` | FK de `ProjectWorkflow`, cascade delete |
| `key` | `String` | Chave do catálogo; única por projeto |
| `status` | `ProjectWorkflowCommercialFactStatus` | `PENDING` por padrão |
| `source` | `ProjectWorkflowCommercialFactSource` | `MANUAL` por padrão |
| `reference` | `String?` | Documento, número, URL legível ou referência comercial |
| `note` | `String?` | Justificativa ou descrição da condição |
| `occurredOn` | `DateTime? @db.Date` | Data civil da confirmação |
| `externalId` | `String?` | Identificador na futura origem CRM |
| `externalUrl` | `String?` | Atalho para consulta na origem |
| `sourceVersion` | `String?` | Versão opaca da origem |
| `sourceUpdatedAt` | `DateTime?` | Data técnica de atualização na origem |
| `lastSyncedAt` | `DateTime?` | Última sincronização bem-sucedida |
| `updatedByUserId` | `String?` | Autor da alteração manual ou técnica |
| `createdAt`, `updatedAt` | `DateTime` | Auditoria Prisma |

Índices: `@@unique([projectId, key])`, `@@index([projectId, status])`, `@@index([source])`, `@@index([updatedByUserId])`.

## Enums

`ProjectWorkflowCommercialFactStatus`: `PENDING`, `CONFIRMED`, `NOT_APPLICABLE`.

`ProjectWorkflowCommercialFactSource`: `MANUAL`, `CRM`.

`ModuleRoleCode`: acrescenta `EFETIVO_COMMERCIAL`.

## Catálogo dos fatos

| Chave | Não aplicável | Confirmação exige |
|---|---:|---|
| `COMMERCIAL_PROPOSAL_CREATED` | não | data e referência |
| `TECHNICAL_PROPOSAL_CREATED` | não | data e referência |
| `PROPOSAL_ACCEPTED` | sim | data e referência |
| `PURCHASE_ORDER_RECEIVED` | sim | data e referência |
| `CONTRACT_SIGNED` | sim | data e referência |
| `COMMERCIAL_REGISTRATION_READY` | não | data e detalhe |
| `MEASUREMENT_TERMS_DEFINED` | não | data e detalhe |
| `BILLING_TERMS_DEFINED` | não | data e detalhe |

Todo `NOT_APPLICABLE` exige `note`. `PENDING` limpa data e não participa da liberação.

## Estados calculados

`commercialReadiness` não é persistido. Contém situação `RELEASED | NOT_RELEASED`, quantidade resolvida, oito fatos normalizados, bloqueadores e operações afetadas. Um `CONFIRMED` incompleto continua bloqueador mesmo quando veio do CRM.

`transitionOptions` não é persistido. Cada item contém destino, permissão e motivos derivados do estado atual.

## Relações e ciclo de vida

- `ProjectWorkflow 1 — N ProjectWorkflowCommercialFact`.
- `User 1 — N ProjectWorkflowCommercialFact` como último autor opcional.
- Excluir a gestão exclui fatos em cascata.
- Reabrir um fato recalcula prontidão sem alterar etapa.
- Mudar o Líder invalida somente o aceite do handover; fatos são preservados.
- Atualização manual usa a versão de `ProjectWorkflow` e grava evento na mesma transação.

