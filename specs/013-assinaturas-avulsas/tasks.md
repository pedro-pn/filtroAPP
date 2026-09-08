---
description: "Lista de tarefas — módulo Assinaturas Avulsas"
---

# Tasks: Assinaturas Avulsas

**Input**: `specs/013-assinaturas-avulsas/` (`spec.md` como fonte de verdade, `plan.md`, `research.md`,
`data-model.md`, `contracts/api.md`, `quickstart.md`; `spec-input.md` preservado apenas como briefing histórico)

**Branch**: `feat/signature-module`

**Tests**: **INCLUÍDOS E OBRIGATÓRIOS.** A §31 do briefing lista 27 cenários de cobertura obrigatória e o
Princípio V da constitution exige teste em `backend/test` para toda regra de negócio nova.

**Organização**: tarefas agrupadas pelas seis histórias de usuário de `spec.md`, para que cada incremento seja
implementável e testável de forma independente.

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

- [X] T001 Rodar `npm run new:module -- assinaturas --title "Assinaturas"` na raiz do repositório e revisar tudo que foi gerado antes de commitar
- [X] T002 Ajustar a entrada `assinaturas` em `shared/modules/registry.json` para **uma única role**: remover `ASSINATURAS_VIEWER`/`assinaturas:viewer` e manter só `{ code: "ASSINATURAS_USER", public: "assinaturas:user", label: "Assinaturas - Usuário", accountTypes: ["ADMIN","INTERNAL"] }`, com `hub.roles: ["assinaturas:user"]`, `routeGroups.default.allowedModuleRoles: ["assinaturas:user"]`, `badge: "ASS"`, `copy: "Envio de PDF avulso, coleta de assinaturas e trilha de auditoria."`
- [X] T003 Adicionar `pathExclusions: ["/assinaturas/assinar"]` à entrada do módulo em `shared/modules/registry.json`, seguindo o precedente do módulo `epi` (`/epi/assinar`)
- [X] T004 Ajustar `backend/prisma/schema.prisma` para conter apenas `ASSINATURAS` em `AppModule` e `ASSINATURAS_USER` em `ModuleRoleCode` (remover o `ASSINATURAS_VIEWER` gerado pelo scaffold)
- [X] T005 Ajustar a migration gerada `backend/prisma/migrations/<ts>_add_assinaturas_module/migration.sql` para conter apenas os dois `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (`ASSINATURAS`, `ASSINATURAS_USER`)
- [X] T006 Rodar `npm run modules:generate` e confirmar que `frontend/src/modules/registry.generated.ts` reflete a role única
- [X] T007 [P] Adicionar as variáveis novas ao schema Zod em `backend/src/config/env.js`: `ASSINATURAS_MAX_PDF_MB` (20), `ASSINATURAS_MAX_PAGES` (50), `ASSINATURAS_MAX_SIGNERS` (20), `ASSINATURAS_TOKEN_MAX_DAYS` (90), `ASSINATURAS_DELETED_RETENTION_DAYS` (90), `ASSINATURAS_PREVIEW_SCALE` (1.5)
- [X] T008 [P] Documentar as seis variáveis novas em `backend/.env.example` com comentário do que cada uma limita
- [X] T009 [P] Adicionar casos das variáveis novas em `backend/test/env.test.js` (default aplicado, valor inválido derruba o boot)
- [X] T010 Criar `backend/src/lib/assinaturas/access.js` com `requireAssinaturasAccess` usando `hasModuleRole(req.auth?.user, 'assinaturas:user')` e resposta 403 `'Acesso restrito ao módulo de Assinaturas.'`, no padrão de `requireEpiAccess` em `backend/src/routes/resources/epis.js`
- [X] T011 Reduzir `backend/src/routes/resources/assinaturas.js` (gerado pelo scaffold) à casca: `Router()`, marcador de bloco público vazio, e `router.use(requireAuth, requireAssinaturasAccess)` antes das rotas autenticadas
- [X] T012 Confirmar o mount `router.use('/assinaturas', assinaturasRouter)` em `backend/src/routes/index.js` no marcador `module:scaffold mount`
- [X] T013 Criar `frontend/src/pages/assinaturas/AssinaturasPage.tsx` como placeholder com o shell largo do módulo (padrão `.equip-page` de `frontend/src/pages/equipamentos/EquipamentosPage.tsx`) e confirmar a rota em `frontend/src/modules/moduleRoutes.tsx`
- [X] T014 [P] Criar `backend/test/assinaturas-access.test.js` com os cenários 1–3: usuário sem `assinaturas:user` → 403; com a role → segue; conta ADMIN sem a role → 403 (sem bypass)
- [X] T015 Rodar `npm run architecture:check`, `cd backend && npm test`, `cd frontend && npm run lint && npm run build` e confirmar tudo verde

**Checkpoint**: card "Assinaturas" aparece em `/modulos` só para quem tem a role; `/assinaturas` abre vazio.

---

## Phase 2: Foundational (Pré-requisitos bloqueantes)

**Objetivo**: modelo de dados, isolamento por proprietário, auditoria e storage — a base de **todas** as histórias.

**⚠️ CRÍTICO**: nenhuma história pode começar antes desta fase terminar.

- [X] T016 Adicionar os seis enums novos em `backend/prisma/schema.prisma`: status do documento (incluindo `FINALIZANDO`), status do assinante, e-mail (incluindo `EM_ENVIO`/`REVISAO_NECESSARIA`), motivo de invalidação, status de purga e auditoria com 27 ações, conforme `data-model.md` §1
- [X] T017 Adicionar o model `SignatureDocument` em `backend/prisma/schema.prisma` com `ownerUserId String?`/`SetNull`, `requesterNameSnapshot`, campos de claim/retry da finalização, relações e os 6 índices de `data-model.md` §2
- [X] T018 Adicionar o model `SignatureDocumentSigner` em `backend/prisma/schema.prisma` com e-mail opcional, token hash/cifra, `invalidationReason`, entrega, evidências, `@@unique([documentId, position])` e os 4 índices
- [X] T019 Adicionar o model `SignatureDocumentField` em `backend/prisma/schema.prisma` com `x/y/width/height` em `Decimal(9,8)`, `pageWidthPt`/`pageHeightPt` em `Decimal(10,3)`, `pageRotation` e os 2 índices
- [X] T020 Adicionar em `backend/prisma/schema.prisma` `SignatureDocumentAuditLog`, `SignatureDocumentFilePurge` e `SignatureDocumentCompletionNotification` (uma outbox por documento, destinatário snapshot, chave idempotente, claim/provider result), conforme `data-model.md` §2
- [X] T021 Adicionar as duas relations de volta em `model User` de `backend/prisma/schema.prisma`: `signatureDocuments` e `signatureDocumentAuditLogs`
- [X] T022 Gerar a migration `backend/prisma/migrations/<ts>_add_assinaturas_tables/migration.sql` via `cd backend && npx prisma migrate dev --name add_assinaturas_tables`, confirmando que ela é **separada e posterior** à migration de T005 e cria 6 enums + 6 tabelas na ordem de `data-model.md` §3
- [X] T023 Estender `backend/src/lib/audit/events.js` com `AUDIT_MODULES.ASSINATURAS = 'assinaturas'`, `AUDIT_ENTITY_TYPES.SIGNATURE_DOCUMENT = 'signature-document'` e o terceiro branch em `recordAuditEvent` gravando em `client.signatureDocumentAuditLog` (com `signerId` a partir de `relatedEntityId`), sem alterar os branches de RDO e EPI
- [X] T024 [P] Acrescentar casos em `backend/test/audit-events.test.js`: o novo alvo grava com os campos certos; alvo desconhecido continua lançando `TypeError`; RDO e EPI seguem inalterados
- [X] T025 Criar `backend/src/lib/assinaturas/audit.js` com `recordDocumentEvent(client, { document, signer, actorUserId, action, description, evidence })`; não expor update/delete semântico e isolar a única mutação permitida (anonimizar IP/UA + acrescentar `DADOS_ACESSO_ANONIMIZADOS`)
- [X] T026 Implementar em `backend/src/lib/assinaturas/access.js` a função `ownerListWhere(ownerUserId)` que **lança** `TypeError` se `ownerUserId` for nulo/vazio e devolve `{ ownerUserId, deletedAt: null }`
- [X] T027 Implementar em `backend/src/lib/assinaturas/access.js` a função `documentForOwnerOrThrow(client, id, ownerUserId, { include, allowArchived = true, allowDeleted = false })` que lança se `ownerUserId` for nulo, faz `findFirst({ where: { id, ownerUserId, deletedAt: null } })` e lança erro **404** (`statusCode = 404`, mensagem `'Documento não encontrado.'`) quando não achar
- [X] T028 Implementar em `backend/src/lib/assinaturas/access.js` os guards `assertDocumentEditable`, `assertDocumentPublishable`, `assertDocumentDeletable` e `assertAccountDeletionReady`; `FINALIZANDO` bloqueia mutações/exclusões com 409 pt-BR
- [X] T029 Criar `backend/src/lib/assinaturas/document.js` com `parsePdfUpload(fileName, dataUrl)` no padrão de `backend/src/lib/qualidade/attachments.js`: regex de data URL `application/pdf`, decodifica base64, valida magic bytes `%PDF`, aplica `env.assinaturasMaxPdfMb`
- [X] T030 Implementar `pdfMetadata(bytes)` em `backend/src/lib/assinaturas/document.js` usando `PDFDocument.load()` do `pdf-lib` para obter `pageCount` e `pageDimensions` (`[{ page, widthPt, heightPt, rotation }]`), rejeitando PDF ilegível, criptografado ou acima de `env.assinaturasMaxPages`
- [X] T031 Implementar `storeSourcePdf`, `sourcePdfBuffer`, `finalPdfBuffer` (ambos revalidam o hash correspondente) e `purgeDocumentFiles` em `backend/src/lib/assinaturas/document.js`, usando a storage gerenciada e recusando qualquer escape de `Assinaturas/`
- [X] T032 Configurar em `backend/src/app.js` parser JSON de 30 MB **somente** para `POST /api/assinaturas/documentos`, mantendo 3 MB nas rotas públicas e os limites atuais nas demais rotas
- [X] T033 [P] Criar `backend/test/assinaturas-document.test.js` cobrindo tipos/magic bytes/PDF ilegível, PDF bruto no limite de 20 MB aceito dentro do body de 30 MB e acima rejeitado, hash/metadados, proteção de path e compensação do arquivo quando a criação no banco falhar
- [X] T034 [P] Acrescentar em `backend/test/assinaturas-access.test.js` os cenários 4, 10 e 11: `ownerListWhere` sempre inclui `ownerUserId` + `deletedAt: null`; `documentForOwnerOrThrow(client, id, null)` e `ownerListWhere(undefined)` **lançam**; documento órfão (`ownerUserId = NULL`) devolve 404 para qualquer usuário

**Checkpoint**: base pronta. As histórias podem começar.

---

## Phase 3: User Story 1 — Fluxo essencial de assinatura avulsa (Priority: P1) 🎯 MVP

**Objetivo**: enviar um PDF, cadastrar assinantes, posicionar campos, publicar, copiar os links manualmente,
cada assinante assina pelo link e o documento passa por `FINALIZANDO` até o PDF íntegro ficar disponível.

**Teste independente**: subir um PDF de 3 páginas; cadastrar dois assinantes **sem e-mail**; posicionar um
campo para cada; publicar com validade de 15 dias; copiar os dois links; abrir cada link em janela anônima e
assinar; conferir `FINALIZANDO → CONCLUIDO` e que o PDF final tem as duas assinaturas nas posições
escolhidas mais a página de evidências. Nenhum e-mail é enviado em nenhum momento.

### Testes da US1 (escrever antes da implementação)

- [X] T035 [P] [US1] Criar `backend/test/assinaturas-publish.test.js` com os casos de configuração/publicação, incluindo assinante/campo/prazo inválidos, propriedades físicas extras no payload de campo rejeitadas e geometria autoritativa derivada para páginas 0°/90°/180°/270°
- [X] T036 [P] [US1] Acrescentar em `backend/test/assinaturas-publish.test.js` os casos de sucesso: publicação válida move para `AGUARDANDO_ASSINATURAS`; **cada assinante recebe um `tokenHash` distinto e não nulo**; editar assinantes/campos depois de publicar → 409; **despublicar com zero assinaturas volta a `RASCUNHO` e zera todos os `tokenHash`; despublicar com uma assinatura registrada → 409**
- [X] T037 [P] [US1] Criar `backend/test/assinaturas-public-sign.test.js` com token ausente/incorreto/expirado/revogado, assinatura/evidência válidas, dupla assinatura idempotente e imagem inválida antes de escrita; todas as rotas recebem segredo só por `X-Signature-Token`
- [X] T038 [P] [US1] Acrescentar em `backend/test/assinaturas-public-sign.test.js` testes de minimização e segredo: payload omite terceiros/e-mail do dono; token não aparece em path/query, access log, resposta 5xx, telemetria ou chave de cache; responses usam `no-store` + `no-referrer`
- [X] T039 [P] [US1] Criar `backend/test/assinaturas-final-pdf.test.js` com transformação afim em 0°/90°/180°/270° e CropBox/MediaBox, hash-base divergente sem promoção, evidências completas e hash final recusando arquivo adulterado em todo download
- [X] T040 [P] [US1] Acrescentar em `backend/test/assinaturas-final-pdf.test.js` falhas antes/depois do temporário e queda após rename, retry/job idempotente, claim expirado e duas finalizações concorrentes; exigir um único arquivo/hash, `PDF_FINAL_GERADO`, `DOCUMENTO_CONCLUIDO` e nunca `CONCLUIDO` com caminho/hash nulos
- [X] T041 [P] [US1] Acrescentar em `backend/test/assinaturas-access.test.js` os cenários 5–9: dono diferente → **404, nunca 403**; matriz das rotas de documento com o usuário B contra documento de A → 404 em todas; `signerId`/`fieldId` de outro documento → 404/400; preview e download de PDF alheio → 404
- [X] T042 [P] [US1] Criar `frontend/test/assinaturas-coordinates.test.mjs` com round-trip pixel/normalizado, clamp/tamanho mínimo, captura e remoção do fragmento, ausência de token em storage/query key/telemetria e polling de `FINALIZANDO` sem reenviar assinatura

### Backend — documento e preview

- [X] T043 [US1] Implementar `createDocument` em `backend/src/lib/assinaturas/document.js`: valida, calcula hash/metadados, grava o arquivo, cria `RASCUNHO` com `ownerUserId`, `requesterNameSnapshot` e título; se a transação falhar após a escrita, remover o arquivo por compensação; auditar `DOCUMENTO_CRIADO`
- [X] T044 [US1] Criar `backend/src/lib/assinaturas/preview.js` com `renderPage(document, pageNumber)` usando `pdfjs-dist/legacy/build/pdf.mjs` + `createCanvas` do `@napi-rs/canvas`, na receita de `backend/scripts/import-manual-rdo-pdfs.js:673-687`, com `isEvalSupported: false`, escala `env.assinaturasPreviewScale`, largura máxima 1400 px e cache em disco em `Assinaturas/Previews/<documentId>/<n>.png`
- [X] T045 [US1] Implementar `purgePreviews(documentId)` em `backend/src/lib/assinaturas/preview.js` para uso pela exclusão e pela retenção
- [X] T046 [US1] Implementar `listDocuments`, `getDocument`, `documentProgress` e `renameDocument` em `backend/src/lib/assinaturas/service.js`, todos passando por `ownerListWhere`/`documentForOwnerOrThrow`
- [X] T047 [US1] Implementar `replaceSigners(tx, document, signers)` em `backend/src/lib/assinaturas/service.js` com validação Zod (nome ≥ 2, e-mail válido quando presente, sem duplicidade, ≤ `env.assinaturasMaxSigners`, `position` sequencial), exigindo `RASCUNHO`, e auditando `CONFIGURACAO_ATUALIZADA`
- [X] T048 [US1] Implementar `replaceFields(tx, document, fields)` em `backend/src/lib/assinaturas/service.js` com schema Zod estrito só para coordenadas normalizadas; validar vínculo/caixa/página e copiar largura/altura/rotação autoritativas de `document.pageDimensions`
- [X] T049 [US1] Criar `backend/src/lib/assinaturas/invites.js` com emissão por `signatureTokenData()` e `inviteUrl(token)` em `${env.appUrl}/assinaturas/assinar#convite=<token>`; nunca usar segredo em path/query
- [X] T050 [US1] Implementar `recoverInviteLink` em `backend/src/lib/assinaturas/invites.js` usando `decryptSignatureToken()` e auditando `LINK_RECUPERADO`; garantir que o token **não** aparece em nenhum retorno de listagem nem em log
- [X] T051 [US1] Implementar `publishDocument` **e `unpublishDocument`** em `backend/src/lib/assinaturas/service.js`. `publishDocument`: valida o prazo recebido (`expiresInDays` **ou** `expiresAt`), aplica as 9 validações de `plan.md` §H.3 em transação, gera `publishedAt`, emite os convites via `issueInvites`, define `emailStatus` (`PENDENTE` com e-mail, `NAO_APLICAVEL` sem) e audita `DOCUMENTO_PUBLICADO` + um `CONVITE_CRIADO` por assinante; SMTP ausente **não** bloqueia. `unpublishDocument`: exige `AGUARDANDO_ASSINATURAS` e **zero** assinaturas registradas (senão 409), zera `tokenHash`/cifra/expiração de todos os convites, devolve o documento a `RASCUNHO` e audita `DOCUMENTO_DESPUBLICADO`
- [X] T052 [US1] Implementar `resolveInviteByToken(client, token)` em `backend/src/lib/assinaturas/invites.js` fazendo lookup **apenas** por `signatureTokenHash(token)`, incluindo documento, campos do próprio assinante e contagem agregada dos demais

