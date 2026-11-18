# Quickstart — Validação da Aba Colaboradores

Guia de validação end-to-end. Não contém código de implementação; referencia `data-model.md` e `contracts/colaboradores-api.md`.

## Pré-requisitos
- Branch `009-colaboradores`.
- Base com dados de ponto importados (`PontoPeriodSummary` populado) e relatórios RDO do ano de teste.
- Migration da feature aplicada (novo campo `JobRole.isOperational`).
- Usuário com papel **manager** do Acompanhamento.

> Comandos de servidor (migration, seed, deploy) NÃO são executados pelo agente. Rodar no servidor:
> ```bash
> # rode no servidor
> npx prisma migrate deploy
> ```

## Setup (dev)
```bash
# backend
cd backend && npm install && npm run dev
# frontend (outro terminal)
cd frontend && npm install && npm run dev
```

## Cenário 1 — Taxa de Improdutividade (US1, P1)
1. Logar como manager e abrir Acompanhamento → seção **Colaboradores** (`?section=colaboradores`).
2. Conferir que a **Taxa Geral** aparece no topo e a lista mostra, por colaborador operacional: total/acumulado anual de HH, média mensal e taxa individual.
3. **Validação manual** (SC-002/SC-004): escolher um colaborador e reproduzir `mediaMensal = totalHH ÷ mesesAtivos` e `taxaGeral = Σ taxaIndividual ÷ N` (tolerância ≤ 0,1).
4. **Piso 0%** (SC-003): um colaborador com média ≥ 161 HH deve exibir taxa 0%, nunca negativa.
5. **Extras ignoradas** (SC-005): colaborador com muitas horas extras não deve ter total de HH produtivas inflado.

## Cenário 2 — Alocação e disponíveis (US2, P2)
1. Selecionar um colaborador com dias em projeto (RDO) e verificar os períodos por projeto/obra.
2. Verificar que dias com ponto sem projeto aparecem como **sede/disponível** e que a **situação atual** está destacada.
3. Filtrar por **disponíveis** e conferir que só aparecem colaboradores cuja situação atual = sede.

## Cenário 3 — Detalhe mensal (US3, P3)
1. Abrir o detalhe de um colaborador (`?colaborador=...`, sobrevive a refresh).
2. Conferir HH produtivas por mês e a comparação com 161 HH; a soma dos meses deve bater com o total anual (invariante 4 do data-model).

## Cenário 4 — Classificação operacional
1. Em gestão de cargos (`JobRoleManager`), marcar um cargo como **administrativo** (`isOperational=false`).
2. Voltar à aba Colaboradores e confirmar que colaboradores desse cargo **não** entram na Taxa Geral (invariante 5).

## Cenário 5 — Permissão e estado vazio
1. Logar como **viewer**: a seção Colaboradores não deve estar acessível (FR-015).
2. Selecionar um ano sem dados de ponto: a aba mostra estado vazio claro, sem erro, e `taxaGeral` nulo (FR-014).

## Cenário 6 — Responsivo e novidade
1. Em viewport estreito, a tabela vira cards; sem scroll horizontal de página; badges e valores não estouram (Princípio II).
2. No primeiro acesso do manager, a campanha de novidade (card driver.js) aparece; após "visto" não reaparece; expira 10 dias após a data de implementação (Princípio VI).

## Testes automatizados (backend)
```bash
cd backend && npm test
```
Cobrir as invariantes do `data-model.md` em `backend/test/acompanhamento-colaboradores.test.js`: extras não contam, piso 0%, taxa geral = média das individuais, consistência mensal×anual, administrativo fora da taxa.
