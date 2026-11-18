---
description: "Lista de tarefas — módulo Assinaturas Avulsas"
---

# Tasks: Assinaturas Avulsas

**Input**: `specs/012-assinaturas-avulsas/` (plan.md, research.md, data-model.md, contracts/api.md, quickstart.md, spec-input.md)

**Branch**: `feat/signature-module`

**Tests**: **INCLUÍDOS E OBRIGATÓRIOS.** A §31 do briefing lista 27 cenários de cobertura obrigatória e o
Princípio V da constitution exige teste em `backend/test` para toda regra de negócio nova.

**Organização**: tarefas agrupadas por história de usuário, para que cada incremento seja implementável e
testável de forma independente. Não existe `spec.md` — as histórias foram derivadas do briefing
(`spec-input.md`) e do plano.

## Formato: `[ID] [P?] [Story] Descrição`

- **[P]**: pode rodar em paralelo (arquivo diferente, sem dependência pendente)
- **[Story]**: US1..US6
- Todo caminho de arquivo é exato e relativo à raiz do repositório

## Histórias de usuário derivadas

| ID | Prioridade | História | Valor entregue sozinha |
|---|---|---|---|
| **US1** | **P1 🎯 MVP** | Como usuário com a permissão, quero enviar um PDF, cadastrar assinantes, posicionar os campos, publicar e **copiar os links manualmente**, para que cada pessoa assine e eu obtenha o PDF final assinado | Fluxo de assinatura completo, funcionando sem e-mail |
| US2 | P2 | Como solicitante, quero que quem tem e-mail receba o convite automaticamente | Elimina o envio manual na maioria dos casos |
| US3 | P3 | Como solicitante, quero renovar, revogar e reenviar convites e ver a trilha de auditoria | Recupera o processo quando um link vence ou vai para a pessoa errada |
| US4 | P4 | Como solicitante, quero arquivar e excluir documentos sem perder as assinaturas já colhidas | Mantém o acervo organizado e a base enxuta |
| US5 | P5 | Como qualquer pessoa, quero validar a autenticidade de um PDF assinado pelo código/QR | Torna o documento final verificável por terceiros |
| US6 | P6 | Como admin do hub, quero excluir uma conta sabendo exatamente quais documentos serão apagados | Resolve desligamento de funcionário sem bypass de leitura |

## Convenções de caminho

Web app: `backend/src/`, `frontend/src/`, testes em `backend/test/` e `frontend/test/`.

---

## Phase 1: Setup (Infraestrutura compartilhada)

**Objetivo**: o módulo existe no hub com a permissão única, sem nenhuma funcionalidade.