### Backend — fluxo público de assinatura

- [X] T053 [US1] Criar `backend/src/lib/assinaturas/signing.js` com `loadInvite(client, token, evidence)` validando por hash/expiração/estado, marcando primeira visualização e auditando; aceitar token somente já extraído do header pela rota
- [X] T054 [US1] Implementar `publicInvitePayload` com somente o próprio assinante, metadados, `requesterNameSnapshot`, progresso e estado `FINALIZANDO`/download disponível; nunca expor terceiros ou e-mail do dono
- [X] T055 [US1] Implementar `confirmSignature` com validação de imagem antes de escrita, releitura transacional por hash e `updateMany` idempotente; resposta traz estado atual `FINALIZANDO|CONCLUIDO` e retry nunca regrava assinatura/auditoria
- [X] T056 [US1] Sob advisory lock do documento, detectar a última assinatura e fazer apenas a transição condicional `AGUARDANDO_ASSINATURAS → FINALIZANDO`, inicializando claim/retry e `FINALIZACAO_INICIADA`; proibir qualquer conclusão nessa transação em `backend/src/lib/assinaturas/signing.js`
- [X] T057 [US1] Adicionar a variante `signatureAvulsa` com versão `signature_avulsa_v1` em `backend/src/lib/privacy-consent.js` e usá-la no schema Zod de confirmação, via `validatePrivacyNoticeAcknowledgement`

