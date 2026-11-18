# Implementation Plan: Assinaturas Avulsas

**Branch**: `feat/signature-module` | **Date**: 2026-08-21 | **Spec**: `specs/012-assinaturas-avulsas/spec-input.md` (briefing do solicitante; não passou por `/speckit-specify`)

**Input**: Briefing de requisitos "Módulo de Assinaturas Avulsas" (33 seções), preservado em `spec-input.md`.

> **Status**: planejamento apenas. Nenhum código do módulo foi escrito.

---

## Summary

Novo módulo **Assinaturas** que permite a um usuário interno subir um PDF avulso (sem vínculo com Projeto/RDO),
posicionar campos de assinatura por assinante, publicar a rodada, distribuir links individuais (e-mail opcional),
acompanhar o progresso e obter o PDF final assinado com trilha de auditoria.

A abordagem é **reuso máximo da infraestrutura de assinatura já existente**: o mecanismo de token
(`signature-token.js` — random 32B + SHA-256 para lookup + AES-256-GCM para recuperação), a captura de assinatura
(`SignatureDialog.tsx`), a evidência de request (`signatures/common.js`), o armazenamento gerenciado de documentos
(`documents/storage.js`), o registrador de auditoria (`audit/events.js`), o mailer/templates
(`mailer.js` + `email-templates.js`), o padrão de rate limit público (`rate-limit.js`), o padrão de job com lock
(`jobs/runner.js`) e a geração de PDF com `pdf-lib` + QR de validação (`qr-code.js`).

O que **não** existe hoje e precisa ser criado: entidade de documento avulso (o `Report` atual exige `projectId`),
assinante com e-mail opcional (o `ReportSignature` atual exige `signerEmail` e tem `@@unique([versionId, signerEmail])`),
posicionamento de campo em coordenadas dentro do PDF (hoje a evidência é uma **página anexa**, não um carimbo posicionado),
e a pré-visualização paginada do PDF no frontend.

---

## Technical Context

**Language/Version**: Node.js 22 (ESM) no backend; TypeScript 5.8 + React 19 no frontend.

**Primary Dependencies**: Express 5, Prisma 7 + PostgreSQL, Zod 4, `pdf-lib` 1.17, `pdfjs-dist` 6 (legacy build),
`@napi-rs/canvas` 1, `nodemailer` 9. Frontend: `@tanstack/react-query` 5, `react-hook-form` 7, `react-router` 8, `zustand` 5.
**Nenhuma dependência nova é necessária** — `pdfjs-dist` e `@napi-rs/canvas` já estão em `backend/package.json`.

**Storage**: PostgreSQL (Prisma) + filesystem gerenciado sob `env.uploadDir` via `backend/src/lib/documents/storage.js`.

**Testing**: `node --test` (`backend/test/*.test.js`, `frontend/test/*.test.mjs`), `npm run architecture:check`.

**Target Platform**: Web (desktop + mobile), backend Linux/Docker atrás de proxy.

**Project Type**: Web application (backend Express + frontend React), módulo do hub existente.

**Performance Goals**: preview de página renderizada sob demanda com cache em disco (alvo < 1.5 s por página na 1ª
renderização, servida de cache depois); PDF final < 5 s para documento de até 30 páginas / 10 assinantes.

**Constraints**: PDF ≤ 20 MB (mesmo teto de `MAX_PDF_BYTES` do módulo Qualidade); ≤ 50 páginas por documento;
≤ 20 assinantes por documento; timezone de exibição `America/Sao_Paulo` (padrão de
`internal-report-signatures.js`), persistência sempre em UTC.

**Scale/Scope**: dezenas de documentos/mês por usuário; ~9 telas/estados no frontend; ~18 endpoints.

---

## Constitution Check

*GATE: avaliado antes do Phase 0 e reavaliado após o desenho (Phase 1). Resultado: **PASS**, sem violações.*

| Princípio | Aderência planejada |
|---|---|
| I — Operação de servidor sagrada | Nenhum comando de servidor será executado pelo agente. Migrations e o backfill de preview aparecem como blocos "rode no servidor" no `quickstart.md`. |
| II — pt-BR e mobile-first | Todas as telas em pt-BR. Lista em cards (`minmax(min(100%, 280px), 1fr)`), modais com rodapé fixo, editor de posicionamento com toolbar que quebra linha e canvas com rolagem interna própria (sem scroll horizontal de página). |
| III — Zod nas duas pontas | Schemas Zod em `backend/src/routes/resources/assinaturas.js` para todo payload; `react-hook-form` + resolver Zod nos formulários de upload/assinantes/publicação. |
| IV — Banco só via Prisma | 1 migration de enums (`AppModule`/`ModuleRoleCode`) + 1 migration de tabelas. Backfill não é necessário (módulo novo, sem dados legados). |
| V — Testes de regra no backend | `backend/test/assinaturas-*.test.js` cobrindo permissão, owner isolation, tokens, publicação, concorrência e finalização (ver seção M). |
| VI — Consistência visual | Reuso de `Modal`, `Button`, `ConfirmDialog`, `Toast`, `SearchBar`, `Skeleton`, `PdfDropzone`, `SignatureDialog`; tokens de `variables.css`; shell largo `.equip-page`-like; navegação por query params (`?doc=`, `?tab=`); tutorial permanente de primeiro acesso (módulo novo) via `driver.js`. **Sem exceção de identidade portada** — o módulo é novo, logo o kit é obrigatório. |

**Evidência visual obrigatória (frontend presente):**

| Surface | Referência existente auditada | Componentes/classes compartilhados | Estados de campo/dropdown | Drag & drop | Persistência de navegação | Novidade/tutorial | Overflow mobile/desktop |
|---|---|---|---|---|---|---|---|
| Listagem de documentos | `frontend/src/pages/qualidade/QualityRecordsTab.tsx` + `estoque` (grade de cards) | `SearchBar`, `Skeleton`, `Button`, grade `minmax(min(100%,280px),1fr)` | filtro de status como `select` do kit (foco/disabled/erro) | N/A | `?tab=ativos|arquivados`, `?status=`, `?q=` | tutorial permanente de módulo novo (driver.js) | cards com `min-width:0`, nome do arquivo com ellipsis |
| Novo documento (upload) | `frontend/src/components/ui/PdfDropzone.tsx` (uso em `estoque`/`qualidade`) | `PdfDropzone`, `Modal`, `Button`, `.field-group.field-invalid` + `.field-error` | required-empty vermelho ao tentar salvar | N/A | `?doc=novo` | passo do tutorial | dropzone 100% de largura |
| Configuração (preview + posicionamento) | novo; espelha o shell largo de `EquipamentosPage` | `Modal`, `Button`, tokens; canvas com `overflow:auto` próprio | lista de assinantes usa `field-group` + `aria-invalid` | **Reordenar assinantes fica fora do MVP** (ordem = ordem de criação); arrastar o *campo* sobre o PDF é posicionamento, não reordenação de lista, e usa Pointer Events com `touch-action:none` | `?doc=<id>&page=<n>` | passo do tutorial | página do PDF escalada por largura do contêiner; sem scroll horizontal de página |
| Confirmação/publicação | `ConfirmDialog` do kit | `Modal`, `ConfirmDialog`, `Button` | select de validade com estados do kit | N/A | modal, sem URL | passo do tutorial | rodapé de ações fixo |
| Detalhes do documento | `frontend/src/pages/ReportDetailPage.tsx` (blocos `det-section`/`det-row`) | `det-section`, `det-row`, `Button`, `ConfirmDialog`, `Toast` | N/A | N/A | `?doc=<id>&tab=assinantes|auditoria` | passo do tutorial | tabela de assinantes vira cards em mobile |
| Assinatura pública | `frontend/src/pages/PublicSignaturePage.tsx` + `EpiPublicSignaturePage.tsx` | **`SignatureDialog` reutilizado sem fork**, `PrivacyNotice`, `survey-page-shell` | erros de nome do signatário já cobertos pelo `SignatureDialog` | N/A | N/A (página de token) | N/A (público externo) | shell público já responsivo |

**Checagem de dívida da fonte reutilizada**: `SignatureDialog.tsx`, `PdfDropzone.tsx`, `Modal`, `ConfirmDialog` e
`PrivacyNotice` foram inspecionados e estão aderentes à constitution atual (tokens, estados, mobile). Nenhuma
tarefa de correção de fonte é necessária.

---

## Project Structure

### Documentation (this feature)

```text
specs/012-assinaturas-avulsas/
├── plan.md              # Este arquivo
├── spec-input.md        # Briefing original de requisitos (33 seções)
├── research.md          # Phase 0 — inventário e decisões
├── data-model.md        # Phase 1 — modelo de dados
├── contracts/
│   └── api.md           # Phase 1 — contrato de endpoints
├── quickstart.md        # Phase 1 — validação end-to-end
└── tasks.md             # Phase 2 — gerado por /speckit-tasks (NÃO criado aqui)
```

### Source Code (repository root)

```text
shared/modules/registry.json                      # + módulo "assinaturas" (1 role)

backend/prisma/schema.prisma                      # + 5 models, 3 enums, 2 valores em AppModule/ModuleRoleCode
backend/prisma/migrations/<ts>_add_assinaturas_module/migration.sql
backend/prisma/migrations/<ts>_add_assinaturas_tables/migration.sql

backend/src/routes/resources/assinaturas.js       # rotas finas (públicas antes do requireAuth)
backend/src/lib/assinaturas/
├── access.js            # requireAssinaturasAccess + documentForOwnerOrThrow (owner isolation)
├── service.js           # criar/configurar/publicar/cancelar/arquivar/excluir
├── document.js          # upload, validação de PDF, storage, hash, contagem de páginas
├── preview.js           # render de página PDF -> PNG (pdfjs-dist + @napi-rs/canvas), cache em disco
├── invites.js           # emissão/renovação/revogação de token, resolução por token
├── signing.js           # fluxo público: ver, baixar PDF, assinar (idempotente)
├── final-pdf.js         # carimbo posicionado + página de evidências + QR de validação
├── audit.js             # wrapper sobre lib/audit/events.js
├── notifications.js     # montagem e envio dos e-mails de convite
└── jobs.js              # job de retry de e-mail + job de expiração/retenção

backend/src/lib/audit/events.js                   # + AUDIT_MODULES.ASSINATURAS / entityType
backend/src/lib/email-templates.js                # + buildStandaloneSignatureRequestEmailTemplate (+ concluído)
backend/src/config/env.js                         # + ASSINATURAS_* (limites/retenção)
backend/src/routes/index.js                       # + mount /assinaturas
backend/src/server.js                             # + startAssinaturasJobs()

backend/test/
├── assinaturas-access.test.js
├── assinaturas-document.test.js
├── assinaturas-publish.test.js
├── assinaturas-public-sign.test.js
├── assinaturas-final-pdf.test.js
└── assinaturas-lifecycle.test.js

frontend/src/api/assinaturas.ts
frontend/src/hooks/useAssinaturas.ts
frontend/src/pages/assinaturas/
├── AssinaturasPage.tsx              # listagem + roteamento interno por query params
├── components/
│   ├── DocumentCard.tsx
│   ├── NewDocumentModal.tsx         # PdfDropzone
│   ├── DocumentSetupView.tsx        # preview + assinantes + posicionamento
│   ├── PdfPageCanvas.tsx            # <img> da página + overlay de campos (Pointer Events)
│   ├── SignerList.tsx
│   ├── PublishDialog.tsx
│   ├── DocumentDetailView.tsx
│   ├── SignerStatusList.tsx         # cópia de link, renovar, revogar
│   └── AuditTrail.tsx
├── utils/coordinates.ts             # normalização/desnormalização de coordenadas
└── AssinaturasPublicSignPage.tsx    # reusa SignatureDialog
frontend/src/modules/moduleRoutes.tsx             # + rota do módulo
frontend/src/modules/registry.generated.ts        # regenerado por npm run modules:generate
frontend/src/App.tsx                              # + rota pública /assinaturas/assinar/:token
frontend/test/assinaturas-coordinates.test.mjs
```

**Structure Decision**: Web application (Opção 2), seguindo `docs/PADRAO_MODULO.md`: rota fina em
`backend/src/routes/resources/assinaturas.js`, domínio em `backend/src/lib/assinaturas/`, página em
`frontend/src/pages/assinaturas/`, jobs em `lib/assinaturas/jobs.js` (nunca exportados de rota).

---

# A. Resumo da arquitetura atual

O app tem **três** fluxos de assinatura hoje. Nenhum deles serve diretamente ao caso avulso, mas juntos fornecem
quase todas as peças.

### A.1 Assinatura interna de relatório (RDO/serviço) — o fluxo mais completo

Cadeia: `Report` → `ReportVersion` (rodada) → `ReportSignature` (um por assinante) → `ReportAuditLog`.

1. Quando um relatório é aprovado e o projeto tem assinantes-cliente configurados,
   `ensureInternalSignatureRound()` (`backend/src/lib/internal-report-signatures.js:243`) cria uma `ReportVersion`
   `ACTIVE` com `sourcePdfUrl` + `sourceDocumentHash` (SHA-256 do PDF-base) e um `ReportSignature` `PENDING`
   por assinante. Um **advisory lock transacional** (`pg_advisory_xact_lock(hashtext($1), 0)` sobre o `reportId`)
   serializa a criação da rodada; `P2002` é tratado como "outra requisição já criou".
2. `issuePendingSignatureTokens()` gera, por assinatura pendente, um token via `createSignatureToken()`
   (32 bytes aleatórios hex) e grava **três coisas**: `tokenHash` (SHA-256, `@unique`, usado no lookup),
   `tokenEncrypted`/`tokenIv`/`tokenAuthTag` (AES-256-GCM, permite **recuperar o link depois**) e `tokenExpiresAt`
   (default 30 dias).
