# Phase 1 — Modelo de dados: Assinaturas Avulsas

Legenda: **[NOVO]** criado por esta feature · **[EXISTE]** já no schema, sem alteração estrutural ·
**[ESTENDIDO]** valor adicionado a um enum existente.

---

## 1. Enums

### [ESTENDIDO] `AppModule`
```prisma
enum AppModule {
  RDO
  ROMANEIO
  EPI
  PRIVACY
  EQUIPAMENTOS
  ESTOQUE
  ACOMPANHAMENTO
  QUALIDADE
  ASSINATURAS   // novo
}
```

### [ESTENDIDO] `ModuleRoleCode`
```prisma
// ... valores existentes ...
  ASSINATURAS_USER   // novo — permissão única do módulo
```

### [NOVO] `SignatureDocumentStatus`
```prisma
enum SignatureDocumentStatus {
  RASCUNHO
  AGUARDANDO_ASSINATURAS
  FINALIZANDO
  CONCLUIDO
  CANCELADO
}
```
`EXPIRADO` **não** é status: deriva de "todos os convites pendentes venceram" e é badge na UI.
`ARQUIVADO` **não** é status: é o atributo ortogonal `archivedAt`.

### [NOVO] `SignatureDocumentSignerStatus`
```prisma
enum SignatureDocumentSignerStatus {
  PENDENTE
  VISUALIZADO
  ASSINADO
  EXPIRADO
  REVOGADO
}
```

### [NOVO] `SignatureDocumentEmailStatus`
```prisma
enum SignatureDocumentEmailStatus {
  NAO_APLICAVEL   // assinante sem e-mail — nenhuma tentativa de envio ocorre
  PENDENTE
  EM_ENVIO
  ENVIADO
  FALHOU
  REVISAO_NECESSARIA // processo caiu com resultado SMTP desconhecido; não reenviar automaticamente
}
```

### [NOVO] `SignatureDocumentInviteInvalidationReason`
```prisma
enum SignatureDocumentInviteInvalidationReason {
  MANUAL
  DOCUMENTO_CANCELADO
  DOCUMENTO_EXCLUIDO
}
```
O motivo torna a restauração segura: somente `DOCUMENTO_EXCLUIDO` pode gerar um convite substituto; link
antigo e revogação manual nunca são revividos.

### [NOVO] `SignatureDocumentFilePurgeStatus`
```prisma
enum SignatureDocumentFilePurgeStatus {
  PREPARANDO
  PENDENTE
  EM_PROCESSAMENTO
  CONCLUIDO
  FALHOU
  CANCELADO
}
```
`PREPARANDO` é persistido antes do staging para que uma queda durante os moves também seja recuperável. O job
restaura e cancela uma operação antiga se a conta ainda existir; se a exclusão já tiver commitado, promove a
operação a `PENDENTE` e continua a purga.

### [NOVO] `SignatureDocumentAuditAction`
```prisma
enum SignatureDocumentAuditAction {
  DOCUMENTO_CRIADO
  CONFIGURACAO_ATUALIZADA
  DOCUMENTO_PUBLICADO
  DOCUMENTO_DESPUBLICADO
  CONVITE_CRIADO
  EMAIL_SOLICITADO
  EMAIL_ENVIADO
  EMAIL_FALHOU
  LINK_RECUPERADO
  LINK_ACESSADO
  DOCUMENTO_VISUALIZADO
  ASSINATURA_REALIZADA
  CONVITE_EXPIRADO
  CONVITE_RENOVADO
  CONVITE_REVOGADO
  FINALIZACAO_INICIADA
  FINALIZACAO_FALHOU
  PDF_FINAL_GERADO
  DOCUMENTO_CONCLUIDO
  DOCUMENTO_CANCELADO
  DOCUMENTO_ARQUIVADO
  DOCUMENTO_RESTAURADO
  DOCUMENTO_EXCLUIDO
  DOCUMENTO_EXCLUSAO_DESFEITA
  ARQUIVOS_PURGADOS
  PROPRIETARIO_REMOVIDO
  DADOS_ACESSO_ANONIMIZADOS
}
```

---

## 2. Models

### [NOVO] `SignatureDocument`