- [ ] T001 Rodar `npm run new:module -- assinaturas --title "Assinaturas"` na raiz do repositório e revisar tudo que foi gerado antes de commitar
- [ ] T002 Ajustar a entrada `assinaturas` em `shared/modules/registry.json` para **uma única role**: remover `ASSINATURAS_VIEWER`/`assinaturas:viewer` e manter só `{ code: "ASSINATURAS_USER", public: "assinaturas:user", label: "Assinaturas - Usuário", accountTypes: ["ADMIN","INTERNAL"] }`, com `hub.roles: ["assinaturas:user"]`, `routeGroups.default.allowedModuleRoles: ["assinaturas:user"]`, `badge: "ASS"`, `copy: "Envio de PDF avulso, coleta de assinaturas e trilha de auditoria."`
- [ ] T003 Adicionar `pathExclusions: ["/assinaturas/assinar"]` à entrada do módulo em `shared/modules/registry.json`, seguindo o precedente do módulo `epi` (`/epi/assinar`)
- [ ] T004 Ajustar `backend/prisma/schema.prisma` para conter apenas `ASSINATURAS` em `AppModule` e `ASSINATURAS_USER` em `ModuleRoleCode` (remover o `ASSINATURAS_VIEWER` gerado pelo scaffold)
- [ ] T005 Ajustar a migration gerada `backend/prisma/migrations/<ts>_add_assinaturas_module/migration.sql` para conter apenas os dois `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (`ASSINATURAS`, `ASSINATURAS_USER`)
- [ ] T006 Rodar `npm run modules:generate` e confirmar que `frontend/src/modules/registry.generated.ts` reflete a role única
- [ ] T007 [P] Adicionar as variáveis novas ao schema Zod em `backend/src/config/env.js`: `ASSINATURAS_MAX_PDF_MB` (20), `ASSINATURAS_MAX_PAGES` (50), `ASSINATURAS_MAX_SIGNERS` (20), `ASSINATURAS_TOKEN_MAX_DAYS` (90), `ASSINATURAS_DELETED_RETENTION_DAYS` (90), `ASSINATURAS_PREVIEW_SCALE` (1.5)
- [ ] T008 [P] Documentar as seis variáveis novas em `backend/.env.example` com comentário do que cada uma limita
- [ ] T009 [P] Adicionar casos das variáveis novas em `backend/test/env.test.js` (default aplicado, valor inválido derruba o boot)
- [ ] T010 Criar `backend/src/lib/assinaturas/access.js` com `requireAssinaturasAccess` usando `hasModuleRole(req.auth?.user, 'assinaturas:user')` e resposta 403 `'Acesso restrito ao módulo de Assinaturas.'`, no padrão de `requireEpiAccess` em `backend/src/routes/resources/epis.js`
- [ ] T011 Reduzir `backend/src/routes/resources/assinaturas.js` (gerado pelo scaffold) à casca: `Router()`, marcador de bloco público vazio, e `router.use(requireAuth, requireAssinaturasAccess)` antes das rotas autenticadas
- [ ] T012 Confirmar o mount `router.use('/assinaturas', assinaturasRouter)` em `backend/src/routes/index.js` no marcador `module:scaffold mount`
- [ ] T013 Criar `frontend/src/pages/assinaturas/AssinaturasPage.tsx` como placeholder com o shell largo do módulo (padrão `.equip-page` de `frontend/src/pages/equipamentos/EquipamentosPage.tsx`) e confirmar a rota em `frontend/src/modules/moduleRoutes.tsx`
- [ ] T014 [P] Criar `backend/test/assinaturas-access.test.js` com os cenários 1–3: usuário sem `assinaturas:user` → 403; com a role → segue; conta ADMIN sem a role → 403 (sem bypass)
- [ ] T015 Rodar `npm run architecture:check`, `cd backend && npm test`, `cd frontend && npm run lint && npm run build` e confirmar tudo verde

**Checkpoint**: card "Assinaturas" aparece em `/modulos` só para quem tem a role; `/assinaturas` abre vazio.

---

## Phase 2: Foundational (Pré-requisitos bloqueantes)

**Objetivo**: modelo de dados, isolamento por proprietário, auditoria e storage — a base de **todas** as histórias.

**⚠️ CRÍTICO**: nenhuma história pode começar antes desta fase terminar.

- [ ] T016 Adicionar os enums novos em `backend/prisma/schema.prisma`: `SignatureDocumentStatus`, `SignatureDocumentSignerStatus`, `SignatureDocumentEmailStatus` e `SignatureDocumentAuditAction` (24 valores, incluindo `DOCUMENTO_DESPUBLICADO` e `PROPRIETARIO_REMOVIDO`), conforme `specs/012-assinaturas-avulsas/data-model.md` §1
- [ ] T017 Adicionar o model `SignatureDocument` em `backend/prisma/schema.prisma` com `ownerUserId String?` e `owner User? @relation("SignatureDocumentOwner", onDelete: SetNull)`, todos os campos e os 5 índices de `data-model.md` §2
- [ ] T018 Adicionar o model `SignatureDocumentSigner` em `backend/prisma/schema.prisma` com `email String?`, `tokenHash String? @unique`, campos de cifra, entrega de e-mail e evidência, `@@unique([documentId, position])` e os 4 índices
- [ ] T019 Adicionar o model `SignatureDocumentField` em `backend/prisma/schema.prisma` com `x/y/width/height` em `Decimal(9,8)`, `pageWidthPt`/`pageHeightPt` em `Decimal(10,3)`, `pageRotation` e os 2 índices
- [ ] T020 Adicionar o model `SignatureDocumentAuditLog` em `backend/prisma/schema.prisma` com `signerId` `SetNull`, `actorUserId` `SetNull` e os 5 índices
- [ ] T021 Adicionar as duas relations de volta em `model User` de `backend/prisma/schema.prisma`: `signatureDocuments` e `signatureDocumentAuditLogs`
- [ ] T022 Gerar a migration `backend/prisma/migrations/<ts>_add_assinaturas_tables/migration.sql` via `cd backend && npx prisma migrate dev --name add_assinaturas_tables`, confirmando que ela é **separada e posterior** à migration de enums de T005
- [ ] T023 Estender `backend/src/lib/audit/events.js` com `AUDIT_MODULES.ASSINATURAS = 'assinaturas'`, `AUDIT_ENTITY_TYPES.SIGNATURE_DOCUMENT = 'signature-document'` e o terceiro branch em `recordAuditEvent` gravando em `client.signatureDocumentAuditLog` (com `signerId` a partir de `relatedEntityId`), sem alterar os branches de RDO e EPI
- [ ] T024 [P] Acrescentar casos em `backend/test/audit-events.test.js`: o novo alvo grava com os campos certos; alvo desconhecido continua lançando `TypeError`; RDO e EPI seguem inalterados
- [ ] T025 Criar `backend/src/lib/assinaturas/audit.js` com `recordDocumentEvent(client, { document, signer, actorUserId, action, description, evidence })` delegando a `recordAuditEvent`, e garantir que **nenhuma** função do arquivo exponha update/delete da tabela de auditoria
- [ ] T026 Implementar em `backend/src/lib/assinaturas/access.js` a função `ownerListWhere(ownerUserId)` que **lança** `TypeError` se `ownerUserId` for nulo/vazio e devolve `{ ownerUserId, deletedAt: null }`
- [ ] T027 Implementar em `backend/src/lib/assinaturas/access.js` a função `documentForOwnerOrThrow(client, id, ownerUserId, { include, allowArchived = true, allowDeleted = false })` que lança se `ownerUserId` for nulo, faz `findFirst({ where: { id, ownerUserId, deletedAt: null } })` e lança erro **404** (`statusCode = 404`, mensagem `'Documento não encontrado.'`) quando não achar
- [ ] T028 Implementar em `backend/src/lib/assinaturas/access.js` os guards de estado `assertDocumentEditable(document)` (exige `RASCUNHO`, não arquivado) e `assertDocumentPublishable(document)`, lançando 409 com mensagem em pt-BR
- [ ] T029 Criar `backend/src/lib/assinaturas/document.js` com `parsePdfUpload(fileName, dataUrl)` no padrão de `backend/src/lib/qualidade/attachments.js`: regex de data URL `application/pdf`, decodifica base64, valida magic bytes `%PDF`, aplica `env.assinaturasMaxPdfMb`
- [ ] T030 Implementar `pdfMetadata(bytes)` em `backend/src/lib/assinaturas/document.js` usando `PDFDocument.load()` do `pdf-lib` para obter `pageCount` e `pageDimensions` (`[{ page, widthPt, heightPt, rotation }]`), rejeitando PDF ilegível, criptografado ou acima de `env.assinaturasMaxPages`
- [ ] T031 Implementar `storeSourcePdf`, `sourcePdfBuffer` (revalida `sourceDocumentHash` e lança 409 se divergir) e `purgeDocumentFiles` em `backend/src/lib/assinaturas/document.js`, usando `writeManagedDocumentFile`/`resolveManagedDocumentPath`/`unlinkManagedDocumentFile` de `backend/src/lib/documents/storage.js` com `folderParts: ['Assinaturas','Documentos']` e `requiredPrefix: 'Assinaturas/'`
- [ ] T032 Estender o predicado de limite de corpo em `backend/src/app.js` para incluir `/api/assinaturas` no grupo de 25 MB, mantendo 3 MB para os endpoints públicos de assinatura
- [ ] T033 [P] Criar `backend/test/assinaturas-document.test.js` cobrindo: data URL não-PDF → 400; magic bytes inválidos → 400; acima do limite → 400; PDF sem páginas/ilegível → 400; PDF válido → hash, `pageCount` e `pageDimensions` corretos; `resolveManagedDocumentPath` recusa `../` e caminho fora de `Assinaturas/`
- [ ] T034 [P] Acrescentar em `backend/test/assinaturas-access.test.js` os cenários 4, 10 e 11: `ownerListWhere` sempre inclui `ownerUserId` + `deletedAt: null`; `documentForOwnerOrThrow(client, id, null)` e `ownerListWhere(undefined)` **lançam**; documento órfão (`ownerUserId = NULL`) devolve 404 para qualquer usuário

**Checkpoint**: base pronta. As histórias podem começar.

---

## Phase 3: User Story 1 — Fluxo essencial de assinatura avulsa (Priority: P1) 🎯 MVP

**Objetivo**: enviar um PDF, cadastrar assinantes, posicionar campos, publicar, copiar os links manualmente,
cada assinante assina pelo link e o documento final assinado fica disponível ao dono.

**Teste independente**: subir um PDF de 3 páginas; cadastrar dois assinantes **sem e-mail**; posicionar um
campo para cada; publicar com validade de 15 dias; copiar os dois links; abrir cada link em janela anônima e
assinar; conferir que o documento fica `CONCLUIDO` e que o PDF final tem as duas assinaturas nas posições
escolhidas mais a página de evidências. Nenhum e-mail é enviado em nenhum momento.

### Testes da US1 (escrever antes da implementação)

- [ ] T035 [P] [US1] Criar `backend/test/assinaturas-publish.test.js` com os casos de configuração e publicação: assinante sem nome → 400; e-mail inválido → 400; e-mails duplicados → 400; assinante sem campo → 400 listando quem falta; campo com `signerId` de fora → 400; `pageNumber` fora de `1..pageCount` → 400; caixa fora de `[0,1]` ou menor que o mínimo → 400; `expiresAt` no passado ou além do teto → 400
- [ ] T036 [P] [US1] Acrescentar em `backend/test/assinaturas-publish.test.js` os casos de sucesso: publicação válida move para `AGUARDANDO_ASSINATURAS`; **cada assinante recebe um `tokenHash` distinto e não nulo**; editar assinantes/campos depois de publicar → 409; **despublicar com zero assinaturas volta a `RASCUNHO` e zera todos os `tokenHash`; despublicar com uma assinatura registrada → 409**
- [ ] T037 [P] [US1] Criar `backend/test/assinaturas-public-sign.test.js` com: token inexistente → 404; token incorreto (hash não bate) → 404; token expirado → 410 e convite marcado `EXPIRADO`; assinatura válida grava `ipAddress`/`userAgent`/`signedAt`/`declaredSignerName`; **dupla assinatura é idempotente** (uma linha, um evento de auditoria); imagem de assinatura inválida → 400 antes de qualquer escrita
- [ ] T038 [P] [US1] Acrescentar em `backend/test/assinaturas-public-sign.test.js` o caso de vazamento: o JSON serializado de `loadInvite` **não** contém nome, e-mail nem status dos outros assinantes, nem o e-mail do dono
- [ ] T039 [P] [US1] Criar `backend/test/assinaturas-final-pdf.test.js` com: conversão de coordenadas normalizadas → pontos do `pdf-lib` (origem, canto oposto, A4 e página rotacionada 90°); hash do PDF-base alterado em disco → 409 e nenhum PDF final gravado; página de evidências contém nome, IP e data/hora de cada assinante
- [ ] T040 [P] [US1] Acrescentar em `backend/test/assinaturas-final-pdf.test.js` o caso de corrida: duas finalizações concorrentes produzem **um único** `CONCLUIDO` e **um único** evento `PDF_FINAL_GERADO`
- [ ] T041 [P] [US1] Acrescentar em `backend/test/assinaturas-access.test.js` os cenários 5–9: dono diferente → **404, nunca 403**; matriz das rotas de documento com o usuário B contra documento de A → 404 em todas; `signerId`/`fieldId` de outro documento → 404/400; preview e download de PDF alheio → 404
- [ ] T042 [P] [US1] Criar `frontend/test/assinaturas-coordinates.test.mjs` com round-trip pixel → normalizado → pixel em três larguras de contêiner, clamp em `[0,1]`, tamanho mínimo e paridade da conversão para o referencial do `pdf-lib` com o backend

### Backend — documento e preview

- [ ] T043 [US1] Implementar `createDocument` em `backend/src/lib/assinaturas/document.js`: valida o upload, calcula `sha256`, extrai metadados, grava o arquivo, cria o `SignatureDocument` `RASCUNHO` com `ownerUserId` e `title` (default = nome do arquivo sem extensão) e audita `DOCUMENTO_CRIADO`
- [ ] T044 [US1] Criar `backend/src/lib/assinaturas/preview.js` com `renderPage(document, pageNumber)` usando `pdfjs-dist/legacy/build/pdf.mjs` + `createCanvas` do `@napi-rs/canvas`, na receita de `backend/scripts/import-manual-rdo-pdfs.js:673-687`, com `isEvalSupported: false`, escala `env.assinaturasPreviewScale`, largura máxima 1400 px e cache em disco em `Assinaturas/Previews/<documentId>/<n>.png`
- [ ] T045 [US1] Implementar `purgePreviews(documentId)` em `backend/src/lib/assinaturas/preview.js` para uso pela exclusão e pela retenção
- [ ] T046 [US1] Implementar `listDocuments`, `getDocument`, `documentProgress` e `renameDocument` em `backend/src/lib/assinaturas/service.js`, todos passando por `ownerListWhere`/`documentForOwnerOrThrow`
- [ ] T047 [US1] Implementar `replaceSigners(tx, document, signers)` em `backend/src/lib/assinaturas/service.js` com validação Zod (nome ≥ 2, e-mail válido quando presente, sem duplicidade, ≤ `env.assinaturasMaxSigners`, `position` sequencial), exigindo `RASCUNHO`, e auditando `CONFIGURACAO_ATUALIZADA`
- [ ] T048 [US1] Implementar `replaceFields(tx, document, fields)` em `backend/src/lib/assinaturas/service.js` validando `signerId` pertencente ao documento, `1 ≤ pageNumber ≤ pageCount`, `x+width ≤ 1`, `y+height ≤ 1` e tamanho mínimo de 2% da página
- [ ] T049 [US1] Criar `backend/src/lib/assinaturas/invites.js` com `issueInvites(tx, document, expiresAt)` usando `signatureTokenData()` de `backend/src/lib/signature-token.js` para gravar `tokenHash` + `tokenEncrypted`/`tokenIv`/`tokenAuthTag` + `tokenExpiresAt` por assinante, e `inviteUrl(token)` apontando para `${env.appUrl}/assinaturas/assinar/<token>`
- [ ] T050 [US1] Implementar `recoverInviteLink` em `backend/src/lib/assinaturas/invites.js` usando `decryptSignatureToken()` e auditando `LINK_RECUPERADO`; garantir que o token **não** aparece em nenhum retorno de listagem nem em log
- [ ] T051 [US1] Implementar `publishDocument` **e `unpublishDocument`** em `backend/src/lib/assinaturas/service.js`. `publishDocument`: valida o prazo recebido (`expiresInDays` **ou** `expiresAt`), aplica as 9 validações de `plan.md` §H.3 em transação, gera `publishedAt`, emite os convites via `issueInvites`, define `emailStatus` (`PENDENTE` com e-mail, `NAO_APLICAVEL` sem) e audita `DOCUMENTO_PUBLICADO` + um `CONVITE_CRIADO` por assinante; SMTP ausente **não** bloqueia. `unpublishDocument`: exige `AGUARDANDO_ASSINATURAS` e **zero** assinaturas registradas (senão 409), zera `tokenHash`/cifra/expiração de todos os convites, devolve o documento a `RASCUNHO` e audita `DOCUMENTO_DESPUBLICADO`
- [ ] T052 [US1] Implementar `resolveInviteByToken(client, token)` em `backend/src/lib/assinaturas/invites.js` fazendo lookup **apenas** por `signatureTokenHash(token)`, incluindo documento, campos do próprio assinante e contagem agregada dos demais

### Backend — fluxo público de assinatura

- [ ] T053 [US1] Criar `backend/src/lib/assinaturas/signing.js` com `loadInvite(client, token, evidence)` que valida existência → token → expiração (expiração preguiçosa gravando `EXPIRADO` + auditoria) → documento não cancelado/excluído → convite não revogado, marca `VISUALIZADO` na primeira abertura e audita `LINK_ACESSADO` + `DOCUMENTO_VISUALIZADO`
- [ ] T054 [US1] Implementar `publicInvitePayload(invite, status)` em `backend/src/lib/assinaturas/signing.js` expondo **somente** o próprio assinante, metadados do documento, o nome de quem solicitou e o progresso agregado — nunca nome/e-mail dos demais nem e-mail do dono
- [ ] T055 [US1] Implementar `confirmSignature` em `backend/src/lib/assinaturas/signing.js` no padrão de `confirmPublicEpiSignatureRequest` (`backend/src/routes/resources/epis.js:788`): valida a imagem com `decodableSignatureImageDataUrl` antes de qualquer escrita, pré-checa fora da transação, e dentro dela relê por token e grava com `updateMany({ where: { id, status: { in: [PENDENTE, VISUALIZADO] } } })`, tratando `count !== 1` como idempotência ou 409
- [ ] T056 [US1] Implementar em `backend/src/lib/assinaturas/signing.js` a checagem de conclusão sob advisory lock `pg_advisory_xact_lock(hashtext($1), 0)` sobre o `documentId` (receita de `lockSignatureRoundForReport` em `backend/src/lib/internal-report-signatures.js:222`) mais `updateMany({ where: { id, status: AGUARDANDO_ASSINATURAS }, data: { status: CONCLUIDO } })` para garantir vencedor único
- [ ] T057 [US1] Adicionar a variante `signatureAvulsa` com versão `signature_avulsa_v1` em `backend/src/lib/privacy-consent.js` e usá-la no schema Zod de confirmação, via `validatePrivacyNoticeAcknowledgement`

### Backend — PDF final

- [ ] T058 [US1] Criar `backend/src/lib/assinaturas/final-pdf.js` com `normalizedFieldToPdfRect(field)` convertendo coordenadas normalizadas (origem superior esquerda) para o referencial do `pdf-lib`: `xPt = x*W`, `yPt = H - (y+height)*H`
- [ ] T059 [US1] Implementar em `backend/src/lib/assinaturas/final-pdf.js` o carimbo das assinaturas: revalida `sourceDocumentHash`, carrega com `pdf-lib`, embute cada imagem com `parseSignatureImageDataUrl` (de `backend/src/lib/signatures/common.js`) preservando aspect ratio dentro da caixa e desenha a legenda com nome + data/hora pt-BR (`America/Sao_Paulo`) abaixo
- [ ] T060 [US1] Implementar em `backend/src/lib/assinaturas/final-pdf.js` a página de evidências anexa (A4 595.28×841.89) com status, nome do arquivo, hash do original e, por assinante, nome declarado, e-mail ou "—", data/hora UTC, IP e navegador resumido, no layout de `writeFinalEvidencePdf` (`backend/src/lib/internal-report-signatures.js:590`) **sem alterar aquele arquivo**
- [ ] T061 [US1] Implementar `buildFinalPdf(document)` em `backend/src/lib/assinaturas/final-pdf.js` gravando em `Assinaturas/Assinados/` via `writeManagedDocumentFile` e persistindo `finalStoragePath`/`finalDocumentHash`/`completedAt`, com auditoria `DOCUMENTO_CONCLUIDO` + `PDF_FINAL_GERADO`

### Backend — rotas

- [ ] T062 [US1] Registrar em `backend/src/routes/resources/assinaturas.js` o bloco público **antes** do `router.use(requireAuth, ...)`, com `createMemoryRateLimit({ windowMs: 15*60*1000, max: 60 })`: `GET /publico/:token`, `GET /publico/:token/pdf`, `GET /publico/:token/paginas/:n.png`, `POST /publico/:token/assinar`, com **schema Zod** para o payload de confirmação
- [ ] T063 [US1] Registrar em `backend/src/routes/resources/assinaturas.js` as rotas autenticadas de documento: `GET /documentos`, `POST /documentos`, `GET /documentos/:id`, `PATCH /documentos/:id`, `GET /documentos/:id/pdf`, `GET /documentos/:id/pdf-final`, `GET /documentos/:id/paginas/:n.png` — com **schema Zod** no `POST /documentos` e no `PATCH /documentos/:id`, e todas chamando `documentForOwnerOrThrow` antes de qualquer leitura
- [ ] T064 [US1] Registrar em `backend/src/routes/resources/assinaturas.js` as rotas de configuração e publicação: `PUT /documentos/:id/assinantes`, `PUT /documentos/:id/campos`, `POST /documentos/:id/publicar`, `POST /documentos/:id/despublicar`, `GET /documentos/:id/assinantes/:signerId/link` — com **schema Zod** em cada payload (`assinantes`, `campos`, `publicar`)
- [ ] T065 [US1] Garantir `Cache-Control: no-store` em todas as respostas com conteúdo de documento (autenticadas e públicas), no padrão de `sendDownloadBuffer` (`backend/src/routes/resources/reports.js:1249`)
- [ ] T066 [US1] Mascarar o token nos logs de acesso: adicionar `skip`/normalização no `morgan` em `backend/src/app.js` para o prefixo `/api/assinaturas/publico/`, de modo que o path registrado nunca contenha o token

### Frontend — camada de dados

- [ ] T067 [P] [US1] Criar `frontend/src/api/assinaturas.ts` com os tipos (`SignatureDocument`, `Signer`, `Field`, `DocumentCard`, payloads públicos) e as chamadas via `apiClient`, no padrão de `frontend/src/api/qualidade.ts`
- [ ] T068 [P] [US1] Criar `frontend/src/hooks/useAssinaturas.ts` com as queries `['assinaturas','list',filtros]`, `['assinaturas','doc',id]` e `['assinaturas','publico',token]` e as mutations com invalidação, no padrão de `frontend/src/hooks/useReports.ts`
- [ ] T069 [P] [US1] Criar `frontend/src/pages/assinaturas/utils/coordinates.ts` com `pixelToNormalized`, `normalizedToPercent` e o clamp/tamanho mínimo compartilhados com o teste T042

### Frontend — telas

- [ ] T070 [US1] Implementar a listagem em `frontend/src/pages/assinaturas/AssinaturasPage.tsx` + `frontend/src/pages/assinaturas/components/DocumentCard.tsx` usando `SearchBar`, `Skeleton`, `Button` e `Toast` de `frontend/src/components/ui/`, com grade `minmax(min(100%, 280px), 1fr)`, `min-width: 0` nos filhos e estados de loading/empty/erro
- [ ] T071 [US1] Implementar `frontend/src/pages/assinaturas/components/NewDocumentModal.tsx` reutilizando `frontend/src/components/ui/PdfDropzone.tsx` e `Modal`, com formulário em `react-hook-form` + resolver Zod, barra de progresso durante o upload e mensagens específicas para arquivo não-PDF, arquivo grande e PDF ilegível
- [ ] T072 [US1] Implementar `frontend/src/pages/assinaturas/components/PdfPageCanvas.tsx`: `<img>` da página em contêiner `position: relative` com `overflow: auto` próprio, campos como `<div>` absolutos posicionados em **percentual**, arraste e redimensionamento por Pointer Events com `touch-action: none`, clamp em `[0,1]`, cor por índice do assinante e movimento por setas do teclado
- [ ] T073 [US1] Implementar `frontend/src/pages/assinaturas/components/SignerList.tsx` usando `react-hook-form` + resolver Zod, com nome obrigatório, e-mail opcional, botão "sou eu" que preenche com os dados da conta autenticada, e o padrão `.field-group.field-invalid` + `.field-error` + `aria-invalid` ao tentar salvar vazio
- [ ] T074 [US1] Implementar `frontend/src/pages/assinaturas/components/DocumentSetupView.tsx` unindo `SignerList` e `PdfPageCanvas`, com navegação de páginas, indicador de salvamento no padrão de `frontend/src/components/reports/DraftSaveStatus.tsx` e aviso inline para assinante sem campo
- [ ] T075 [US1] Implementar `frontend/src/pages/assinaturas/components/PublishDialog.tsx` usando `react-hook-form` + resolver Zod, com resumo dos assinantes, `select` de validade (7/15/30/60 dias + data específica) usando os estados de campo do kit, e exibição da lista de pendências devolvida pelo 400 da publicação
- [ ] T076 [US1] Implementar `frontend/src/pages/assinaturas/components/DocumentDetailView.tsx` + `SignerStatusList.tsx` com os blocos `det-section`/`det-row` (padrão de `frontend/src/pages/ReportDetailPage.tsx`), mostrando por assinante nome, e-mail ou "—", badge de status, data/hora **no fuso `America/Sao_Paulo`** e o botão **Copiar link** com toast de confirmação
- [ ] T077 [US1] Adicionar os downloads de PDF original e PDF final em `frontend/src/pages/assinaturas/components/DocumentDetailView.tsx`, com o final visível apenas quando o documento está `CONCLUIDO`
- [ ] T078 [US1] Implementar `frontend/src/pages/assinaturas/AssinaturasPublicSignPage.tsx` reutilizando **sem fork** `frontend/src/components/reports/SignatureDialog.tsx` e `frontend/src/components/privacy/PrivacyNotice.tsx`, no shell `survey-page-shell` de `frontend/src/pages/PublicSignaturePage.tsx`, com o campo do próprio assinante destacado na prévia
- [ ] T079 [US1] Tratar em `frontend/src/pages/assinaturas/AssinaturasPublicSignPage.tsx` os estados de link inválido, expirado, revogado, documento cancelado/inexistente, já assinado e erro de rede, cada um com mensagem pt-BR específica
- [ ] T080 [US1] Registrar a rota pública `<Route path="/assinaturas/assinar/:token" element={<AssinaturasPublicSignPage />} />` em `frontend/src/App.tsx`, junto das demais rotas públicas
- [ ] T081 [US1] Adicionar a variante `signatureAvulsa` e a constante `SIGNATURE_AVULSA_NOTICE_VERSION` em `frontend/src/constants/privacy.ts`, alinhada com T057
- [ ] T082 [US1] Persistir a navegação interna em query params em `frontend/src/pages/assinaturas/AssinaturasPage.tsx` (`?doc=<id>`, `?page=<n>`, `?tab=`), limpando parâmetros incompatíveis ao trocar de seção, e verificar que F5 mantém a mesma tela

**Checkpoint**: US1 completa. O módulo entrega valor real sem depender de e-mail.

---

## Phase 4: User Story 2 — Convite por e-mail (Priority: P2)

**Objetivo**: quem tem e-mail recebe o convite automaticamente; quem não tem continua pelo link copiado.

**Teste independente**: publicar um documento com um assinante **com** e-mail e um **sem**; conferir que só o
primeiro recebe; derrubar o SMTP e conferir que a publicação continua funcionando, o convite fica `FALHOU` e o
link segue copiável e válido.

### Testes da US2

- [ ] T083 [P] [US2] Criar `backend/test/assinaturas-notifications.test.js` com: envio **apenas** para assinante com e-mail (zero chamadas ao mailer para os demais, que ficam `NAO_APLICAVEL`); falha de SMTP marca `FALHOU` **sem invalidar o token**; publicação não é bloqueada por SMTP ausente
- [ ] T084 [P] [US2] Acrescentar em `backend/test/assinaturas-notifications.test.js` o caso de idempotência do job: duas execuções concorrentes com `emailClaimedAt` enviam uma única vez; e o caso de que `emailLastError` nunca contém o link/token

### Implementação da US2

- [ ] T085 [P] [US2] Adicionar `buildStandaloneSignatureRequestEmailTemplate({ documentTitle, requesterName, signerName, signUrl, expiresLabel })` em `backend/src/lib/email-templates.js`, seguindo o formato de `buildReportSignatureRequestEmailTemplate`
- [ ] T086 [P] [US2] Adicionar `buildStandaloneSignatureCompletedEmailTemplate({ documentTitle, signerNames, finalDocumentHash, appUrl })` em `backend/src/lib/email-templates.js`
- [ ] T087 [US2] Criar `backend/src/lib/assinaturas/notifications.js` com `sendInviteEmail(signer, document)` usando `sendClientMail` de `backend/src/lib/mailer.js`, gravando `emailStatus`/`emailSentAt`/`emailAttempts` e auditando `EMAIL_SOLICITADO`, `EMAIL_ENVIADO` ou `EMAIL_FALHOU`
- [ ] T088 [US2] Implementar `queueInviteEmails(document)` em `backend/src/lib/assinaturas/notifications.js`, chamado **após o commit** da publicação, nunca dentro da transação
- [ ] T089 [US2] Implementar `sendCompletedEmail(document)` em `backend/src/lib/assinaturas/notifications.js`, disparado após `buildFinalPdf` para o dono do documento
- [ ] T090 [US2] Criar `backend/src/lib/assinaturas/jobs.js` com o job `assinaturas:invite-emails` (a cada 5 min) sob `acquireJobLock` de `backend/src/lib/jobs/runner.js`, usando `emailClaimedAt` como trava por convite, backoff exponencial e teto de 5 tentativas
- [ ] T091 [US2] Exportar `startAssinaturasJobs()` de `backend/src/lib/assinaturas/jobs.js` e chamá-lo em `backend/src/server.js`, confirmando que `architecture:check` continua verde (job em `lib`, nunca em `routes`)
- [ ] T092 [US2] Ligar `queueInviteEmails` ao fim de `publishDocument` em `backend/src/lib/assinaturas/service.js` e `sendCompletedEmail` ao fim da finalização em `backend/src/lib/assinaturas/signing.js`
- [ ] T093 [US2] Exibir o estado de entrega por assinante em `frontend/src/pages/assinaturas/components/SignerStatusList.tsx` ("E-mail enviado", "Falha no envio — copie o link", "Sem e-mail — copie o link"), sem nunca mostrar o token

**Checkpoint**: US1 + US2 funcionando de forma independente.

---

## Phase 5: User Story 3 — Gestão dos convites e auditoria visível (Priority: P3)

**Objetivo**: renovar, revogar e reenviar convites; expirar automaticamente; ver a trilha completa.

**Teste independente**: com um documento publicado, renovar um convite e conferir que o link antigo passa a dar
404 e o novo funciona; revogar o outro e conferir que ele para de funcionar na hora; abrir a aba de auditoria e
ver a sequência completa de eventos.

### Testes da US3

- [ ] T094 [P] [US3] Acrescentar em `backend/test/assinaturas-public-sign.test.js`: token revogado → 404; **renovação invalida o token anterior** (o antigo resolve 404, o novo funciona); renovação concorrente com tentativa de assinatura → exatamente um vence, sem estado inconsistente
- [ ] T095 [P] [US3] Criar `backend/test/assinaturas-lifecycle.test.js` com o bloco de auditoria: cada ação grava o evento esperado na ordem esperada; nenhum caminho de código faz update/delete em `SignatureDocumentAuditLog`; nenhum evento contém token
- [ ] T096 [P] [US3] Acrescentar em `backend/test/assinaturas-lifecycle.test.js` o job de expiração: convite vencido vira `EXPIRADO` com auditoria `CONVITE_EXPIRADO`, e convite já `ASSINADO` **não** é afetado

### Implementação da US3

- [ ] T097 [US3] Implementar `renewInvite(tx, document, signerId, expiresAt)` em `backend/src/lib/assinaturas/invites.js`: recusa convite `ASSINADO`/`REVOGADO`, troca `tokenHash` + cifra + expiração em **uma única** `update` atômica, incrementa `renewalCount` e audita `CONVITE_RENOVADO`
- [ ] T098 [US3] Implementar `revokeInvite` e `revokeAllPending` em `backend/src/lib/assinaturas/invites.js` zerando `tokenHash` (`NULL`) e marcando `REVOGADO`/`revokedAt`, com auditoria `CONVITE_REVOGADO`, sem nunca tocar em convite `ASSINADO`
- [ ] T099 [US3] Implementar `expireOverdueInvites(client)` em `backend/src/lib/assinaturas/invites.js` para o job diário, marcando `EXPIRADO` e auditando
- [ ] T100 [US3] Adicionar o job `assinaturas:maintenance` (24 h) em `backend/src/lib/assinaturas/jobs.js` sob `acquireJobLock`, chamando `expireOverdueInvites` e registrando em `JobRun`
- [ ] T101 [US3] Implementar `listAudit(document, cursor)` em `backend/src/lib/assinaturas/service.js` com paginação por cursor e ordenação `createdAt desc`
- [ ] T102 [US3] Registrar em `backend/src/routes/resources/assinaturas.js` as rotas `POST /documentos/:id/assinantes/:signerId/renovar`, `POST /documentos/:id/assinantes/:signerId/revogar`, `POST /documentos/:id/assinantes/:signerId/reenviar-email` e `GET /documentos/:id/auditoria` — com **schema Zod** no payload de renovação, todas com owner check e resolvendo o `signerId` **a partir do documento já autorizado**
- [ ] T103 [US3] Adicionar as ações Renovar, Revogar e Reenviar e-mail em `frontend/src/pages/assinaturas/components/SignerStatusList.tsx`, com `ConfirmDialog` de `frontend/src/components/ui/` na revogação e toast de resultado
- [ ] T104 [US3] Implementar `frontend/src/pages/assinaturas/components/AuditTrail.tsx` com rótulos pt-BR por evento, data/hora em `America/Sao_Paulo`, paginação e apresentação em cards no mobile (sem tabela larga)
- [ ] T105 [US3] Exibir badge de expiração por convite e o aviso agregado "links expirados" no card da listagem em `frontend/src/pages/assinaturas/components/DocumentCard.tsx`

**Checkpoint**: US1 + US2 + US3 funcionando de forma independente.

---

## Phase 6: User Story 4 — Organização do acervo (Priority: P4)

**Objetivo**: arquivar/restaurar, cancelar rodada e excluir com invalidação imediata dos links e retenção.

**Teste independente**: arquivar um documento concluído e conferir que ele sai da listagem principal, continua
`CONCLUIDO` e com PDF final baixável; excluir um documento aguardando assinaturas e conferir que os links
morrem na hora e a trilha permanece.

### Testes da US4

- [ ] T106 [P] [US4] Acrescentar em `backend/test/assinaturas-lifecycle.test.js`: arquivar **não** altera status nem invalida links; restaurar volta à listagem; cancelar revoga pendentes e **preserva** assinados
- [ ] T107 [P] [US4] Acrescentar em `backend/test/assinaturas-lifecycle.test.js`: excluir invalida **todos** os links ativos imediatamente; restaurar excluído **não** revive tokens; job de retenção purga arquivos e **preserva** a trilha, preenchendo `filesPurgedAt` e zerando os caminhos

### Implementação da US4

- [ ] T108 [US4] Implementar `archive` e `restore` em `backend/src/lib/assinaturas/service.js` mexendo apenas em `archivedAt`, com auditoria `DOCUMENTO_ARQUIVADO`/`DOCUMENTO_RESTAURADO`
- [ ] T109 [US4] Implementar `cancelDocument(tx, document, reason)` em `backend/src/lib/assinaturas/service.js`: exige `AGUARDANDO_ASSINATURAS`, chama `revokeAllPending`, grava `CANCELADO`/`canceledAt`/`cancelReason` e audita `DOCUMENTO_CANCELADO`
- [ ] T110 [US4] Implementar `softDelete` e `restoreDeleted` em `backend/src/lib/assinaturas/service.js`: exclusão grava `deletedAt`, revoga todos os convites ativos e audita `DOCUMENTO_EXCLUIDO`; a restauração respeita a janela de retenção e audita `DOCUMENTO_EXCLUSAO_DESFEITA`
- [ ] T111 [US4] Estender o job `assinaturas:maintenance` em `backend/src/lib/assinaturas/jobs.js` para purgar arquivos e previews de documentos excluídos além de `env.assinaturasDeletedRetentionDays`, preenchendo `filesPurgedAt` e auditando `ARQUIVOS_PURGADOS`, **sem apagar** a linha nem a trilha
- [ ] T112 [US4] Registrar em `backend/src/routes/resources/assinaturas.js` as rotas `POST /documentos/:id/cancelar`, `POST /documentos/:id/arquivar`, `POST /documentos/:id/restaurar`, `DELETE /documentos/:id` e `POST /documentos/:id/restaurar-excluido`, com **schema Zod** no payload de cancelamento
- [ ] T113 [US4] Adicionar a aba Arquivados e o filtro por status em `frontend/src/pages/assinaturas/AssinaturasPage.tsx`, refletidos em `?tab=` e `?status=`, com o `select` nos estados do kit
- [ ] T114 [US4] Adicionar as ações Arquivar, Restaurar, Cancelar e Excluir em `frontend/src/pages/assinaturas/components/DocumentDetailView.tsx` usando `ConfirmDialog`, com confirmação **reforçada** (digitar o nome do documento) quando o status é `CONCLUIDO` e aviso explícito de invalidação dos links quando está `AGUARDANDO_ASSINATURAS`
- [ ] T115 [US4] Estender `backend/src/lib/data-retention.js` com o alvo de anonimização de `ipAddress`/`userAgent` em `SignatureDocumentAuditLog` após o cutoff, no mesmo padrão já aplicado a `ReportAuditLog`

**Checkpoint**: US1–US4 funcionando de forma independente.

---

## Phase 7: User Story 5 — Validação pública do documento assinado (Priority: P5)

**Objetivo**: código de validação + QR no PDF final e página pública que confirma a autenticidade.

**Teste independente**: concluir um documento, escanear o QR do PDF final (ou abrir `/validar-documento/<code>`)
e ver o documento como válido, com os assinantes e as datas; um código inexistente mostra "código inválido".

### Testes da US5

- [ ] T116 [P] [US5] Acrescentar em `backend/test/assinaturas-final-pdf.test.js`: `validationCode` gerado e único na publicação; o endpoint público resolve o código; documento não concluído não é dado como válido; código inexistente → 404

### Implementação da US5

- [ ] T117 [US5] Gerar `validationCode` (`randomBytes(18).toString('base64url')`) em `publishDocument` (`backend/src/lib/assinaturas/service.js`), no padrão de `createSignatureValidationCode` de `backend/src/lib/internal-report-signatures.js`
- [ ] T118 [US5] Desenhar o QR clicável e o código na página de evidências em `backend/src/lib/assinaturas/final-pdf.js` reutilizando `createValidationQrCodeMatrix` de `backend/src/lib/qr-code.js` e uma link-annotation apontando para `${env.appUrl}/validar-documento/<code>`
- [ ] T119 [US5] Implementar `validateByCode(client, code)` em `backend/src/lib/assinaturas/service.js` devolvendo título, status, `sourceDocumentHash`, `finalDocumentHash`, `completedAt` e, por assinante, nome declarado e data/hora — sem e-mail e sem IP
- [ ] T120 [US5] Registrar a rota pública `GET /validar/:code` em `backend/src/routes/resources/assinaturas.js`, dentro do bloco público e com o mesmo rate limiter
- [ ] T121 [US5] Parametrizar `frontend/src/pages/SignatureValidationPage.tsx` para resolver código de RDO **e** de documento avulso, sem alterar o endpoint atual do RDO, e registrar `/validar-documento/:code` em `frontend/src/App.tsx`

**Checkpoint**: US1–US5 funcionando de forma independente.

---

## Phase 8: User Story 6 — Exclusão de conta (Priority: P6)

**Objetivo**: excluir uma conta apaga os documentos não concluídos do usuário, preserva os concluídos como
órfãos e avisa a contagem antes de confirmar. Implementa a decisão D16.

**Teste independente**: com um usuário que tem 2 documentos em rascunho/aguardando e 1 concluído, iniciar a
exclusão da conta como ADMIN; a confirmação avisa "2 serão excluídos, 1 concluído será preservado"; após
confirmar, os 2 somem do banco e do disco, o concluído permanece com `ownerUserId = NULL` e ninguém — nem
ADMIN — consegue abri-lo pela aplicação.

**⚠️ Única fase que altera comportamento de módulo existente.** O PR precisa citar a decisão D16.

### Testes da US6

- [ ] T122 [P] [US6] Acrescentar em `backend/test/assinaturas-lifecycle.test.js` o bloco de exclusão de conta: `userDeletionImpact` conta corretamente por status; `prepareUserDeletion` apaga rascunhos/aguardando/cancelados e **não** apaga concluídos; concluídos ficam com `ownerUserId = NULL` e ganham `PROPRIETARIO_REMOVIDO`
- [ ] T123 [P] [US6] Acrescentar em `backend/test/assinaturas-lifecycle.test.js`: os caminhos dos arquivos dos apagados são devolvidos para purga e os dos preservados **não**; erro na rotina aborta a exclusão da conta inteira
- [ ] T124 [P] [US6] Criar em `backend/test/` (ou estender o teste de contas existente) o caso de regressão: excluir uma conta **sem** documentos de assinatura continua funcionando exatamente como antes

### Implementação da US6

- [ ] T125 [US6] Implementar `userDeletionImpact(client, userId)` em `backend/src/lib/assinaturas/service.js` devolvendo `{ toDelete, toPreserve }` agrupado por status
- [ ] T126 [US6] Implementar `prepareUserDeletion(tx, userId)` em `backend/src/lib/assinaturas/service.js`: coleta os caminhos, apaga os documentos com status ≠ `CONCLUIDO` (cascade leva assinantes, campos e trilha) e grava `PROPRIETARIO_REMOVIDO` nos concluídos que ficarão órfãos
- [ ] T127 [US6] Adicionar a rota `GET /:id/impacto` em `backend/src/routes/resources/users.js` sob `requireHubAdmin`, devolvendo `{ assinaturas: { toDelete, toPreserve } }`
- [ ] T128 [US6] Alterar `DELETE /:id` em `backend/src/routes/resources/users.js` para envolver `prepareUserDeletion(tx, userId)` e `prisma.user.delete()` na **mesma transação**, e purgar os arquivos coletados **após o commit**
- [ ] T129 [US6] Exibir a contagem de impacto na confirmação de exclusão em `frontend/src/pages/admin/AdminAccountsPage.tsx` ("N documentos de assinatura serão excluídos permanentemente. M documentos concluídos serão preservados."), usando `ConfirmDialog` do kit

**Checkpoint**: todas as histórias funcionando de forma independente.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T130 Novidade temporária de 10 dias: **N/A** — a constitution exige campanha temporária apenas para função nova dentro de módulo existente. Registrar essa justificativa no PR
- [ ] T131 Tutorial permanente de primeiro acesso: implementar `frontend/src/pages/assinaturas/AssinaturasTutorial.tsx` com `driver.js` no padrão de `frontend/src/components/HubTutorial.tsx`, cobrindo enviar PDF → adicionar assinantes → posicionar campos → publicar → copiar links → acompanhar, com marcador de "visto" em `localStorage` por usuário/navegador
- [ ] T132 Contrato visual: auditar cada controle novo de formulário em `frontend/src/pages/assinaturas/` e confirmar uso de `field-group` (ou equivalente documentado), sem rótulo apenas por placeholder e sem `select` com aparência crua do navegador
- [ ] T133 Validação visual de obrigatórios: submeter cada formulário novo com campos vazios e confirmar `.field-group.field-invalid`, `aria-invalid` e `.field-error` abaixo do controle, em NewDocumentModal, SignerList e PublishDialog
- [ ] T134 Drag and drop: reordenação de lista é **N/A** nesta feature (a ordem dos assinantes é a de criação). Verificar que o **posicionamento de campo** em `PdfPageCanvas.tsx` usa Pointer Events com `touch-action: none`, funciona no toque e cancela sem persistir; registrar o N/A da reordenação no PR
- [ ] T135 Continuidade de navegação: verificar que `?doc=`, `?page=`, `?tab=` e `?status=` sobrevivem ao F5 e ao deep-link, e que trocar de seção limpa os parâmetros incompatíveis
- [ ] T136 Auditoria de overflow no mobile: verificar em telas estreitas a grade de cards, a lista de assinantes, as abas, os badges de status e o editor de posicionamento — sem scroll horizontal de página, com `min-width: 0` nos filhos de grid/flex e truncamento dos nomes longos de arquivo
- [ ] T137 Passe de consistência visual: verificar todas as superfícies da tabela de evidência visual do `plan.md` em desktop e mobile, com os estados default/foco/disabled/erro/vazio dos selects e o shell largo no desktop
- [ ] T138 Identidade portada: **N/A** — módulo novo sem app de origem, obrigado ao kit e aos tokens. Registrar no PR
- [ ] T139 [P] Auditoria de segurança de logs: `grep` no código do módulo garantindo que nenhum `console.*` recebe `token`, apenas `tokenHash.slice(0,8)`; conferir que o mascaramento do `morgan` de T066 está ativo
- [ ] T140 [P] Observabilidade: adicionar logs estruturados (sem dado sensível) para falha de upload, falha de render de preview, falha na geração do PDF final, falha de e-mail, token inválido/expirado em forma agregada e duração do processamento, em `backend/src/lib/assinaturas/`
- [ ] T141 [P] Documentar o módulo em `README.md` e acrescentar a nota do módulo em `docs/PADRAO_MODULO.md`
- [ ] T142 [P] Acrescentar a operação ao `LGPD_ROPA.md`: nome e e-mail de assinantes externos, IP/User-Agent como evidência de assinatura, retenção de 90 dias e a base legal de guarda para assinatura concluída
- [ ] T143 Rodar a validação completa de `specs/012-assinaturas-avulsas/quickstart.md`, incluindo o passo 12b (exclusão de conta) e o checklist de aceite dos 20 itens
- [ ] T144 Rodar o CI completo: `npm run architecture:check`, `cd backend && npm test`, `cd frontend && npm run lint && npm test && npm run build`
- [ ] T145 Auditoria de data/hora: verificar a exibição em **todas** as superfícies do módulo — listagem, detalhes, status por assinante, expiração de convite, trilha de auditoria e página pública — garantindo o fuso **`America/Sao_Paulo`** (FR-039), alinhado ao que o backend já faz em `backend/src/lib/internal-report-signatures.js`. Extrair um formatador compartilhado (`frontend/src/pages/assinaturas/utils/datetime.ts`) em vez de repetir `toLocaleString` por componente; registrar no PR a divergência com o padrão atual do frontend, que usa o fuso do navegador
- [ ] T146 Medir e registrar no PR os dois alvos de tempo dos critérios de sucesso: prévia de página em até 2 s na primeira exibição e instantânea nas seguintes (SC-012); arquivo final disponível em até 5 s para documento de 30 páginas com 10 assinantes (SC-013). Caso algum alvo não seja atingido, registrar o número real e propor ajuste do critério na spec ou otimização

---

## Dependencies & Execution Order

### Dependências entre fases

- **Phase 1 (Setup)**: sem dependências
- **Phase 2 (Foundational)**: depende da Phase 1 — **BLOQUEIA todas as histórias**
- **Phase 3 (US1)**: depende da Phase 2
- **Phase 4 (US2)**: depende da Phase 2; integra com US1 (publicação) mas é testável sozinha
- **Phase 5 (US3)**: depende da Phase 2; T094 precisa dos convites da US1 para exercitar renovação
- **Phase 6 (US4)**: depende da Phase 2; T110 usa `revokeAllPending` de T098 (US3)
- **Phase 7 (US5)**: depende da Phase 2 e do `final-pdf.js` da US1
- **Phase 8 (US6)**: depende da Phase 2 e de `purgeDocumentFiles`/`purgePreviews` (T031, T045)
- **Phase 9 (Polish)**: depende de todas as histórias desejadas

### Dependências reais entre histórias

Nem todas as histórias são 100% independentes — este é um módulo, não um conjunto de features soltas:

| História | Dependência técnica | Ainda é testável sozinha? |
|---|---|---|
| US1 | — | Sim |
| US2 | `publishDocument` (T051) | Sim — com um documento publicado |
| US3 | `issueInvites` (T049) | Sim |
| US4 | `revokeAllPending` (T098, US3) | Sim — se US3 já estiver pronta |
| US5 | `final-pdf.js` (T058–T061) | Sim |
| US6 | `purgeDocumentFiles` (T031), `purgePreviews` (T045) | Sim |

### Dentro de cada história

- Testes escritos **antes** da implementação (Princípio V)
- Lib de domínio antes das rotas; rotas antes do frontend
- `access.js` sempre antes de qualquer rota que toque documento

### Oportunidades de paralelismo

- Phase 1: T007, T008, T009, T014 em paralelo
- Phase 2: T024, T033, T034 em paralelo; T016–T020 são o mesmo arquivo (`schema.prisma`) e **não** paralelizam
- Phase 3: T035–T042 (todos os testes) em paralelo; T067, T068, T069 em paralelo
- Phase 4: T083, T084 em paralelo; T085, T086 em paralelo
- Phase 9: T139, T140, T141, T142 em paralelo
- Com equipe: depois da Phase 2, US2/US3/US5 podem correr em paralelo com o frontend da US1

---

## Parallel Example: User Story 1

```bash
# Todos os testes da US1 juntos:
Task: "backend/test/assinaturas-publish.test.js — configuração e publicação"
Task: "backend/test/assinaturas-public-sign.test.js — fluxo público"
Task: "backend/test/assinaturas-final-pdf.test.js — coordenadas e finalização"
Task: "backend/test/assinaturas-access.test.js — matriz de owner isolation"
Task: "frontend/test/assinaturas-coordinates.test.mjs — round-trip de coordenadas"

