# Quickstart: validar a Conferência de alocação

Guia de validação ponta a ponta. Os detalhes de dados e de API estão em
[data-model.md](./data-model.md) e [contracts/allocation-review-api.md](./contracts/allocation-review-api.md).

## Pré-requisitos (local)

- Banco local com migrations aplicadas: `cd backend && npx prisma migrate dev`.
- Seed ou dados com:
  - pelo menos dois projetos ativos com CNPJ;
  - um import de ponto cobrindo a semana de teste;
  - RDOs aprovados na semana;
  - um plano oficial do Efetivo com alocações na semana.
- Um usuário com o papel `efetivo:allocation-review`, um gestor do Efetivo e um ADMIN.

> Migrations em staging ou produção são aplicadas pelo operador (Princípio I). Este guia não
> traz comandos de servidor.

## Testes automatizados

```bash
cd backend && npm test          # node --test test/*.test.js
cd frontend && npm run build    # tsc -b + vite; NÃO usar `tsc --noEmit` solto (project references)
cd frontend && npx playwright test --config=playwright.allocation-review.config.ts   # tela com API simulada
```

Os testes do backend precisam das variáveis do CI (`NODE_ENV=test`, `DATABASE_URL`, `TRUST_PROXY=false`,
`SIGNATURE_TOKEN_SECRET`, `SURVEY_TOKEN_SECRET`); sem banco, os testes de integração são pulados.

Testes novos esperados:

- `allocation-review-suggestion.test.js`: regra de sugestão e indicadores (FR-004/005).
- `allocation-review-service.test.js`: rascunho, conferir, desconferir, fechar, reabrir,
  versão, data futura e dia fora do vínculo.
- `allocation-review-labor-cost.test.js`: precedência sobre o ajuste manual, `REVIEW_IDLE`
  retirando horas e piso de 8h48 em dia útil sem ponto.
- `allocation-review-absence-alerts.test.js`: agrupamento em períodos, cancelamento e resolução
  ao cadastrar ausência.
- `allocation-monthly-report.test.js` (atualizado): substituição de RDO, dias sem projeto sem
  CNPJ, viagem com CNPJ do destino, turno noturno preservado e cálculo do 3º dia útil.
- `allocation-review-routes.test.js`: contratos, 403 sem papel, 403 ao reabrir sem ADMIN e 409
  de versão.

## Cenários manuais

1. **Grade (US1)**: entrar com o usuário de conferência e abrir
   `/efetivo?section=conferencia&semana=<segunda>`.
   - Ver as células com projeto e CNPJ e os três indicadores.
   - Ver a divergência quando a etiqueta do ponto difere do RDO.
   - Ver "Sem informação" em dia útil vazio.
   - Atualizar a página (F5) mantém semana, filtro e agrupamento.
2. **Correção (US2)**:
   - Corrigir um dia pelo painel com "repetir" em dois dias.
   - Corrigir três dias pelo modo de seleção.
   - Tentar conferir uma linha com pendência: o botão fica bloqueado.
   - Usar "Conferir linhas sem pendência".
   - Fechar a semana: só é possível depois do domingo e com todos conferidos.
   - Reabrir com ADMIN. Com o usuário de conferência, a ação não aparece e a API responde 403.
3. **Custo (US3)**: anotar o custo HH dos projetos A e B. Conferir um dia de A como B e outro
   como Sede, e reabrir o custo.
   - As horas do primeiro dia saem de A e entram em B.
   - O dia de Sede sai de A.
   - Um dia não conferido do mesmo mês não muda.
4. **Relatório (US3)**: em Relatórios › Estatística › Alocação dos colaboradores, no mês da
   semana, conferir a tela e o PDF:
   - o dia corrigido aparece em B com o CNPJ de B;
   - Sede aparece sem CNPJ;
   - viagem aparece com o CNPJ do destino.
5. **Envio (US4)**: em teste unitário com `now` simulado, um mês cujo dia 1º seguinte é sexta,
   sem feriados:
   - com semana aberta: sexta e segunda dão `awaiting_review`; terça (dia 5) envia;
   - com todas as semanas fechadas na segunda: envia na segunda;
   - com feriado cadastrado na segunda: o limite passa para quarta.
6. **Aviso (US5)**: marcar Férias em três dias seguidos sem férias cadastradas e conferir a
   linha.
   - O gestor do Efetivo vê uma notificação. O link abre o cadastro com colaborador, tipo e
     período preenchidos.
   - Cadastrar as férias encerra o aviso.
   - Em outro caso, desconferir a linha cancela o aviso.
7. **Celular**: em largura de 375px, a grade vira um card por colaborador, o painel do dia ocupa
   a tela com rodapé fixo e não há scroll horizontal de página.
8. **Novidade**: no primeiro acesso, o card de novidade e o tutorial guiado aparecem. Depois de
   vistos, não reaparecem.
