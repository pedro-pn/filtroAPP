# Data Model: Relatórios de Manutenção e Produção

## Enumerações

- `ReportType`: acrescenta `RDO_MAINTENANCE` e `RDO_PRODUCTION`.
- `ReportEmissionPermission`: `SITE_RDO`, `MAINTENANCE`, `PRODUCTION`.
- `ChemicalCleaningMaterial`: `CARBON_STEEL`, `STAINLESS_STEEL`, `CUNIFE`, `OTHER`.
- `MaintenanceAttachmentKind`: `PHOTO`, `DOCUMENT`.

## Entidades alteradas

### User

- `reportEmissionPermissions: ReportEmissionPermission[]`, default vazio para contas novas; formulário administrativo define explicitamente.
- Relações de criação, revisão, configuração e auditoria.
- A migration concede `SITE_RDO` às contas internas/admin existentes com papel interno do RDO; não concede as demais.

### Report

- Aceita os dois tipos novos.
- Relações `maintenanceRecords`, `chemicalCleanings` e `operationalReviewAudits`.
- Colunas atuais de jornada continuam autoritativas.

### CompanyEquipment

- `maintenanceProfileId: String?`, relação opcional com `MaintenanceProfile`.
- Relação com `MaintenanceRecord`.
- Equipamento inativo permanece no histórico, mas não é elegível para criação.

### EquipmentCategory

- `maintenanceIntervalDays: Int?`, intervalo preventivo opcional entre 1 e 3650 dias.
- O intervalo é herdado por todos os equipamentos ativos da categoria e não possui exceção individual.
- `null` significa que a programação da categoria ainda não foi configurada.

## Novas entidades

### MaintenanceProfile

| Campo | Regra |
|---|---|
| id | identificador imutável |
| key | chave única estável |
| name | rótulo editável obrigatório |
| order | inteiro para exibição |
| isActive | controla uso em novos registros |
| createdAt / updatedAt | auditoria temporal |

Relações: muitos itens, equipamentos e registros históricos. Perfil referenciado é desativado, não removido.

### MaintenanceProfileItem

| Campo | Regra |
|---|---|
| id | identificador |
| profileId | pai obrigatório |
| label | serviço obrigatório, até 300 caracteres |
| order | sequência única dentro do perfil |
| isActive | controla seleção futura |

### MaintenanceConfiguration

Singleton de chave `global`: `supervisorCollaboratorId`, `updatedByUserId`, `updatedAt`. O supervisor só é válido com colaborador ativo, conta vinculada ativa e assinatura presente no instante da aprovação.

### MaintenanceRecord

| Campo | Regra |
|---|---|
| id | identificador |
| reportId | nulo para avulsa; obrigatório no cartão 5002 |
| equipmentId | equipamento obrigatório |
| profileId | referência opcional; snapshots são autoritativos |
| maintenanceDate | data herdada ou informada |
| status | PENDING, RETURNED ou APPROVED |
| createdByUserId | responsável imutável |
| reviewedByUserId | ator real da última revisão |
| responsibleNameSnapshot | nome na criação |
| profileNameSnapshot | nome aplicado |
| selectedServices | JSON ordenado `{ itemId?, label, order }`, mínimo 1 |
| observations / reviewNotes | opcionais |
| supervisorNameSnapshot / supervisorSignatureSnapshot | preenchidos ao aprovar |
| approvedAt / returnedAt | datas de transição |
| createdAt / updatedAt | auditoria temporal |

Índices: `(equipmentId, status, maintenanceDate)`, `reportId`, `(status, maintenanceDate)` e `(profileId, status)`.

O histórico consolidado é uma projeção paginada desta entidade, filtrada por `APPROVED`, ordenada por `maintenanceDate`/`createdAt` decrescentes e enriquecida com TAG, nome e categoria do equipamento e anexo `DOCUMENT`; não exige nova persistência.

A programação preventiva também é uma projeção, sem tabela própria: para cada equipamento ativo, seleciona a manutenção `APPROVED` mais recente e soma `EquipmentCategory.maintenanceIntervalDays`. Sem intervalo resulta em `UNCONFIGURED`; com intervalo e sem manutenção aprovada resulta em `NO_HISTORY`; datas anteriores, iguais ou posteriores ao dia corrente resultam respectivamente em `OVERDUE`, `DUE_TODAY` ou `UPCOMING`.

### MaintenanceThirdPartyService

`maintenanceId`, `serviceDate`, `location`, `description`, `order`. Itens ilimitados, ordem preservada.

### MaintenanceAttachment

`maintenanceId`, `kind`, `fileName`, `mimeType`, `storagePath`, `publicToken`, `createdAt`. No máximo 10 fotos e um documento por manutenção; o documento não pode ser removido pelo fluxo comum.

### ChemicalCleaning

`reportId`, `description`, `material`, `otherMaterial`, `quantityKg Decimal(12,3)`, `order`, timestamps. `otherMaterial` é obrigatório somente para `OTHER`; quantidade sempre maior que zero.

### OperationalReviewAudit

`reportId?`, `maintenanceId?`, `actorUserId`, `previousStatus`, `nextStatus`, `notes?`, `createdAt`. A validação exige exatamente um alvo.

## Estados e transições

```text
PENDING ──approve──> APPROVED (terminal no fluxo comum)
PENDING ──return───> RETURNED
RETURNED ─resubmit─> PENDING
RETURNED ─approve──> APPROVED
```

- RDO 5002 sincroniza todos os `MaintenanceRecord` vinculados na mesma transação.
- RDO 5004 altera somente `Report` e nunca cria arquivo/assinatura.
- Manutenção avulsa transiciona o próprio `MaintenanceRecord`.
- Aprovação 5002/avulsa exige supervisor válido e ator supervisor ou ADMIN.
- Aprovação 5004 exige gestor do RDO.
- Retry após transição concluída devolve o estado atual sem criar outro documento.

## Dados fixos e seed

- Assegurar códigos 5002 e 5004 sem sobrescrever cadastro existente.
- Semear UFI, UTH, UFP regular, UFP pneu, UTO, UBP, ULQ regular, ULQ diesel, TRO e CMR.
- Semear os rótulos revisados do formulário Google em ordem estável.