```prisma
model SignatureDocument {
  id                  String                       @id @default(cuid())
  ownerUserId         String?                      // NULL = documento concluido orfao (conta do dono foi excluida)
  requesterNameSnapshot String                     // nome historico, imutavel mesmo apos excluir a conta
  title               String
  originalFileName    String
  mimeType            String                       @default("application/pdf")
  fileSizeBytes       Int
  pageCount           Int
  pageDimensions      Json                         // [{ page, widthPt, heightPt, rotation }]
  sourceStoragePath   String?                      // relativo a env.uploadDir; null após purga
  sourceDocumentHash  String                       // sha256 hex do PDF original
  finalStoragePath    String?
  finalDocumentHash   String?
  validationCode      String?                      @unique
  status              SignatureDocumentStatus      @default(RASCUNHO)
  tokenExpiresAt      DateTime?                    // prazo escolhido na publicação (referência p/ novos convites)
  finalizationClaimedAt DateTime?
  finalizationAttempts Int                          @default(0)
  finalizationNextAttemptAt DateTime?
  finalizationLastError String?                     // erro sanitizado; sem token/path absoluto
  cancelReason        String?
  publishedAt         DateTime?
  completedAt         DateTime?
  canceledAt          DateTime?
  archivedAt          DateTime?
  deletedAt           DateTime?
  filesPurgedAt       DateTime?
  createdAt           DateTime                     @default(now())
  updatedAt           DateTime                     @updatedAt

  owner               User?                        @relation("SignatureDocumentOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)
  signers             SignatureDocumentSigner[]
  fields              SignatureDocumentField[]
  auditLogs           SignatureDocumentAuditLog[]
  completionNotification SignatureDocumentCompletionNotification?

  @@index([ownerUserId, deletedAt, archivedAt, createdAt])
  @@index([ownerUserId])
  @@index([ownerUserId, status])
  @@index([status, finalizationNextAttemptAt])
  @@index([deletedAt])
  @@index([archivedAt])
}
```

Notas:
- `ownerUserId` é **anulável** com `onDelete: SetNull`. Motivo: ao excluir uma conta, os documentos **não
  concluídos** dela são apagados por uma rotina explícita (antes do `user.delete()`) e os **concluídos** são
  preservados como órfãos (`ownerUserId = NULL`), porque carregam assinaturas de terceiros com valor
  probatório. Ver `plan.md` D16.
- `requesterNameSnapshot` é preenchido no upload e não acompanha renomes posteriores. E-mails, página de
  evidências e payload público continuam historicamente corretos quando `ownerUserId` vira `NULL`.
- **Órfão é inacessível por design**: toda consulta autenticada usa `where: { id, ownerUserId: <id do usuário> }`,
  e `NULL` nunca casa com um id real. Nenhum usuário — inclusive ADMIN — enxerga documento órfão pela aplicação.
  O acesso é operacional (SQL documentado no `plan.md`), com a trilha de auditoria íntegra.
- `documentForOwnerOrThrow` **deve lançar** se receber `ownerUserId` nulo/indefinido, para que um bug futuro não
  transforme a consulta em `ownerUserId: null` e exponha os órfãos.
- `pageDimensions` é `Json` por ser uma lista pequena e somente-leitura, capturada uma vez no upload. Conforme
  `docs/PADRAO_MODULO.md`, campo `Json` é aceitável desde que o contrato esteja validado por schema Zod e
  coberto por teste — ambos previstos.
- `sourceStoragePath`/`finalStoragePath` viram `null` na purga por retenção; a linha e a auditoria permanecem.
- `FINALIZANDO` e os quatro campos `finalization*` formam a fila durável. Somente a transição condicional
  `FINALIZANDO → CONCLUIDO`, no mesmo commit que persiste caminho/hash/data, pode concluir o documento.

### [NOVO] `SignatureDocumentSigner`

Concentra **assinante + convite + evidência**, como `ReportSignature` faz hoje (evita uma tabela de convite
1:1 sem ganho).