### Backend — PDF final

- [X] T058 [US1] Criar `normalizedFieldToPdfRect(field, pageGeometry)` em `backend/src/lib/assinaturas/final-pdf.js` com matriz afim compatível com PDF.js para 0°/90°/180°/270° e CropBox/MediaBox; fórmula direta só no caso 0°
- [X] T059 [US1] Implementar o builder **puro** de bytes finais em `backend/src/lib/assinaturas/final-pdf.js`: revalidar hash-base, carimbar imagens com geometria derivada no servidor e legenda pt-BR, sem escrever arquivo/banco
- [X] T060 [US1] Implementar em `backend/src/lib/assinaturas/final-pdf.js` página de evidências A4 com nome histórico do solicitante, hash original e, por assinante, nome/e-mail/data/IP/navegador, no layout de `writeFinalEvidencePdf` sem alterar `backend/src/lib/internal-report-signatures.js`
- [X] T061 [US1] Implementar processador idempotente + job `assinaturas:finalization` em `backend/src/lib/assinaturas/jobs.js`: escrita/hash/rename recuperáveis, auditorias e transição conclusiva que cria `SignatureDocumentCompletionNotification` na mesma transação; iniciar via `startAssinaturasJobs()` em `backend/src/server.js`

### Backend — rotas

- [X] T062 [US1] Registrar antes do auth, com rate limit, as rotas sem token no path `GET /publico`, `GET /publico/pdf`, `GET /publico/paginas/:n.png`, `POST /publico/assinar`; extrair/validar `X-Signature-Token`, usar schema Zod e responder `no-store` + `no-referrer`
- [X] T063 [US1] Registrar em `backend/src/routes/resources/assinaturas.js` as rotas autenticadas de documento; `POST /documentos` usa o parser isolado de 30 MB e schema Zod, downloads validam hashes, e toda leitura por id chama `documentForOwnerOrThrow`
- [X] T064 [US1] Registrar em `backend/src/routes/resources/assinaturas.js` as rotas de configuração e publicação: `PUT /documentos/:id/assinantes`, `PUT /documentos/:id/campos`, `POST /documentos/:id/publicar`, `POST /documentos/:id/despublicar`, `GET /documentos/:id/assinantes/:signerId/link` — com **schema Zod** em cada payload (`assinantes`, `campos`, `publicar`)
- [X] T065 [US1] Garantir `Cache-Control: no-store` em conteúdo e `Referrer-Policy: no-referrer` nas superfícies públicas; downloads final autenticado/público passam por `finalPdfBuffer` e validam hash
- [X] T066 [US1] Redigir `X-Signature-Token` em logs/erros/observabilidade em `backend/src/app.js`; rotas sem segredo no path eliminam vazamento por access log, e mensagens nunca incluem header/token

