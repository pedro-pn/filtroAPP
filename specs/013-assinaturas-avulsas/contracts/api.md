# Contrato de API — Assinaturas Avulsas

Base: `/api/assinaturas`. Erros seguem o handler central de `backend/src/app.js`
(`{ error: string, details?: ... }`); `ZodError` → 400 com `details`.

Ordem de registro no router (crítica, molde de `epis.js`):

```js
// 1) rotas públicas — SEM requireAuth, todas com publicSignatureLimiter
router.get('/publico', publicLimiter, ...)
router.get('/publico/pdf', publicLimiter, ...)
router.get('/publico/paginas/:n.png', publicLimiter, ...)
router.post('/publico/assinar', publicLimiter, assinaturaBodyParser, ...)
router.get('/validar/:code', publicLimiter, ...)

// 2) a partir daqui, tudo autenticado e com permissão de módulo
router.use(requireAuth, requireAssinaturasAccess)
```

Rate limit público: `createMemoryRateLimit({ windowMs: 15*60*1000, max: 60 })` (mesmo perfil de
`publicSignatureLimiter` em `reports.js`/`epis.js`).

---

# Parte 1 — Endpoints públicos (assinante externo)

Nenhum exige sessão. Todos autorizam **exclusivamente** pelo token do convite e respondem
`Cache-Control: no-store` e `Referrer-Policy: no-referrer`. O token chega exclusivamente no header
`X-Signature-Token`; ausência ou formato inválido é indistinguível de token desconhecido. Links enviados ao
assinante usam `/assinaturas/assinar#convite=<token>`: o frontend captura e remove o fragmento imediatamente,
mantém o valor só em memória e nunca o coloca em path, query, storage, chave de cache ou telemetria.

## `GET /api/assinaturas/publico`

**Finalidade**: carregar o convite. **Autenticação**: nenhuma. **Autorização**:
`X-Signature-Token: <token>` válido.

**Validações**: `tokenHash` resolve → documento não `CANCELADO`, `deletedAt: null` → convite não `REVOGADO` →
`tokenExpiresAt > agora` (senão marca `EXPIRADO`, audita e responde 410).

**Efeitos**: na primeira abertura marca `VISUALIZADO` + `viewedAt` e audita `LINK_ACESSADO` +
`DOCUMENTO_VISUALIZADO` (com IP/UA de `signatureEvidenceFromRequest`).

**200**
```json
{
  "status": "ATIVO",
  "expiresAt": "2026-09-20T02:59:00.000Z",
  "document": {
    "title": "Contrato de prestação",
    "originalFileName": "contrato.pdf",
    "pageCount": 4,
    "status": "AGUARDANDO_ASSINATURAS",
    "sourceDocumentHash": "9f2c…",
    "requestedBy": "Pedro Paulo",
    "progress": { "signed": 1, "total": 3 }
  },
  "signer": { "name": "Maria Silva", "status": "VISUALIZADO", "signedAt": null },
  "fields": [ { "pageNumber": 2, "x": 0.12, "y": 0.71, "width": 0.28, "height": 0.07 } ]
}
```

> **Nunca** retorna nome, e-mail ou status individual dos outros assinantes, nem o e-mail do dono.
> `requestedBy` vem de `requesterNameSnapshot`, o **nome histórico** de quem solicitou (necessário para o
> assinante saber de quem veio), e continua disponível se a conta for excluída; e-mail do dono não é exposto.

**Erros**: `404` token inválido/desconhecido/revogado · `410` expirado · `410` documento cancelado ou excluído ·
`429` rate limit.

## `GET /api/assinaturas/publico/pdf`
Devolve o PDF-base enquanto o convite está assinável. Se o documento estiver `CONCLUIDO`, devolve o **final**
somente para convite `ASSINADO` ainda válido, inclusive quando `ownerUserId = NULL` (ver P-3). Revalida
`sourceDocumentHash` no original e `finalDocumentHash` no final antes de servir → `409` se divergir.
`FINALIZANDO` responde `409` com `code: DOCUMENT_FINALIZING`, permitindo polling pelo `GET /publico`.
**200** `application/pdf` + `Content-Disposition: inline` + `no-store`.

## `GET /api/assinaturas/publico/paginas/:n.png`
Preview da página `n` (1-based, `<= pageCount`). **200** `image/png`, `no-store`. `404` fora do intervalo.

