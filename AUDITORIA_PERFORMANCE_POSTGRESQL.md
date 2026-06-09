# Auditoria de Performance PostgreSQL

Data: 2026-06-05

## Contexto

O PostgreSQL está hospedado em outro país em relação à aplicação, com latência média estimada de 120 ms por consulta. Nesta condição, o custo de comunicação é parte central da performance: muitas consultas pequenas e repetitivas podem ser piores do que uma consulta maior e bem planejada.

Esta auditoria não propõe mudanças de regra de negócio, retorno de API, estrutura de dados com perda de compatibilidade, remoção de tabelas, remoção de colunas ou exclusão de dados. As recomendações abaixo devem ser validadas em staging com `EXPLAIN ANALYZE` e métricas reais antes de qualquer alteração em produção.

## Resumo executivo

Os principais gargalos encontrados são:

1. N+1 em regras de acesso de cliente a relatórios.
   - Arquivo: `backend/src/routes/resources/reports.js`
   - Funções principais: `canAccessReport`, `canClientSeeReportForAccess`, `projectReportsForClientVisibility`.
   - Impacto estimado: em lote com 20 relatórios, pode haver cerca de 20 consultas extras, equivalendo a aproximadamente 2,4 s apenas em latência de rede.

2. Telas com alto fan-out de endpoints.
   - Arquivos: `frontend/src/pages/gestor/GestorPage.tsx`, `frontend/src/pages/collaborator/NewReportPage.tsx`, `frontend/src/pages/ReportDetailPage.tsx`.
   - Impacto estimado: uma navegação pode disparar 7 a 12 requests, cada um com autenticação e consultas ao banco. Com 120 ms, isso pode representar 840 ms a 1,44 s de latência bruta, antes do processamento e transferência de payload.

3. `GET /reports` carrega muitos dados sem paginação.
   - Arquivo: `backend/src/routes/resources/reports.js`.
   - A rota usa `include` amplo com projeto, operador, autorizados, criador, revisor, colaboradores, serviços, anexos, versões, assinaturas e revisões.
   - Impacto estimado: baixo número de consultas, mas alto volume de dados, ordenação e memória em banco/aplicação.

4. `syncRomaneioCatalog()` faz upserts linha a linha.
   - Arquivo: `backend/src/lib/romaneio-catalog.js`.
   - Chamado antes de criação/edição de romaneio e geração do PDF do catálogo.
   - Impacto estimado: com 100 itens de catálogo/unidades/contadores, pode gerar centenas de operações SQL. A 120 ms por round-trip, isso pode virar dezenas de segundos se não houver batching efetivo.

5. Índices ausentes em FKs usadas por includes frequentes.
   - Tabelas: `ReportService`, `ReportAttachment`, `ClientReportReview`.
   - Impacto estimado: risco de `Seq Scan` ao carregar relações de relatórios, especialmente em listas grandes.

6. Estatísticas agregadas em Node.js.
   - Arquivo: `backend/src/routes/resources/statistics.js`.
   - `/statistics/projects` faz `Project.findMany`, `Report.count` e `Report.findMany`, podendo carregar até 5.000 RDOs com serviços para agregar na aplicação.
   - Impacto estimado: pelo menos 3 round-trips, ou cerca de 360 ms de latência bruta, além de custo de banco, transferência e processamento em Node.

## Gargalos por fluxo

### Relatórios - acesso de cliente e lote

Arquivos:

- `backend/src/routes/resources/reports.js`

Padrão encontrado:

- `canAccessReport()` chama `canClientSeeReportForAccess()`.
- `canClientSeeReportForAccess()` busca todos os relatórios do projeto via `projectReportsForClientVisibility()`.
- Em endpoints de detalhe e PDF, após `canAccessReport()`, há nova consulta para buscar relatórios do projeto e validar `canClientSeeReport()`.
- Em batch download, `assertBatchAccess()` chama `canAccessReport()` para cada relatório selecionado.

Impacto com 120 ms:

- 1 relatório: consulta extra de visibilidade = ~120 ms.
- 20 relatórios: ~20 consultas = ~2,4 s.
- 50 relatórios: ~50 consultas = ~6 s.

Recomendação:

- Criar uma variante de autorização que receba os relatórios do projeto já carregados.
- Em batch, agrupar `projectId`s e carregar visibilidade uma vez por projeto.
- Em detalhe/PDF, evitar a segunda consulta quando `canAccessReport()` já calculou visibilidade.

Risco: Baixo.

Ganho estimado: Alto.

Redução estimada de consultas:

- De N consultas por relatório para 1 consulta por projeto.

Código sugerido, em alto nível:

```js
async function clientVisibilityContextForReports(reports, client = prisma) {
  const projectIds = Array.from(new Set(reports.map(report => report.projectId).filter(Boolean)));
  const projectReports = await client.report.findMany({
    where: {
      projectId: { in: projectIds },
      deletedAt: null,
      project: activeReportProjectWhere()
    },
    include
  });
  const byProjectId = new Map();
  for (const report of projectReports) {
    if (!byProjectId.has(report.projectId)) byProjectId.set(report.projectId, new Map());
    byProjectId.get(report.projectId).set(report.id, report);
  }
  return byProjectId;
}
```

### `GET /reports`

Arquivo:

- `backend/src/routes/resources/reports.js`

Padrão encontrado:

- A rota `GET /reports` não possui paginação.
- O `include` é amplo e carrega relações completas.
- Para cliente, filtra visibilidade em memória após carregar os itens.