### Frontend — camada de dados

- [X] T067 [P] [US1] Criar `frontend/src/api/assinaturas.ts` com tipos/chamadas autenticadas e wrapper público que envia `X-Signature-Token`, força `no-referrer` e nunca interpola o segredo na URL, no padrão de `frontend/src/api/qualidade.ts`
- [X] T068 [P] [US1] Criar `frontend/src/hooks/useAssinaturas.ts` com queries autenticadas usuais e chave pública opaca por sessão que não contém token; wrapper mantém o segredo só em memória e envia `X-Signature-Token`
- [X] T069 [P] [US1] Criar `frontend/src/pages/assinaturas/utils/coordinates.ts` com `pixelToNormalized`, `normalizedToPercent` e o clamp/tamanho mínimo compartilhados com o teste T042

### Frontend — telas

- [X] T070 [US1] Implementar a listagem em `frontend/src/pages/assinaturas/AssinaturasPage.tsx` + `frontend/src/pages/assinaturas/components/DocumentCard.tsx` usando `SearchBar`, `Skeleton`, `Button` e `Toast` de `frontend/src/components/ui/`, com grade `minmax(min(100%, 280px), 1fr)`, `min-width: 0` nos filhos e estados de loading/empty/erro
- [X] T071 [US1] Implementar `frontend/src/pages/assinaturas/components/NewDocumentModal.tsx` reutilizando `frontend/src/components/ui/PdfDropzone.tsx` e `Modal`, com formulário em `react-hook-form` + resolver Zod, barra de progresso durante o upload e mensagens específicas para arquivo não-PDF, arquivo grande e PDF ilegível
- [X] T072 [US1] Implementar `frontend/src/pages/assinaturas/components/PdfPageCanvas.tsx`: `<img>` da página em contêiner `position: relative` com `overflow: auto` próprio, campos como `<div>` absolutos posicionados em **percentual**, arraste e redimensionamento por Pointer Events com `touch-action: none`, clamp em `[0,1]`, cor por índice do assinante e movimento por setas do teclado
- [X] T073 [US1] Implementar `frontend/src/pages/assinaturas/components/SignerList.tsx` usando `react-hook-form` + resolver Zod, com nome obrigatório, e-mail opcional, botão "sou eu" que preenche com os dados da conta autenticada, e o padrão `.field-group.field-invalid` + `.field-error` + `aria-invalid` ao tentar salvar vazio
- [X] T074 [US1] Implementar `frontend/src/pages/assinaturas/components/DocumentSetupView.tsx` unindo `SignerList` e `PdfPageCanvas`, com navegação de páginas, indicador de salvamento no padrão de `frontend/src/components/reports/DraftSaveStatus.tsx` e aviso inline para assinante sem campo
- [X] T075 [US1] Implementar `frontend/src/pages/assinaturas/components/PublishDialog.tsx` usando `react-hook-form` + resolver Zod, com resumo dos assinantes, `select` de validade (7/15/30/60 dias + data específica) usando os estados de campo do kit, e exibição da lista de pendências devolvida pelo 400 da publicação
- [X] T076 [US1] Implementar `DocumentDetailView.tsx` + `SignerStatusList.tsx` no padrão visual do app, com assinantes, fuso `America/Sao_Paulo`, copiar link e badge `FINALIZANDO` com atualização automática
- [X] T077 [US1] Adicionar downloads em `DocumentDetailView.tsx`: final só em `CONCLUIDO`, nunca durante `FINALIZANDO`, e exibir erro de integridade sem tentar servir bytes divergentes
- [X] T078 [US1] Implementar `AssinaturasPublicSignPage.tsx` reutilizando `SignatureDialog`/`PrivacyNotice`, capturando `#convite=`, removendo-o imediatamente com `history.replaceState`, mantendo token só em memória e destacando o campo próprio
- [X] T079 [US1] Tratar estados público em pt-BR, incluindo assinatura aceita com documento `FINALIZANDO`: polling sem reenviar, download só quando `CONCLUIDO`, além de inválido/expirado/revogado/cancelado/já assinado/rede
- [X] T080 [US1] Registrar `<Route path="/assinaturas/assinar" element={<AssinaturasPublicSignPage />} />` em `frontend/src/App.tsx`, sem parâmetro secreto
- [X] T081 [US1] Adicionar a variante `signatureAvulsa` e a constante `SIGNATURE_AVULSA_NOTICE_VERSION` em `frontend/src/constants/privacy.ts`, alinhada com T057
- [X] T082 [US1] Persistir a navegação interna em query params em `frontend/src/pages/assinaturas/AssinaturasPage.tsx` (`?doc=<id>`, `?page=<n>`, `?tab=`), limpando parâmetros incompatíveis ao trocar de seção, e verificar que F5 mantém a mesma tela

