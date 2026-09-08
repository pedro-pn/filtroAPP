# API Contract: Relatórios de Manutenção e Produção

Base: `/api/rdo/operational-reports` (também no alias legado sem `/rdo`). Todos os endpoints exigem autenticação.

## Contexto

### `GET /context`

Retorna permissões, capacidades de revisão, supervisor e projetos fixos.

```json
{
  "permissions": ["SITE_RDO", "MAINTENANCE"],
  "canReviewMaintenance": false,
  "canReviewProduction": false,
  "maintenanceSupervisor": { "id": "...", "name": "...", "valid": true },
  "projects": {
    "maintenance": { "id": "...", "code": "5002", "name": "Manutenção" },
    "production": { "id": "...", "code": "5004", "name": "Produção" }
  }
}
```

## RDOs internos

### `GET /`

Filtros: `kind=MAINTENANCE|PRODUCTION`, `status`, `mine`, `from`, `to`, `page`, `pageSize`. A resposta é restringida ao criador, supervisor ou papéis gerenciais aplicáveis.

### `POST /`

```json
{
  "kind": "MAINTENANCE",
  "reportDate": "2026-09-03",
  "arrivalTime": "07:00",
  "departureTime": "17:00",
  "lunchBreak": "12:00-13:00",
  "collaboratorIds": ["collab-id"],
  "nightShift": { "enabled": false, "arrivalTime": "", "departureTime": "", "breakTime": "", "collaboratorIds": [] },
  "overtimeReason": null,
  "dailyDescription": "Atividades do dia",
  "maintenanceRecords": [],
  "chemicalCleanings": []
}
```

- `MAINTENANCE`: ao menos uma manutenção e nenhuma limpeza.
- `PRODUCTION`: ao menos uma limpeza e nenhuma manutenção.
- Projeto, criador, estado, contagem e cálculo de horas são autoritativos no servidor.
- Resposta `201`; erros `400` validação, `403` permissão, `409` conflito.

### `GET /:id`

Retorna cabeçalho, colaboradores por turno, jornada calculada, itens, estado e auditoria autorizada.

### `PUT /:id`

Mesmo shape de criação sem `kind`; criador/ADMIN enquanto PENDING ou RETURNED.

### `PATCH /:id/status`

Payload `{ "status": "APPROVED", "reviewNotes": null }`. Para 5002, a aprovação é unitária com os cartões e gera um PDF por manutenção. Para 5004, não gera arquivo.

## Manutenção avulsa

### `POST /maintenance`

```json
{
  "maintenanceDate": "2026-09-03",
  "equipmentId": "equipment-id",
  "selectedServiceIds": ["profile-item-id"],
  "observations": "Opcional",
  "thirdPartyServices": [
    { "serviceDate": "2026-09-03", "location": "Oficina", "description": "Usinagem" }
  ],
  "photos": [
    { "fileName": "foto.jpg", "mimeType": "image/jpeg", "dataUrl": "data:image/jpeg;base64,..." }
  ]
}
```

Exige `MAINTENANCE`, exatamente um equipamento e no máximo 10 fotos.

- `GET /maintenance`: filtra status, mine, equipmentId e período.
- `GET /maintenance/:id`: retorna registro, terceiros, anexos e auditoria autorizada.
- `PUT /maintenance/:id`: atualiza pendente/devolvida; aceita novas fotos e IDs de fotos removidas.
- `PATCH /maintenance/:id/status`: supervisor global ou ADMIN aprova/devolve; PDF sempre usa o supervisor global.
- `GET /maintenance/:id/document`: somente aprovado; PDF inline com nome seguro.

### Histórico consolidado de manutenção

`GET /maintenance/history?q=&page=1&pageSize=20&sortBy=maintenanceDate&sortDirection=desc` retorna somente manutenções `APPROVED`, de qualquer origem, para usuários com permissão/capacidade de manutenção. `sortBy` aceita `maintenanceDate`, `tag`, `equipment`, `category` e `responsible`; `sortDirection` aceita `asc` ou `desc`. A ordenação ocorre antes da paginação. A rota deve ser declarada antes de `/:id`.