3. Os links vão por e-mail (`sendSignatureRequestEmails` em `reports.js:483`), com template
   `buildReportSignatureRequestEmailTemplate`. Se o envio falha, `deliverIssuedSignatureRequestEmails` **apaga os
   tokens não enviados** para que o retry os reemita — a assinatura não é corrompida.
4. O assinante abre `/assinar/:token` (`PublicSignaturePage.tsx`). O backend expõe
   `GET|POST /api/reports/public-sign/:token[...]` **antes** do `requireAuth`, sob `publicSignatureLimiter`
   (`createMemoryRateLimit`, 60 req/15 min por IP+rota). O payload público
   (`publicSignaturePayload`) devolve só o necessário.
5. A assinatura visual é capturada no `SignatureDialog` (desenho em canvas ou upload de imagem) e enviada como
   data URL. O backend valida bytes com `parseSignatureImageDataUrl`/`decodableSignatureImageDataUrl`
   (`lib/signatures/common.js`) — checa magic bytes PNG/JPEG, dimensões (≤4096, ≤4 MP) e tamanho (≤1.5 MB),
   e confirma que o `pdf-lib` consegue embutir.
6. `signInternalReportVersion()` grava a assinatura com **update condicional**
   (`updateMany({ where: { id, status: PENDING } })`); se `count !== 1`, relê o registro e decide entre
   idempotência (já assinado → sucesso) e 409. Evidências gravadas: `ipAddress` (via
   `signatureEvidenceFromRequest`, que só confia em `X-Forwarded-For` quando `trust proxy` está ligado),
   `userAgent`, `signedAt`, `declaredSignerName`, `privacyNoticeVersion`.
7. Quando todos os obrigatórios assinam, `writeFinalEvidencePdf()` **revalida o hash do PDF-base** (409 se
   divergir), **anexa uma página de evidências** com status, hash, código de validação, QR
   (`createValidationQrCodeMatrix`), link-annotation e a imagem de cada assinatura, salva como `-assinado.pdf`
   e devolve `finalDocumentHash`. O `validationCode` (18 bytes base64url, `@unique`) alimenta a página pública
   `/validar-assinatura/:code`.
8. Cada passo grava `ReportAuditLog` via `recordAuditEvent()` (`lib/audit/events.js`), append-only, com
   `action` do enum `ReportAuditAction`, `ipAddress`, `userAgent`, `userId`, `versionId`.
9. `startSignatureReminderJob()` (`lib/signature-reminders.js`) reenvia lembretes usando
   `reminderClaimedAt`/`reminderCount` como trava de idempotência.

### A.2 Assinatura de ficha de EPI — o molde estrutural mais próximo

`EpiSignatureRequest` (tokenHash `@unique`, `expiresAt`, `signedAt`, `signedPdfPath`/`signedPdfHash`, IP/UA) +
`EpiSignatureRequestAuditLog`. Rotas públicas `/api/epi/public-sign/:token[...]` registradas **antes** de
`router.use(requireAuth, requireEpiAccess)`. `confirmPublicEpiSignatureRequest()` é o melhor exemplo de
**confirmação idempotente**: pré-checa fora da transação, gera o PDF assinado, e dentro da transação relê o
request e revalida status antes de gravar. Página pública: `EpiPublicSignaturePage.tsx` (145 linhas), que reusa
`SignatureDialog`.

### A.3 ZapSign (legado)

Campos `zapsign*` em `Report` + `lib/zapsign.js` + job de reconciliação. **Fora de escopo**; nada será reutilizado.

### A.4 Peças transversais reaproveitáveis

- **Storage gerenciado**: `lib/documents/storage.js` — `writeManagedDocumentFile` (grava com `flag:'wx'`,
  nome sanitizado + token), `resolveManagedDocumentPath` (bloqueia `..`, path absoluto e escape do root),
  `unlinkManagedDocumentFile`, `inlineContentDisposition`. Já usado por Qualidade, Estoque e Equipamentos.
- **Validação de PDF**: `lib/qualidade/attachments.js` é o padrão — data URL `application/pdf`, decodifica base64,
  checa `bytes.subarray(0,4) === '%PDF'` e o teto de 20 MB. `app.js` já eleva o limite do `express.json` por rota.
- **Permissões**: `shared/modules/registry.json` é a fonte de verdade → `lib/module-roles.js` (`hasModuleRole`)
  → `middleware/auth.js` (`requireModuleRole`) → `frontend/src/modules/registry.generated.ts` → `RoleRoute`.
- **Jobs**: `lib/jobs/runner.js` (`acquireJobLock` sobre a tabela `JobLock`, `JobRun` para histórico).
- **E-mail**: `lib/mailer.js` (`sendClientMail`, `getMissingMailerConfig`, flag `SEND_CLIENT_EMAILS`) +
  `lib/email-templates.js` (28 builders, logo embutida por CID, `addNotificationPreferencesLink`).
- **Soft delete / arquivamento**: `deletedAt` (Report, Project, QualityRecord) e `archivedAt` (EpiRecord) —
  **os dois conceitos já coexistem no app e são distintos**.
- **Retenção/LGPD**: `lib/data-retention.js` anonimiza `ReportAuditLog`/`EpiSignatureRequestAuditLog`
  (IP/UA) após o cutoff, em vez de apagar a trilha. `LGPD_ROPA.md` e `LGPD_COMPLIANCE.md` documentam a política.

### A.5 O que **não** existe

| Peça necessária | Situação hoje |
|---|---|
| Documento sem projeto | `Report.projectId` é obrigatório (`onDelete: Restrict`) |
| Assinante sem e-mail | `ReportSignature.signerEmail` é `String` obrigatório com `@@unique([versionId, signerEmail])` |
| Campo de assinatura posicionado no PDF | Não existe — a evidência atual é uma **página anexa** ao fim do PDF |
| Preview paginado de PDF no frontend | Não existe; `pdfjs-dist` só está no **backend** (usado em `scripts/import-manual-rdo-pdfs.js`) |
| Owner isolation por usuário | Não existe; a autorização atual é por projeto/cliente/módulo |

---

# B. Inventário de código existente

| Arquivo/caminho | Responsabilidade | Reuso | Alteração necessária |
|---|---|---|---|
| `backend/src/lib/signature-token.js` | Geração/hash/cifra do token de assinatura | **Reutilizar direto** | Nenhuma. `signatureTokenData()` entrega `{token, tokenHash, tokenEncrypted, tokenIv, tokenAuthTag}` |
| `backend/src/lib/signatures/common.js` | Validação da imagem de assinatura, `normalizeSignerEmail`, `signatureTokenExpiresAt`, `signatureEvidenceFromRequest` (IP/UA confiáveis) | **Reutilizar direto** | Nenhuma |
| `backend/src/lib/documents/storage.js` | Escrita/resolução/remoção segura de arquivos gerenciados | **Reutilizar direto** | Nenhuma |
| `backend/src/lib/qr-code.js` | `createValidationQrCodeMatrix` para o QR de validação | **Reutilizar direto** | Nenhuma |
| `backend/src/lib/rate-limit.js` | `createMemoryRateLimit` para rotas públicas | **Reutilizar direto** | Nenhuma |
| `backend/src/lib/jobs/runner.js` | `acquireJobLock`/`JobRun` | **Reutilizar direto** | Nenhuma |
| `backend/src/lib/mailer.js` | `sendClientMail`, `getMissingMailerConfig` | **Reutilizar direto** | Nenhuma |
| `backend/src/lib/module-roles.js` | `hasModuleRole` e derivação do registry | **Reutilizar direto** | Nenhuma (lê o registry) |
| `backend/src/middleware/auth.js` | `requireAuth`, `requireModuleRole(...)` | **Reutilizar direto** | Nenhuma — usar `requireModuleRole('assinaturas:user')`; guard nomeado fica em `lib/assinaturas/access.js` |
| `backend/src/lib/audit/events.js` | `recordAuditEvent` (append-only) | **Estender** | + `AUDIT_MODULES.ASSINATURAS`, `AUDIT_ENTITY_TYPES.SIGNATURE_DOCUMENT` e o branch que grava em `signatureDocumentAuditLog`. Aditivo, não altera RDO/EPI |
| `backend/src/lib/email-templates.js` | Templates HTML | **Estender** | + 2 builders exportados (convite avulso, documento concluído). Padrão do arquivo é justamente acumular builders |
| `backend/src/config/env.js` | Env validada com Zod | **Estender** | + `ASSINATURAS_MAX_PDF_MB`, `ASSINATURAS_MAX_PAGES`, `ASSINATURAS_MAX_SIGNERS`, `ASSINATURAS_DELETED_RETENTION_DAYS`, `ASSINATURAS_TOKEN_MAX_DAYS` |
| `backend/src/routes/resources/users.js` | Contas do hub; `DELETE /:id` faz `prisma.user.delete()` físico (linha 416) | **Estender** | + `GET /:id/impacto` (contagem por status) e chamada de `assinaturas.prepareUserDeletion()` antes do delete. Alteração em módulo existente, justificada em D16 |
| `backend/src/routes/index.js` | Mount dos routers | **Estender** | + `router.use('/assinaturas', assinaturasRouter)` no marcador `module:scaffold mount` |
| `backend/src/server.js` | Boot dos jobs | **Estender** | + `startAssinaturasJobs()` importado de `lib/assinaturas/jobs.js` |
| `backend/src/app.js` | Limites do `express.json` | **Estender** | O predicado `isSignatureApi` já casa `/public-sign`; adicionar `/api/assinaturas` ao grupo de upload (25 MB) e manter 3 MB para o confirm público |
| `backend/src/lib/internal-report-signatures.js` | Rodada, tokens, assinatura, PDF de evidência do RDO | **Adaptar por cópia dirigida** | **Não alterar.** O novo `lib/assinaturas/final-pdf.js` reimplementa o *layout* da página de evidências (o atual é acoplado a `report`/`version`/projeto) mas importa os primitivos já compartilhados (`sha256Hex`-equivalente, `parseSignatureImageDataUrl`, `createValidationQrCodeMatrix`). Ver decisão D8 |
| `backend/src/routes/resources/epis.js` | Molde do fluxo público com token | **Adaptar (referência)** | Nenhuma alteração; serve de modelo para `lib/assinaturas/signing.js` |
| `backend/src/routes/resources/reports.js` | Fluxo de assinatura RDO (7.495 linhas, budget travado) | **Não tocar** | Nenhuma. O `architecture-check` reprova crescimento deste arquivo |
| `backend/src/lib/qualidade/attachments.js` | Molde de upload/validação de PDF em data URL | **Adaptar (referência)** | Nenhuma; `lib/assinaturas/document.js` segue o mesmo desenho |
| `backend/src/lib/data-retention.js` | Retenção/anonimização LGPD | **Estender (fase posterior)** | + alvo de anonimização de `SignatureDocumentAuditLog` e purga de arquivos de documentos excluídos |
| `backend/scripts/import-manual-rdo-pdfs.js` | Receita `pdfjs-dist` legacy + `@napi-rs/canvas` → PNG | **Adaptar (receita)** | Nenhuma; a receita é extraída para `lib/assinaturas/preview.js` |
| `shared/modules/registry.json` | Fonte de verdade de módulos/roles/rotas | **Estender** | + entrada `assinaturas` com 1 role e `pathExclusions: ["/assinaturas/assinar"]` |
| `frontend/src/components/reports/SignatureDialog.tsx` | Captura de assinatura (desenho/upload) + cache de nome | **Reutilizar direto** | Nenhuma. Já é usado por RDO e EPI |
| `frontend/src/components/ui/PdfDropzone.tsx` | Upload de PDF com drag & drop | **Reutilizar direto** | Nenhuma |
| `frontend/src/components/ui/{Modal,Button,ConfirmDialog,Toast,SearchBar,Skeleton}.tsx` | Kit de UI | **Reutilizar direto** | Nenhuma |
| `frontend/src/components/privacy/PrivacyNotice.tsx` | Aviso LGPD na assinatura | **Reutilizar direto** | + variante `signatureAvulsa` em `frontend/src/constants/privacy.ts` |
| `frontend/src/pages/PublicSignaturePage.tsx` | Página pública RDO | **Adaptar (referência)** | Não alterar; `AssinaturasPublicSignPage.tsx` copia o shell (`survey-page-shell`) e reusa `SignatureDialog` |
| `frontend/src/pages/epi/EpiPublicSignaturePage.tsx` | Página pública EPI (145 linhas) | **Adaptar (referência)** | Idem |
| `frontend/src/modules/moduleRoutes.tsx` / `registry.ts` | Rotas e acesso por módulo | **Estender** | + bloco `RoleRoute` do módulo (marcadores `module:scaffold`) |
| `frontend/src/App.tsx` | Rotas públicas | **Estender** | + `<Route path="/assinaturas/assinar/:token" .../>` |
| `frontend/src/pages/SignatureValidationPage.tsx` (177 linhas) | Validação pública por código | **Estender** | Aceitar código de documento avulso além de `reportVersion` (consulta um endpoint que resolve os dois) — ou rota própria; ver D9 |
| `backend/test/internal-report-signatures.test.js`, `epi-security.test.js`, `signature-token.test.js`, `signatures-common.test.js`, `audit-events.test.js` | Cobertura atual do fluxo de assinatura | **Referência de padrão** | Nenhuma. São o molde dos novos testes (funções puras exportadas + injeção de client fake) |

---

# C. Gap analysis