**Checkpoint**: US1 completa. O módulo entrega valor real sem depender de e-mail.

---

## Phase 4: User Story 2 — Convite por e-mail (Priority: P2)

**Objetivo**: quem tem e-mail recebe o convite automaticamente; quem não tem continua pelo link copiado.

**Teste independente**: publicar um documento com um assinante **com** e-mail e um **sem**; conferir que só o
primeiro recebe; derrubar o SMTP e conferir que a publicação continua funcionando, o convite fica `FALHOU` e o
link segue copiável e válido.

### Testes da US2

- [X] T083 [P] [US2] Criar `backend/test/assinaturas-notifications.test.js` com: envio **apenas** para assinante com e-mail (zero chamadas ao mailer para os demais, que ficam `NAO_APLICAVEL`); falha de SMTP marca `FALHOU` **sem invalidar o token**; publicação não é bloqueada por SMTP ausente
- [X] T084 [P] [US2] Acrescentar em `backend/test/assinaturas-notifications.test.js`: claim concorrente envia uma vez; falha confirmada recebe retry; claim antigo de resultado desconhecido vira `REVISAO_NECESSARIA` sem reenvio; outbox após crash da finalização não perde/duplica o aviso; erros não contêm link/token

### Implementação da US2

- [X] T085 [P] [US2] Adicionar `buildStandaloneSignatureRequestEmailTemplate({ documentTitle, requesterNameSnapshot, signerName, signUrl, expiresLabel })` em `backend/src/lib/email-templates.js`, seguindo o formato de `buildReportSignatureRequestEmailTemplate`
- [X] T086 [P] [US2] Adicionar `buildStandaloneSignatureCompletedEmailTemplate({ documentTitle, signerNames, finalDocumentHash, appUrl })` em `backend/src/lib/email-templates.js`
- [X] T087 [US2] Criar `backend/src/lib/assinaturas/notifications.js` com `sendInviteEmail(signer, document)` usando `sendClientMail` de `backend/src/lib/mailer.js`, gravando `emailStatus`/`emailSentAt`/`emailAttempts` e auditando `EMAIL_SOLICITADO`, `EMAIL_ENVIADO` ou `EMAIL_FALHOU`
- [X] T088 [US2] Implementar `queueInviteEmails(document)` em `backend/src/lib/assinaturas/notifications.js`, chamado **após o commit** da publicação, nunca dentro da transação
- [X] T089 [US2] Implementar `sendCompletedEmailAttempt` em `backend/src/lib/assinaturas/notifications.js` sobre a outbox: claim condicional, providerMessageId, falha conhecida/backoff e resultado incerto para revisão; usar `emailTo` snapshot, não a relação com `User`
- [X] T090 [US2] Estender `backend/src/lib/assinaturas/jobs.js` com `assinaturas:invite-emails` e `assinaturas:completion-emails` (5 min); ambos distinguem falha conhecida de claim antigo ambíguo e nunca fazem retry cego
- [X] T091 [US2] Integrar os dois jobs de e-mail ao `startAssinaturasJobs()` já iniciado em `backend/src/server.js` e confirmar `architecture:check` verde (jobs só em `lib`, nunca em `routes`)
- [X] T092 [US2] Ligar `queueInviteEmails` após o commit de publicação e tentar a outbox de conclusão após o commit conclusivo; jobs permanecem a recuperação durável em `backend/src/lib/assinaturas/service.js` e `backend/src/lib/assinaturas/jobs.js`
- [X] T093 [US2] Exibir o estado de entrega por assinante em `frontend/src/pages/assinaturas/components/SignerStatusList.tsx` ("E-mail enviado", "Falha no envio — copie o link", "Sem e-mail — copie o link"), sem nunca mostrar o token

**Checkpoint**: US1 + US2 funcionando de forma independente.

---

## Phase 5: User Story 3 — Gestão dos convites e auditoria visível (Priority: P3)

**Objetivo**: renovar, revogar e reenviar convites; expirar automaticamente; ver a trilha completa.

**Teste independente**: com um documento publicado, renovar um convite e conferir que o link antigo passa a dar
404 e o novo funciona; revogar o outro e conferir que ele para de funcionar na hora; abrir a aba de auditoria e
ver a sequência completa de eventos.

### Testes da US3

- [X] T094 [P] [US3] Acrescentar em `backend/test/assinaturas-public-sign.test.js`: token revogado → 404; **renovação invalida o token anterior** (o antigo resolve 404, o novo funciona); renovação concorrente com tentativa de assinatura → exatamente um vence, sem estado inconsistente
- [X] T095 [P] [US3] Criar `backend/test/assinaturas-lifecycle.test.js` com ordem de auditoria, imutabilidade dos campos semânticos, exceção exclusiva de anonimização de IP/UA seguida por `DADOS_ACESSO_ANONIMIZADOS` e ausência de token
- [X] T096 [P] [US3] Acrescentar em `backend/test/assinaturas-lifecycle.test.js` o job de expiração: convite vencido vira `EXPIRADO` com auditoria `CONVITE_EXPIRADO`, e convite já `ASSINADO` **não** é afetado

