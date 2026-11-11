# Validação local

Pré-requisitos: dependências do backend instaladas e Prisma Client gerado, sem conectar a produção.

1. `cd backend && node --test test/integration-report-pdf.test.js test/report-pdf-cache.test.js test/api-openapi-contract.test.js test/integration-expanded-api.test.js`
2. `cd backend && npm test`
3. Na raiz: `npm run architecture:check`.

Validar PDFs finais, ZapSign cacheado, manual, base e cache fresco; cache obsoleto e hash divergente retornam 409 sem escrita/geração. Escopos ausentes bloqueiam antes do banco; projeto não autorizado bloqueia antes do filesystem. Listagem antiga não ganha campos. Contato pessoal nunca é serializado. Consulte contracts/omni.md e docs/API_INTEGRACOES.md para habilitar token e exemplos.
