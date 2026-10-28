# Contrato e relatório de entrega — API Omni, Parte 1

Base: `/api/integracoes/v1`. Autenticação Bearer, cotas e política de projetos existentes. **schemaVersion: `1.0`** em todas as respostas: envelope preservado, alterações aditivas. O contrato OpenAPI canônico está em [openapi.yaml](../../015-api-token-playground/contracts/openapi.yaml).

## GET /projetos

Operação `operational.Project.list`, escopo existente `projetos.read`.

Campos atuais preservados: `id`, `createdAt`, `updatedAt`, `code`, `name`, `isActive`, `location`, `clientSegment`, `mobilizationDate`, `demobilizationDate`, `startDate`.

| Campo acrescentado | Tipo | Origem/regra |
| --- | --- | --- |
| clientName | string | Project.clientName |
| clientCnpj | string/null | Project.clientCnpj; normalizado para 14 dígitos; legado inválido/ausente retorna null |
| commercialProposalCode | string/null | Project.commercialProposalCode |
| endDate | datetime/null | Project.endDate, no formato ISO usado nas coleções operacionais |
| includesSaturday | boolean | Project.includesSaturday |
| includesSunday | boolean | Project.includesSunday |
| workdayHours | string | Project.workdayHours, HH:MM |
| weekendWorkdayHours | string | Project.weekendWorkdayHours, HH:MM |
| executedAtHeadquarters | boolean/null | ProjectWorkflow.executedAtHeadquarters; null sem workflow |

Parâmetros preservados: `limit`, `cursor`, `updatedSince`, `snapshotAt`, `projectCode`, `projectId`, `active`. ProjectCode e projectId são mutuamente exclusivos. updatedSince continua associado a Project.updatedAt; alterações somente do workflow exigem reconciliação completa para este campo derivado.

Exemplo fictício: `GET /api/integracoes/v1/projetos?projectCode=05776&limit=100`.

```json
{
  "items": [{
    "id": "project-demo-1",
    "createdAt": "2026-10-01T12:00:00.000Z",
    "updatedAt": "2026-10-20T12:00:00.000Z",
    "code": "05776",
    "name": "Obra de demonstração",
    "isActive": true,
    "location": "Itajaí/SC",
    "clientSegment": "Industrial",
    "mobilizationDate": "2026-10-05T00:00:00.000Z",
    "demobilizationDate": null,
    "startDate": "2026-10-06T00:00:00.000Z",
    "clientName": "Cliente Fictício Ltda.",
    "commercialProposalCode": "1234",
    "endDate": "2026-11-05T00:00:00.000Z",
    "includesSaturday": true,
    "includesSunday": false,
    "workdayHours": "09:00",
    "weekendWorkdayHours": "08:00",
    "clientCnpj": "12345678000195",
    "executedAtHeadquarters": false
  }],
  "page": { "limit": 100, "hasMore": false, "nextCursor": null, "snapshotAt": "2026-10-28T12:00:00.000Z" },
  "generatedAt": "2026-10-28T12:00:00.000Z",
  "schemaVersion": "1.0",
  "requestId": "request-project-demo"
}
```

## GET /projetos/responsaveis

Operação `operational.ProjectResponsible.list`, **novo escopo `projetos.responsaveis.read`**, sensibilidade **PERSONAL**, status **AVAILABLE** no catálogo de Administração → Tokens de API. Independente de projetos.read; a concessão é explícita. Para ampliar o token do Omni, rotacione-o ou emita substituto com esse escopo; o token existente não ganha permissões automaticamente.

Parâmetros: `limit`, `cursor`, `updatedSince`, `snapshotAt`, `projectCode` ou `projectId`.

Campos exatos: `projectId` (string), `projectCode` (string), `role` (LEADER/PLANNER/FIELD_OPERATOR), `userId` (string/null), `collaboratorId` (string/null), `name` (string), `email` (string/null) e `updatedAt` (datetime).

- LEADER = ProjectWorkflow.leaderUserId; PLANNER = ProjectWorkflow.plannerUserId.
- FIELD_OPERATOR = Project.operatorId; userId/email vêm do User ligado ao colaborador; name vem do Collaborator.
- Somente domínio exato `filtrovali.com.br`, confirmado pelo usuário; comparação de domínio ignora maiúsculas e remove espaços externos. E-mail pessoal, ausente ou de subdomínio retorna null. Sem fallback para username ou Collaborator.email.
- Uma linha por papel atribuído, inclusive se uma pessoa tiver dois papéis. Sem workflow, pode haver somente FIELD_OPERATOR. Sem responsáveis, zero linhas. Projetos excluídos não aparecem.
- updatedAt = maior carimbo entre Project e ProjectWorkflow. updatedSince é inclusivo. Ambos os carimbos precisam ser menores ou iguais ao snapshot; a ordenação é `(projectId, role)`, com FIELD_OPERATOR, LEADER e PLANNER nessa ordem.
- Nome/e-mail do cadastro de pessoa pode mudar sem alterar os dois carimbos. Remoções e desvinculações não têm tombstones: faça reconciliação completa periódica, substituindo os papéis atuais por projeto.
- Não saem telefone, CPF, username, papéis do hub, dados de cliente, hashes ou tokens.