```json
{
  "items": [
    {
      "id": "maintenance-id",
      "maintenanceDate": "2026-09-04",
      "equipment": { "id": "...", "code": "UFI 001", "name": "Unidade ...", "category": "UFI" },
      "profileName": "UFI",
      "responsibleName": "Colaborador",
      "selectedServices": [{ "label": "Pintura", "order": 1 }],
      "hasDocument": true
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

`q` busca sem distinção de caixa por TAG/código, nome do equipamento e categoria. O download continua usando `GET /maintenance/:id/document`; item sem documento retorna `hasDocument: false` e não oferece link na interface.

### Programação preventiva

`GET /maintenance/schedule?q=&categoryId=&status=&page=1&pageSize=50` exige `MAINTENANCE`. `status` aceita `OVERDUE`, `DUE_TODAY`, `UPCOMING`, `NO_HISTORY` e `UNCONFIGURED`.

```json
{
  "items": [{
    "equipment": { "id": "...", "code": "UFI 001", "name": "Unidade" },
    "category": { "id": "...", "name": "UFI", "maintenanceIntervalDays": 30 },
    "lastMaintenanceId": "...",
    "lastMaintenanceDate": "2026-08-01",
    "nextMaintenanceDate": "2026-08-31",
    "status": "OVERDUE",
    "daysUntilDue": -4
  }],
  "categories": [{ "id": "...", "name": "UFI", "maintenanceIntervalDays": 30 }],
  "summary": { "total": 1, "OVERDUE": 1, "DUE_TODAY": 0, "UPCOMING": 0, "NO_HISTORY": 0, "UNCONFIGURED": 0 },
  "pagination": { "page": 1, "pageSize": 50, "total": 1, "totalPages": 1 },
  "referenceDate": "2026-09-04"
}
```

A última manutenção ignora estados `PENDING`/`RETURNED`; o dia de referência usa `America/Sao_Paulo`.

## Configuração em Equipamentos

- `GET /api/equipamentos/maintenance/config`: supervisor, elegibilidade, candidatos autorizados e perfis/itens.
- `PUT /api/equipamentos/categories/:id`: aceita `maintenanceIntervalDays` inteiro de 1 a 3650 ou `null`, além dos campos atuais; gestor de Equipamentos.
- `PUT /api/equipamentos/maintenance/config`: `{ "supervisorCollaboratorId": "..." }`; gestor de Equipamentos.
- `POST /api/equipamentos/maintenance/profiles`: `{ "name": "Novo perfil", "items": ["Serviço A"] }`.
- `PUT /api/equipamentos/maintenance/profiles/:id`: nome, ordem, estado e itens ordenados.
- `DELETE /api/equipamentos/maintenance/profiles/:id`: desativa com vínculo/histórico; remove apenas sem referência.
- `GET /api/equipamentos/:id/maintenance-history`: somente APPROVED, data decrescente, com documento.

Supervisor exige colaborador ativo, conta vinculada ativa e assinatura. Rótulos vazios/duplicados de perfil são rejeitados.

## Contas

`GET/POST/PUT /api/admin/accounts` lê/escreve `reportEmissionPermissions: ["SITE_RDO", "MAINTENANCE", "PRODUCTION"]`. CLIENT aceita somente lista vazia; valor desconhecido retorna `400`.

## Sede

`GET /api/acompanhamento/comercial/sede?from=YYYY-MM-DD&to=YYYY-MM-DD` preserva campos financeiros e adiciona:

```json
{
  "operational": {
    "maintenance5002": {
      "reportCount": 3,
      "maintenanceCount": 8,
      "workedMinutes": 4200,
      "overtimeMinutes": 360,
      "uniqueCollaborators": 5,
      "byProfile": [{ "label": "UFI", "count": 4 }],
      "byEquipment": [{ "equipmentId": "...", "code": "UFI 001", "name": "...", "count": 2 }]
    },
    "production5004": {
      "reportCount": 4,
      "totalKg": 123.45,
      "workedMinutes": 5100,
      "overtimeMinutes": 240,
      "uniqueCollaborators": 7,
      "byMaterial": [{ "material": "CARBON_STEEL", "label": "Aço carbono", "kg": 80 }]
    }
  }
}
```

Somente aprovados do período entram nos totais.
