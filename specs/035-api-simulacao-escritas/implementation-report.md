# Relatório de implementação — simulação das escritas

Data: 2026-10-29. Implementação local; sem deploy ou alteração de credenciais em produção.

## Resultado

As cinco escritas suportam `Prefer: validate-only` e o modo obrigatório por
credencial `SIMULATE`. A escrita executa os serviços existentes com um cliente
transacional comum, projeta `would` e provoca rollback antes de responder HTTP
200. Transações internas reutilizam esse cliente. Conflitos que exigem retry
reiniciam a transação inteira, sem repetir queries em transação abortada.

LIVE continua usando os serviços e respostas anteriores. Credenciais existentes
recebem LIVE pelo default da migração. Logs usam `ApiRequestLog.simulated`, fora
do rollback; cotas e último uso são preservados como metadados operacionais.
Erros anteriores ao executor também recebem a preferência e rastreamento quando
a credencial é identificada. JSON e Content-Type inválidos reconhecem SIMULATE
antes do parser. CORS permite Prefer e expõe Preference-Applied.

## Efeitos verificados por rota

| POST | Escritas internas examinadas | Efeitos fora do banco |
|---|---|---|
| `/qualidade/registros` | QualityRecord, QualityRecordSeq, IntegrationQualityReceipt; gatilhos de QualityRecordAuditLog, IntegrationEvent e IntegrationEventSequence | Não chama e-mail, filesystem, jobs, agendamentos, serviços externos ou pós-commit. |
| `/acompanhamento/oportunidades` | CrmOpportunity, CrmOpportunityEvent, CrmPlanningReceipt, CrmOpportunityLinkEvent, CrmProjectMapping; fechamento pode criar Project, ClientSegment e aplicar defaults | Invalidações de cache de projetos/defaults são suprimidas somente no contexto da simulação. Nenhum e-mail, arquivo, job, agendamento ou chamada externa. |
| `/efetivo/projetos` | Project, ClientSegment e ProjectBudget; seleção da revisão pode ajustar CommercialAppProposal. Propostas são lidas do staging local | Invalidações de cache suprimidas na simulação. Não lê arquivo Access nem consulta ComercialAPP, Omie, ZapSign ou Prisma CRM; nenhum e-mail/job/agendamento. |
| `/efetivo/projetos/:id/fatos-comerciais` | ProjectWorkflowCommercialFact, ProjectWorkflow e ProjectWorkflowEvent, inclusive versão e invalidação da autorização de mobilização | Nenhum e-mail, arquivo, cache, job, agendamento, chamada externa ou pós-commit. |
| `/efetivo/projetos/:id/documentos` | ProjectDocument, ProjectDocumentVersion, ProjectWorkflow e ProjectWorkflowEvent, inclusive replay e invalidação da autorização de mobilização | Envia referência EXTERNAL_REFERENCE. Não baixa, grava ou move arquivos; não prepara assinaturas, chama ZapSign, envia e-mail, agenda ou enfileira tarefas. |

O teste genérico compara conteúdo e contagem de **179 tabelas de domínio**, de
um schema PostgreSQL completo com 183 tabelas. Inclui NotificationEvent, todas as
tabelas de jobs, feed, contador do feed, sequência da Qualidade, auditorias e
recibos. Exclui apenas ApiRequestLog, ApiUsageBucket, ApiCredential e
ApiCredentialEvent, metadados administrativos deliberadamente persistentes.
Espiões de filesystem e fetch detectam tentativas de escrita de arquivos e
chamadas externas. O teste também verifica que o cache permanece preenchido.

Não há rota atual com simulação incompleta. Operações sem suporte declarado são
recusadas com `501 SIMULATION_NOT_SUPPORTED`, sem executar a escrita. O gate de
arquitetura exige registro, executor e caso na matriz para novas escritas.

## Testes e validação

- `backend/test/api-write-simulation.test.js`: matriz das cinco operações por
  cabeçalho e por credencial; invariância de todas as tabelas e caches; LIVE
  persistindo após simulação com a mesma chave; replays reais; ausência de IDs
  temporários; 422 do responsável, 409 de chave real conflitante, 400, 403 e 429;
  JSON/Content-Type inválidos; falha após escrita com rollback; modo auditado,
  conflito de versão, rotação e escopo Omni; recusa 501 e retries integrais.