### Implementação da US3

- [X] T097 [US3] Implementar `renewInvite(tx, document, signerId, expiresAt)` em `backend/src/lib/assinaturas/invites.js`: recusa convite `ASSINADO`/`REVOGADO`, troca `tokenHash` + cifra + expiração em **uma única** `update` atômica, incrementa `renewalCount` e audita `CONVITE_RENOVADO`
- [X] T098 [US3] Implementar `revokeInvite` e `revokeAllPending(reason)` em `backend/src/lib/assinaturas/invites.js`, zerando token/cifra e gravando `invalidationReason` (`MANUAL`, `DOCUMENTO_CANCELADO` ou `DOCUMENTO_EXCLUIDO`), sem tocar em `ASSINADO`
- [X] T099 [US3] Implementar `expireOverdueInvites(client)` em `backend/src/lib/assinaturas/invites.js` para o job diário, marcando `EXPIRADO` e auditando
- [X] T100 [US3] Adicionar o job `assinaturas:maintenance` (24 h) em `backend/src/lib/assinaturas/jobs.js` sob `acquireJobLock`, chamando `expireOverdueInvites` e registrando em `JobRun`
- [X] T101 [US3] Implementar `listAudit(document, cursor)` em `backend/src/lib/assinaturas/service.js` com paginação por cursor e ordenação `createdAt desc`
- [X] T102 [US3] Registrar em `backend/src/routes/resources/assinaturas.js` as rotas `POST /documentos/:id/assinantes/:signerId/renovar`, `POST /documentos/:id/assinantes/:signerId/revogar`, `POST /documentos/:id/assinantes/:signerId/reenviar-email` e `GET /documentos/:id/auditoria` — com **schema Zod** no payload de renovação, todas com owner check e resolvendo o `signerId` **a partir do documento já autorizado**
- [X] T103 [US3] Adicionar as ações Renovar, Revogar e Reenviar e-mail em `frontend/src/pages/assinaturas/components/SignerStatusList.tsx`, com `ConfirmDialog` de `frontend/src/components/ui/` na revogação e toast de resultado
- [X] T104 [US3] Implementar `frontend/src/pages/assinaturas/components/AuditTrail.tsx` com rótulos pt-BR por evento, data/hora em `America/Sao_Paulo`, paginação e apresentação em cards no mobile (sem tabela larga)
- [X] T105 [US3] Exibir badge de expiração por convite e o aviso agregado "links expirados" no card da listagem em `frontend/src/pages/assinaturas/components/DocumentCard.tsx`

**Checkpoint**: US1 + US2 + US3 funcionando de forma independente.

---

## Phase 6: User Story 4 — Organização do acervo (Priority: P4)

**Objetivo**: arquivar/restaurar, cancelar rodada e excluir com invalidação imediata dos links e retenção.

**Teste independente**: arquivar um documento concluído e conferir que ele sai da listagem principal, continua
`CONCLUIDO` e com PDF final baixável; excluir um documento aguardando assinaturas e conferir que os links
morrem na hora e a trilha permanece.

### Testes da US4

- [X] T106 [P] [US4] Acrescentar em `backend/test/assinaturas-lifecycle.test.js`: arquivar **não** altera status nem invalida links; restaurar volta à listagem; cancelar revoga pendentes e **preserva** assinados
- [X] T107 [P] [US4] Acrescentar em `backend/test/assinaturas-lifecycle.test.js`: excluir recusa `FINALIZANDO` e invalida links com motivo; restauração reemite somente não assinados invalidados por exclusão, mantendo link antigo/revogação manual/assinatura; retenção purga bytes e preserva trilha

### Implementação da US4

- [X] T108 [US4] Implementar `archive` e `restore` em `backend/src/lib/assinaturas/service.js` mexendo apenas em `archivedAt`, com auditoria `DOCUMENTO_ARQUIVADO`/`DOCUMENTO_RESTAURADO`
- [X] T109 [US4] Implementar `cancelDocument(tx, document, reason)` em `backend/src/lib/assinaturas/service.js`: exige `AGUARDANDO_ASSINATURAS`, chama `revokeAllPending`, grava `CANCELADO`/`canceledAt`/`cancelReason` e audita `DOCUMENTO_CANCELADO`
- [X] T110 [US4] Implementar `softDelete` e `restoreDeleted` em `backend/src/lib/assinaturas/service.js`: bloquear `FINALIZANDO`; excluir com motivo `DOCUMENTO_EXCLUIDO`; restaurar na retenção gera tokens novos apenas para não assinados com esse motivo, reinicia e-mail e devolve `{ document, reissuedInvites }`
- [X] T111 [US4] Estender o job `assinaturas:maintenance` em `backend/src/lib/assinaturas/jobs.js` para purgar arquivos e previews de documentos excluídos além de `env.assinaturasDeletedRetentionDays`, preenchendo `filesPurgedAt` e auditando `ARQUIVOS_PURGADOS`, **sem apagar** a linha nem a trilha
- [X] T112 [US4] Registrar em `backend/src/routes/resources/assinaturas.js` as rotas `POST /documentos/:id/cancelar`, `POST /documentos/:id/arquivar`, `POST /documentos/:id/restaurar`, `DELETE /documentos/:id` e `POST /documentos/:id/restaurar-excluido`, com **schema Zod** no payload de cancelamento
- [X] T113 [US4] Adicionar a aba Arquivados e o filtro por status em `frontend/src/pages/assinaturas/AssinaturasPage.tsx`, refletidos em `?tab=` e `?status=`, com o `select` nos estados do kit
- [X] T114 [US4] Adicionar ações de ciclo de vida em `DocumentDetailView.tsx` com `ConfirmDialog`, confirmação reforçada de concluído, aviso de invalidação/reemissão e controles desabilitados com explicação durante `FINALIZANDO`
- [X] T115 [US4] Estender `backend/src/lib/data-retention.js` para anonimizar **somente** IP/UA qualificados, preservar campos semânticos e acrescentar `DADOS_ACESSO_ANONIMIZADOS`

**Checkpoint**: US1–US4 funcionando de forma independente.

---