| Item | Classificação | Observação |
|---|---|---|
| Geração de token seguro (entropia, hash de lookup, cifra para recuperação) | **Já existe** | `signature-token.js` |
| Validação da imagem de assinatura | **Já existe** | `signatures/common.js` |
| Captura de assinatura no frontend | **Já existe** | `SignatureDialog.tsx` |
| Evidência de IP/User-Agent confiável | **Já existe** | `signatureEvidenceFromRequest` |
| Rate limit de rota pública | **Já existe** | `createMemoryRateLimit` |
| Storage seguro de PDF + path traversal | **Já existe** | `documents/storage.js` |
| Validação de PDF (magic bytes + limite) | **Já existe** | padrão de `qualidade/attachments.js` |
| Upload de PDF no frontend | **Já existe** | `PdfDropzone` |
| Job com lock distribuído | **Já existe** | `jobs/runner.js` |
| Infra de e-mail (transport, flags, logo, preferências) | **Já existe** | `mailer.js` |
| Registro de módulo + permissão modular | **Já existe** | `registry.json` + `hasModuleRole` + `RoleRoute` |
| Soft delete e arquivamento | **Já existe** (padrões distintos) | `deletedAt` e `archivedAt` |
| QR + código de validação pública | **Já existe** | `qr-code.js` + `validationCode` |
| Registrador de auditoria append-only | **Reutilizar com pequena adaptação** | + módulo/entityType em `audit/events.js` |
| Template de e-mail de convite | **Reutilizar com pequena adaptação** | + builder em `email-templates.js` |
| Limite de corpo por rota | **Reutilizar com pequena adaptação** | + prefixo em `app.js` |
| Envio + retry de e-mail de convite | **Precisa ser estendido** | O RDO tem retry via "apagar token e reemitir"; aqui o link precisa continuar copiável, então o retry vira estado por convite + job |
| Página pública de validação por código | **Precisa ser estendido** | Hoje só resolve `ReportVersion.validationCode` |
| Retenção LGPD | **Precisa ser estendido** | + alvo para o novo audit log e purga de arquivos |
| **Entidade de documento avulso (sem projeto)** | **Precisa ser criado** | `Report.projectId` é obrigatório |
| **Assinante com e-mail opcional** | **Precisa ser criado** | `ReportSignature.signerEmail` é obrigatório e único por rodada |
| **Campo de assinatura com coordenadas** | **Precisa ser criado** | Não há conceito de posição no app |
| **Renderização de página do PDF para preview** | **Precisa ser criado** | Receita existe em script; vira lib |
| **Carimbo da assinatura na posição escolhida** | **Precisa ser criado** | O PDF final atual só anexa página |
| **Owner isolation por usuário** | **Precisa ser criado** | Padrão novo (mas trivial): filtro obrigatório por `ownerUserId` |
| **Impacto/limpeza na exclusão de conta** | **Precisa ser estendido** | `users.js` hoje deleta a conta sem inventário de efeitos colaterais (D16) |
| **Editor de posicionamento no frontend** | **Precisa ser criado** | Componente novo com Pointer Events |
| **Trilha de auditoria do documento avulso** | **Precisa ser criado** | Tabela nova, mesmo formato do `ReportAuditLog` |

---

# D. Decisões de arquitetura

### D1 — Tabelas novas, bibliotecas reutilizadas (não estender `Report`)

**Decisão**: criar `SignatureDocument` / `SignatureDocumentSigner` / `SignatureDocumentField` /
`SignatureDocumentAuditLog`, reaproveitando as **bibliotecas** de assinatura, não as **tabelas**.

**Por quê**: encaixar documento avulso em `Report` exigiria (a) tornar `Report.projectId` opcional — campo usado
em ~60 índices/consultas, na numeração sequencial (`@@unique([projectId, reportType, sequenceNumber])`), no
`canAccessReport` e em todo o Acompanhamento; (b) tornar `ReportSignature.signerEmail` opcional e **remover**
`@@unique([versionId, signerEmail])`, que é hoje a garantia de "um assinante por e-mail por rodada" do RDO.
As duas mudanças alteram o caminho crítico do módulo mais usado do app, contra a restrição "não alterar
comportamento de módulos existentes sem justificar". Um discriminador (`source`/`documentType`) em `Report`
não resolve — o problema é a **forma** dos dados, não a rotulagem.

**Trade-off**: ~5 tabelas novas e uma segunda implementação do layout da página de evidências. Em troca, zero
risco de regressão no RDO e liberdade para modelar coordenadas e e-mail opcional corretamente.

### D2 — Sem tabela de "rodada"; imutabilidade por congelamento

**Decisão**: não replicar `ReportVersion`. O `SignatureDocument` carrega `sourceDocumentHash`,
`finalDocumentHash`, `validationCode` e `status`. Regras:

- `RASCUNHO`: PDF, assinantes e campos livremente editáveis.
- `AGUARDANDO_ASSINATURAS` com **zero** assinaturas: o dono pode **despublicar** (`POST /:id/despublicar`),
  que invalida todos os tokens, volta para `RASCUNHO` e grava auditoria. Cobre 90% dos "errei o e-mail".
- `AGUARDANDO_ASSINATURAS` com **≥1** assinatura: **congelado**. PDF, assinantes, campos e identidade não
  mudam mais. As únicas ações são renovar/revogar convite pendente ou **cancelar** o documento (preservando as
  evidências já colhidas). Corrigir o conteúdo exige **novo documento** (novo upload).

**Por quê**: atende §22 (imutabilidade) com o mínimo de estrutura. Uma tabela de rodada só ganharia valor se
quiséssemos re-rodar sobre o mesmo PDF **após** assinaturas — exatamente o que §22 proíbe.

**Trade-off**: perde-se o histórico "v1/v2" dentro do mesmo registro; o vínculo entre um documento cancelado e
seu substituto fica só na auditoria. Aceitável para o MVP; `replacesDocumentId` pode ser adicionado depois sem
migração destrutiva.

### D3 — Coordenadas normalizadas, referencial PDF

**Decisão**: cada `SignatureDocumentField` guarda `pageNumber` (1-based), `x`, `y`, `width`, `height` como
`Decimal(9,8)` **normalizados em [0,1]**, com origem no **canto superior esquerdo** da página, mais
`pageWidthPt`, `pageHeightPt` e `pageRotation` capturados no momento do posicionamento (referencial auditável).
O backend converte para o sistema do `pdf-lib` (origem inferior esquerda) na finalização:
`xPt = x * pageWidth`, `yPt = pageHeight - (y + height) * pageHeight`.

**Por quê**: independe do zoom/DPI/tamanho de tela; sobrevive a re-renderização; guardar as dimensões em pontos
permite detectar (e recusar) um PDF cujas páginas mudaram — reforço do `sourceDocumentHash`.

**Alternativas rejeitadas**: pixels absolutos (quebra em qualquer outro DPI); pontos PDF absolutos (correto, mas
obriga o frontend a conhecer a escala e falha silenciosamente se a página for recortada).

### D4 — Preview de PDF renderizado no backend

**Decisão**: `GET /api/assinaturas/documentos/:id/paginas/:n.png` renderiza a página com `pdfjs-dist/legacy` +
`@napi-rs/canvas` (receita já validada em `backend/scripts/import-manual-rdo-pdfs.js:673`), em escala fixa
(~1.5x, largura máxima 1400 px), com cache em disco sob `Assinaturas/Previews/<documentId>/<n>.png` e
`Cache-Control: private, max-age=...` (nunca `public`). A rota exige `requireAuth` + owner; a versão pública
exige token válido e só serve as páginas do documento daquele convite.

**Por quê**: evita adicionar `pdfjs-dist` (+ worker, +~1 MB gzip e configuração de bundler) ao frontend; usa
dependências já instaladas; centraliza a autorização no servidor (o browser nunca recebe o PDF inteiro só para
desenhar a prévia).

**Trade-off**: CPU e disco no servidor. Mitigação: render sob demanda (só a página aberta), cache em disco,
teto de páginas (`ASSINATURAS_MAX_PAGES`), limpeza dos previews junto com a purga do documento.

**Alternativa considerada**: `pdfjs-dist` no frontend — melhor UX (zoom/scroll nativos, sem round-trip), mas
dependência nova, worker a configurar e o PDF completo trafegando para o cliente. Fica como evolução se o custo
de render incomodar.

### D5 — Token: reuso integral do mecanismo do RDO, incluindo a cifra reversível

**Decisão**: `signatureTokenData()` por convite. Persistir `tokenHash` (`@unique`, único caminho de lookup) +
`tokenEncrypted`/`tokenIv`/`tokenAuthTag` + `tokenExpiresAt`.

**Sobre armazenar token recuperável (§12)**: o requisito "o dono copia o link depois" **exige** recuperação.
As opções são (a) guardar o token em claro, (b) guardar cifrado com chave fora do banco, (c) não guardar e
reemitir a cada cópia. O projeto **já escolheu (b)** para o RDO e a implementação é sólida: AES-256-GCM,
chave derivada de `SIGNATURE_TOKEN_SECRET` (cuja ausência **quebra o boot em produção**, ver
`assertProductionSignatureTokenSecretConfigured`), com rotação suportada por
`PREVIOUS_SIGNATURE_TOKEN_SECRETS`. Vazamento do dump do banco **não** entrega os links. Adotamos (b) sem
alteração. (c) foi rejeitada porque invalidaria o link já enviado por e-mail toda vez que o dono clicasse em
"copiar" — pior segurança operacional e pior UX.

**Regras de log**: o token nunca aparece em log, URL de log, mensagem de erro ou auditoria. A auditoria
referencia o convite por `signerId`. Quando um log precisar identificar um convite, usa
`tokenHash.slice(0, 8)`.

### D6 — Expiração por convite, prazo único definido na publicação

**Decisão**: `tokenExpiresAt` fica **no convite** (espelha `ReportSignature.tokenExpiresAt`). Na publicação o
dono escolhe **um** prazo, aplicado a todos os convites. A renovação é **por convite** e pode estender só
aquele.

**Por quê**: é o modelo do sistema atual (nada novo a inventar) e é o que a operação real pede — o expirado
costuma ser um assinante, não a rodada. Um `roundExpiresAt` no documento seria um segundo relógio a manter
sincronizado.

**UX**: `select` com opções pré-definidas (7 / 15 / 30 / 60 dias) + opção "Data específica" com
`<input type="date">`. O backend recebe **ou** `expiresInDays` **ou** `expiresAt` (ISO), valida
`> agora + 1h` e `<= agora + ASSINATURAS_TOKEN_MAX_DAYS` (default 90). Exibição sempre em
`America/Sao_Paulo` via `Intl.DateTimeFormat` (padrão de `formatDateTimePtBr`); persistência em UTC.

### D7 — Permissão única: `assinaturas:user`

**Decisão**: módulo `assinaturas` no registry com **uma** role, `assinaturas:user`
(code Prisma `ASSINATURAS_USER`, label "Assinaturas - Usuário", `accountTypes: ["ADMIN","INTERNAL"]`).
Guard: `requireModuleRole('assinaturas:user')`.

**Por quê**: `docs/PADRAO_MODULO.md` define o **formato** `<modulo>:<papel>` (exemplifica manager/viewer/signer),
não um conjunto fechado. Como §3 exige explicitamente ausência de hierarquia, `manager`/`viewer` seriam nomes
mentirosos. O scaffold `npm run new:module` gera manager+viewer por padrão — a entrada será ajustada à mão
depois de rodá-lo (ou escrita direto no registry). Ver P-1.

**Importante**: ter `assinaturas:user` dá acesso ao **módulo**, nunca aos documentos alheios (D10).

> **Decidido em 2026-08-21**: `assinaturas:user` confirmado.

### D8 — PDF final: carimbo posicionado + página de evidências, em lib própria

**Decisão**: `lib/assinaturas/final-pdf.js` (novo) faz, em uma passada com `pdf-lib`:
1. revalida `sha256(PDF original) === sourceDocumentHash` (409 se divergir, igual a `writeFinalEvidencePdf`);
2. embute a imagem de cada assinatura **na posição do campo**, preservando aspect ratio dentro da caixa, com
   uma legenda discreta (nome + data/hora pt-BR) abaixo;
3. **anexa a página de evidências** — status, nome do arquivo, hash do original, código de validação, QR
   clicável, e por assinante: nome declarado, e-mail (ou "—"), data/hora UTC, IP, navegador resumido;
4. grava como `<nome>-assinado.pdf` via `writeManagedDocumentFile` e devolve `finalDocumentHash`.

**Sobre duplicação**: o layout da página de evidências repete parte de
`internal-report-signatures.js:writeFinalEvidencePdf`. **Não extraímos** essa função para uma lib comum agora:
ela é acoplada a `report`/`version`/`project`/`ReportSignatureStatus` e mexer nela é mexer no caminho de
finalização do RDO em produção — refactor amplo vetado pelo briefing e pela constitution. Reutilizamos os
**primitivos já compartilhados** (`createValidationQrCodeMatrix`, `parseSignatureImageDataUrl`,
`signatures/common.js`) e duplicamos ~120 linhas de desenho. Follow-up registrado: quando o módulo estabilizar,
extrair `lib/signatures/evidence-page.js` em PR próprio, com teste de golden-file no RDO antes e depois.

### D9 — Validação pública do documento final

**Decisão**: `validationCode` novo (`randomBytes(18).toString('base64url')`, `@unique`) no `SignatureDocument`
e endpoint público `GET /api/assinaturas/validar/:code` (rate-limited), com página
`/validar-documento/:code`. `SignatureValidationPage.tsx` é **parametrizada** para aceitar as duas origens
(RDO e avulso) em vez de duplicada — mudança pequena e de baixo risco na página, sem tocar no endpoint do RDO.