- `backend/test/helpers/api-simulation-db.js`: PostgreSQL WASM/PGlite descartável,
  Prisma e schema completos, gatilhos reais do feed/auditoria e execução da nova
  migração. Não utiliza o banco configurado na aplicação.
- `backend/test/api-openapi-contract.test.js`: parâmetros Prefer e confirmação
  simulada em sucesso/erro para todas as escritas. O teste legado de escrita do
  Playground agora solicita LIVE explicitamente.
- `frontend/test/admin-api-write-simulation.test.mjs`: padrão SIMULATE em todas as
  escritas, LIVE explícito, cURL copiado preservando Prefer e Idempotency-Key,
  rotação preservando SIMULATE e campanha com expiração global de dez dias.
- `npm run architecture:check`: passou. Testes negativos comprovam a rejeição de
  escrita sem declaração, sem caso ou fora do executor transacional.
- Backend `npm test`: **2.526 passaram, 0 falhas, 35 ignorados**. Os ignorados são
  integrações preexistentes que exigem URLs de bancos externos específicos; todos
  os cenários novos de simulação executaram no banco descartável.
- Frontend `npm test`: **854 passaram, 0 falhas**; lint e build passaram.
- Validação adicional com PostgreSQL 16 nativo descartável: todas as migrações
  aplicadas e **20 testes do PrismaCRM passaram**. O cenário do Playground
  confirma HTTP 200 simulado, ausência de oportunidade/recibo persistido e
  gravação HTTP 201 com LIVE explícito para o mesmo evento. Esse teste foi
  atualizado durante a execução do CI, pois ainda pressupunha escrita padrão.
- `git diff --check`: passou.

A suíte local sem integrações específicas usa `NODE_ENV=test` e DATABASE_URL
fictícia, em porta sem banco, para satisfazer a validação de configuração. A
validação adicional do CRM e das migrações usa PostgreSQL 16 em container
descartável. Nenhum banco da aplicação foi acessado.

## Exemplos fictícios

Todas as respostas de sucesso abaixo usam HTTP 200 e o cabeçalho
`Preference-Applied: validate-only`. São recortes de `would`; os campos adicionais
allowlisted são mostrados na documentação da API e no console.

```json
{"simulated":true,"operation":"quality.records.create","would":{"type":"DESVIO","status":"EM_TRIAGEM","projectCode":"05776","actionOwnerUserId":"usuario-existente-ficticio","eventDate":"2026-10-29","previewNumber":"D-001/26"},"warnings":[],"requestId":"exemplo-qualidade"}
```

```json
{"simulated":true,"operation":"efetivo.projects.create","would":{"outcome":"created","code":"05776","registrationPending":true,"clientSegment":"naval"},"warnings":[],"requestId":"exemplo-projeto"}
```

```json
{"simulated":true,"operation":"efetivo.projects.document.post","would":{"outcome":"CREATED","type":"CONTRACT","title":"Contrato fictício","version":{"source":"CRM","contentKind":"EXTERNAL_REFERENCE","externalId":"crm-ficticio","sourceVersion":"1"}},"warnings":[],"requestId":"exemplo-documento"}
```

## Migração e ativação

A migração `20261029120000_api_write_simulation` cria ApiWriteMode, adiciona
ApiCredential.writeMode e ApiRequestLog.simulated. Também corrige o gatilho de
workflow legado que referenciava `NEW.id`: ProjectWorkflow usa projectId como
identificador e não tem coluna id. Os testes com o schema real detectaram e
validaram a correção em inserções e atualizações.

Aplicar a migração e publicar backend/frontend pelo processo normal do ambiente.
Depois, em Administração → Tokens de API, definir **Omni – desenvolvimento** como
SIMULATE. Caso falte `qualidade.registros.create`, usar rotação para conceder o
escopo e manter SIMULATE na substituta. Não houve alteração automática desse
token nem liberação de escopos para credenciais existentes.
