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

Atualizado em: 2026-06-05, branch `database_performance`.

### Aplicado nesta branch

1. N+1 de autorização de cliente em relatórios.
   - `canAccessReport()` passou a aceitar contexto de visibilidade de cliente já carregado.
   - Batch download de relatórios de cliente passou a carregar a visibilidade uma vez por conjunto de projetos.
   - Endpoints de detalhe e PDF reaproveitam o contexto de visibilidade, evitando a segunda consulta redundante.
   - Teste adicionado: `client report access can reuse preloaded project visibility context`.

2. Índices de performance.
   - Adicionados índices em `ClientReportReview(reportId, createdAt)`, `ReportService(reportId)`, `ReportAttachment(reportId)` e `ReportAttachment(reportServiceId)`.
   - Adicionados índices compostos secundários para `EpiRecord`, `Romaneio`, `SatisfactionSurvey` e `DataSubjectRequest`.
   - Migrations criadas:
     - `backend/prisma/migrations/20260605130000_add_report_relation_performance_indexes/`
     - `backend/prisma/migrations/20260605133000_add_secondary_performance_indexes/`

3. Cache local de listas mestres.
   - Implementado cache TTL curto em memória para colaboradores, equipamentos, opções de inibição, manômetros, contadores de partículas, unidades e categorias de unidades.
   - Invalidação explícita adicionada nas mutações dessas listas.
   - Observação: por ser cache em memória, múltiplas instâncias podem ter até 60 segundos de defasagem entre si.

4. Otimização inicial de `syncRomaneioCatalog()`.
   - Chamadas concorrentes agora compartilham a mesma sincronização em andamento.
   - Rotas de romaneio passaram a usar `ensureRomaneioCatalogSynced()` com TTL curto para evitar sync completo a cada requisição.
   - Mutações de unidades e contadores continuam chamando sync forçado para preservar consistência.

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

### Parcialmente aplicado

1. Cache de listas mestres e bootstrap por tela.
   - Cache de listas mestres foi aplicado.
   - Endpoints de bootstrap por tela ainda não foram criados.

2. Otimização de `syncRomaneioCatalog()`.
   - TTL e deduplicação concorrente foram aplicados.
   - Controle persistente por versão/hash e batching real de upserts ainda estão pendentes.

3. Cache/agregação de estatísticas.
   - Cache TTL do endpoint principal foi aplicado.
   - Agregações SQL/materializações ainda estão pendentes.

4. Paginação e `select` resumido em `GET /reports`.
   - Paginação opcional foi aplicada.
   - `select` resumido opcional foi aplicado.
   - Hook de consumo paginado foi adicionado.
   - Adaptação visual das telas para paginação ainda está pendente.

### Pendente

1. Adoção de paginação e resumo pelas telas.
   - `GestorPage`, `CoordinatorPage`, `ClientPage` e listagens de colaborador ainda usam o modo legado.
   - Falta migrar gradualmente para `useReportsPage({ page, pageSize, summary: true })`.
   - Ao migrar `NewReportPage`, preservar os campos de `extraData` usados para diferenciar serviços pendentes ambíguos.
   - Ao migrar `NewReportPage`, validar fotos herdadas, miniaturas e marcadores de UI removidos do payload de serviços.
   - O modo resumido não deve ser usado para edição/detalhe quando anexos, versões ou dados completos de fotos de serviços forem necessários.

2. Bootstrap por tela.
   - Criar endpoints de bootstrap para `GestorPage`, `NewReportPage` e `ReportDetailPage`.
   - Adaptar frontend para consumir bootstrap sem quebrar endpoints existentes.

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
   - Aplicado: cache TTL de listas mestres.
   - Pendente: endpoints de bootstrap e adaptação do frontend.

4. Otimizar `syncRomaneioCatalog()`. Status: parcialmente aplicado.
   - Ganho: Alto.
   - Redução de latência: Alta.
   - Risco: Médio.
   - Facilidade: Média.
   - Aplicado: TTL e deduplicação de sync concorrente.
   - Pendente: versionamento/hash persistente e batching de upserts.

5. Paginação e `select` resumido em `GET /reports`. Status: parcialmente aplicado.
   - Ganho: Alto em bases grandes.
   - Redução de latência: Média.
   - Risco: Médio.
   - Facilidade: Média.
   - Aplicado: modo paginado opcional e `select` resumido opcional preservando retorno legado.
   - Pendente: adaptação da UI para consumir páginas/resumo.

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

## Plano de implementação

### Fase 1: baixo risco e alto impacto

- [x] Corrigir N+1 de autorização de cliente.
- [x] Adicionar índices FK faltantes.
- [x] Adicionar logs controlados de queries lentas e operações lentas.
- [x] Cachear listas mestres com TTL curto e invalidação em mutações.
- [x] Configurar pool e limites de conexão do Prisma via env.

### Fase 2: melhorias estruturais

- [ ] Criar endpoint de bootstrap para `GestorPage`, `NewReportPage` e `ReportDetailPage`.
- [x] Introduzir modo paginado em `GET /reports`, mantendo compatibilidade com o modo atual.
- [x] Separar `select` opcional de listagem e `include` completo de detalhe.
- [x] Adicionar API/hook frontend para listagem paginada/resumida.
- [ ] Migrar telas para usar `useReportsPage({ page, pageSize, summary: true })`.
- [ ] Adicionar controles visuais de paginação nas telas migradas.
- [ ] Validar migração de `NewReportPage` contra serviços pendentes ambíguos, anexos de serviços, fotos herdadas e miniaturas.
- [ ] Otimizar `syncRomaneioCatalog()` com controle de versão/hash persistente.
- [ ] Otimizar `syncRomaneioCatalog()` com batching/diff de upserts.
- [x] Adicionar índices compostos secundários.
- [ ] Validar uso real dos índices com `EXPLAIN ANALYZE`.
- [x] Adicionar cache TTL de `/statistics/projects`.
- [ ] Migrar métricas simples de estatísticas para agregações SQL quando validado.

### Fase 3: otimizações avançadas

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