```prisma
model SignatureDocumentSigner {
  id                      String                        @id @default(cuid())
  documentId              String
  name                    String
  email                   String?                       // OPCIONAL — diferença central vs. ReportSignature
  position                Int
  status                  SignatureDocumentSignerStatus @default(PENDENTE)
  isRequired              Boolean                       @default(true)

  // convite
  tokenHash               String?                       @unique
  tokenEncrypted          String?
  tokenIv                 String?
  tokenAuthTag            String?
  tokenExpiresAt          DateTime?
  renewalCount            Int                           @default(0)
  invalidationReason      SignatureDocumentInviteInvalidationReason?

  // entrega de e-mail
  emailStatus             SignatureDocumentEmailStatus  @default(NAO_APLICAVEL)
  emailAttempts           Int                           @default(0)
  emailSentAt             DateTime?
  emailLastError          String?                       // truncado; NUNCA contém o link/token
  emailClaimedAt          DateTime?                     // trava de idempotência do job

  // evidência de assinatura
  declaredSignerName      String?
  signatureImageDataUrl   String?
  ipAddress               String?
  userAgent               String?
  privacyNoticeAcceptedAt DateTime?
  privacyNoticeVersion    String?
  viewedAt                DateTime?
  signedAt                DateTime?
  revokedAt               DateTime?
  expiredAt               DateTime?

  createdAt               DateTime                      @default(now())
  updatedAt               DateTime                      @updatedAt

  document                SignatureDocument             @relation(fields: [documentId], references: [id], onDelete: Cascade)
  fields                  SignatureDocumentField[]
  auditLogs               SignatureDocumentAuditLog[]

  @@unique([documentId, position])
  @@index([documentId])
  @@index([documentId, status])
  @@index([status, tokenExpiresAt])
  @@index([emailStatus, emailClaimedAt])
}
```

Notas:
- **Não há** `@@unique([documentId, email])` no banco: e-mail é opcional e o Postgres trataria múltiplos `NULL`
  como distintos, dando falsa sensação de garantia. A unicidade de e-mail entre assinantes é validada em Zod +
  serviço na publicação, com teste.
- `tokenHash @unique` é a única via de lookup do convite e a constraint que impede colisão.
- Renovar = uma única `update` que troca `tokenHash`/cifra/expiração → o token anterior deixa de resolver
  atomicamente.
- Revogar/excluir = `tokenHash = NULL` → o link existente fica irresolvível para sempre. Restaurar documento
  excluído gera bytes totalmente novos apenas para não assinados com `invalidationReason = DOCUMENTO_EXCLUIDO`.

### [NOVO] `SignatureDocumentField`

```prisma
model SignatureDocumentField {
  id            String                  @id @default(cuid())
  documentId    String
  signerId      String
  pageNumber    Int                     // 1-based
  x             Decimal                 @db.Decimal(9, 8)   // 0..1, origem no canto SUPERIOR ESQUERDO
  y             Decimal                 @db.Decimal(9, 8)
  width         Decimal                 @db.Decimal(9, 8)
  height        Decimal                 @db.Decimal(9, 8)
  pageWidthPt   Decimal                 @db.Decimal(10, 3)  // snapshot autoritativo copiado pelo servidor
  pageHeightPt  Decimal                 @db.Decimal(10, 3)
  pageRotation  Int                     @default(0)
  createdAt     DateTime                @default(now())
  updatedAt     DateTime                @updatedAt

  document      SignatureDocument       @relation(fields: [documentId], references: [id], onDelete: Cascade)
  signer        SignatureDocumentSigner @relation(fields: [signerId], references: [id], onDelete: Cascade)

  @@index([documentId, pageNumber])
  @@index([signerId])
}
```

Invariantes (validadas em Zod + serviço, não no banco):
`1 <= pageNumber <= document.pageCount` · `0 <= x,y` · `x+width <= 1` · `y+height <= 1` ·
`width,height >= 0.02` · `signer.documentId === documentId`.

O payload de escrita contém apenas `signerId`, `pageNumber`, `x`, `y`, `width`, `height`. O backend relê a
entrada correspondente de `document.pageDimensions`, persiste o snapshot acima e chama, em **um** ponto,
`normalizedFieldToPdfRect(field, pageGeometry)`. Essa transformação afim converte do viewport visual com
origem superior esquerda para o referencial PDF inferior esquerdo, incluindo `CropBox`/`MediaBox` e rotação
0°/90°/180°/270°. A fórmula direta `x*W`, `H-(y+h)*H` só é válida para rotação 0° e não pode ser usada nas
demais orientações.

Tabela separada (em vez de colunas no signer) porque: torna "assinante sem campo" um estado validável na
publicação; permite mais de um campo por assinante sem migração; e mantém a linha do assinante focada em
identidade/convite/evidência.

### [NOVO] `SignatureDocumentAuditLog`