Exemplo fictício: `GET /api/integracoes/v1/projetos/responsaveis?projectCode=05776&limit=100`.

```json
{
  "items": [{
    "projectId": "project-demo-1",
    "projectCode": "05776",
    "role": "FIELD_OPERATOR",
    "userId": "user-field-demo",
    "collaboratorId": "collaborator-demo",
    "name": "Pessoa de Campo Fictícia",
    "email": "campo.exemplo@filtrovali.com.br",
    "updatedAt": "2026-10-20T12:00:00.000Z"
  }, {
    "projectId": "project-demo-1",
    "projectCode": "05776",
    "role": "LEADER",
    "userId": "user-leader-demo",
    "collaboratorId": null,
    "name": "Líder Fictício",
    "email": "lider.exemplo@filtrovali.com.br",
    "updatedAt": "2026-10-20T12:00:00.000Z"
  }, {
    "projectId": "project-demo-1",
    "projectCode": "05776",
    "role": "PLANNER",
    "userId": "user-planner-demo",
    "collaboratorId": null,
    "name": "Gestor Fictício",
    "email": null,
    "updatedAt": "2026-10-20T12:00:00.000Z"
  }],
  "page": { "limit": 100, "hasMore": false, "nextCursor": null, "snapshotAt": "2026-10-28T12:00:00.000Z" },
  "generatedAt": "2026-10-28T12:00:00.000Z",
  "schemaVersion": "1.0",
  "requestId": "request-responsibles-demo"
}
```

## GET /efetivo/projetos/status

Operação `efetivo.projects.status.list`, escopo existente `efetivo.projetos.status.read`. Coleção paginada com uma linha por projeto elegível no Efetivo: não excluído, não exclusivo do gestor e fora dos centros de sede. Filtro active vazio inclui ativos e inativos.

Parâmetros: `limit`, `cursor`, `snapshotAt`, `projectCode` ou `projectId`, `active` e `stage` (um código de etapa). Etapas: HANDOVER, INITIAL_ANALYSIS, WAITING_PLANNING, MOBILIZATION_PLANNING, PREPARATION, MOBILIZATION, EXECUTION, DEMOBILIZATION, POST_JOB, FINAL_MEASUREMENT e FINISHED. Stage omitido inclui projetos sem workflow.

**Leitura completa:** não aceita updatedSince nem createdSince. O avanço depende de RDOs, históricos, correções, escopo e avanço manual; workflowVersion não serve como watermark. SnapshotAt fixa o cursor e limita a criação dos projetos, sem congelar gates, vínculos ou avanço. Releia todas as páginas a cada ciclo. Ordem por id.

Campos compartilhados com a consulta individual: `projectId`, `projectCode`, `workflowStarted`, `stage`, `workflowVersion`, `plannedMobilizationDate`, `plannedExecutionStartDate`, `plannedExecutionEndDate`, `fieldCompletionDate`, `demobilizationDate`, `commercialReadiness`, `mobilizationReady`, `closureReady`, `openIssueCount`, `criticalIssueCount`, `progressPercent`, `progressMethod` e `closedAt`.

Somente a coleção acrescenta `commercialExpectedMobilizationDate` (date/null), `commercialExpectedStartDate` (date/null), `commercialExpectedDurationDays` (integer/null) e `actualMobilizationDate` (date/null), todos do ProjectWorkflow.

O endpoint individual `GET /efetivo/projetos/{id}/status` conserva os campos, elegibilidade e envelope atuais. Nenhuma das projeções de status expõe pessoas, textos de pendências, documentos ou valores.

Exemplo fictício: `GET /api/integracoes/v1/efetivo/projetos/status?active=true&stage=EXECUTION&limit=100`.