Recomendação:

- Introduzir modo paginado opcional, mantendo o comportamento atual por compatibilidade.
- Criar um `select` resumido para listagem e manter `include` completo apenas em detalhe, PDF e edição.
- Para cliente, mover o máximo possível da visibilidade para o `where`, mantendo validação final em memória apenas quando necessário.

Risco: Médio, porque a UI pode depender de campos presentes na listagem.

Ganho estimado: Alto em bases maiores.

Redução de latência:

- Não reduz necessariamente o número de round-trips, mas reduz tempo de execução, payload e memória.

### Estatísticas

Arquivo:

- `backend/src/routes/resources/statistics.js`

Padrão encontrado:

- `/statistics/projects` faz:
  - `project.findMany`
  - `report.count`
  - `report.findMany` com serviços
- A agregação é feita em Node.js.
- Há limite de 5.000 RDOs e 500 relatórios diários.

Impacto com 120 ms:

- 3 consultas sequenciais = ~360 ms de latência mínima.
- O custo real aumenta com leitura dos serviços e transferência de JSON.

Recomendação:

- Manter o endpoint atual por compatibilidade.
- Adicionar cache de resultado por chave de filtros com TTL curto, por exemplo 1 a 5 minutos.
- Avaliar agregações SQL para métricas simples: contagens, somas de minutos, agrupamentos por período.
- Manter parsing de `extraData` em Node quando necessário para compatibilidade com legados.

Risco: Médio.

Ganho estimado: Médio/Alto em dashboards acessados frequentemente.

### Romaneio

Arquivos:

- `backend/src/routes/resources/romaneios.js`
- `backend/src/lib/romaneio-catalog.js`

Padrão encontrado:

- `syncRomaneioCatalog()` é chamado em rotas de catálogo, criação e edição.
- A sincronização faz leitura de arquivo, busca unidades, busca contadores e upserts linha a linha.

Impacto com 120 ms:

- 50 itens podem representar dezenas/centenas de consultas.
- 100 itens podem passar de 12 s de latência bruta se cada upsert gerar round-trip separado.

Recomendação:

- Evitar sincronização completa em toda requisição.
- Rodar sincronização por job, comando administrativo ou cache com versão/hash.
- Usar `createMany`, `updateMany` e diffs em lote quando possível.
- Registrar `syncedAt`/hash em memória ou tabela de controle para impedir sync redundante.

Risco: Médio.

Ganho estimado: Alto em rotas de romaneio.

### EPI

Arquivo:

- `backend/src/routes/resources/epis.js`

Padrão encontrado:

- `GET /epi/collaborators` carrega colaboradores ativos com todos os `epiRecords`, `catalogItem` e `signatureRequest`.
- Isso evita N+1, mas cresce em volume conforme a tabela `EpiRecord` cresce.

Recomendação:

- Avaliar paginação ou filtro de registros arquivados/inativos sem alterar comportamento padrão.
- Adicionar índice composto para listagem por colaborador e ordenação.