### D10 — Owner isolation: um único ponto de passagem

**Decisão**: **todo** acesso autenticado a documento passa por
`documentForOwnerOrThrow(id, ownerUserId, { include, allowArchived, allowDeleted })` em
`lib/assinaturas/access.js`, que executa
`prisma.signatureDocument.findFirst({ where: { id, ownerUserId, deletedAt: null } })` e lança **404** quando não
encontra. A listagem sempre injeta `ownerUserId` no `where`. Nenhuma rota autenticada recebe o documento por
outro caminho.

- **404, não 403**: não revela a existência de documento alheio (evita oráculo de IDs).
- **Sem bypass de ADMIN** — *decidido em 2026-08-21*: um `ADMIN` com a permissão só vê os próprios documentos,
  sem nenhuma visão administrativa na aplicação. É o que §4 pede ("mesmo que sejam gestores"). O caso de
  funcionário desligado é resolvido pela exclusão de conta (D16), não por um bypass de leitura.
- **Sem exceção por sub-recurso**: assinantes, campos, auditoria, PDFs, previews e links são todos carregados
  **a partir do documento já validado**, nunca por id próprio. Isso elimina a classe inteira de IDOR de
  sub-recurso.

### D11 — Assinaturas em paralelo

**Decisão**: MVP paralelo. Todos os convites são emitidos na publicação e qualquer um pode assinar a qualquer
momento. É o comportamento do RDO hoje (nenhum campo de ordem existe).

**Futuro barato**: `SignatureDocumentSigner.position` já existe (para ordenar a exibição). Sequencial seria
"emitir token só do próximo `position` pendente" — poucas linhas em `invites.js`, sem migração. Fica fora do MVP.

### D12 — O dono como assinante

**Decisão**: **suportado e trivial**. O dono aparece como um `SignatureDocumentSigner` normal (nome e e-mail
pré-preenchidos com os dados da conta), com campo e token próprios. A UI oferece "Assinar agora" que abre o
mesmo link público em nova aba. Nenhuma regra especial no backend — o fluxo público é idêntico.

**Custo**: um botão e um pré-preenchimento. Sem aumento relevante de escopo.

### D13 — Arquivar ≠ excluir

| | Arquivar | Excluir |
|---|---|---|
| Campo | `archivedAt` (padrão `EpiRecord`) | `deletedAt` (padrão `Report`/`Project`/`QualityRecord`) |
| Efeito nos links | **Nenhum** — o documento continua assinável | **Invalidados imediatamente** (`tokenHash = NULL`, convites pendentes → `REVOGADO`) |
| Efeito no status | Nenhum. É atributo ortogonal de organização, não muda o significado jurídico | Documento sai de todas as listagens |
| Reversível | Sim (`POST /:id/restaurar`) | Sim, dentro da janela de retenção (`POST /:id/restaurar-excluido`), **mas os links não voltam** — o dono precisa renovar cada convite |
| Arquivos | Preservados | Preservados durante a retenção; purgados depois |
| Auditoria | Preservada | Preservada **inclusive após a purga dos arquivos** |

**Comportamento por status na exclusão**: `RASCUNHO` → exclusão direta (só confirmação). `AGUARDANDO_ASSINATURAS`
→ confirmação com aviso explícito de que os links serão invalidados. `CONCLUÍDO` → confirmação reforçada
(digitar o nome do documento), porque há valor probatório; o PDF final e a auditoria **não** são apagados na
exclusão lógica.

**Retenção** (*decidida em 2026-08-21*): `ASSINATURAS_DELETED_RETENTION_DAYS` = **90**. Após o prazo, o job **remove os bytes**
(original, final, previews) e **zera os caminhos**, mantendo a linha do documento e toda a auditoria — mesma
filosofia do `data-retention.js`, que anonimiza a trilha em vez de apagá-la.

### D16 — Exclusão de conta: apaga os não concluídos, preserva os concluídos

*Decisão do solicitante em 2026-08-21.* `DELETE /api/admin/accounts/:id` (`users.js:416`) hoje faz
`prisma.user.delete()` — exclusão **física** real. As relations atuais do `User` são `SetNull` (relatórios
sobrevivem com autor nulo) ou `Cascade` (sessões, papéis). Este módulo entra assim:

- `SignatureDocument.ownerUserId` é **anulável**, com `onDelete: SetNull`.
- Antes do `user.delete()`, uma rotina explícita (`assinaturas.prepareUserDeletion(tx, userId)`) **apaga** os
  documentos do usuário cujo status **não** é `CONCLUIDO` — rascunhos, aguardando assinaturas e cancelados —
  junto com assinantes, campos e trilha (cascade das tabelas filhas), coletando os caminhos dos arquivos.
- Os documentos **`CONCLUIDO`** sobrevivem com `ownerUserId = NULL` e recebem um evento de auditoria
  `PROPRIETARIO_REMOVIDO`. Motivo: carregam assinaturas de terceiros com valor probatório; apagá-las junto com
  a conta destruiria evidência de forma irreversível.
- Após o commit, os arquivos coletados (original, final, previews) são **purgados imediatamente** — *decidido
  em 2026-08-21*. Os 90 dias de retenção valem só para a exclusão feita pelo dono, onde a linha do documento
  permanece e a restauração é possível; aqui a linha some de vez, então guardar bytes criaria arquivo órfão
  irrestaurável e não auditável.
- A tela de exclusão de conta mostra o impacto antes de confirmar:
  *"7 documentos de assinatura serão excluídos permanentemente. 3 documentos concluídos serão preservados."*
  Alimentada por `GET /api/admin/accounts/:id/impacto` (ver H.1).

**Documento órfão é inacessível pela aplicação.** Toda consulta autenticada usa
`where: { id, ownerUserId: <id do usuário> }` e `NULL` nunca casa com um id real — nem para ADMIN.
`documentForOwnerOrThrow` **lança** se receber `ownerUserId` nulo/indefinido, para que um bug futuro não vire
`ownerUserId: null` e exponha o acervo. O acesso a um órfão é operacional, por consulta direta documentada:

```sql
-- rode no servidor, apenas quando houver demanda jurídica formal
SELECT id, title, "originalFileName", "completedAt", "validationCode", "finalDocumentHash"
FROM "SignatureDocument" WHERE "ownerUserId" IS NULL ORDER BY "completedAt" DESC;
```

**Alteração em módulo existente, justificada**: `backend/src/routes/resources/users.js` ganha a chamada da
rotina e o endpoint de impacto. É a mudança mínima possível — sem ela, o `SetNull` transformaria **todos** os
documentos do usuário em órfãos silenciosos, o oposto do pedido. A alternativa (`onDelete: Restrict`) travaria
o desligamento de funcionário, e o `Cascade` puro apagaria as assinaturas de terceiros.

### D14 — E-mail: falha nunca corrompe o processo

**Decisão**: a publicação **cria os convites e commita** primeiro; o envio acontece **depois**, fora da
transação. Cada convite tem `emailStatus` (`NAO_APLICAVEL` | `PENDENTE` | `ENVIADO` | `FALHOU`),
`emailAttempts`, `emailSentAt`, `emailLastError` (mensagem truncada, **nunca** o link) e `emailClaimedAt`.

Diferente do RDO — que **apaga o token** quando o envio falha, para reemitir no retry — aqui o token
**permanece válido**, porque §13 exige que o dono possa copiar o link manualmente mesmo com o e-mail falhando.
O retry roda em `lib/assinaturas/jobs.js` sob `acquireJobLock`, usando `emailClaimedAt` como trava (padrão de
`reminderClaimedAt`), com backoff e teto de 5 tentativas. Assinante sem e-mail nasce `NAO_APLICAVEL` e
**nenhuma tentativa de envio ocorre**.

### D15 — Storage e download

**Decisão**: arquivos sob `env.uploadDir` via `documents/storage.js`, em
`Assinaturas/Documentos/`, `Assinaturas/Assinados/` e `Assinaturas/Previews/<documentId>/`.
**Não** usamos o padrão de "token público de anexo" (`/api/qualidade-anexos/:token`) — esses links são
não-autenticados por design, incompatível com §4. Downloads do dono passam por rota autenticada + owner check
e respondem com `Cache-Control: no-store` (padrão de `sendDownloadBuffer` em `reports.js:1249`).
`resolveManagedDocumentPath` com `requiredPrefix: 'Assinaturas/'` bloqueia qualquer escape de diretório.

---

# E. Modelo de dados

Detalhe completo com tipos, índices e constraints em **`data-model.md`**. Resumo:

**Já existe (sem alteração de estrutura):** `User` (ganha relations de volta), `ModuleRole`, `JobLock`, `JobRun`.

**Enums novos:** `SignatureDocumentStatus` (`RASCUNHO`, `AGUARDANDO_ASSINATURAS`, `CONCLUIDO`, `CANCELADO`),
`SignatureDocumentSignerStatus` (`PENDENTE`, `VISUALIZADO`, `ASSINADO`, `EXPIRADO`, `REVOGADO`),
`SignatureDocumentAuditAction` (18 valores, ver seção K).
**Enums estendidos:** `AppModule` += `ASSINATURAS`; `ModuleRoleCode` += `ASSINATURAS_USER`.

**Tabelas novas:**

| Tabela | Papel | Constraints-chave |
|---|---|---|
| `SignatureDocument` | O documento avulso | `ownerUserId` (FK `Restrict`), `status`, `sourceStoragePath`, `sourceDocumentHash`, `finalStoragePath`, `finalDocumentHash`, `validationCode @unique`, `originalFileName`, `fileSizeBytes`, `pageCount`, `publishedAt`, `completedAt`, `canceledAt`, `archivedAt`, `deletedAt`. Índices: `[ownerUserId, deletedAt, archivedAt, createdAt]`, `[ownerUserId, status]`, `[deletedAt]` |
| `SignatureDocumentSigner` | Assinante + convite (token, validade, evidências) | `documentId` (Cascade), `name`, `email?`, `position`, `status`, `tokenHash @unique`, `tokenEncrypted/Iv/AuthTag`, `tokenExpiresAt`, `viewedAt`, `signedAt`, `revokedAt`, `declaredSignerName`, `signatureImageDataUrl`, `ipAddress`, `userAgent`, `privacyNotice*`, `email*`, `renewalCount`. `@@unique([documentId, position])` |
| `SignatureDocumentField` | Posição do campo no PDF | `documentId` (Cascade), `signerId` (Cascade), `pageNumber`, `x/y/width/height` `Decimal(9,8)`, `pageWidthPt`, `pageHeightPt`, `pageRotation`. Índices `[documentId, pageNumber]`, `[signerId]` |
| `SignatureDocumentAuditLog` | Trilha append-only | `documentId` (Cascade), `signerId?` (SetNull), `actorUserId?` (SetNull), `action`, `description?`, `ipAddress?`, `userAgent?`, `createdAt`. Índices `[documentId, createdAt]`, `[action]` |

**Convenções seguidas** (`docs/PADRAO_MODULO.md` → "Banco"): `createdAt`/`updatedAt`, dono explícito, status
explícito, índices para as listagens principais, soft delete, tabela de auditoria dedicada.

**Não há relacionamento com `Project`, `Report` ou `Collaborator`** — é justamente o ponto do módulo.

---

# F. Estados e transições

## F.1 Documento

```text
                 upload
                   │
                   ▼
             ┌───────────┐   publicar (validações §9)   ┌──────────────────────────┐
             │ RASCUNHO  │ ───────────────────────────► │ AGUARDANDO_ASSINATURAS   │
             └───────────┘ ◄─────────────────────────── └──────────────────────────┘
                   │        despublicar (0 assinaturas)      │            │
                   │                                          │            │ última assinatura
                   │ excluir                        cancelar  │            ▼
                   │                                          │      ┌───────────┐
                   ▼                                          ▼      │ CONCLUIDO │
              (deletedAt)                              ┌───────────┐ └───────────┘
                                                       │ CANCELADO │       │ excluir
                                                       └───────────┘       ▼
                                                                     (deletedAt)
```

`archivedAt` e `deletedAt` são **ortogonais** ao status (um documento `CONCLUIDO` pode estar arquivado sem
deixar de ser `CONCLUIDO`). "Expirado" **não** é status de documento: deriva de "todos os convites pendentes
estão expirados" e é exibido como badge na UI (§16: não criar status derivável).

**Ações permitidas por estado (dono):**

| Ação | RASCUNHO | AGUARDANDO (0 assin.) | AGUARDANDO (≥1 assin.) | CONCLUIDO | CANCELADO |
|---|:--:|:--:|:--:|:--:|:--:|
| Ver detalhes / auditoria | ✅ | ✅ | ✅ | ✅ | ✅ |
| Baixar PDF original | ✅ | ✅ | ✅ | ✅ | ✅ |
| Baixar PDF final | — | — | — | ✅ | — |
| Trocar PDF | ✅ | ❌ | ❌ | ❌ | ❌ |
| Add/editar/remover assinante | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mover/criar/apagar campo | ✅ | ❌ | ❌ | ❌ | ❌ |
| Publicar | ✅ | — | — | — | ❌ |
| Despublicar (volta a RASCUNHO) | — | ✅ | ❌ | ❌ | ❌ |
| Copiar link de convite | — | ✅ | ✅ (pendentes) | ❌ | ❌ |
| Renovar convite | — | ✅ | ✅ (pendente/expirado) | — | ❌ |
| Revogar convite | — | ✅ | ✅ (pendente) | ❌ | ❌ |
| Reenviar e-mail | — | ✅ | ✅ (pendentes com e-mail) | — | ❌ |
| Cancelar documento | ❌ | ✅ | ✅ | ❌ | — |
| Arquivar / restaurar | ✅ | ✅ | ✅ | ✅ | ✅ |
| Excluir (soft) | ✅ | ✅ | ✅ | ✅ | ✅ |