## Phase 7: User Story 5 — Validação pública do documento assinado (Priority: P5)

**Objetivo**: código de validação + QR no PDF final e página pública que confirma a autenticidade.

**Teste independente**: concluir um documento, escanear o QR do PDF final (ou abrir `/validar-documento/<code>`)
e ver o documento como válido, com os assinantes e as datas; um código inexistente mostra "código inválido".

### Testes da US5

- [X] T116 [P] [US5] Acrescentar em `backend/test/assinaturas-final-pdf.test.js`: código único; somente concluído resolve; código inexistente → 404; validação continua para órfão com `requesterNameSnapshot`; PDF final adulterado nunca é servido

### Implementação da US5

- [X] T117 [US5] Gerar `validationCode` (`randomBytes(18).toString('base64url')`) em `publishDocument` (`backend/src/lib/assinaturas/service.js`), no padrão de `createSignatureValidationCode` de `backend/src/lib/internal-report-signatures.js`
- [X] T118 [US5] Desenhar o QR clicável e o código na página de evidências em `backend/src/lib/assinaturas/final-pdf.js` reutilizando `createValidationQrCodeMatrix` de `backend/src/lib/qr-code.js` e uma link-annotation apontando para `${env.appUrl}/validar-documento/<code>`
- [X] T119 [US5] Implementar `validateByCode(client, code)` devolvendo título, status, hashes, conclusão, `requesterNameSnapshot` e assinantes/data — sem e-mail/IP — independentemente de `ownerUserId`
- [X] T120 [US5] Registrar a rota pública `GET /validar/:code` em `backend/src/routes/resources/assinaturas.js`, dentro do bloco público e com o mesmo rate limiter
- [X] T121 [US5] Parametrizar `frontend/src/pages/SignatureValidationPage.tsx` para resolver código de RDO **e** de documento avulso, sem alterar o endpoint atual do RDO, e registrar `/validar-documento/:code` em `frontend/src/App.tsx`

**Checkpoint**: US1–US5 funcionando de forma independente.

---

## Phase 8: User Story 6 — Exclusão de conta (Priority: P6)

**Objetivo**: excluir uma conta torna imediatamente inacessíveis os arquivos dos documentos não concluídos,
preserva concluídos como órfãos e recupera falhas entre banco/filesystem. Implementa D16.

**Teste independente**: com um usuário que tem 2 documentos em rascunho/aguardando e 1 concluído, iniciar a
exclusão da conta como ADMIN; a confirmação avisa "2 serão excluídos, 1 concluído será preservado"; após
confirmar, os 2 somem do banco e seus bytes saem dos caminhos servidos, o concluído permanece com
`ownerUserId = NULL`; ninguém o abre autenticado, mas validação e convite assinado válido continuam públicos.

**⚠️ Única fase que altera comportamento de módulo existente.** O PR precisa citar a decisão D16.

### Testes da US6

- [X] T122 [P] [US6] Acrescentar em `backend/test/assinaturas-lifecycle.test.js`: impacto separa delete/preserve/finalizing; `FINALIZANDO` bloqueia sem tocar arquivos; concluídos ficam órfãos com nome histórico/evento; acesso autenticado nega e validação + convite assinado válido continuam
- [X] T123 [P] [US6] Criar `backend/test/assinaturas-account-deletion-files.test.js` com staging parcial que restaura, falha transacional que restaura, manifesto `PREPARANDO` abandonado, falha física pós-commit retomada pelo job, idempotência e garantia de nunca mover arquivos preservados
- [X] T124 [P] [US6] Criar em `backend/test/` (ou estender o teste de contas existente) o caso de regressão: excluir uma conta **sem** documentos de assinatura continua funcionando exatamente como antes

### Implementação da US6

- [X] T125 [US6] Implementar `userDeletionImpact(client, userId)` em `backend/src/lib/assinaturas/service.js` devolvendo `{ toDelete, toPreserve, finalizing }` e recusando execução se `finalizing > 0`
- [X] T126 [US6] Criar `backend/src/lib/assinaturas/file-quarantine.js`: operação durável `PREPARANDO`, paths relativos validados, move/rollback por manifesto, reconciliação de crash e purga idempotente com claim/backoff
- [X] T127 [US6] Adicionar `GET /:id/impacto` em `backend/src/routes/resources/users.js` sob `requireHubAdmin`, devolvendo `{ assinaturas: { toDelete, toPreserve, finalizing } }`
- [X] T128 [US6] Alterar `DELETE /:id` em `backend/src/routes/resources/users.js`: advisory lock; staging; transação que apaga só rascunho/aguardando/cancelado, audita concluídos, promove manifesto e deleta usuário; rollback restaura; pós-commit tenta purga; integrar job `assinaturas:file-purge` em `backend/src/lib/assinaturas/jobs.js`
- [X] T129 [US6] Exibir impacto em `frontend/src/pages/admin/AdminAccountsPage.tsx`, bloquear confirmação com `FINALIZANDO` e explicar quarentena/preservação usando `ConfirmDialog`

