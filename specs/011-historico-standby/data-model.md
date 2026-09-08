# Data Model: Histórico de standby por projeto

## Entidades persistidas reutilizadas

### Project

Representa o projeto individual aberto no dashboard detalhado.

Campos lidos:

- `id`: identificador usado para limitar a consulta.
- `code`: código exibido no título do diálogo.
- `name`: nome exibido no título do diálogo.
- `deletedAt`: projetos excluídos não podem produzir histórico.

### Report

Representa uma fonte operacional de um projeto em uma data.

Campos lidos:

- `id`: relaciona o relatório aos colaboradores.
- `projectId`: garante pertencimento ao projeto solicitado.
- `reportType`: participa da seleção de fontes do realizado.
- `reportDate`: define o dia do histórico.
- `specialConditions`: contém `standby`, `standbyDetails.total`, `standbyDetails.motivo` e possível `parentRdoId`.
- `daytimeCount`: fallback de efetivo para relatórios sem vínculos individuais.
- `deletedAt`: somente relatórios ativos são considerados.

### ReportCollaborator

Relaciona colaboradores diurnos a um relatório.

Campos lidos:

- `reportId`: associa o vínculo ao relatório.
- `collaboratorId`: permite deduplicar pessoas no mesmo dia.

Colaboradores noturnos registrados dentro de `specialConditions.noturnoDetails.collaboratorIds` também participam da deduplicação.

## Modelo derivado

### ProjectStandbyHistory

- `project.id`: string não vazia.
- `project.code`: string.
- `project.name`: string.
- `entries`: lista ordenada de `ProjectStandbyHistoryEntry`.

### ProjectStandbyHistoryEntry

- `date`: data canônica `YYYY-MM-DD`.
- `standbyMinutes`: inteiro maior que zero.
- `collaboratorCount`: inteiro maior ou igual a zero ou `null` quando não registrado.
- `reason`: texto não vazio ou `null` quando não registrado.

## Regras de derivação

1. Carregar somente relatórios do projeto solicitado com `deletedAt = null`.
2. Eliminar relatórios técnicos derivados por meio da regra de fontes já usada pelo Acompanhamento.
3. Interpretar duração numérica ou `HH:MM`; duração inválida, vazia ou não positiva é ignorada.
4. Agrupar ocorrências restantes por `reportDate` normalizada em UTC.
5. Somar `standbyMinutes` no dia.
6. Deduplicar `collaboratorId` diurno e noturno no dia. Se não houver ids, manter o maior `daytimeCount` positivo. Se não houver nenhum dos dois, usar `null`.
7. Remover motivos vazios, deduplicar textos idênticos e concatenar motivos distintos com ` · `.
8. Ordenar as entradas por `date` decrescente.

## Transições de estado

Não há transição persistida. No cliente, o diálogo passa por `fechado → carregando → sucesso vazio/sucesso com dados` ou `carregando → erro → nova tentativa`.