```json
{
  "items": [{
    "projectId": "project-demo-1",
    "projectCode": "05776",
    "workflowStarted": true,
    "stage": "EXECUTION",
    "workflowVersion": 3,
    "plannedMobilizationDate": "2026-10-05",
    "plannedExecutionStartDate": "2026-10-06",
    "plannedExecutionEndDate": "2026-11-05",
    "fieldCompletionDate": null,
    "demobilizationDate": null,
    "commercialReadiness": "RELEASED",
    "mobilizationReady": true,
    "closureReady": false,
    "openIssueCount": 1,
    "criticalIssueCount": 0,
    "progressPercent": 42,
    "progressMethod": "RDO",
    "closedAt": null,
    "commercialExpectedMobilizationDate": "2026-10-05",
    "commercialExpectedStartDate": "2026-10-06",
    "commercialExpectedDurationDays": 30,
    "actualMobilizationDate": "2026-10-05"
  }],
  "page": { "limit": 100, "hasMore": false, "nextCursor": null, "snapshotAt": "2026-10-28T12:00:00.000Z" },
  "generatedAt": "2026-10-28T12:00:00.000Z",
  "schemaVersion": "1.0",
  "requestId": "request-status-demo"
}
```

## Paginação, cotas e Playground

Os três endpoints mantêm cursor HMAC opaco, vinculado à operação, filtros, política de projetos e snapshot. Reenvie os filtros ao percorrer nextCursor. Mudança de política/filtros, adulteração ou snapshot incompatível invalida o cursor. Limite máximo: menor entre 500 e a cota por página do token; default 100 ou limite menor da credencial. Cotas de requisições/linhas existentes são reservadas e liquidadas pela rota genérica e pelo Playground.

As duas novas operações aparecem no Playground com seus parâmetros e exemplos de URI; `stage=EXECUTION` é um único código. Respostas e cURL usam o mesmo serviço contratado. Falta de escopo retorna 403 INSUFFICIENT_SCOPE; filtro de projeto fora da política retorna 403 PROJECT_NOT_ALLOWED. Não há deploy ou alteração do token nesta entrega.

## Testes adicionados

`backend/test/integration-omni-projects.test.js` cobre:

- Nove campos aditivos, CNPJ normalizado/inválido, workflow ausente e campos excluídos.
- Mapeamento dos três papéis, papéis ausentes, e-mail pessoal/ausente, domínio exato e ausência de fallback.
- Recorte de projetos, exclusão lógica, 403 sem escopo e limite da credencial antes de consulta.
- Cursor entre papéis do mesmo projeto, limite de consultas, assinatura, filtros, política e snapshot.
- updatedSince por alteração somente do projeto ou somente do workflow, igualdade inclusiva e teto do snapshot.
- Status equivalente ao individual, quatro campos adicionais e contrato individual preservado.
- Filtros active/stage/projectCode/projectId, inativos elegíveis e projeto sem workflow.
- Mudança real do avanço por RDO sem mudar workflowVersion/carimbos; rejeição de updatedSince.
- Catálogo AVAILABLE/PERSONAL, descritor do Playground, rotas reais, cotas e auditoria sem PII.

Os testes existentes de OpenAPI, seleções Prisma, API operacional e Playground verificam a nova expansão. As contagens do catálogo foram atualizadas para 41 escopos e 45 operações.

## Resultado da validação

Em 2026-10-28: backend completo com 2.501 testes aprovados, 34 ignorados e zero falhas (2.535 no total); frontend com 848 aprovados e zero falhas. Os testes opcionais que exigem banco dedicado foram ignorados. Os 12 cenários novos Omni, contratos OpenAPI, arquitetura, lint, build do frontend e conferência de whitespace passaram. Os testes do backend usaram URL de banco sintética não conectável para garantir que os doubles não acessassem dados reais.

## Auditoria de siglas

README corrigido para RTP = Relatório de Teste de Pressão; RLQ = Relatório de Limpeza Química; RCPU = Relatório de Contagem de Partículas e Umidade; RLM = Relatório de Limpeza Mecânica; RLF = Relatório de Flushing; RLI = Relatório de Inibição.

Os seis arquivos `Modelos/definitivos/Modelo - {RTP,RLQ,RCPU,RLM,RLF,RLI}.docx` foram inspecionados em leitura: todos os títulos já correspondem às definições confirmadas. Nenhum template foi alterado. A interface `frontend/src/pages/efetivo/components/QualityDocumentModels.tsx` usa os títulos corretos de RCPU e RTP; os demais rótulos encontrados usam siglas ou nomes de serviços, sem título divergente identificado.

Divergência preservada para revisão: `docs/DATABOOK_MAPA_DE_CAMPOS.md:34` descreve RLI como **“Limpeza/Inibição”**; o nome confirmado é **“Relatório de Inibição”**. Na linha 35, RLF aparece como “Flushing (inibição)”, um rótulo de mapeamento do formulário, não o título do documento. Não foi modificado nesta entrega.

Parte 2 registrada em [034-api-omni-fase2/spec.md](../../034-api-omni-fase2/spec.md), somente requisitos e critérios de aceite.