```prisma
model SignatureDocumentAuditLog {
  id          String                       @id @default(cuid())
  documentId  String
  signerId    String?
  actorUserId String?
  action      SignatureDocumentAuditAction
  description String?
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime                     @default(now())

  document    SignatureDocument            @relation(fields: [documentId], references: [id], onDelete: Cascade)
  signer      SignatureDocumentSigner?     @relation(fields: [signerId], references: [id], onDelete: SetNull)
  actor       User?                        @relation("SignatureDocumentAuditActor", fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([documentId, createdAt])
  @@index([signerId])
  @@index([actorUserId])
  @@index([action])
  @@index([createdAt])
}
```

Append-only semântico: nenhum caminho altera/deleta `action`, `description`, `actorUserId`, `documentId`,
`signerId` ou `createdAt`. O job de retenção pode **anonimizar somente** `ipAddress`/`userAgent` após o cutoff,
exatamente como `data-retention.js` faz com `ReportAuditLog`, e acrescenta
`DADOS_ACESSO_ANONIMIZADOS` para tornar a exceção observável.

### [NOVO] `SignatureDocumentFilePurge`

Manifesto independente das linhas que serão apagadas. Não possui FK para documento ou usuário: precisa
sobreviver à exclusão física de ambos.

```prisma
model SignatureDocumentFilePurge {
  id                    String                           @id @default(cuid())
  operationKey          String                           @unique
  targetUserId          String                           // snapshot, sem FK
  quarantineRoot        String                           // relativo a UPLOAD_DIR
  manifest              Json                             // [{ originalPath, quarantinePath, kind }]
  status                SignatureDocumentFilePurgeStatus @default(PREPARANDO)
  attempts              Int                              @default(0)
  claimedAt             DateTime?
  nextAttemptAt         DateTime?
  lastError             String?                          // sanitizado; sem path absoluto/token
  completedAt           DateTime?
  createdAt             DateTime                         @default(now())
  updatedAt             DateTime                         @updatedAt

  @@index([status, nextAttemptAt])
  @@index([targetUserId])
  @@index([createdAt])
}
```

Ciclo: cria `PREPARANDO` → move arquivos atualizando o manifesto → transação de exclusão promove a
`PENDENTE` → tentativa imediata/job faz claim `EM_PROCESSAMENTO` → `CONCLUIDO`. Falha de staging ou da
transação restaura os moves e marca `CANCELADO`; falha física pós-commit marca `FALHOU` com backoff. Operação
e remoção são idempotentes: arquivo já ausente dentro da quarentena conta como removido.

### [NOVO] `SignatureDocumentCompletionNotification`

Outbox durável criada **na mesma transação** que conclui o documento. Evita perder a notificação se o processo
cair depois do commit do PDF e permite separar falha confirmada do SMTP de resultado ambíguo.

```prisma
model SignatureDocumentCompletionNotification {
  id                String                       @id @default(cuid())
  documentId        String                       @unique
  idempotencyKey    String                       @unique
  emailTo           String                       // snapshot no momento da conclusão
  status            SignatureDocumentEmailStatus @default(PENDENTE)
  attempts          Int                          @default(0)
  claimedAt         DateTime?
  nextAttemptAt     DateTime?
  providerMessageId String?
  lastError         String?                      // sanitizado; sem token/path absoluto
  sentAt            DateTime?
  createdAt         DateTime                     @default(now())
  updatedAt         DateTime                     @updatedAt

  document          SignatureDocument            @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
  @@index([createdAt])
}
```

O envio faz claim condicional `PENDENTE|FALHOU → EM_ENVIO`. Erro confirmado pelo transport marca `FALHOU` e
recebe backoff; aceitação confirmada grava `providerMessageId`/`sentAt` e `ENVIADO`. Claim antigo sem resultado
conhecido vira `REVISAO_NECESSARIA` e **não** é reenviado automaticamente — o precedente é
`DataSubjectRequestResponseAttempt`. Assim, uma reexecução automática não duplica uma mensagem que pode ter
sido aceita pelo provedor. A reconciliação manual registra a decisão antes de liberar novo envio.

### [EXISTE] `User` — apenas relations de volta

```prisma
model User {
  // ... campos existentes, inalterados ...
  signatureDocuments          SignatureDocument[]          @relation("SignatureDocumentOwner")
  signatureDocumentAuditLogs  SignatureDocumentAuditLog[]  @relation("SignatureDocumentAuditActor")
}
```
Relations Prisma não geram DDL do lado `User` — nenhuma coluna nova, nenhum risco para dados existentes.

---

## 3. Migrations