## `POST /api/assinaturas/publico/assinar`

**Entrada**
```json
{
  "signerName": "Maria Silva",
  "signatureImageDataUrl": "data:image/png;base64,…",
  "privacyNoticeAccepted": true,
  "privacyNoticeVersion": "signature_avulsa_v1"
}
```

**Validações**, nesta ordem:
1. Zod: `signerName` 2..160 (nome + sobrenome), `signatureImageDataUrl` ≤ 750.000 chars, aviso de privacidade
   na versão corrente (`validatePrivacyNoticeAcknowledgement`).
2. `decodableSignatureImageDataUrl` — magic bytes PNG/JPEG, dimensões ≤ 4096 e ≤ 4 MP, ≤ 1,5 MB, `pdf-lib`
   consegue embutir. **Antes** de qualquer escrita.
3. Pré-checagem do convite fora da transação (404/410 cedo).
4. Transação: advisory lock por `documentId` → relê o convite por `tokenHash` → revalida →
   `updateMany({ where: { id, status: { in: [PENDENTE, VISUALIZADO] } } })`. `count !== 1` ⇒ relê:
   já `ASSINADO` → **idempotente 200**; `REVOGADO`/`EXPIRADO` → 409.
5. Ainda na transação: se todos os obrigatórios assinaram, transição condicional
   `AGUARDANDO_ASSINATURAS → FINALIZANDO`, inicializa claim/retry e grava `FINALIZACAO_INICIADA`. Não há
   caminho que marque `CONCLUIDO` nessa transação.
6. **Após o commit**: tenta o processador idempotente compartilhado com `assinaturas:finalization`. Ele gera em
   arquivo temporário, verifica hash, promove atomicamente e só então faz `FINALIZANDO → CONCLUIDO` no mesmo
   commit que persiste caminho/hash/data e as auditorias finais. Falha mantém `FINALIZANDO` para retry.

**Evidências gravadas**: `ipAddress`, `userAgent`, `signedAt`, `declaredSignerName`,
`privacyNoticeAcceptedAt`, `privacyNoticeVersion`, `signatureImageDataUrl`.

**200** — a assinatura foi aceita; a finalização pode ser assíncrona:
```json
{
  "success": true,
  "documentStatus": "FINALIZANDO",
  "downloadAvailable": false,
  "signer": { "name": "Maria Silva", "status": "ASSINADO", "signedAt": "2026-08-21T18:04:11.000Z" }
}
```
Retry idempotente após a assinatura devolve o estado atual (`FINALIZANDO` ou `CONCLUIDO`) sem novo evento,
arquivo ou e-mail. O frontend faz polling do `GET /publico` quando recebe `FINALIZANDO`.

**Erros**: `400` imagem/nome/aviso inválidos · `404` token inválido · `409` convite não assinável ·
`409` hash do PDF-base divergente · `410` expirado/cancelado · `429` rate limit.

## `GET /api/assinaturas/validar/:code`
Valida um PDF final pelo `validationCode` impresso/QR. **200** com título, status, `sourceDocumentHash`,
`finalDocumentHash`, `completedAt`, `requestedBy` histórico e, por assinante, nome declarado e data/hora.
Permanece disponível para documento órfão. **404** código desconhecido ou documento ainda não concluído.

---

# Parte 2 — Endpoints autenticados (proprietário)

Todos exigem `requireAuth` + `requireModuleRole('assinaturas:user')` **e** owner check via
`documentForOwnerOrThrow(id, req.auth.user.id)`. Documento de outro usuário ⇒ **404** (nunca 403).

