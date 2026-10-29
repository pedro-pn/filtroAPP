# Tasks: Omni fase 2 — Entrega A

- [x] T001 Ler prompt, convenções, specs 033/034, grafo e fontes relevantes.
- [x] T002 Registrar decisões em plan.md e contracts antes da implementação.
- [x] T003 Criar migration aditiva, eventos transacionais e auditoria de Qualidade.
- [x] T004 Implementar feed assinado, retenção, escopos por tipo e recorte de projetos.
- [x] T005 Implementar RDO em todos os estados, filtros e carimbos sem alterar legado.
- [x] T006 Implementar criação Qualidade validada, idempotência, FK e auditoria OMNI.
- [x] T007 Atualizar catálogo, Playground, OpenAPI e docs com exemplos fictícios.
- [x] T008 Cobrir transições/rollback, retomada/410, isolamento e concorrência.
- [x] T009 Executar checks, revisar diff/grafo e registrar relatório final.
- [x] T010 Incluir job Omni com PostgreSQL no CI para executar o teste real sem skip.

Entrega B: US5 → US6/US7 → US8; US4 dispensada pelo Omni. Somente planejamento.

## Resultado da validação — 2026-10-28

- Backend completo: 2.546 testes; 2.511 aprovados, 35 opcionais ignorados, zero falhas.
- PostgreSQL 16 descartável: teste adicional aprovado com schema completo anterior,
  migration aplicada, Prisma, autenticação Bearer e HTTP reais. Duas conexões
  comprovaram o bloqueio até commit e a retomada sem perda. POSTs concorrentes
  retornaram o mesmo registro; evidências e auditoria foram verificadas no banco.
- A migration aplicada não apresenta drift em relação ao schema Prisma.
- Sete cenários novos em integration-omni-phase2.test.js: os nove tipos, no-op,
  transições e carimbos, evidências, auditoria, rollback, todos os escopos por tipo,
  cursor/retomada/410, isolamento de projetos, criação idempotente, erros, rotas e
  Playground. integration-omni-phase2-postgres.test.js oferece o teste opcional real
  por TEST_OMNI_PHASE2_DATABASE_URL, restrito a banco descartável omni_phase2_test*.
- Frontend completo: 850 aprovados, zero falhas; inclui dois novos testes de escopo
  alternativo de RDO, formulário e cURL com Idempotency-Key.
- Prisma validate/generate, npm run architecture:check, lint, build e git diff --check
  aprovados. Revisão com detect_changes, get_review_context e get_affected_flows,
  seguida de conferência na fonte; o grafo não reconhece toda a cobertura indireta.
- Catálogo com 44 escopos AVAILABLE, OpenAPI 1.9.0 e envelope schemaVersion 1.0.
  Exemplos fictícios e decisões estão em contracts/omni-phase2.md e docs/API_INTEGRACOES.md.
- Retenção pública de 30 dias, sem limpeza física automática; Qualidade EM_TRIAGEM
  sem natureza. Eventos começam após a migration, sem backfill. Novos escopos exigem
  emissão/rotação explícita de credencial. Entrega B somente planejada.
- Nenhum deploy, migration no banco de desenvolvimento/produção ou alteração de
  credenciais reais. O container de PostgreSQL usado na validação foi descartado.

## CI — 2026-10-29

- Job `Omni phase 2 (PostgreSQL)` em `.github/workflows/ci.yml`: Node 22,
  PostgreSQL 16, instalação limpa, Prisma generate/deploy e testes das fases 1/2.
- Validação local adicional com todo o histórico de migrations via prisma:deploy
  em banco vazio: aprovada. As suítes Omni usam o mesmo banco explícito do job,
  incluindo a corrida de duas conexões e os POSTs idempotentes simultâneos.
- Auditorias npm no mesmo nível do CI (`--audit-level=high`): backend e frontend
  sem vulnerabilidades altas ou críticas.