## F.2 Assinante/convite

```text
  (documento publicado)
          │
          ▼
     ┌──────────┐  abre o link   ┌─────────────┐   assina    ┌──────────┐
     │ PENDENTE │ ─────────────► │ VISUALIZADO │ ──────────► │ ASSINADO │  (terminal)
     └──────────┘                └─────────────┘             └──────────┘
        │     │                        │
        │     │ tokenExpiresAt passou   │ tokenExpiresAt passou
        │     ▼                        ▼
        │  ┌──────────┐  renovar  ┌──────────┐
        │  │ EXPIRADO │ ────────► │ PENDENTE │
        │  └──────────┘           └──────────┘
        │
        │ revogar / documento cancelado ou excluído
        ▼
     ┌──────────┐
     │ REVOGADO │  (terminal)
     └──────────┘
```

`ASSINADO` é **terminal e imutável**: nem revogação, nem cancelamento, nem exclusão do documento alteram a
assinatura ou suas evidências. `VISUALIZADO` só avança a partir de `PENDENTE` (nunca regride de `ASSINADO`).
A expiração é aplicada de forma **preguiçosa** no primeiro acesso após o vencimento (padrão de
`expirePendingPublicEpiRequest`) e também por um job diário, para que a listagem do dono fique correta sem
depender de o assinante abrir o link.

---

# G. Segurança e autorização

### G.1 Owner isolation / IDOR-BOLA

- Ponto único: `documentForOwnerOrThrow()` (D10). Toda rota autenticada — **listagem, detalhes, PDF original,
  PDF final, preview de página, assinantes, campos, auditoria, links, renovação, revogação, reenvio de e-mail,
  publicação, despublicação, cancelamento, arquivamento, restauração, exclusão e download** — chama esse helper
  antes de qualquer leitura ou escrita.
- Sub-recursos (`signerId`, `fieldId`) **nunca** são consultados por id isolado: são resolvidos dentro do
  documento já autorizado (`document.signers.find(...)`), o que impede "documento A + signer de B".
- IDs são `cuid()`, mas **isso não é o mecanismo de autorização** — a autorização é o filtro `ownerUserId`.
- Resposta 404 uniforme para "não existe" e "não é seu".
- Teste dedicado obrigatório: usuário B recebe 404 em **cada** rota do documento de A (M-3).

### G.2 Segurança do link público

| Vetor | Mitigação |
|---|---|
| Adivinhação de token | 256 bits de entropia (`randomBytes(32)`), lookup **só** por `tokenHash` SHA-256 com índice único |
| Vazamento de banco | Token nunca em claro; cópia cifrada com AES-256-GCM e chave fora do banco (`SIGNATURE_TOKEN_SECRET`, obrigatória em produção) |
| Expiração | `tokenExpiresAt` verificado em **toda** rota pública; expiração preguiçosa grava `EXPIRADO` e audita |
| Revogação | `tokenHash = NULL` torna o token irresolvível para sempre; usada em revogar, cancelar, excluir e **renovar** |
| Renovação segura | Novo `signatureTokenData()` sobrescreve `tokenHash`/cifra em uma única `update` — o token anterior deixa de resolver no mesmo instante, atomicamente |
| Replay | A assinatura é idempotente por `updateMany({ where:{ id, status: PENDENTE } })`; um replay retorna o mesmo resultado, não uma segunda assinatura |
| Enumeração / força bruta | `createMemoryRateLimit` (60 req/15 min por IP+rota) em **todas** as rotas públicas |
| Vazamento entre assinantes | O payload público expõe **apenas** o próprio assinante (nome + status) e metadados do documento (nome do arquivo, nº de páginas, quantos faltam). **Nunca** nome, e-mail ou status individual dos demais, nem o e-mail do dono |
| Acesso ao storage | Sem URL pública de arquivo. O PDF público é servido pela rota do token, com `resolveManagedDocumentPath(requiredPrefix:'Assinaturas/')` |
| Cache de página pública | `Cache-Control: no-store` em toda resposta pública com conteúdo do documento; preview público idem |
| CSRF | Autenticação por `Bearer` em header (`middleware/auth.js`), não cookie → não há CSRF nas rotas autenticadas. As rotas públicas são autorizadas pelo token na própria URL e não têm efeito colateral cross-site além da assinatura, que exige payload JSON próprio |
| CORS | `app.js` já restringe por `ALLOWED_ORIGIN`; nenhuma exceção nova |
| Token no frontend | O token vive no path da rota pública e no clipboard quando o dono copia. **Nunca** em `localStorage`, query string logada, ou telemetria. O `SignatureDialog` só guarda o *nome* do signatário em `localStorage` |
| Logs | Regra dura: `console.*`/observabilidade só recebem `tokenHash.slice(0,8)`. `morgan('dev')` loga o path — por isso a rota pública usa `:token` no path… **ação necessária**: adicionar um `skip`/token-masking do `morgan` para `/api/assinaturas/publico/*` (ver O-6) |

### G.3 Upload

- Data URL `application/pdf` obrigatória; base64 decodificado; **magic bytes `%PDF`** verificados
  (padrão `qualidade/attachments.js`); teto `ASSINATURAS_MAX_PDF_MB` (default 20).
- Contagem de páginas e sanidade estrutural por `PDFDocument.load()` do `pdf-lib` — um arquivo que não abre é
  rejeitado com 400 antes de qualquer gravação. Teto `ASSINATURAS_MAX_PAGES` (default 50).
- PDFs criptografados/protegidos por senha são rejeitados (o `load` falha ou exige `ignoreEncryption`; não
  passamos essa flag).
- **Não executamos nem renderizamos JavaScript do PDF.** O `pdfjs-dist` roda no backend com
  `isEvalSupported: false`; o preview vira PNG estático, então nenhum conteúdo ativo do PDF chega ao browser.
- Nome original é armazenado como metadado e **sanitizado** por `safeDocumentPathPart` antes de virar nome de
  arquivo; o `Content-Disposition` usa `inlineContentDisposition` (já normaliza).
- O `pdf-lib` re-serializa o documento na finalização, o que descarta a maior parte de estruturas ativas.

### G.4 Privacidade (§25)

O app já tem política e artefatos (`LGPD_COMPLIANCE.md`, `LGPD_ROPA.md`, `privacy-consent.js`,
`data-retention.js`). Impactos deste módulo, **sem criar política nova**:

- **Dados de terceiros**: nome (obrigatório) e e-mail (opcional) de assinantes externos passam a ser tratados
  pelo app. Base legal e finalidade são as mesmas já declaradas para a assinatura de RDO/EPI. **Ação**:
  acrescentar a operação ao `LGPD_ROPA.md` (uma linha) — ver P-4.
- **IP/User-Agent**: coletados como evidência de assinatura, exatamente como nos fluxos atuais, e sujeitos à
  anonimização por `data-retention.js` após o cutoff (a extensão do job é tarefa E7).
- **Aviso ao assinante**: nova variante `signatureAvulsa` do `PrivacyNotice`, com versão
  `signature_avulsa_v1` registrada em `privacy-consent.js` e gravada em
  `privacyNoticeVersion`/`privacyNoticeAcceptedAt` — mesmo mecanismo de RDO/EPI.
- **Retenção**: documentos excluídos têm os bytes purgados após `ASSINATURAS_DELETED_RETENTION_DAYS`;
  a trilha permanece (anonimizada no cutoff geral).
- **Backups**: sem mudança de procedimento; o conteúdo do documento é do usuário e segue a política do app.
- **Direitos do titular**: um assinante externo que solicitar exclusão cai no fluxo existente de
  `DataSubjectRequest`; o operador precisa saber que a **assinatura concluída é evidência jurídica** e não é
  apagável isoladamente. Decisão de produto em P-4.

---

# H. Backend

## H.1 Endpoints

Contrato detalhado (payloads, códigos de erro) em **`contracts/api.md`**. Todos sob `/api/assinaturas`.

### Públicos (registrados **antes** do `router.use(requireAuth, requireAssinaturasAccess)`, todos com `publicSignatureLimiter`)

| Método + rota | Finalidade | Autorização | Entrada | Saída | Serviço |
|---|---|---|---|---|---|
| `GET /publico/:token` | Carregar o convite | Token válido e não expirado/revogado | — | Status + metadados do documento + **apenas o próprio assinante** + progresso agregado | `signing.loadInvite` |
| `GET /publico/:token/pdf` | Baixar o PDF a assinar (ou o final, se concluído) | Idem | — | `application/pdf`, `no-store` | `signing.invitePdf` |
| `GET /publico/:token/paginas/:n.png` | Preview da página | Idem | `n` ≤ `pageCount` | `image/png`, `no-store` | `preview.renderPage` |
| `POST /publico/:token/assinar` | Registrar a assinatura | Idem + convite `PENDENTE`/`VISUALIZADO` | `{ signerName, signatureImageDataUrl, privacyNoticeAccepted, privacyNoticeVersion }` | `{ success, completed, signer }` | `signing.confirm` |
| `GET /validar/:code` | Validar um PDF final | Código público | — | Status, hashes, lista de assinantes com data/hora | `service.validateByCode` |

Validações do fluxo público: existência do convite → token → expiração → documento não cancelado/excluído →
assinante não revogado → status atual → imagem de assinatura decodificável → hash do PDF-base inalterado.

### Autenticados (`requireAuth` + `requireModuleRole('assinaturas:user')` + **owner check em cada um**)

| Método + rota | Finalidade | Entrada | Saída | Validações principais |
|---|---|---|---|---|
| `GET /documentos` | Listar | `?status&q&arquivados&cursor` | Cards com progresso `assinados/total` | `where.ownerUserId` obrigatório |
| `POST /documentos` | Upload + criação | `{ fileName, pdfDataUrl, title? }` | Documento `RASCUNHO` | data URL PDF, `%PDF`, ≤20 MB, ≤50 páginas, `pdf-lib` abre |
| `GET /documentos/:id` | Detalhes | — | Documento + assinantes + campos + progresso | owner |
| `GET /documentos/:id/pdf` | PDF original | — | `application/pdf` | owner |
| `GET /documentos/:id/pdf-final` | PDF assinado | — | `application/pdf` | owner + `CONCLUIDO` + hash confere |
| `GET /documentos/:id/paginas/:n.png` | Preview | — | `image/png` | owner, `n ≤ pageCount` |
| `PATCH /documentos/:id` | Renomear título | `{ title }` | Documento | owner + `RASCUNHO` |
| `PUT /documentos/:id/assinantes` | Substituir a lista de assinantes | `[{ id?, name, email?, position }]` | Documento | owner + `RASCUNHO`, nome obrigatório, e-mail válido se presente, ≤20, sem e-mail duplicado |
| `PUT /documentos/:id/campos` | Substituir os campos | `[{ signerId, pageNumber, x, y, width, height, pageWidthPt, pageHeightPt, pageRotation }]` | Documento | owner + `RASCUNHO`, `signerId` pertence ao documento, `1 ≤ pageNumber ≤ pageCount`, `0 ≤ x,y`, `x+width ≤ 1`, `y+height ≤ 1`, tamanho mínimo (2% da página) |
| `POST /documentos/:id/publicar` | Validar e publicar | `{ expiresInDays } \| { expiresAt }` | Documento + resumo de envio | **Todas as validações do §9** (ver H.3) |
| `POST /documentos/:id/despublicar` | Voltar a rascunho | — | Documento | owner + `AGUARDANDO` + **zero** assinaturas |
| `GET /documentos/:id/assinantes/:signerId/link` | Recuperar o link | — | `{ url, expiresAt }` | owner + convite ativo; decifra o token; **audita a recuperação** |
| `POST /documentos/:id/assinantes/:signerId/renovar` | Novo token | `{ expiresInDays } \| { expiresAt }` | `{ url, expiresAt }` | owner + convite não `ASSINADO`/`REVOGADO`; invalida o anterior atomicamente |
| `POST /documentos/:id/assinantes/:signerId/revogar` | Revogar | — | Documento | owner + convite não `ASSINADO` |
| `POST /documentos/:id/assinantes/:signerId/reenviar-email` | Reenviar convite | — | `{ emailStatus }` | owner + convite ativo **com e-mail** |
| `GET /documentos/:id/auditoria` | Trilha | `?cursor` | Eventos ordenados | owner |
| `POST /documentos/:id/cancelar` | Cancelar rodada | `{ reason? }` | Documento | owner + `AGUARDANDO`; revoga pendentes, preserva assinados |
| `POST /documentos/:id/arquivar` / `/restaurar` | Arquivar/desarquivar | — | Documento | owner |
| `DELETE /documentos/:id` | Exclusão lógica | — | `204` | owner; invalida links; audita |
| `POST /documentos/:id/restaurar-excluido` | Desfazer exclusão | — | Documento | owner + dentro da retenção; links **não** voltam |

### Fora do router do módulo — contas do hub (D16)

| Método + rota | Finalidade | Autorização | Saída | Serviço |
|---|---|---|---|---|
| `GET /api/admin/accounts/:id/impacto` | Alimentar a confirmação de exclusão de conta | `requireHubAdmin` | `{ assinaturas: { toDelete: 7, toPreserve: 3 } }` | `assinaturas.userDeletionImpact` |
| `DELETE /api/admin/accounts/:id` (**existente, estendido**) | Excluir conta | `requireHubAdmin` | `204` | + `prepareUserDeletion(tx, userId)` antes do `user.delete()`; purga dos arquivos após o commit |