**Checkpoint**: todas as histórias funcionando de forma independente.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T130 Novidade temporária de 10 dias: **N/A** — a constitution exige campanha temporária apenas para função nova dentro de módulo existente. Registrar essa justificativa no PR
- [X] T131 Tutorial permanente de primeiro acesso: implementar `frontend/src/pages/assinaturas/AssinaturasTutorial.tsx` com `driver.js` no padrão de `frontend/src/components/HubTutorial.tsx`, cobrindo enviar PDF → adicionar assinantes → posicionar campos → publicar → copiar links → acompanhar, com marcador de "visto" em `localStorage` por usuário/navegador
- [X] T132 Contrato visual: auditar cada controle novo de formulário em `frontend/src/pages/assinaturas/` e confirmar uso de `field-group` (ou equivalente documentado), sem rótulo apenas por placeholder e sem `select` com aparência crua do navegador
- [ ] T133 Validação visual de obrigatórios: submeter cada formulário novo com campos vazios e confirmar `.field-group.field-invalid`, `aria-invalid` e `.field-error` abaixo do controle, em NewDocumentModal, SignerList e PublishDialog
- [X] T134 Drag and drop: reordenação de lista é **N/A** nesta feature (a ordem dos assinantes é a de criação). Verificar que o **posicionamento de campo** em `PdfPageCanvas.tsx` usa Pointer Events com `touch-action: none`, funciona no toque e cancela sem persistir; registrar o N/A da reordenação no PR
- [X] T135 Continuidade de navegação: verificar que `?doc=`, `?page=`, `?tab=` e `?status=` sobrevivem ao F5 e ao deep-link, e que trocar de seção limpa os parâmetros incompatíveis
- [ ] T136 Auditoria de overflow no mobile: verificar em telas estreitas a grade de cards, a lista de assinantes, as abas, os badges de status e o editor de posicionamento — sem scroll horizontal de página, com `min-width: 0` nos filhos de grid/flex e truncamento dos nomes longos de arquivo
- [ ] T137 Passe de consistência visual: verificar todas as superfícies da tabela de evidência visual do `plan.md` em desktop e mobile, com os estados default/foco/disabled/erro/vazio dos selects e o shell largo no desktop
- [X] T138 Identidade portada: **N/A** — módulo novo sem app de origem, obrigado ao kit e aos tokens. Registrar no PR
- [X] T139 [P] Auditoria de segredos: usar `rg` e testes para garantir que token não entra em path/query/header logado, `console.*`, erro 5xx, auditoria, cache, storage ou telemetria; somente identificador hash truncado seguro pode ser observado
- [X] T140 [P] Observabilidade: logs estruturados sem segredos/paths absolutos para upload, preview, finalização/retry, e-mail, token agregado e quarentena/purga, incluindo duração e tentativas em `backend/src/lib/assinaturas/`
- [X] T141 [P] Documentar o módulo em `README.md` e acrescentar a nota do módulo em `docs/PADRAO_MODULO.md`
- [X] T142 [P] Acrescentar a operação ao `LGPD_ROPA.md`: nome e e-mail de assinantes externos, IP/User-Agent como evidência de assinatura, retenção de 90 dias e a base legal de guarda para assinatura concluída
- [ ] T143 Rodar a validação completa de `specs/013-assinaturas-avulsas/quickstart.md`, incluindo finalização recuperável, rota pública sem segredo, rotações e exclusão de conta com falhas de filesystem
- [X] T144 Rodar o CI completo: `npm run architecture:check`, `cd backend && npm test`, `cd frontend && npm run lint && npm test && npm run build`
- [X] T145 Auditoria de data/hora: verificar a exibição em **todas** as superfícies do módulo — listagem, detalhes, status por assinante, expiração de convite, trilha de auditoria e página pública — garantindo o fuso **`America/Sao_Paulo`** (FR-039), alinhado ao que o backend já faz em `backend/src/lib/internal-report-signatures.js`. Extrair um formatador compartilhado (`frontend/src/pages/assinaturas/utils/datetime.ts`) em vez de repetir `toLocaleString` por componente; registrar no PR a divergência com o padrão atual do frontend, que usa o fuso do navegador
- [X] T146 Medir e registrar no PR: prévia inicial ≤2 s e cache P95 ≤250 ms (SC-012); final ≤5 s para 30 páginas/10 assinantes (SC-013). Se não atingir, otimizar ou propor ajuste explícito da spec

## Phase 10: Correções da homologação do fluxo essencial

- [X] T147 Separar visualmente as ações do diálogo de upload do campo de anexo em `frontend/src/pages/assinaturas/components/NewDocumentModal.tsx` e `frontend/src/styles/base.css`
- [X] T148 Abrir documentos novos e rascunhos diretamente na configuração, ocultando a aba Acompanhamento enquanto o documento estiver em `RASCUNHO`
- [X] T149 Corrigir a remoção por X no campo sobre o PDF e ajustar o campo inicial para um retângulo compacto em `frontend/src/pages/assinaturas/components/PdfPageCanvas.tsx`
- [X] T150 Persistir campos locais antes de publicar para que a validação do backend use o posicionamento que o usuário acabou de adicionar
- [X] T151 Trocar a grade horizontal de documentos por uma listagem vertical responsiva e cobrir as regressões em `frontend/test/assinaturas-ui-contract.test.mjs`
- [X] T152 Refinar o campo de assinatura: uma cor suave sem moldura, nome centralizado, X transparente externo e redimensionador com riscos diagonais sutis
- [X] T153 Compactar e melhorar visualmente as linhas de assinantes na aba de acompanhamento
- [X] T154 Corrigir a desserialização do retorno `void` dos advisory locks usados pelo módulo
- [X] T155 Separar o formulário dos assinantes adicionados e compartilhar a paleta visual com os campos no PDF
- [X] T156 Manter as ações do ciclo de vida em uma linha compacta e esclarecer o alcance do cancelamento
- [X] T157 Substituir a seleção prévia do card por um seletor contextual de assinante no PDF, com inclusão direta para assinante único
- [X] T158 Separar visualmente conteúdo, campos e ações do diálogo de publicação
- [X] T159 Renderizar a assinatura posicionada no PDF sem fundo, moldura ou rótulo sobreposto
- [X] T160 Alinhar a página final de evidências ao padrão dos relatórios e incorporar o logo colorido da empresa

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
- **Phase 8 (US6)**: depende da Phase 2, de `purgePreviews` (T045) e do manifesto `SignatureDocumentFilePurge`
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
| US6 | models de purge (T016/T020), `purgePreviews` (T045) | Sim |

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
| E8 finalização e PDF final | T056, T058–T061 + US5 (T116–T121) |
| E9 e-mail e jobs | US2 (T083–T093) |
| E10 frontend completo | T067–T082, T103–T105, T113–T114 |
| E11 ciclo de vida e retenção | US4 (T106–T115) + T131 |
| E12 exclusão de conta | US6 (T122–T129) |

---

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente
- Commit após cada tarefa ou grupo lógico coerente
- Toda tarefa que toca rota de documento precisa passar por `documentForOwnerOrThrow` — sem exceção
- Nenhum token completo pode aparecer em path, query, log, auditoria, cache, storage, telemetria ou mensagem de erro
- `backend/src/routes/resources/reports.js` **não** deve ser alterado em nenhuma tarefa (budget travado no `architecture:check`)
- `backend/src/lib/internal-report-signatures.js` **não** deve ser alterado em nenhuma tarefa (ver decisão D8)
- As únicas alterações fora do módulo são as integrações inventariadas no plano (`app.js`, auditoria, e-mail,
  retenção, registry e contas); `backend/src/routes/resources/users.js` é a única mudança de comportamento de
  módulo existente e está justificada em D16
