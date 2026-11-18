# Phase 1 — Data Model: Aba Colaboradores

## Entidades persistidas (existentes, reutilizadas)

### PontoPeriodSummary (existente — fonte das HH produtivas)
Campos relevantes:
- `collaboratorId` — vínculo ao `Collaborator` (nulo até o nome ser casado).
- `periodStart` / `periodEnd` — intervalo do sumário.
- `workedMinutes` — **horas normais = HH produtivas** (minutos). ÷ 60 = HH.
- `he70Minutes`, `he100Minutes` — horas extras. **Excluídas** do cálculo (FR-003).
- `monthly` (JSON) — `{ "YYYY-MM": { normalMinutes, extrasMinutes, nightMinutes, workedDates[] } }`. Base do total anual, média mensal e contagem de meses ativos.
- `workedDates[]` — dias com horas normais > 0 (usado no cruzamento com RDO para alocação).

### Collaborator (existente)
- `id`, `code`, `name`, `role` (texto livre), `isActive`.
- Relação `pontoPeriods: PontoPeriodSummary[]`.
- Sem classificação operacional/administrativo hoje.

### JobRole (existente — lista gerenciável de cargos)
- `id`, `name` (único), `order`, `isActive`.
- **Mudança desta feature** (ver abaixo).

### RDO / Relatórios (existente)
- Fonte da alocação por projeto/obra, consumida via `rdoDataByCollaboratorFromReports()` de `labor-cost.js`.

## Mudança de schema (migration Prisma)

### JobRole.isOperational (NOVO campo)
```prisma
model JobRole {
  // ... campos existentes ...
  isOperational Boolean @default(true) // cargo compõe a equipe operacional (Taxa de Improdutividade)
}
```
- **Default `true`**: preserva o comportamento atual (todos entram) até o gestor reclassificar cargos administrativos.
- **Migration**: `prisma migrate` versionada (Princípio IV). Comando entregue ao operador para rodar no servidor (Princípio I).
- **Backfill (opcional, idempotente + dry-run)**: marcar `isOperational = false` para cargos administrativos conhecidos, se o gestor fornecer a lista; caso contrário, ajuste manual pela UI.

### Regra de vínculo colaborador → cargo (a validar na implementação)
- Resolver o cargo do colaborador para obter `isOperational`. Ordem de tentativa:
  1. `CostProfile`/`jobRoleId` associado ao colaborador, se existir.
  2. `Collaborator.role` (texto) casado com `JobRole.name` (normalizado).
  3. Fallback: tratar como operacional (`true`) e permitir reclassificação manual.
- Documentar o critério escolhido no serviço; não silenciar colaboradores sem cargo resolvido.

## Entidades derivadas (calculadas, não persistidas)

### CollaboratorProductivity (por colaborador, por ano)
| Campo | Origem/Cálculo |
|-------|----------------|
| `collaboratorId`, `name`, `role`, `isOperational` | Collaborator + JobRole |
| `totalHHprodutivas` | Σ `monthly[YYYY-MM].normalMinutes` do ano ÷ 60 |
| `mesesAtivos` | nº de `YYYY-MM` do ano com registro de ponto (FR-017; mês parcial = 1) |
| `mediaMensal` | `totalHHprodutivas / mesesAtivos` |
| `taxaIndividual` | `max(0, (161 − mediaMensal) / 161)`; `null`/excluído se `mesesAtivos = 0` |
| `porMes[]` | lista `{ mes: "YYYY-MM", hhProdutivas, acimaDaRef: hh ≥ 161 }` (US3) |

### TeamProductivity (equipe operacional, por ano)
| Campo | Cálculo |
|-------|---------|
| `year` | ano analisado |
| `colaboradores[]` | apenas operacionais com `mesesAtivos > 0` |
| `taxaGeral` | `Σ taxaIndividual / N` (N = tamanho de `colaboradores[]`) |
| `refMensal` | 161 (constante) |

### CollaboratorAllocation (por colaborador)
| Campo | Origem/Cálculo |
|-------|----------------|
| `collaboratorId` | Collaborator |
| `periodos[]` | agrupamento contíguo de `workedDates` por projeto (RDO): `{ projeto, inicio, fim }` |
| `situacaoAtual` | classificação do registro mais recente: `alocado(projeto)` \| `sede` \| `folga` |
| `disponivel` | `situacaoAtual === 'sede'` (ponto sem projeto) |

## Regras de validação
- `year`: inteiro plausível (ex.: 2000–2100); default = ano corrente.
- HH e taxas nunca negativas; taxa individual com piso 0% (FR-008).
- Divisão por zero evitada: `mesesAtivos = 0` exclui o colaborador da Taxa Geral.
- Extras (`he70/he100`) nunca somadas às HH produtivas (SC-005).

## Invariantes (base para os testes de backend)
1. Remover/zerar horas extras de um colaborador não altera `totalHHprodutivas`, `mediaMensal` nem `taxaIndividual`.
2. `mediaMensal ≥ 161 ⇒ taxaIndividual = 0`.
3. `taxaGeral` = média aritmética das `taxaIndividual` dos colaboradores operacionais com `mesesAtivos > 0`.
4. `Σ porMes[].hhProdutivas = totalHHprodutivas` (consistência mensal × anual).
5. Colaborador administrativo (`isOperational = false`) não entra em `colaboradores[]` nem em `taxaGeral`.