## H.2 Services / use-cases (`backend/src/lib/assinaturas/`)

| Módulo | Funções principais |
|---|---|
| `access.js` | `requireAssinaturasAccess`, `documentForOwnerOrThrow`, `assertDocumentEditable`, `assertDocumentPublishable`, `ownerListWhere` |
| `document.js` | `parsePdfUpload` (data URL, `%PDF`, tamanho), `createDocument`, `pdfMetadata` (páginas + dimensões por página), `storeSourcePdf`, `sourcePdfBuffer` (revalida hash), `purgeDocumentFiles` |
| `preview.js` | `renderPage(documentId, pageNumber)` com cache em disco, `purgePreviews` |
| `service.js` | `listDocuments`, `getDocument`, `renameDocument`, `replaceSigners`, `replaceFields`, `publishDocument`, `unpublishDocument`, `cancelDocument`, `archive`/`restore`, `softDelete`/`restoreDeleted`, `validateByCode`, `documentProgress`, `userDeletionImpact`, `prepareUserDeletion` |
| `invites.js` | `issueInvites(tx, document, expiresAt)`, `renewInvite`, `revokeInvite`, `revokeAllPending`, `inviteUrl(token)`, `recoverInviteLink`, `resolveInviteByToken`, `expireOverdueInvites` |
| `signing.js` | `loadInvite`, `markViewed`, `confirmSignature` (idempotente, transacional), `finalizeIfComplete` |
| `final-pdf.js` | `buildFinalPdf(document)` → carimbo posicionado + página de evidências + QR; devolve `{ storagePath, hash }` |
| `audit.js` | `recordDocumentEvent(client, { document, signer, actorUserId, action, description, evidence })` |
| `notifications.js` | `sendInviteEmail(signer, document)`, `sendCompletedEmail(document)`, `queueInviteEmails(document)` |
| `jobs.js` | `startAssinaturasJobs()` → job de retry de e-mail + job de expiração/retenção, ambos sob `acquireJobLock` |

## H.3 Validações de publicação (§9), em ordem

1. Documento em `RASCUNHO` e não arquivado/excluído.
2. PDF existe no storage e `sha256(bytes) === sourceDocumentHash` (integridade do arquivo em disco).
3. `signers.length >= 1` e `<= ASSINATURAS_MAX_SIGNERS`.
4. Todo assinante tem `name` não vazio (mín. 2 caracteres).
5. E-mails presentes são válidos e não se repetem entre assinantes.
6. Todo assinante tem **pelo menos um** campo.
7. Todo campo aponta para um `signerId` **deste** documento, com `pageNumber` dentro de `1..pageCount` e caixa
   dentro dos limites normalizados.
8. Prazo válido: `expiresAt > agora + 1h` e `<= agora + ASSINATURAS_TOKEN_MAX_DAYS`.
9. Se houver assinante com e-mail: SMTP configurado **ou** `SEND_CLIENT_EMAILS=false`. Se faltar configuração
   SMTP, a publicação **não é bloqueada** — os convites nascem `FALHOU` e o dono copia os links (§13:
   falha de e-mail não corrompe o processo). Isso difere do RDO, que bloqueia; a diferença é intencional e
   deve constar no PR.

Falha em qualquer item → `400` com a lista de pendências (para a UI destacar campo a campo).

## H.4 Jobs

| Job | Frequência | Lock | O que faz |
|---|---|---|---|
| `assinaturas:invite-emails` | 5 min | `acquireJobLock('assinaturas:invite-emails')` + `emailClaimedAt` por convite | Reenvia convites `PENDENTE`/`FALHOU` com `emailAttempts < 5`, backoff exponencial |
| `assinaturas:maintenance` | 24 h | `acquireJobLock('assinaturas:maintenance')` | Marca convites vencidos como `EXPIRADO` (+auditoria); purga arquivos e previews de documentos excluídos além da retenção |

Ambos registram execução em `JobRun` (padrão `lib/jobs/runner.js`) e vivem em `lib/assinaturas/jobs.js` —
nunca exportados de arquivo de rota (regra do `architecture-check`).

---

# I. Frontend

## I.1 Páginas e componentes

| Tela | Arquivo | Reuso | Estados tratados |
|---|---|---|---|
| **Listagem** | `pages/assinaturas/AssinaturasPage.tsx` + `components/DocumentCard.tsx` | `SearchBar`, `Skeleton`, `Button`, `Toast`, grade de cards do padrão Estoque/Qualidade | loading (skeleton de cards), empty ("Nenhum documento ainda" + CTA), erro com retry, aba Arquivados, filtro por status, busca por nome (`?q=`) |
| **Novo documento** | `components/NewDocumentModal.tsx` | `Modal`, `PdfDropzone`, `Button`, `field-group`/`field-error` | upload em andamento (barra + botão desabilitado), arquivo inválido ("Envie um arquivo PDF válido"), arquivo grande, PDF ilegível/protegido, falha de rede |
| **Configuração** | `components/DocumentSetupView.tsx` + `PdfPageCanvas.tsx` + `SignerList.tsx` | `Button`, `Modal`, tokens; navegação de páginas própria | página carregando (skeleton da página), assinante sem campo (aviso inline), campo fora da página (bloqueado no drag), autosave com indicador (padrão `DraftSaveStatus.tsx`) |
| **Publicação** | `components/PublishDialog.tsx` | `Modal`, `ConfirmDialog`, `Button`, `select` do kit | resumo de assinantes, escolha de validade, lista de pendências de validação vinda do 400, publicando (spinner), aviso "e-mail indisponível — copie os links" |
| **Detalhes** | `components/DocumentDetailView.tsx` + `SignerStatusList.tsx` + `AuditTrail.tsx` | `det-section`/`det-row` (padrão `ReportDetailPage`), `ConfirmDialog`, `Toast`, `Button` | por assinante: nome, e-mail ou "—", badge de status, data/hora da assinatura, botão **Copiar link** (com toast "Link copiado"), Renovar, Revogar, Reenviar e-mail com badge de falha; downloads; auditoria paginada; confirmações de arquivar/excluir |
| **Assinatura pública** | `pages/assinaturas/AssinaturasPublicSignPage.tsx` | **`SignatureDialog` sem fork**, `PrivacyNotice`, shell `survey-page-shell` das páginas públicas | link inválido, expirado (com texto "peça um novo link a quem enviou"), revogado, documento cancelado/inexistente, já assinado (confirmação + download), assinando (spinner), erro de rede |
| **Validação pública** | `pages/SignatureValidationPage.tsx` (estendida) | página existente parametrizada | código inválido, documento não concluído |

## I.2 Editor de posicionamento (`PdfPageCanvas.tsx`)

- Renderiza `<img src={pagePngUrl}>` dentro de um contêiner `position: relative` com `overflow: auto` **próprio**
  (nunca scroll horizontal de página).
- Campos são `<div>` absolutos com `left/top/width/height` em **percentual** — a conversão para/de o modelo
  normalizado é literalmente `x * 100 + '%'`, então a posição é correta em qualquer largura sem recálculo.
- Arrastar/redimensionar por **Pointer Events** com `touch-action: none` (mesma exigência do padrão de drag &
  drop do app), com clamp em `[0,1]` e tamanho mínimo.
- Cada campo mostra o nome do assinante e usa uma cor derivada do índice (paleta dos tokens), para deixar óbvio
  o vínculo campo↔assinante.
- `pageWidthPt`/`pageHeightPt` vêm do `GET /documentos/:id` (metadados por página) e são enviados junto ao salvar.
- Acessibilidade: cada campo é focável e move-se com as setas do teclado (passo de 0,5%).

## I.3 Camada de dados

`frontend/src/api/assinaturas.ts` (tipos + chamadas via `apiClient`) e
`frontend/src/hooks/useAssinaturas.ts` (react-query: `['assinaturas','list',filtros]`,
`['assinaturas','doc',id]`, `['assinaturas','auditoria',id]`, `['assinaturas','publico',token]`),
com invalidação após cada mutação — mesmo padrão de `hooks/useReports.ts` e `api/qualidade.ts`.

## I.4 Onboarding

Módulo novo ⇒ **tutorial permanente de primeiro acesso** (driver.js), no padrão de `HubTutorial.tsx` /
`ClientTutorial.tsx`, cobrindo: enviar PDF → adicionar assinantes → posicionar campos → publicar → copiar links
→ acompanhar. Novidade temporária de 10 dias **não** se aplica (isso é para função nova dentro de módulo
existente); o card do hub já sinaliza o módulo novo.

---

# J. Fluxo completo

**1. Criação.** O usuário com `assinaturas:user` abre `/assinaturas` → "Novo documento" → arrasta o PDF.
O frontend converte para data URL e chama `POST /documentos`. O backend valida (`%PDF`, tamanho, `pdf-lib`
abre), calcula `sha256`, conta páginas e coleta as dimensões de cada página, grava o arquivo em
`Assinaturas/Documentos/` via `writeManagedDocumentFile` e cria o `SignatureDocument` `RASCUNHO` com
`ownerUserId = req.auth.user.id`. Auditoria: `DOCUMENTO_CRIADO`.

**2. Configuração.** Tela dividida: à esquerda a lista de assinantes (nome obrigatório, e-mail opcional, botão
"sou eu" que preenche com os dados da conta), à direita a página do PDF renderizada pelo backend. O usuário
seleciona um assinante e clica/arrasta na página para criar o campo. Salvamento por
`PUT /documentos/:id/assinantes` e `PUT /documentos/:id/campos` (substituição completa, idempotente).
Auditoria: `CONFIGURACAO_ATUALIZADA` (agregado, não um evento por arrasto).

**3. Publicação.** "Publicar" abre o `PublishDialog` com o resumo e a escolha de validade.
`POST /documentos/:id/publicar` roda as 9 validações (H.3) em uma transação; se passar: status →
`AGUARDANDO_ASSINATURAS`, `publishedAt`, `validationCode` gerado, e para **cada** assinante um
`signatureTokenData()` grava `tokenHash` + cifra + `tokenExpiresAt`. `emailStatus` nasce `PENDENTE` (com
e-mail) ou `NAO_APLICAVEL` (sem). Auditoria: `DOCUMENTO_PUBLICADO` + um `CONVITE_CRIADO` por assinante.
A transação **commita antes** de qualquer envio.

**4. Envio.** Fora da transação, `queueInviteEmails` percorre os convites `PENDENTE` e envia via
`sendClientMail` com o novo template. Sucesso → `emailStatus = ENVIADO`, `emailSentAt`, auditoria
`EMAIL_ENVIADO`. Falha → `emailStatus = FALHOU`, `emailAttempts++`, `emailLastError` (sem link),
auditoria `EMAIL_FALHOU`, e o job de retry assume. **O link permanece válido e copiável em qualquer cenário.**
A tela de detalhes já mostra os assinantes com "Copiar link".

**5. Assinatura.** O assinante abre `/assinaturas/assinar/:token`. `GET /publico/:token` resolve por
`tokenHash`, checa expiração (expirando preguiçosamente se preciso), marca `VISUALIZADO` na primeira abertura
(auditoria `LINK_ACESSADO` + `DOCUMENTO_VISUALIZADO`) e devolve o payload mínimo. A página mostra a prévia
paginada com o campo **daquele** assinante destacado, o `PrivacyNotice` e o botão Assinar, que abre o
`SignatureDialog`. `POST /publico/:token/assinar` valida a imagem
(`decodableSignatureImageDataUrl`), abre transação, relê o convite por token, e grava com
`updateMany({ where: { id, status: { in: [PENDENTE, VISUALIZADO] } } })` — `count !== 1` ⇒ relê e devolve
idempotência ou 409. Evidências: IP, User-Agent, `signedAt`, `declaredSignerName`, versão do aviso.
Auditoria: `ASSINATURA_REALIZADA`.

**6. Conclusão.** Ainda na mesma transação, um **advisory lock** sobre `documentId`
(`pg_advisory_xact_lock(hashtext($1), 0)`, receita de `lockSignatureRoundForReport`) serializa a checagem
"todos assinaram?". Se sim, `updateMany({ where: { id, status: AGUARDANDO_ASSINATURAS }, data: { status: CONCLUIDO }})`
garante um único vencedor. Após o commit, `buildFinalPdf()` revalida o hash do original, carimba as assinaturas
nas posições, anexa a página de evidências com QR, grava em `Assinaturas/Assinados/` e persiste
`finalStoragePath`/`finalDocumentHash`. Auditoria: `DOCUMENTO_CONCLUIDO` + `PDF_FINAL_GERADO`. O dono recebe
e-mail de conclusão; **só ele** baixa o PDF final pela área autenticada (o assinante recebe o final pelo próprio
link enquanto este não expirar — ver P-3).

**7. Arquivamento / exclusão.** Arquivar (`archivedAt`) tira da listagem principal e nada mais — assinaturas e
links intactos; restaurar traz de volta. Excluir (`deletedAt`) exige confirmação explícita (reforçada se
`CONCLUIDO`), invalida **imediatamente** todos os links ativos (`tokenHash = NULL`, pendentes → `REVOGADO`) e
audita `DOCUMENTO_EXCLUIDO`. Os arquivos permanecem durante `ASSINATURAS_DELETED_RETENTION_DAYS`; depois o job
de manutenção apaga os bytes e zera os caminhos, **preservando a linha do documento e toda a auditoria**.

---

# K. Auditoria