| # | Método + rota | Finalidade | Entrada | Saída | Serviço | Validações |
|---|---|---|---|---|---|---|
| 1 | `GET /documentos` | Listar | `?status`, `?q`, `?arquivados=1`, `?cursor`, `?limit` | `{ items: DocumentCard[], nextCursor }` | `service.listDocuments` | `where.ownerUserId` sempre; `q` casa `title`/`originalFileName` |
| 2 | `POST /documentos` | Upload | `{ fileName, pdfDataUrl, title? }` | `Document` (`RASCUNHO`) | `document.createDocument` | parser JSON de 30 MB só nesta rota; PDF bruto ≤ `MAX_PDF_MB`; data URL `application/pdf`; `%PDF`; `pdf-lib` abre; `pageCount` ≤ `MAX_PAGES`; não criptografado; compensação do arquivo se o banco falhar |
| 3 | `GET /documentos/:id` | Detalhes | — | `Document` + `signers` + `fields` + `progress` + `pageDimensions` | `service.getDocument` | owner |
| 4 | `GET /documentos/:id/pdf` | PDF original | — | `application/pdf`, `no-store` | `document.sourcePdfBuffer` | owner; hash confere (409) |
| 5 | `GET /documentos/:id/pdf-final` | PDF assinado | — | `application/pdf`, `no-store` | `document.finalPdfBuffer` | owner; `CONCLUIDO`; hash confere |
| 6 | `GET /documentos/:id/paginas/:n.png` | Preview | — | `image/png`, `private, no-store` | `preview.renderPage` | owner; `1 ≤ n ≤ pageCount` |
| 7 | `PATCH /documentos/:id` | Renomear | `{ title }` | `Document` | `service.renameDocument` | owner; `RASCUNHO`; 1..180 chars |
| 8 | `PUT /documentos/:id/assinantes` | Substituir assinantes | `[{ id?, name, email?, position }]` | `Document` | `service.replaceSigners` | owner; `RASCUNHO`; `name` ≥ 2; e-mail válido se presente; sem e-mail duplicado; ≤ `MAX_SIGNERS`; `position` sequencial |
| 9 | `PUT /documentos/:id/campos` | Substituir campos | `[{ signerId, pageNumber, x, y, width, height }]` | `Document` | `service.replaceFields` | owner; `RASCUNHO`; `signerId` do documento; `1 ≤ pageNumber ≤ pageCount`; caixa dentro de `[0,1]`; ≥ 2%; servidor relê dimensões/rotação e rejeita propriedades físicas extras |
| 10 | `POST /documentos/:id/publicar` | Publicar | `{ expiresInDays }` **ou** `{ expiresAt }` | `{ document, invites: [{ signerId, name, hasEmail, expiresAt }], emailSummary }` | `service.publishDocument` | as 9 validações da seção H.3 do plano |
| 11 | `POST /documentos/:id/despublicar` | Voltar a rascunho | — | `Document` | `service.unpublishDocument` | owner; `AGUARDANDO`; **zero** assinaturas (senão 409); invalida todos os tokens |
| 12 | `GET /documentos/:id/assinantes/:signerId/link` | Recuperar o link | — | `{ url, expiresAt }` | `invites.recoverInviteLink` | owner; convite ativo com token; decifra; **audita `LINK_RECUPERADO`** |
| 13 | `POST /documentos/:id/assinantes/:signerId/renovar` | Novo token | `{ expiresInDays }` \| `{ expiresAt }` | `{ url, expiresAt }` | `invites.renewInvite` | owner; convite ≠ `ASSINADO`/`REVOGADO`; troca `tokenHash` atomicamente; `renewalCount++`; audita |
| 14 | `POST /documentos/:id/assinantes/:signerId/revogar` | Revogar | — | `Document` | `invites.revokeInvite` | owner; convite ≠ `ASSINADO`; `tokenHash = NULL` |
| 15 | `POST /documentos/:id/assinantes/:signerId/reenviar-email` | Reenviar convite | — | `{ emailStatus }` | `notifications.sendInviteEmail` | owner; convite ativo **com e-mail**; sem e-mail ⇒ 400 |
| 16 | `GET /documentos/:id/auditoria` | Trilha | `?cursor`, `?limit` | `{ items: AuditEvent[], nextCursor }` | `service.listAudit` | owner |
| 17 | `POST /documentos/:id/cancelar` | Cancelar rodada | `{ reason? }` | `Document` | `service.cancelDocument` | owner; `AGUARDANDO`; revoga pendentes; **preserva assinados** |
| 18 | `POST /documentos/:id/arquivar` | Arquivar | — | `Document` | `service.archive` | owner; não altera status nem links |
| 19 | `POST /documentos/:id/restaurar` | Desarquivar | — | `Document` | `service.restore` | owner |
| 20 | `DELETE /documentos/:id` | Excluir (lógico) | — | `204` | `service.softDelete` | owner; recusa `FINALIZANDO`; invalida links ativos com motivo `DOCUMENTO_EXCLUIDO`; audita |
| 21 | `POST /documentos/:id/restaurar-excluido` | Desfazer exclusão | — | `{ document, reissuedInvites: [{ signerId, expiresAt, hasEmail }] }` | `service.restoreDeleted` | owner; dentro da retenção; token novo só para não assinados invalidados pela exclusão; antigos/manuais nunca voltam |

