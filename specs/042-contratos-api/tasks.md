# Tasks: Contratos, validação e erros da API interna (042)

- [x] T001 `lib/api-contract/registry.js` (`defineRoute`: registra o spec, faz parse de body/params/query com zod, 400/413 no formato padrão)
- [x] T002 `lib/http/error-codes.js` + `sendError()`; handler central em `app.js` sempre com `code` e `requestId` (também em 4xx)
- [x] T003 `scripts/build-internal-openapi.js` (`z.toJSONSchema`) → `docs/api/openapi.internal.json` + `docs/api/README.md`; `npm run contract:build` / `contract:view` (dev)
- [x] T004 `backend/test/internal-api-contract.test.js` no job `Backend`: rotas do Express × registro, escrita sem schema declarado, arquivo gerado atualizado, allowlist que só diminui
- [ ] T005 Helper `expectMatchesContract()` (Ajv) para os testes de integração
- [x] T006 Fase 1 — auth/account: registrar rotas, schemas faltantes (`/2fa/*`, `/logout`), erros padronizados
- [x] T007 Fase 2 — RDO/reports (uploads, PDF, manual-upload, operational-reports, drafts, databook `edicoes`, statistics recipients); upload manual em multipart se D3 = a
- [x] T008 Fase 3 — efetivo, workforce, conferência de alocação
- [x] T009 Fase 4 — equipamentos, epi, estoque, qualidade, romaneio, logística, manometers, counters
- [ ] T010 Fase 5 — acompanhamento (comercial/custo/ponto), operations, privacy, admin/api-credentials/accounts, notifications, assinaturas
- [ ] T011 Frontend: teste de `extractApiErrorMessage` com o formato novo; mostrar `requestId` em erro inesperado
- [x] T012 7.5 `withRetry()` em `lib/http/outbound.js`; Conecta RH (sync/compliance) e leitura em lote do ComercialAPP; alerta após N ciclos (`CONECTA_RH_ALERT_AFTER_FAILURES`)
- [x] T013 ~~7.6 `/api/webhooks/v1/projects` + `Deprecation`/`Sunset` + contador~~ — revertida em 2026-11-25: o PrismaCRM já usa `/api/integracoes/v1/efetivo/projetos` (7.6 atendido); webhook removido
- [x] T014 ~~Coordenar com o PrismaCRM a troca para `/v1`~~ — obsoleta: nada a mudar no CRM; webhook removido (PR `chore/remove-project-intake-webhook`)
- [ ] T015 Docs: README (onde está o contrato), `docs/PADRAO_MODULO.md` (toda rota nova usa `defineRoute`), revisão de segurança (7.x)