Reaproveita `recordAuditEvent()` (`lib/audit/events.js`) — estendido com
`AUDIT_MODULES.ASSINATURAS` / `AUDIT_ENTITY_TYPES.SIGNATURE_DOCUMENT` — gravando em
`SignatureDocumentAuditLog`. **Append-only**: nenhum código do módulo faz `update`/`delete` nessa tabela
(só o job de retenção pode **anonimizar** IP/UA, como já faz com `ReportAuditLog`).

Campos por evento: `documentId`, `signerId?`, `actorUserId?` (nulo em ação de assinante externo), `action`,
`description` (pt-BR, sem dado sensível), `ipAddress?`, `userAgent?`, `createdAt`.

| `action` | Quando | Evidências |
|---|---|---|
| `DOCUMENTO_CRIADO` | Upload concluído | ator, IP/UA, nome e hash do arquivo na `description` |
| `CONFIGURACAO_ATUALIZADA` | Assinantes/campos salvos | ator, IP/UA, contagem de assinantes/campos |
| `DOCUMENTO_PUBLICADO` | Publicação | ator, IP/UA, validade escolhida |
| `DOCUMENTO_DESPUBLICADO` | Volta a rascunho | ator, IP/UA |
| `CONVITE_CRIADO` | Um por assinante na publicação | `signerId`, expiração |
| `EMAIL_SOLICITADO` | Envio enfileirado | `signerId` |
| `EMAIL_ENVIADO` | SMTP aceitou | `signerId` |
| `EMAIL_FALHOU` | Erro no envio | `signerId`, mensagem truncada **sem link** |
| `LINK_RECUPERADO` | Dono copiou o link | ator, IP/UA, `signerId` |
| `LINK_ACESSADO` | `GET /publico/:token` resolveu | `signerId`, IP/UA (sem ator) |
| `DOCUMENTO_VISUALIZADO` | Primeira abertura do assinante | `signerId`, IP/UA |
| `ASSINATURA_REALIZADA` | Assinatura gravada | `signerId`, IP/UA, nome declarado, versão do aviso |
| `CONVITE_EXPIRADO` | Expiração preguiçosa ou por job | `signerId` |
| `CONVITE_RENOVADO` | Novo token emitido | ator, IP/UA, `signerId`, nova expiração |
| `CONVITE_REVOGADO` | Revogação manual | ator, IP/UA, `signerId` |
| `DOCUMENTO_CONCLUIDO` | Última assinatura obrigatória | `signerId` da última |
| `PDF_FINAL_GERADO` | Arquivo final gravado | `finalDocumentHash` na `description` |
| `DOCUMENTO_CANCELADO` | Cancelamento da rodada | ator, IP/UA, motivo |
| `DOCUMENTO_ARQUIVADO` / `DOCUMENTO_RESTAURADO` | Organização | ator, IP/UA |
| `DOCUMENTO_EXCLUIDO` / `DOCUMENTO_EXCLUSAO_DESFEITA` | Soft delete | ator, IP/UA |
| `ARQUIVOS_PURGADOS` | Retenção cumprida | sem ator (job) |
| `PROPRIETARIO_REMOVIDO` | Conta do dono excluída; documento concluído preservado como órfão (D16) | ator = admin que excluiu a conta, IP/UA |

**Nunca registrado**: token completo, conteúdo do PDF, imagem da assinatura (essa fica na linha do assinante,
não na trilha).

---

# L. Migrations

Duas migrations, ambas **puramente aditivas**. Nenhuma tabela, coluna ou índice existente é alterado ou
removido ⇒ **risco zero para dados atuais** (RDO, EPI, Qualidade e Estoque não são tocados).

### L.1 `<ts>_add_assinaturas_module`

Gerada pelo scaffold (`npm run new:module`) ou escrita à mão:

```sql
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'ASSINATURAS';
ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS 'ASSINATURAS_USER';
```

**Atenção operacional**: no PostgreSQL, `ALTER TYPE ... ADD VALUE` **não pode ser usado no mesmo bloco
transacional em que o novo valor é referenciado**. Por isso os enums vão em uma migration **separada e
anterior** à das tabelas — é exatamente o que o scaffold já faz.

### L.2 `<ts>_add_assinaturas_tables`

`CREATE TYPE` dos 3 enums novos + `CREATE TABLE` das 4 tabelas + índices e FKs (SQL completo em
`data-model.md`). Ordem: enums → `SignatureDocument` → `SignatureDocumentSigner` →
`SignatureDocumentField` → `SignatureDocumentAuditLog`.

### L.3 Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Valor de enum adicionado e usado na mesma transação | Migrations separadas (L.1 antes de L.2) |
| `User` ganha 3 relations novas | Relations Prisma não geram DDL no lado `User`; as FKs ficam nas tabelas novas |
| `ownerUserId` com `onDelete` errado | **`SetNull` + coluna anulável** (D16). `Restrict` travaria o desligamento de funcionário; `Cascade` puro apagaria assinaturas de terceiros. `SetNull` sozinho transformaria tudo em órfão — por isso `prepareUserDeletion` apaga os não concluídos **antes** do `user.delete()` |
| Órfão acessível por engano | `documentForOwnerOrThrow` e `ownerListWhere` lançam se `ownerUserId` for nulo/indefinido; teste dedicado |
| Registry fora de sincronia com o Prisma | O CI já valida `registry.generated.ts` vs `registry.json` e os enums Prisma vs registry. Rodar `npm run modules:generate` no mesmo commit |
| Deploy sem `SIGNATURE_TOKEN_SECRET` | Já é obrigatório em produção desde o RDO (`assertProductionSignatureTokenSecretConfigured`); nada novo |
| Backfill | **Não existe** — módulo novo, sem dados legados |

---

# M. Estratégia de testes

Padrão do repositório: `node --test`, funções puras exportadas do módulo de domínio e client Prisma **fake**
injetado (molde de `backend/test/epi-security.test.js` e `internal-report-signatures.test.js`). Sem banco real.

### M.1 `assinaturas-access.test.js` — permissão e isolamento (crítico)

| # | Cenário | Espera |
|---|---|---|
| 1 | Usuário **sem** `assinaturas:user` chama qualquer rota do módulo | 403 |
| 2 | Usuário **com** `assinaturas:user` chama a listagem | 200 |
| 3 | Conta `ADMIN` sem a role do módulo | 403 (sem bypass) |
| 4 | `ownerListWhere(userId)` sempre inclui `ownerUserId` e `deletedAt: null` | assert estrutural |
| 5 | `documentForOwnerOrThrow` com dono diferente | **404**, nunca 403 |
| 6 | **Matriz de rotas**: para cada uma das 20 rotas de documento, usuário B contra documento de A | 404 em todas |
| 7 | `signerId` de outro documento em `/renovar`, `/revogar`, `/link`, `/reenviar-email` | 404 |
| 8 | `fieldId`/`signerId` de outro documento em `PUT /campos` | 400 |
| 9 | Preview e download de PDF de documento alheio | 404 |
| 10 | `documentForOwnerOrThrow(id, null)` e `ownerListWhere(undefined)` | **lançam** — `ownerUserId: null` nunca chega ao `where` |
| 11 | Documento órfão (`ownerUserId = NULL`) consultado por qualquer usuário, inclusive ADMIN | 404 |

### M.2 `assinaturas-document.test.js` — upload e storage

Data URL não-PDF → 400; magic bytes inválidos (`data:application/pdf` com bytes `PK`) → 400; > limite → 400;
PDF sem páginas / ilegível → 400; PDF válido → hash, `pageCount` e dimensões corretos; `resolveManagedDocumentPath`
recusa `../` e caminho fora de `Assinaturas/`; `purgeDocumentFiles` apaga original, final e previews.

### M.3 `assinaturas-publish.test.js` — configuração e publicação

Assinante sem nome → 400; e-mail inválido → 400; e-mails duplicados → 400; assinante **sem campo** → 400
listando quem falta; campo com `signerId` de fora → 400; `pageNumber` fora de `1..pageCount` → 400;
caixa fora de `[0,1]` ou menor que o mínimo → 400; `expiresAt` no passado / além do teto → 400;
publicação válida → status `AGUARDANDO_ASSINATURAS`, `validationCode` gerado, **um token distinto por
assinante** (asserção explícita de `tokenHash` diferentes); e-mail **só** para quem tem e-mail
(`NAO_APLICAVEL` para os demais, zero chamadas ao mailer); SMTP ausente **não** bloqueia a publicação;
`despublicar` com 0 assinaturas volta a `RASCUNHO` e zera os `tokenHash`; `despublicar` com 1 assinatura → 409;
editar assinantes/campos após publicar → 409.

### M.4 `assinaturas-public-sign.test.js` — fluxo público

Token inexistente → 404; token **incorreto** (hash não bate) → 404; token **expirado** → 410 + convite marcado
`EXPIRADO` + auditoria; token **revogado** → 404; documento cancelado/excluído → 410; assinatura válida →
`ASSINADO` + IP/UA/`signedAt` gravados; **dupla assinatura** (mesmo payload duas vezes) → idempotente, uma só
linha e um só evento de auditoria; imagem de assinatura inválida → 400 **antes** de qualquer escrita;
renovação **invalida o token anterior** (o antigo passa a resolver 404 e o novo funciona);
renovação concorrente com assinatura → exatamente um dos dois vence, sem estado inconsistente;
progresso parcial (2 de 4) reflete corretamente; o payload público **não** contém nome/e-mail dos outros
assinantes (asserção sobre o JSON serializado).

### M.5 `assinaturas-final-pdf.test.js` — finalização

Conclusão após a última assinatura obrigatória; `finalDocumentHash` gerado e estável; hash do PDF-base alterado
em disco → 409 e **nenhum** PDF final gravado; conversão de coordenadas normalizadas → pontos do `pdf-lib`
(casos: origem, canto oposto, página A4 e página rotacionada 90°); página de evidências contém nome, IP e
data/hora de cada assinante; `validationCode` resolve pelo endpoint público; **duas finalizações concorrentes**
produzem um único `CONCLUIDO` e um único `PDF_FINAL_GERADO`.

### M.6 `assinaturas-lifecycle.test.js` — auditoria, arquivamento, exclusão

Cada ação grava exatamente o evento esperado, na ordem esperada; auditoria é append-only (nenhum caminho de
código chama update/delete); arquivar **não** altera status nem invalida links; restaurar volta à listagem;
excluir invalida **todos** os links ativos imediatamente e mantém as assinaturas concluídas intactas;
restaurar excluído **não** revive os tokens; job de retenção purga arquivos e **preserva** a trilha;
job de e-mail com `emailClaimedAt` não envia duas vezes (simulação de duas execuções concorrentes).

**Exclusão de conta (D16)**: `userDeletionImpact` conta corretamente por status; `prepareUserDeletion` apaga
rascunhos/aguardando/cancelados e **não** apaga concluídos; concluídos ficam com `ownerUserId = NULL` e ganham
`PROPRIETARIO_REMOVIDO` na trilha; os caminhos dos arquivos dos apagados são devolvidos para purga e os dos
preservados **não**; a rotina roda dentro da transação do `user.delete()` e um erro nela aborta a exclusão da
conta inteira.

### M.7 Frontend — `frontend/test/assinaturas-coordinates.test.mjs`

Round-trip pixel → normalizado → pixel em três larguras de contêiner; clamp em `[0,1]`; tamanho mínimo;
conversão para o referencial do `pdf-lib` idêntica à do backend (o mesmo caso de teste dos dois lados).

### M.8 Gates de CI

`npm run architecture:check` (nenhum arquivo crítico cresce; nada novo solto em `backend/src/lib/`; job não
exportado de rota), `npm test` (backend e frontend), `npm run lint`, `npm run build`.

---

# N. Plano de implementação

Onze etapas, cada uma um commit revisável. As etapas 1–3 são infraestrutura sem UI; da 4 em diante há valor
entregável a cada passo.

### E1 — Registro do módulo e permissão
- **Objetivo**: o módulo existe no hub, com a permissão única, sem nenhuma funcionalidade.
- **Arquivos**: `shared/modules/registry.json`, `backend/prisma/schema.prisma` (enums),
  `backend/prisma/migrations/<ts>_add_assinaturas_module/migration.sql`,
  `frontend/src/modules/registry.generated.ts` (gerado), `frontend/src/modules/moduleRoutes.tsx`,
  `backend/src/routes/index.js`, `backend/src/routes/resources/assinaturas.js` (casca),
  `backend/src/lib/assinaturas/access.js`, `frontend/src/pages/assinaturas/AssinaturasPage.tsx` (placeholder).
- **Dependências**: nenhuma.
- **Resultado**: usuário com `assinaturas:user` vê o card no hub e abre `/assinaturas` (tela vazia); quem não
  tem, recebe 403/redirect.
- **Testes**: `assinaturas-access.test.js` cenários 1–3; `npm run architecture:check`.

### E2 — Modelo de dados
- **Objetivo**: tabelas e enums no banco.
- **Arquivos**: `backend/prisma/schema.prisma`, `backend/prisma/migrations/<ts>_add_assinaturas_tables/migration.sql`.
- **Dependências**: E1.
- **Resultado**: `prisma generate` expõe os 4 models; nada consome ainda.
- **Testes**: `npm run architecture:check`; migration aplicada em ambiente local pelo desenvolvedor
  (comando de servidor documentado em `quickstart.md`, **não executado pelo agente**).

### E3 — Upload, storage e metadados do PDF
- **Objetivo**: criar documento em `RASCUNHO` a partir de um PDF.
- **Arquivos**: `lib/assinaturas/document.js`, `lib/assinaturas/audit.js`,
  `lib/audit/events.js` (+módulo/entityType), `config/env.js` (+limites), `app.js` (+limite de corpo),
  `routes/resources/assinaturas.js` (`POST /documentos`, `GET /documentos`, `GET /documentos/:id`,
  `GET /documentos/:id/pdf`, `DELETE`), `lib/assinaturas/access.js` (`documentForOwnerOrThrow`).