### `<ts>_add_assinaturas_module/migration.sql`
```sql
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'ASSINATURAS';
ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS 'ASSINATURAS_USER';
```
**Deve ser uma migration separada e anterior** à das tabelas: o Postgres não permite usar um valor de enum
recém-adicionado no mesmo bloco transacional.

### `<ts>_add_assinaturas_tables/migration.sql`
Ordem: `CREATE TYPE` dos 6 enums novos → `CREATE TABLE "SignatureDocument"` →
`"SignatureDocumentSigner"` → `"SignatureDocumentField"` → `"SignatureDocumentAuditLog"` →
`"SignatureDocumentFilePurge"` → `"SignatureDocumentCompletionNotification"` →
`CREATE INDEX`/`CREATE UNIQUE INDEX` → `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`.

Gerada por `npx prisma migrate dev --name add_assinaturas_tables` (rodado pelo desenvolvedor; em servidor,
`npx prisma migrate deploy` como bloco "rode no servidor" — Princípio I).

**Risco para dados existentes: nenhum.** As duas migrations são estritamente aditivas; nenhuma tabela, coluna,
índice ou constraint existente é alterado ou removido.

---

## 4. Variáveis de ambiente novas (`backend/src/config/env.js`)

| Variável | Default | Uso |
|---|---|---|
| `ASSINATURAS_MAX_PDF_MB` | `20` | Teto do upload (alinhado ao `MAX_PDF_BYTES` de Qualidade) |
| `ASSINATURAS_MAX_PAGES` | `50` | Teto de páginas por documento |
| `ASSINATURAS_MAX_SIGNERS` | `20` | Teto de assinantes por documento |
| `ASSINATURAS_TOKEN_MAX_DAYS` | `90` | Teto da validade escolhida na publicação |
| `ASSINATURAS_DELETED_RETENTION_DAYS` | `90` | Dias até purgar arquivos excluídos pelo dono (na exclusão de conta, o staging é imediato e a remoção física pode ser retomada) |
| `ASSINATURAS_PREVIEW_SCALE` | `1.5` | Escala do render de preview |

Reutilizadas sem alteração: `SIGNATURE_TOKEN_SECRET`, `PREVIOUS_SIGNATURE_TOKEN_SECRETS`, `UPLOAD_DIR`,
`APP_URL`, `SMTP_*`, `SEND_CLIENT_EMAILS`, `TRUST_PROXY`.

Conforme `docs/PADRAO_MODULO.md`, as novas variáveis entram em `backend/.env.example` e ganham caso em
`backend/test/env.test.js`.

---

## 5. Consultas principais e uso dos índices

| Consulta | `where` | Índice |
|---|---|---|
| Listagem ativa | `{ ownerUserId, deletedAt: null, archivedAt: null }` ordenado por `createdAt desc` | `[ownerUserId, deletedAt, archivedAt, createdAt]` |
| Listagem arquivados | `{ ownerUserId, deletedAt: null, archivedAt: { not: null } }` | idem |
| Filtro por status | `{ ownerUserId, status }` | `[ownerUserId, status]` |
| Job de finalização | `{ status: FINALIZANDO, finalizationNextAttemptAt <= now }` | `[status, finalizationNextAttemptAt]` |
| Autorização (toda rota) | `{ id, ownerUserId, deletedAt: null }` | PK + filtro |
| Resolver convite público | `{ tokenHash }` | `tokenHash @unique` |
| Job de expiração | `{ status: PENDENTE, tokenExpiresAt: { lt: now } }` | `[status, tokenExpiresAt]` |
| Job de e-mail | `{ emailStatus: { in: [PENDENTE, FALHOU] }, emailClaimedAt: null }` | `[emailStatus, emailClaimedAt]` |
| Outbox de conclusão | `{ status: [PENDENTE, FALHOU], nextAttemptAt <= now }` | `[status, nextAttemptAt]` |
| Trilha do documento | `{ documentId }` ordenado por `createdAt desc` | `[documentId, createdAt]` |
| Validação pública | `{ validationCode }` | `validationCode @unique` |
| Job de purga de conta | `{ status: [PREPARANDO, PENDENTE, FALHOU], nextAttemptAt <= now }` | `[status, nextAttemptAt]` |
| Impacto da exclusão de conta | `{ ownerUserId, status }` agrupado | `[ownerUserId, status]` |
| Órfãos (rotina operacional) | `{ ownerUserId: null }` | `[ownerUserId]` |