# Camada de dados do frontend em paralelo:
Task: "frontend/src/api/assinaturas.ts"
Task: "frontend/src/hooks/useAssinaturas.ts"
Task: "frontend/src/pages/assinaturas/utils/coordinates.ts"
```

---

## Implementation Strategy

### MVP primeiro (US1)

1. Phase 1: Setup (T001–T015)
2. Phase 2: Foundational (T016–T034) — **crítico, bloqueia tudo**
3. Phase 3: US1 (T035–T082)
4. **PARAR E VALIDAR**: rodar os passos 1–7, 9 e 11 do `quickstart.md`
5. Entregar/demonstrar — o módulo já resolve o problema, com links copiados manualmente

### Entrega incremental

1. Setup + Foundational → base pronta
2. + US1 → MVP entregável
3. + US2 → convites automáticos por e-mail
4. + US3 → renovação, revogação e auditoria visível
5. + US4 → arquivamento, exclusão e retenção
6. + US5 → validação pública do PDF assinado
7. + US6 → exclusão de conta integrada
8. + Phase 9 → tutorial, auditoria visual e documentação

### Mapeamento com as etapas do plan.md

| Etapa do plan.md | Fases/tarefas equivalentes |
|---|---|
| E1 registro e permissão | Phase 1 (T001–T015) |
| E2 modelo de dados | T016–T022 |
| E3 upload e storage | T023–T034, T043, T046 |
| E4 preview | T044, T045 |
| E5 assinantes e campos | T047, T048 |
| E6 publicação e convites | T049–T051, T064 |
| E7 fluxo público | T052–T057, T062 |
| E8 finalização e PDF final | T058–T061 + US5 (T116–T121) |
| E9 e-mail e jobs | US2 (T083–T093) |
| E10 frontend completo | T067–T082, T103–T105, T113–T114 |
| E11 ciclo de vida e retenção | US4 (T106–T115) + T131 |
| E12 exclusão de conta | US6 (T122–T129) |

---

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente
- Commit após cada tarefa ou grupo lógico coerente
- Toda tarefa que toca rota de documento precisa passar por `documentForOwnerOrThrow` — sem exceção
- Nenhum token completo pode aparecer em log, auditoria, payload de listagem ou mensagem de erro
- `backend/src/routes/resources/reports.js` **não** deve ser alterado em nenhuma tarefa (budget travado no `architecture:check`)
- `backend/src/lib/internal-report-signatures.js` **não** deve ser alterado em nenhuma tarefa (ver decisão D8)
- A única alteração de módulo existente autorizada é `backend/src/routes/resources/users.js` na US6, justificada em D16