- **Dependências**: E2.
- **Resultado**: upload por API funciona; documento aparece na listagem **só para o dono**.
- **Testes**: `assinaturas-document.test.js` completo; `assinaturas-access.test.js` cenários 4–6 e 9.

### E4 — Preview de páginas
- **Objetivo**: servir cada página como PNG, autorizado.
- **Arquivos**: `lib/assinaturas/preview.js`, rota `GET /documentos/:id/paginas/:n.png`.
- **Dependências**: E3.
- **Resultado**: a página do PDF é visualizável no browser; cache em disco funcionando.
- **Testes**: unit de cache-key e clamp de `n`; owner check (cenário 9).

### E5 — Assinantes e campos (configuração)
- **Objetivo**: persistir assinantes e posições, com todas as validações de estrutura.
- **Arquivos**: `lib/assinaturas/service.js` (`replaceSigners`, `replaceFields`), rotas
  `PUT /assinantes`, `PUT /campos`, `PATCH /documentos/:id`.
- **Dependências**: E3.
- **Resultado**: configuração completa por API; documento continua `RASCUNHO`.
- **Testes**: `assinaturas-publish.test.js` (parte de configuração); `assinaturas-access.test.js` cenários 7–8.

### E6 — Publicação e convites
- **Objetivo**: validar, publicar e emitir um token por assinante.
- **Arquivos**: `lib/assinaturas/invites.js`, `lib/assinaturas/service.js` (`publishDocument`,
  `unpublishDocument`), rotas `POST /publicar`, `POST /despublicar`,
  `GET /assinantes/:signerId/link`, `POST /renovar`, `POST /revogar`.
- **Dependências**: E5.
- **Resultado**: links individuais existem e podem ser copiados/renovados/revogados. Sem e-mail ainda.
- **Testes**: `assinaturas-publish.test.js` completo (tokens distintos, renovação invalidando o anterior).

### E7 — Fluxo público de assinatura
- **Objetivo**: assinar pelo link.
- **Arquivos**: `lib/assinaturas/signing.js`, bloco de rotas públicas em `routes/resources/assinaturas.js`
  (antes do `requireAuth`), `constants/privacy.ts` + `privacy-consent.js` (aviso `signature_avulsa_v1`).
- **Dependências**: E6, E4.
- **Resultado**: assinatura registrada com evidências; progresso parcial visível ao dono.
- **Testes**: `assinaturas-public-sign.test.js` completo.

### E8 — Finalização e PDF final
- **Objetivo**: concluir o documento e gerar o PDF assinado + validação pública.
- **Arquivos**: `lib/assinaturas/final-pdf.js`, `service.validateByCode`, rotas
  `GET /documentos/:id/pdf-final`, `GET /validar/:code`, `frontend/src/pages/SignatureValidationPage.tsx`
  (parametrizada), `App.tsx` (+`/validar-documento/:code`).
- **Dependências**: E7.
- **Resultado**: última assinatura conclui, carimba, anexa evidências e libera o download ao dono.
- **Testes**: `assinaturas-final-pdf.test.js` completo.

### E9 — E-mail e jobs
- **Objetivo**: notificar quem tem e-mail, com retry.
- **Arquivos**: `lib/assinaturas/notifications.js`, `lib/assinaturas/jobs.js`,
  `lib/email-templates.js` (+2 builders), `server.js` (+`startAssinaturasJobs`),
  rota `POST /reenviar-email`.
- **Dependências**: E6 (convite) e E8 (e-mail de conclusão).
- **Resultado**: convite chega por e-mail; falha não bloqueia nada; retry automático.
- **Testes**: envio só com e-mail presente; falha marca `FALHOU` sem invalidar token; idempotência do job.

### E10 — Frontend completo
- **Objetivo**: as seis telas da seção I.
- **Arquivos**: todo `frontend/src/pages/assinaturas/**`, `api/assinaturas.ts`, `hooks/useAssinaturas.ts`,
  `App.tsx` (+`/assinaturas/assinar/:token`), `registry.json` (+`pathExclusions`).
- **Dependências**: E3–E9.
- **Resultado**: fluxo end-to-end pela interface.
- **Testes**: `frontend/test/assinaturas-coordinates.test.mjs`; `npm run lint`, `npm test`, `npm run build`;
  checklist visual da tabela do Constitution Check.

### E11 — Ciclo de vida, retenção e tutorial
- **Objetivo**: arquivar/restaurar/cancelar, retenção e onboarding.
- **Arquivos**: `service.js` (arquivar/restaurar/cancelar/restaurar-excluído),
  `jobs.js` (manutenção/retenção), `lib/data-retention.js` (+alvo de anonimização),
  `pages/assinaturas/AssinaturasTutorial.tsx`, `docs/PADRAO_MODULO.md` (nota do módulo), `README.md`.
- **Dependências**: E10.
- **Resultado**: módulo completo e operável.
- **Testes**: `assinaturas-lifecycle.test.js` (parte de ciclo de vida e retenção).

### E12 — Integração com exclusão de conta (D16)
- **Objetivo**: excluir uma conta apaga os documentos não concluídos do usuário, preserva os concluídos e avisa
  o admin antes de confirmar.
- **Arquivos**: `lib/assinaturas/service.js` (`userDeletionImpact`, `prepareUserDeletion`),
  `backend/src/routes/resources/users.js` (`GET /:id/impacto` + chamada no `DELETE /:id`),
  `frontend/src/pages/admin/AdminAccountsPage.tsx` (confirmação com contagem),
  `frontend/src/api/account.ts` ou `users` (chamada do impacto).
- **Dependências**: E11 (a rotina de purga de arquivos já existe).
- **Resultado**: desligamento de funcionário resolvido sem bypass de leitura para ADMIN; evidência de
  assinatura de terceiros preservada.
- **Testes**: bloco de exclusão de conta em `assinaturas-lifecycle.test.js`; `assinaturas-access.test.js`
  cenários 10–11 (órfão inacessível).
- **Atenção**: é a única etapa que altera comportamento de módulo existente. O PR precisa citar D16 na
  justificativa e incluir teste de que excluir conta **sem** documentos continua funcionando como hoje.

---

# O. Riscos e pontos de atenção

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| O-1 | **Duplicação do layout da página de evidências** (D8) diverge do RDO com o tempo | Médio | Documentado como dívida consciente; follow-up de extração com golden-file. Os *primitivos* (QR, validação de imagem, hash) já são compartilhados |
| O-2 | Render de PDF no servidor consome CPU/disco | Médio | Render sob demanda por página, cache em disco, teto de páginas, purga junto com o documento. Métrica de duração exposta (seção observabilidade) |
| O-3 | PDF malicioso (JS embutido, bomba de descompressão, criptografado) | Alto | `%PDF` + teto de tamanho + `PDFDocument.load()` obrigatório antes de gravar; `pdfjs` com `isEvalSupported:false`; preview vira PNG (nenhum conteúdo ativo chega ao browser); `pdf-lib` re-serializa na finalização |
| O-4 | Token vazando em log | Alto | Rota pública passa por `morgan` — **tarefa explícita** em E7: mascarar/`skip` o path `/api/assinaturas/publico/*`. Nenhum `console.*` do módulo recebe token; só `tokenHash.slice(0,8)` |
| O-5 | Corrida na conclusão (dois assinantes finais simultâneos) | Alto | Advisory lock por `documentId` + `updateMany` condicional no status; teste M-5 dedicado |
| O-6 | Corrida entre renovar e assinar | Médio | Renovação é um único `update` atômico que troca o `tokenHash`; a assinatura relê o convite **dentro** da transação por token. O perdedor recebe 404/409 coerente; teste M-4 |
| O-7 | Job de e-mail executando duas vezes | Médio | `acquireJobLock` (nível de job) + `emailClaimedAt` (nível de convite), padrão de `reminderClaimedAt` |
| O-8 | Owner isolation esquecido em uma rota futura | Alto | Ponto único `documentForOwnerOrThrow` + teste de **matriz de rotas** (M-1 cenário 6) que falha ao adicionar rota nova sem cobertura |
| O-9 | Arquivo em disco alterado/perdido depois de publicado | Alto | `sourceDocumentHash` revalidado na finalização e no download público (409/410 com mensagem clara), como já faz `writeFinalEvidencePdf` |
| O-10 | `SIGNATURE_TOKEN_SECRET` rotacionado sem `PREVIOUS_SIGNATURE_TOKEN_SECRETS` | Médio | Comportamento já existente e testado no RDO; documentar em `quickstart.md` que a rotação quebra a **recuperação** do link (não a validação, que usa hash) |
| O-11 | Enum Prisma adicionado e usado na mesma transação | Médio | Migrations separadas (L.1/L.2) |
| O-12 | Crescimento do arquivo de rota | Baixo | Rota fina; toda regra em `lib/assinaturas/`. `architecture:check` no CI |
| O-13 | Documento excluído com assinatura concluída (valor probatório) | Médio | Exclusão é lógica; PDF final e trilha preservados durante a retenção; confirmação reforçada na UI. Ver P-4 |
| O-14 | Assinantes externos com muitos campos em documento grande | Baixo | Tetos configuráveis (`MAX_PAGES`, `MAX_SIGNERS`) validados no backend |
| O-15 | Exclusão de conta apagando documento por engano | Alto | Confirmação com contagem explícita ("7 serão excluídos, 3 preservados") vinda de `GET /accounts/:id/impacto`; concluídos nunca são apagados por essa via (D16) |
| O-16 | `ownerUserId: null` vazando no `where` e expondo órfãos | Alto | `documentForOwnerOrThrow`/`ownerListWhere` lançam com owner nulo; teste dedicado (M-1 cenário 10) |
| O-17 | Arquivos órfãos no disco após exclusão de conta | Médio | Purga imediata dos bytes na mesma rotina, após o commit; a linha do documento não sobrevive para permitir restauração |

---

# P. Decisões de produto — RESOLVIDAS em 2026-08-21

Todas as questões abertas foram decididas pelo solicitante. Nenhuma pendência bloqueia `/speckit-tasks`.

| # | Questão | Decisão | Onde está no plano |
|---|---|---|---|
| P-1 | Nome da permissão | **`assinaturas:user`** (code `ASSINATURAS_USER`, label "Assinaturas - Usuário"). Ajustar à mão a saída do scaffold, que gera manager+viewer | D7 |
| P-2 | ADMIN vê documentos alheios? | **Não — isolamento total**, sem visão administrativa na aplicação. O caso de funcionário desligado é resolvido pela exclusão de conta (P-6), não por bypass de leitura | D10, D16 |
| P-3 | Acesso do assinante ao PDF final | **Até o vencimento do convite**, sem prorrogação. Depois disso, só o dono baixa pela área autenticada | contracts/api.md, `GET /publico/:token/pdf` |
| P-4 | Retenção após exclusão pelo dono | **90 dias** e, para pedido LGPD de assinante externo, **não** apagar assinatura concluída (base legal de guarda de evidência) | D13, G.4 |
| P-5 | Título do documento | **Campo `title` opcional**, default = nome do arquivo sem extensão, editável **apenas** em `RASCUNHO` | data-model.md, `PATCH /documentos/:id` |
| P-6 | Exclusão de conta *(questão nova, surgida de P-2)* | **Apaga os não concluídos, preserva os concluídos** como órfãos (`ownerUserId = NULL`), com aviso de contagem antes de confirmar | **D16**, E12 |
| P-7 | Purga dos arquivos na exclusão de conta *(nova)* | **Imediata**. Os 90 dias valem só para a exclusão feita pelo dono, onde a linha do documento sobrevive e a restauração é possível | D16 |

**Consequências registradas** das decisões P-2/P-6/P-7:
- `SignatureDocument.ownerUserId` passou de `String` + `Restrict` para `String?` + `SetNull`.
- Novo valor de auditoria `PROPRIETARIO_REMOVIDO`.
- `backend/src/routes/resources/users.js` entrou no inventário como **estendido** — a única alteração de
  módulo existente do projeto, justificada em D16.
- Etapa **E12** acrescentada ao plano de implementação.
- Riscos **O-15/O-16/O-17** acrescentados.

**Decisão de produto que permanece com o responsável por privacidade** (não bloqueia implementação): incluir a
operação no `LGPD_ROPA.md` antes do go-live, cobrindo nome/e-mail de assinantes externos, IP/User-Agent como
evidência e a retenção de 90 dias.

## Complexity Tracking

*Constitution Check passou sem violações. Nenhuma justificativa de complexidade é necessária.*

As duas escolhas que **poderiam** parecer complexidade extra estão justificadas no corpo do plano e não
violam princípio algum:

| Escolha | Por que é necessária | Alternativa mais simples rejeitada porque |
|---|---|---|
| 4 tabelas novas em vez de reusar `Report`/`ReportSignature` (D1) | `Report.projectId` e `ReportSignature.signerEmail` são obrigatórios e sustentam índices/constraints do RDO | Tornar os dois opcionais alteraria o caminho crítico do módulo mais usado, contra a restrição de não mudar comportamento existente |
| Duplicação parcial do layout da página de evidências (D8) | `writeFinalEvidencePdf` é acoplada a `report`/`version`/`project`; extraí-la agora seria refactor amplo no caminho de produção do RDO | Extrair uma lib comum já exigiria mexer na finalização do RDO — vetado pelo briefing; fica como follow-up com golden-file |