## Formato `DocumentCard` (listagem)

```json
{
  "id": "clx…",
  "title": "Contrato de prestação",
  "originalFileName": "contrato.pdf",
  "status": "AGUARDANDO_ASSINATURAS",
  "pageCount": 4,
  "signerCount": 3,
  "signedCount": 1,
  "progressLabel": "1 de 3 assinaturas",
  "hasExpiredInvites": false,
  "isArchived": false,
  "createdAt": "2026-08-21T14:02:00.000Z",
  "completedAt": null
}
```

## Formato `Signer` (detalhes — visão do dono)

```json
{
  "id": "clx…",
  "name": "Maria Silva",
  "email": "maria@exemplo.com",
  "position": 1,
  "status": "PENDENTE",
  "signedAt": null,
  "viewedAt": "2026-08-21T15:10:00.000Z",
  "tokenExpiresAt": "2026-09-20T02:59:00.000Z",
  "canCopyLink": true,
  "canRenew": true,
  "canRevoke": true,
  "emailStatus": "ENVIADO",
  "emailSentAt": "2026-08-21T14:05:00.000Z",
  "emailLastError": null
}
```

> O token **nunca** aparece neste payload. O link só é entregue pelo endpoint #12, que audita a recuperação.

---

# Parte 3 — Integração com contas do hub (D16)

Fora do router do módulo, em `backend/src/routes/resources/users.js`.

## `GET /api/admin/accounts/:id/impacto`
**Autorização**: `requireHubAdmin`. **Finalidade**: alimentar a confirmação de exclusão de conta.

**200**
```json
{ "assinaturas": { "toDelete": 7, "toPreserve": 3, "finalizing": 0 } }
```
`toDelete` = documentos `RASCUNHO`, `AGUARDANDO_ASSINATURAS` ou `CANCELADO`.
`toPreserve` = documentos `CONCLUIDO`, que sobrevivem como órfãos.
`finalizing` = documentos em finalização; se maior que zero, a UI explica o bloqueio e não confirma.

## `DELETE /api/admin/accounts/:id` *(rota existente, estendida)*

**Comportamento novo**, sob advisory lock pelo `userId`:
1. Reconta o impacto; qualquer `FINALIZANDO` retorna `409 ACCOUNT_SIGNATURES_FINALIZING` antes de tocar bytes.
2. Cria `SignatureDocumentFilePurge` em `PREPARANDO`, monta o manifesto e move atomicamente original/final/
   previews dos documentos a apagar para `Assinaturas/Quarentena/<operationId>/`. Os caminhos originais ficam
   imediatamente inacessíveis.
3. Em transação: apaga documentos `RASCUNHO`/`AGUARDANDO_ASSINATURAS`/`CANCELADO`; audita
   `PROPRIETARIO_REMOVIDO` nos `CONCLUIDO`; promove o manifesto a `PENDENTE`; executa `user.delete()`, cujo
   `SetNull` torna os concluídos órfãos.
4. Após commit, tenta a purga idempotente. Falha marca `FALHOU` e o job `assinaturas:file-purge` retoma.

Falha de staging ou da transação restaura os moves pelo manifesto, marca a operação `CANCELADO` e mantém a
conta. Uma operação `PREPARANDO` abandonada é reconciliada pelo job. Conta sem documentos mantém o
comportamento atual, sem manifesto desnecessário.

---

## Códigos de erro padronizados

| Código | Quando |
|---|---|
| `400` | Payload inválido (Zod), PDF inválido, validações de publicação, reenvio para assinante sem e-mail |
| `401` | Sessão ausente/expirada |
| `403` | Sem `assinaturas:user` |
| `404` | Documento/assinante inexistente, **de outro usuário** ou **órfão** (`ownerUserId = NULL`); token público inválido/revogado |
| `409` | Transição de estado inválida; hash divergente; convite não assinável; PDF `FINALIZANDO`; exclusão de conta bloqueada por finalização |
| `410` | Convite expirado; documento cancelado/excluído (rotas públicas) |
| `413` | Corpo acima do limite de `express.json` |
| `429` | Rate limit das rotas públicas |
| `503` | SMTP indisponível em operação que exige envio síncrono (apenas no reenvio manual) |