Índice sugerido:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "EpiRecord_collaborator_lend_created_idx"
ON "EpiRecord"("collaboratorId", "lendDate" DESC, "createdAt" DESC);
```

Risco: Baixo.

Ganho estimado: Médio.

### Frontend e comunicação aplicação-banco

Arquivos:

- `frontend/src/pages/gestor/GestorPage.tsx`
- `frontend/src/pages/collaborator/NewReportPage.tsx`
- `frontend/src/pages/ReportDetailPage.tsx`
- `frontend/src/hooks/*.ts`

Padrão encontrado:

- `GestorPage` dispara relatórios, rascunhos, projetos ativos, projetos arquivados, colaboradores, usuários internos, usuários clientes, unidades, categorias, manômetros, contadores e pesquisas.
- `NewReportPage` dispara projetos, colaboradores, unidades, manômetros, contadores, opções de inibição e rascunhos.
- Cada request passa por `requireAuth`, que consulta `UserSession` com `user`, `collaborator` e `moduleRoles`.

Impacto com 120 ms:

- 7 requests = ~840 ms de latência bruta.
- 12 requests = ~1,44 s de latência bruta.
- Se algum endpoint executa 2 a 4 consultas, o custo total aumenta rapidamente.

Recomendação:

- Criar endpoint de bootstrap por tela ou módulo.
- Cachear listas de baixa alteração no backend com TTL e invalidação por mutação.
- No frontend, usar `staleTime` maior para dados mestres.

Risco: Baixo/Médio.

Ganho estimado: Alto na experiência de navegação.

## Índices recomendados

Antes de aplicar, validar se os índices já existem no banco real. Preferir `CREATE INDEX CONCURRENTLY` em produção.

### FKs de relatórios

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportService_reportId_idx"
ON "ReportService"("reportId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportAttachment_reportId_idx"
ON "ReportAttachment"("reportId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportAttachment_reportServiceId_idx"
ON "ReportAttachment"("reportServiceId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ClientReportReview_reportId_createdAt_idx"
ON "ClientReportReview"("reportId", "createdAt" DESC);
```

Motivo:

- Relações carregadas com frequência por `include` em `Report`.

Consultas beneficiadas:

- `GET /reports`
- `GET /reports/:id`
- downloads PDF/DOCX
- auditorias e revisões de cliente

Impacto em escrita:

- Pequeno aumento de custo em inserts/updates/deletes nessas tabelas.
- Mais uso de disco.

### Ordenação de relatórios

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_active_project_date_created_idx"
ON "Report"("projectId", "reportDate" DESC, "createdAt" DESC)
WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_active_date_created_idx"
ON "Report"("reportDate" DESC, "createdAt" DESC)
WHERE "deletedAt" IS NULL;
```

Motivo:

- Listagens ordenam por `reportDate DESC, createdAt DESC`.
- Muitas consultas filtram `deletedAt IS NULL`.

Consultas beneficiadas:

- `GET /reports`
- histórico por projeto
- consultas de cliente/colaborador/coordenador com filtros por projeto.

Impacto em escrita:

- Moderado, pois `Report` recebe muitas criações/atualizações.

### Estatísticas

O schema já possui:

- `Report(reportType, status, reportDate)`
- `Report(projectId, reportType, status, reportDate)`

Esses índices ajudam `/statistics/projects`. Validar com `EXPLAIN ANALYZE` se o plano usa estes índices para:

```sql
WHERE "reportType" = 'RDO'
  AND "status" IN ('APPROVED', 'SIGNED')
  AND "reportDate" BETWEEN ... AND ...
  AND "deletedAt" IS NULL
```

Se o filtro `deletedAt IS NULL` for muito seletivo, avaliar índice parcial:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_stats_active_idx"
ON "Report"("projectId", "reportType", "status", "reportDate")
WHERE "deletedAt" IS NULL;
```

Risco:

- Baixo, mas pode duplicar parcialmente índices já existentes. Só aplicar se o plano real justificar.

### EPI

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "EpiRecord_collaborator_lend_created_idx"
ON "EpiRecord"("collaboratorId", "lendDate" DESC, "createdAt" DESC);
```

Motivo:

- `GET /epi/collaborators` carrega registros por colaborador ordenando por `lendDate` e `createdAt`.

Impacto em escrita:

- Pequeno/moderado em criação e atualização de registros EPI.

### Romaneio

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Romaneio_project_date_created_idx"
ON "Romaneio"("projectId", "romaneioDate" DESC, "createdAt" DESC);
```

Motivo:

- `GET /romaneios` filtra por projeto e ordena por `romaneioDate DESC, createdAt DESC`.

Impacto em escrita:

- Pequeno.

### Pesquisas e LGPD

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SatisfactionSurvey_sentAt_idx"
ON "SatisfactionSurvey"("sentAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "DataSubjectRequest_status_createdAt_idx"
ON "DataSubjectRequest"("status", "createdAt" DESC);
```

Motivo:

- Dashboard de pesquisas filtra por ano em `sentAt`.
- Lista LGPD filtra por status e ordena por `createdAt DESC`.

Impacto em escrita:

- Pequeno.

## Consultas com filtros que podem impedir índices

Padrões encontrados:

- `mode: 'insensitive'` em `username`, `email`, `clientEmailPrimary`, `signerEmail`, `emailTo`.
- `contains` com `mode: 'insensitive'` na busca de romaneio.
- Filtros em arrays JSON/array, como `clientEmailCc` e `clientSigners`.

Recomendações:

- Avaliar índices funcionais em `lower(btrim(...))` para buscas frequentes por e-mail/username.
- Para busca textual em romaneio, avaliar extensão `pg_trgm` e índices GIN se a base crescer.
- Para `clientSigners` em JSON, considerar coluna normalizada futura apenas se o custo ficar alto. Não mudar agora sem projeto de compatibilidade.

Exemplos a validar:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_username_lower_idx"
ON "User"(lower(btrim("username")));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Project_clientEmailPrimary_lower_idx"
ON "Project"(lower(btrim("clientEmailPrimary")))
WHERE "deletedAt" IS NULL;
```

Risco:

- Baixo para índice funcional, mas deve ser validado contra as queries geradas pelo Prisma.

## Cache recomendado

### Cache local em memória

Aplicável para:

- `Collaborator`
- `Unit`
- `Manometer`
- `ParticleCounter`
- `Equipment`
- `InhibitionOption`
- `EpiCatalogItem`
- `RomaneioCatalogItem`
- segmentos de cliente/projeto

Estratégia:

- TTL entre 60 e 300 segundos.
- Invalidação explícita em rotas de criação, edição e remoção.
- Manter fallback sem cache em caso de erro.

Risco: Baixo.

### Cache distribuído

Aplicável se houver múltiplas instâncias de backend:

- Redis ou serviço equivalente.
- Cache de dashboards e estatísticas por chave de filtros.
- TTL curto para evitar inconsistência perceptível.

Risco: Médio por dependência operacional.

### Cache de agregações

Aplicável para:

- `/statistics/projects`
- `/statistics/overview`
- `/surveys/dashboard`
- relatório mensal de alocação.

Estratégia:

- Cache por período e filtros.
- Invalidar em criação/alteração de relatório, projeto ou pesquisa.

## EXPLAIN ANALYZE

Gerar planos no banco real, nunca durante pico de produção sem cuidado.

### Relatórios por listagem

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "Report"
WHERE "deletedAt" IS NULL
ORDER BY "reportDate" DESC, "createdAt" DESC;
```

Observar:

- `Seq Scan` em `Report`.
- `Sort Method: external merge`, indicando uso de disco.
- `Rows Removed by Filter`.
- `shared read blocks` alto.

### Serviços por relatório

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "ReportService"
WHERE "reportId" = '<report-id>';
```

Observar:

- Se aparece `Seq Scan`, o índice em `reportId` deve ser priorizado.

### Anexos por relatório/serviço

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "ReportAttachment"
WHERE "reportId" = '<report-id>';

EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "ReportAttachment"
WHERE "reportServiceId" = '<service-id>';
```

### Estatísticas

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "Report"
WHERE "deletedAt" IS NULL
  AND "reportType" = 'RDO'
  AND "status" IN ('APPROVED', 'SIGNED')
  AND "reportDate" >= '<from-date>'
  AND "reportDate" <= '<to-date>'
ORDER BY "reportDate" ASC;
```

Observar:

- Uso de `Report_reportType_status_reportDate_idx`.
- Uso de `Report_projectId_reportType_status_reportDate_idx` quando há filtro por projeto.
- Custo de sort.
- Volume de linhas retornadas.

### EPI

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "EpiRecord"
WHERE "collaboratorId" = '<collaborator-id>'
ORDER BY "lendDate" DESC, "createdAt" DESC;
```

### Romaneio

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "Romaneio"
WHERE "projectId" = '<project-id>'
ORDER BY "romaneioDate" DESC, "createdAt" DESC;
```

## Configuração PostgreSQL

Recomendações compatíveis com produção:

- Usar pooler, como PgBouncer, especialmente com Prisma e banco remoto.
- Definir `connection_limit` na `DATABASE_URL` do Prisma conforme capacidade do banco.
- Manter `max_connections` conservador e controlar concorrência pelo pooler.
- `shared_buffers`: cerca de 25% da RAM do servidor PostgreSQL.
- `effective_cache_size`: 50% a 75% da RAM.
- `work_mem`: começar em 8 MB a 32 MB por operação e ajustar com base em sorts/hash reais.
- `maintenance_work_mem`: 256 MB a 1 GB, conforme RAM disponível, para VACUUM e criação de índices.
- Autovacuum: monitorar tabelas com muitas atualizações/deleções, principalmente `Report`, `ReportService`, `ReportAttachment`, `ReportAuditLog`, `EpiRecord`, `SatisfactionSurvey` e tokens/sessões.
- Habilitar e monitorar `pg_stat_statements`.

Consultas úteis:

```sql
SELECT query, calls, mean_exec_time, total_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

```sql
SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

## Status da implementação

Atualizado em: 2026-06-08, branch `database_performance`.

### Aplicado nesta branch

1. N+1 de autorização de cliente em relatórios.
   - `canAccessReport()` passou a aceitar contexto de visibilidade de cliente já carregado.
   - Batch download de relatórios de cliente passou a carregar a visibilidade uma vez por conjunto de projetos.
   - Endpoints de detalhe e PDF reaproveitam o contexto de visibilidade, evitando a segunda consulta redundante.
   - Teste adicionado: `client report access can reuse preloaded project visibility context`.

2. Índices de performance.
   - Adicionados índices em `ClientReportReview(reportId, createdAt)`, `ReportService(reportId)`, `ReportAttachment(reportId)` e `ReportAttachment(reportServiceId)`.
   - Adicionados índices compostos secundários para `EpiRecord`, `Romaneio`, `SatisfactionSurvey` e `DataSubjectRequest`.
   - Adicionados índices parciais de ordenação para relatórios ativos em `Report(reportDate, createdAt)` e `Report(projectId, reportDate, createdAt)`, ambos com `deletedAt IS NULL`.
   - Migrations criadas:
     - `backend/prisma/migrations/20260605130000_add_report_relation_performance_indexes/`
     - `backend/prisma/migrations/20260605133000_add_secondary_performance_indexes/`
     - `backend/prisma/migrations/20260608100000_add_active_report_order_indexes/`
   - Observação: os índices parciais de `Report` ficam apenas em migration SQL porque o schema Prisma não expressa `WHERE "deletedAt" IS NULL`.

3. Cache local de listas mestres.
   - Implementado cache TTL curto em memória para colaboradores, equipamentos, opções de inibição, manômetros, contadores de partículas, unidades e categorias de unidades.
   - Invalidação explícita adicionada nas mutações dessas listas.
   - Observação: por ser cache em memória, múltiplas instâncias podem ter até 60 segundos de defasagem entre si.

4. Otimização inicial de `syncRomaneioCatalog()`.
   - Chamadas concorrentes agora compartilham a mesma sincronização em andamento.
   - Rotas de romaneio passaram a usar `ensureRomaneioCatalogSynced()` com TTL curto para evitar sync completo a cada requisição.
   - Mutações de unidades e contadores continuam chamando sync forçado para preservar consistência.
   - A sincronização passou a carregar linhas existentes do catálogo em lote, criar novos itens com `createMany(skipDuplicates)` e atualizar apenas itens que mudaram.
   - Adicionado controle persistente por hash das fontes do catálogo em `RomaneioCatalogSyncState`, pulando writes quando arquivo, unidades e contadores não mudaram.
   - Migration criada:
     - `backend/prisma/migrations/20260608103000_add_romaneio_catalog_sync_state/`

5. Observabilidade e pool Prisma.
   - Adicionada configuração opcional `DATABASE_CONNECTION_LIMIT` para anexar `connection_limit` à `DATABASE_URL` quando ainda não configurado.
   - Adicionada configuração opcional `PRISMA_SLOW_QUERY_MS` para logar queries Prisma lentas.
   - Adicionada configuração opcional `SLOW_OPERATION_LOG_MS` para logar operações internas lentas.
   - Logs diretos de timing em `reports.js` foram substituídos por logging controlado por env.

6. Cache de estatísticas.
   - `GET /statistics/projects` passou a usar cache TTL por chave de filtros.
   - A chave considera período, granularidade, status do projeto, papel do usuário, segmento, projetos selecionados e inclusão de relatórios diários.
   - Cache é invalidado em mutações principais de relatórios e projetos.

7. Testes.
   - Suíte backend executada com sucesso: `npm test`.
   - Testes adicionados para configuração de performance, URL do Prisma, logger lento e cache por chave.

8. Paginação opcional em `GET /reports`.
   - Sem `page`/`pageSize`, a rota mantém o retorno legado em array.
   - Com `page` ou `pageSize`, a rota retorna `{ items, pagination }`.
   - Para usuários internos, paginação usa `skip`, `take` e `count` no banco.
   - Para cliente, a paginação preserva o filtro final de visibilidade em memória.
   - API frontend adicionada: `listReportsPage()`, sem alterar `listReports()` nem as telas atuais.

9. `select` resumido opcional em `GET /reports`.
   - Com `summary=true`, a rota usa `select` de listagem em vez do `include` completo.
   - O resumo mantém campos necessários para cards/listas: projeto básico, criador, colaboradores, serviços, assinaturas e revisões de cliente.
   - Relações pesadas como anexos e versões ficam fora do resumo.
   - API frontend `listReportsPage()` aceita `summary`.

10. Base frontend para listagem paginada.
   - Adicionado hook `useReportsPage()` para consumir `listReportsPage()`.
   - Query key separada evita colisão entre cache legado em array e cache paginado.
   - Atualização/remoção de relatórios no cache agora trata tanto arrays legados quanto payloads paginados.

11. Adoção inicial do `select` resumido no frontend.
   - `useReports()` passou a aceitar `summary=true`.
   - `GestorPage`, `CoordinatorPage`, `ClientPage`, `HomePage`, `OngoingServicesPage`, `MyReportsPage` e `MyArchivedReportsPage` passaram a carregar relatórios com payload resumido.
   - `NewReportPage` e `ReportDetailPage` permanecem no payload completo para preservar edição, continuidade, anexos, fotos herdadas, miniaturas e versões.

12. Bootstrap inicial da tela de novo relatório.
   - Criado endpoint `GET /bootstrap/new-report`, também disponível sob `/rdo/bootstrap/new-report`.
   - O endpoint agrega projetos ativos acessíveis, colaboradores, unidades, manômetros, contadores, opções de inibição e rascunhos RDO do usuário.
   - `NewReportPage` passou a consumir esse bootstrap para dados mestres e rascunhos, reduzindo requests iniciais independentes.
   - O hook `useDrafts()` usa os rascunhos do bootstrap como dados iniciais e mantém as mutações atualizando o cache/invalidações existentes.

13. Bootstrap do editor de detalhe de relatório.
   - Criado endpoint `GET /bootstrap/report-detail/:reportId`, também disponível sob `/rdo/bootstrap/report-detail/:reportId`.
   - O endpoint agrega dados mestres do editor, equipamentos e uma lista mínima de relatórios para validação de conflito de sequência.
   - `ReportDetailPage` passou a usar esse bootstrap no editor, removendo requests separados para projetos, colaboradores, equipamentos, unidades, manômetros, contadores, opções de inibição e a lista completa de relatórios.
   - O relatório atual continua sendo carregado pelo endpoint completo de detalhe, preservando anexos, versões, fotos e assinaturas.

14. Bootstrap parcial da `GestorPage`.
   - Criado endpoint `GET /bootstrap/gestor`, também disponível sob `/rdo/bootstrap/gestor`.
   - O endpoint agrega projetos ativos, projetos arquivados, colaboradores, unidades, categorias, manômetros, contadores, pesquisas, segmentos de cliente e perguntas de pesquisa.
   - `GestorPage` passou a consumir esse bootstrap para essas listas, mantendo relatórios, rascunhos e usuários em queries próprias.
   - O endpoint é restrito a `rdo:manager`, pois agrega dados administrativos.

15. Primeira adoção visual da paginação de relatórios.
   - `GET /reports` passou a aceitar filtros opt-in `statuses` e `projectActive`, aplicados antes de `skip/take`.
   - `GET /reports` passou a aceitar filtro opt-in `reportType`, permitindo carregar mais relatórios de um tipo específico dentro do mesmo projeto.
   - `MyReportsPage` passou a usar paginação backend acumulativa com `mine: true`, `summary: true`, `projectActive: true` e status por aba.
   - `MyArchivedReportsPage` passou a usar paginação backend acumulativa com `mine: true`, `summary: true` e `projectActive: false`.
   - A busca textual dessas duas telas é enviada ao backend, evitando filtrar apenas a página carregada.
   - A resposta paginada inclui totais por `projeto + tipo` em `groups`, permitindo saber quais abas ainda têm relatórios antes de clicar no rodapé.
   - A UI usa botão `Carregar mais` no rodapé apenas para buscar projetos ainda não visíveis, mantendo um único agrupamento por projeto.
   - Dentro de cada grupo `projeto + tipo`, há um `Carregar mais` próprio para revelar/carregar somente relatórios daquele projeto e daquele tipo.

16. Busca paginada e adoção no painel do coordenador.
   - `GET /reports` passou a aceitar `search` com filtro textual aplicado antes de `skip/take` para usuários internos.
   - Para clientes, a busca é aplicada depois do cálculo completo de visibilidade para preservar a regra de liberação por RDO assinado.
   - `CoordinatorPage` passou a consumir páginas acumuladas nas abas de pendentes, aprovados e arquivados.
   - As abas de relatórios do coordenador usam filtros de status, atividade do projeto, criador e busca no backend, com botão `Carregar mais`.
   - Como os resultados são acumulados no cliente, cada projeto permanece em um único grupo visual, com carregamento incremental por `projeto + tipo` independente do rodapé.

17. Paginação na `GestorPage`.
   - As abas de relatórios pendentes, aprovados e arquivados passaram a consumir páginas acumuladas com `summary=true`.
   - Criado filtro backend `reviewQueue=true` para a fila de revisão do gestor, incluindo `PENDING`, `RETURNED` e relatórios com reprovação ativa do cliente.
   - A busca textual das abas aprovados e arquivados é enviada ao backend, preservando agrupamento, seleção e download em lote para os relatórios carregados.
   - O resumo da `GestorPage` passou a usar consultas paginadas leves (`pageSize=1`) para contar aprovados e assinados.
   - A UI usa botão `Carregar mais` no rodapé para projetos ainda não visíveis e botão interno por `projeto + tipo` para não dividir a aba do mesmo projeto em páginas diferentes.

18. Paginação na `ClientPage`.
   - `ClientPage` passou a consumir páginas acumuladas com `summary=true`.
   - A busca textual do portal do cliente é enviada ao backend, preservando o cálculo final de visibilidade do cliente no servidor.
   - O total de relatórios usa `pagination.total`; agrupamentos por projeto/tipo, seleção em lote e contagens de aprovados/assinados ficam restritos aos relatórios carregados para evitar consultas extras de visibilidade.
   - A seleção em lote é limpa ao mudar busca, projeto ou tipo de relatório.
   - A UI usa botão `Carregar mais` no rodapé para buscar projetos ainda não visíveis e botão interno na aba ativa para revelar/carregar apenas relatórios daquele projeto e daquele tipo.

19. Validação da `NewReportPage` após bootstrap/paginação.
   - A `NewReportPage` continua sem usar `summary=true` para relatórios de continuidade, preservando `extraData`, anexos, fotos herdadas e miniaturas.
   - Validações executadas: `frontend/test/ongoing-services.test.mjs`, `frontend/test/report-service-payload.test.mjs`, `backend/test/report-upload-attachments.test.js` e `backend/test/rcpu-service-history.test.js` dentro das suítes completas.

### Parcialmente aplicado

1. Cache de listas mestres e bootstrap por tela.
   - Cache de listas mestres foi aplicado.
   - Bootstrap da `NewReportPage` foi aplicado para dados mestres e rascunhos.
   - Bootstrap da `ReportDetailPage` foi aplicado para o editor.
   - Bootstrap parcial da `GestorPage` foi aplicado para listas de apoio.

2. Otimização de `syncRomaneioCatalog()`.
   - TTL e deduplicação concorrente foram aplicados.
   - Controle persistente por hash foi aplicado.
   - Batching de leituras e criação de novos itens foi aplicado.
   - Updates ainda são executados por linha apenas para itens cujo conteúdo mudou, preservando regras de ocultação e reativação.

3. Cache/agregação de estatísticas.
   - Cache TTL do endpoint principal foi aplicado.
   - Agregações SQL/materializações ainda estão pendentes.

4. Paginação e `select` resumido em `GET /reports`.
   - Paginação opcional foi aplicada.
   - `select` resumido opcional foi aplicado.
   - Hook de consumo paginado foi adicionado.
   - Hook de consumo acumulativo foi adicionado para telas agrupadas por projeto.
   - Adoção inicial de `summary=true` foi aplicada nas listagens que não dependem de anexos/versões.
   - Busca textual backend foi adicionada para listagens paginadas.
   - Telas agrupadas por projeto passaram a usar `Carregar mais` acumulativo em vez de paginação numerada, evitando repetir o mesmo projeto em páginas diferentes.
   - Telas agrupadas por projeto/tipo passaram a ter `Carregar mais` interno por grupo.
   - A `ClientPage` mantém agrupamentos e métricas detalhadas no escopo dos relatórios carregados para não multiplicar consultas de visibilidade, com busca textual executada no backend antes da página exibida.

### Pendente pós-Fase 2

1. Acompanhamento de paginação e resumo pelas telas.
   - `MyReportsPage`, `MyArchivedReportsPage`, as abas de relatórios da `CoordinatorPage`, as abas de relatórios da `GestorPage` e a `ClientPage` já usam paginação backend com carregamento acumulativo.
   - Para `ClientPage`, avaliar futuramente facetas/contagens por projeto no backend caso seja necessário recuperar agrupamentos globais sem carregar todos os relatórios no navegador.
   - `NewReportPage` permanece fora do modo resumido para preservar os campos de `extraData` usados para diferenciar serviços pendentes ambíguos.
   - Validação de fotos herdadas, miniaturas e marcadores de UI da `NewReportPage` foi executada nas suítes backend/frontend.
   - O modo resumido não deve ser usado para edição/detalhe quando anexos, versões ou dados completos de fotos de serviços forem necessários.

2. Bootstrap por tela.
   - Avaliar inclusão segura de relatórios, rascunhos e usuários no bootstrap da `GestorPage` sem prejudicar invalidações e permissões.

3. Agregações SQL ou materializações para estatísticas.
   - Migrar métricas simples para agregações no banco quando validado por `EXPLAIN ANALYZE`.
   - Manter parsing de campos legados/JSON em Node quando necessário.

4. Validação operacional dos índices.
   - Rodar `EXPLAIN ANALYZE` em staging/produção antes de confirmar ganho real.
   - Avaliar criação com `CREATE INDEX CONCURRENTLY` em produção para evitar locks longos.

5. Cache distribuído.
   - Avaliar Redis ou equivalente se houver múltiplas instâncias de backend.

6. Busca textual e índices funcionais.
   - Avaliar `pg_trgm` para busca de romaneios.
   - Avaliar índices funcionais para e-mail/username quando os planos reais justificarem.

7. Medição do fluxo de aprovação de relatórios.
   - Instrumentar `PATCH /reports/:id/status` para separar o tempo de carregamento inicial, transação de status, sincronização de relatórios derivados, organização de anexos, preparação de assinatura interna, geração de PDF e enfileiramento/notificação.
   - Usar os logs para diferenciar gargalo de banco (`txMs` próximo do tempo total) de gargalo pós-transação (`ensureInternalSignatureRoundAndNotify`, PDF, anexos ou notificações).
   - Só depois da medição decidir entre reduzir `include`/`select` do fluxo de aprovação, criar índices adicionais, ou mover preparação de assinatura/PDF para processamento assíncrono.

### Impacto do merge da `main`

Atualizado em: 2026-06-05 após merge dos commits:

- `2fd36f4f fix: diferenciar serviços pendentes ambíguos`
- `b517c42f fix: preservar anexos de serviços ao salvar relatório`
- `7bc718ba fix: não persistir fotos antigas ao continuar serviço`
- `9969cae1 fix: preservar fotos herdadas e renumerar relatórios deletados`
- `b7e108ad fix: manter miniaturas de fotos herdadas em serviços continuados`
- `2533a0fd fix: atualizar miniaturas ao organizar fotos de serviços`

Impacto avaliado:

- A implementação de performance não exigiu correção de conflito textual.
- O `include` completo de relatórios continua carregando `services.attachments`, `attachments` e `versions`; portanto os fluxos de detalhe, edição e preservação de anexos continuam usando dados completos.
- O `select` resumido permanece opt-in por `summary=true` e omite anexos/versões apenas para listagem. Ele mantém `extraData`, `serviceType`, `equipment`, `system`, `material`, horários e status de finalização, que são os campos necessários para chaves de continuidade de serviços pendentes.
- Os commits novos da `main` reforçam que `NewReportPage` depende de dados de continuidade de serviços, fotos herdadas e miniaturas. Antes de migrar essa tela para listagem resumida, validar novamente `frontend/test/ongoing-services.test.mjs`, `frontend/test/report-service-payload.test.mjs`, `backend/test/report-upload-attachments.test.js` e `backend/test/rcpu-service-history.test.js`.
- A renumeração de relatórios deletados permanece no caminho de exclusão com dados completos e não conflita com paginação/listagem resumida.

## Ranking final

1. Corrigir N+1 de autorização de cliente em relatórios. Status: aplicado.
   - Ganho: Muito alto.
   - Redução de latência: Muito alta.
   - Risco: Baixo.
   - Facilidade: Média.

2. Adicionar índices FK faltantes em `ReportService`, `ReportAttachment` e `ClientReportReview`. Status: aplicado.
   - Ganho: Alto.
   - Redução de latência: Média.
   - Risco: Baixo.
   - Facilidade: Alta.

3. Cache de listas mestres e bootstrap por tela. Status: parcialmente aplicado.
   - Ganho: Alto.
   - Redução de latência: Alta.
   - Risco: Baixo/Médio.
   - Facilidade: Média.
   - Aplicado: cache TTL de listas mestres, bootstrap de dados mestres e rascunhos da `NewReportPage`, bootstrap do editor da `ReportDetailPage` e bootstrap parcial da `GestorPage`.
   - Pendente: avaliar inclusão de relatórios, rascunhos e usuários no bootstrap da `GestorPage`.

4. Otimizar `syncRomaneioCatalog()`. Status: parcialmente aplicado.
   - Ganho: Alto.
   - Redução de latência: Alta.
   - Risco: Médio.
   - Facilidade: Média.
   - Aplicado: TTL, deduplicação concorrente, hash persistente, leitura em lote e criação em lote com `createMany`.
   - Pendente: avaliar batching adicional de updates se os planos/volume real justificarem.

5. Paginação e `select` resumido em `GET /reports`. Status: parcialmente aplicado.
   - Ganho: Alto em bases grandes.
   - Redução de latência: Média.
   - Risco: Médio.
   - Facilidade: Média.
   - Aplicado: modo paginado opcional, `select` resumido opcional, busca textual backend, filtro `reviewQueue=true`, hook acumulativo e adoção do resumo em telas de listagem do colaborador, coordenador, gestor e cliente.
   - Aplicado: filtro `reportType` e carregamento incremental por `projeto + tipo` nas telas de relatórios agrupados.
   - Pendente: avaliar facetas/contagens globais adicionais para a `ClientPage` se os usuários precisarem navegar por projetos fora da página atual.

6. Cache/agregação SQL para estatísticas. Status: parcialmente aplicado.
   - Ganho: Médio/Alto.
   - Redução de latência: Média/Alta.
   - Risco: Médio.
   - Facilidade: Média/Alta.
   - Aplicado: cache TTL por chave em `/statistics/projects`.
   - Pendente: agregações SQL/materializações.

7. Índices compostos adicionais para EPI, romaneio, pesquisas e LGPD. Status: aplicado.
   - Ganho: Médio.
   - Redução de latência: Média.
   - Risco: Baixo.
   - Facilidade: Alta.

8. Índices parciais de ordenação para relatórios ativos. Status: aplicado.
   - Ganho: Médio/Alto em bases grandes.
   - Redução de latência: Média.
   - Risco: Baixo.
   - Facilidade: Alta.

## Plano de implementação

### Fase 1: baixo risco e alto impacto

- [x] Corrigir N+1 de autorização de cliente.
- [x] Adicionar índices FK faltantes.
- [x] Adicionar índices parciais de ordenação para relatórios ativos.
- [x] Adicionar logs controlados de queries lentas e operações lentas.
- [x] Cachear listas mestres com TTL curto e invalidação em mutações.
- [x] Configurar pool e limites de conexão do Prisma via env.

### Fase 2: melhorias estruturais concluída

- [x] Criar endpoint de bootstrap para dados mestres da `NewReportPage`.
- [x] Criar endpoint de bootstrap parcial para `GestorPage`.
- [x] Criar endpoint de bootstrap para `ReportDetailPage`.
- [x] Introduzir modo paginado em `GET /reports`, mantendo compatibilidade com o modo atual.
- [x] Separar `select` opcional de listagem e `include` completo de detalhe.
- [x] Adicionar API/hook frontend para listagem paginada/resumida.
- [x] Adicionar hook frontend para carregamento acumulativo em telas agrupadas por projeto.
- [x] Migrar telas de listagem para usar `summary=true` sem alterar UX.
- [x] Migrar `MyReportsPage` e `MyArchivedReportsPage` para carregamento acumulativo com `summary=true`.
- [x] Adicionar botão `Carregar mais` em `MyReportsPage` e `MyArchivedReportsPage`.
- [x] Adicionar busca textual backend para listagens paginadas de relatórios.
- [x] Migrar abas de relatórios da `CoordinatorPage` para carregamento acumulativo com `summary=true`.
- [x] Adicionar botão `Carregar mais` nas abas de relatórios da `CoordinatorPage`.
- [x] Migrar abas aprovados/arquivados da `GestorPage` para carregamento acumulativo com `summary=true`.
- [x] Adicionar botão `Carregar mais` nas abas aprovados/arquivados da `GestorPage`.
- [x] Criar filtro backend para pendentes do gestor incluindo reprovação ativa do cliente.
- [x] Migrar aba pendentes da `GestorPage` para carregamento acumulativo com `summary=true`.
- [x] Migrar `ClientPage` para carregamento acumulativo com `summary=true`.
- [x] Substituir paginação numerada por `Carregar mais` nas telas agrupadas por projeto.
- [x] Adicionar `Carregar mais` interno por `projeto + tipo` nas abas de relatórios.
- [x] Adicionar totais por `projeto + tipo` na resposta paginada para exibir o botão interno sem depender do rodapé.
- [x] Fazer o `Carregar mais` do rodapé pular relatórios de projetos já visíveis e buscar apenas novas abas de projeto.
- [x] Garantir que a busca das listagens paginadas consulte o backend em vez de filtrar apenas os itens já carregados.
- [x] Incluir rascunhos no bootstrap da `NewReportPage` sem quebrar autosave/invalidações.
- [x] Validar migração de `NewReportPage` contra serviços pendentes ambíguos, anexos de serviços, fotos herdadas e miniaturas.
- [x] Otimizar `syncRomaneioCatalog()` com controle de versão/hash persistente.
- [x] Otimizar `syncRomaneioCatalog()` com batching/diff de upserts.
- [x] Adicionar índices compostos secundários.
- [x] Adicionar cache TTL de `/statistics/projects`.

### Fase 3: otimizações avançadas

- [ ] Medir o fluxo de aprovação de relatórios com logs segmentados em `PATCH /reports/:id/status`.
- [ ] Avaliar, com base na medição, se a aprovação precisa de otimização SQL, redução de `include`/`select`, ou fila/background para preparação de assinatura/PDF.
- [ ] Validar uso real dos índices com `EXPLAIN ANALYZE` em staging/produção.
- [ ] Migrar métricas simples de estatísticas para agregações SQL quando validado.
- [ ] Migrar parte das estatísticas para agregações SQL ou materializações.
- [ ] Avaliar Redis para cache distribuído se houver múltiplas instâncias.
- [ ] Avaliar `pg_trgm` para buscas textuais de romaneio.
- [ ] Avaliar particionamento apenas se tabelas como `Report`, `ReportAuditLog`, `EpiRecord` ou `SatisfactionSurvey` chegarem a milhões de linhas e os planos reais indicarem benefício.

## Validação de segurança

As recomendações acima:

- Não removem dados.
- Não removem colunas.
- Não removem tabelas.
- Não alteram regras de negócio.
- Não exigem alteração de retorno de API como requisito imediato.
- Priorizam índices, cache, batching e redução de round-trips.

Qualquer mudança de paginação, bootstrap ou cache deve ser implementada preservando os endpoints existentes até a UI ser adaptada e validada.
