# Contrato: painel de execução

## `GET /api/efetivo/project-workflow/:projectId/execution`

Retorna:

- `schedule`: previsto, realizado, método, dias transcorridos/planejados e término esperado/projetado;
- `rdo`: recebidos, pendentes/devolvidos, liberados ao cliente, assinados, com quantitativos, com evidências e última data;
- `technicalReports`: tipo, fonte `SYSTEM|MANUAL`, emitidos, meta, aprovados, assinados, devolvidos e faltantes;
- `deviations`: desvios do projeto no formato da Qualidade;
- `permissions.canEdit`.

## `PUT /api/efetivo/project-workflow/:projectId/execution/report-targets`

Entrada: `{ targets: [{ reportType, expectedCount, completedCount? }] }`.

- `expectedCount` é inteiro de 0 a 9999.
- `completedCount` é aceito somente para RLR e não pode superar a meta quando a meta for maior que zero.
- Apenas Líder e gestor alteram.
- A mudança gera evento, mas não altera a versão da autorização.

## `POST /api/efetivo/project-workflow/:projectId/execution/deviations`

Entrada: `{ category, description, ownerName, dueDate, impact, action, status }`.

- Todos os campos são obrigatórios.
- Apenas na etapa `EXECUTION` e por Líder/gestor.
- Resposta: desvio serializado pelo módulo Qualidade.

## `PATCH /api/efetivo/project-workflow/:projectId/execution/deviations/:deviationId`

Entrada: `{ status }`.

- O registro deve ser `DESVIO`, pertencer ao projeto e não estar excluído.
- Apenas Líder/gestor.
- Atualiza autoria do registro no módulo Qualidade.
