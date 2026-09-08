# Phase 0 — Research: Assinaturas Avulsas

Objetivo: resolver todos os "NEEDS CLARIFICATION" técnicos do plano investigando o código existente, e
registrar decisão / racional / alternativas para cada ponto.

Nenhum item permaneceu como NEEDS CLARIFICATION. As decisões de produto e as clarificações de 2026-08-27
estão consolidadas na seção P do `plan.md` e no `spec.md`.

---

## R1 — Onde vive o mecanismo de assinatura hoje?

**Achado**: três fluxos.

| Fluxo | Entrada | Tabelas | Rotas | Página pública |
|---|---|---|---|---|
| Interno de relatório | `backend/src/lib/internal-report-signatures.js` (808 linhas) | `ReportVersion`, `ReportSignature`, `ReportAuditLog` | `backend/src/routes/resources/reports.js:6217-6360`, `:7189` | `frontend/src/pages/PublicSignaturePage.tsx` |
| Ficha de EPI | `backend/src/routes/resources/epis.js:700-925` | `EpiSignatureRequest`, `EpiSignatureRequestAuditLog` | `/api/epi/public-sign/:token` | `frontend/src/pages/epi/EpiPublicSignaturePage.tsx` |
| ZapSign (legado) | `backend/src/lib/zapsign.js`, `zapsign-legacy-reconciliation.js` | campos `zapsign*` em `Report` | — | externo |

**Decisão**: o fluxo interno de relatório é a referência de **regras** (token, rodada, evidência, PDF final);
o fluxo de EPI é a referência de **estrutura** (entidade própria + rotas públicas antes do `requireAuth` +
confirmação idempotente). ZapSign é ignorado.

---

## R2 — Token: gerar, validar, expirar, recuperar

**Achado** (`backend/src/lib/signature-token.js`):

```js
createSignatureToken()   // randomBytes(32).toString('hex')  → 256 bits
signatureTokenHash(t)    // sha256 hex → coluna @unique de lookup
encryptSignatureToken(t) // AES-256-GCM (iv 12B + authTag) com chave = sha256(SIGNATURE_TOKEN_SECRET)
decryptSignatureToken()  // tenta o segredo atual e depois PREVIOUS_SIGNATURE_TOKEN_SECRETS (rotação)
signatureTokenData()     // devolve { token, tokenHash, tokenEncrypted, tokenIv, tokenAuthTag }
```

`SIGNATURE_TOKEN_SECRET` é **obrigatório em produção** (`assertProductionSignatureTokenSecretConfigured` em
`config/env.js`); fora de produção há fallback.

Expiração: `signatureTokenExpiresAt(days)` em `lib/signatures/common.js`; o RDO usa 30 dias
(`INTERNAL_SIGNATURE_TOKEN_DAYS`), o EPI usa 7 (`EPI_SIGNATURE_TOKEN_DAYS`).

**Decisão**: reuso integral, sem uma linha nova de criptografia. Expiração por convite, prazo escolhido pelo
dono na publicação, teto configurável (`ASSINATURAS_TOKEN_MAX_DAYS`, default 90). O link entregue usa
`/assinaturas/assinar#convite=<token>`; o frontend remove o fragmento ao carregar, mantém o token só em memória
e chama rotas públicas sem segredo no path/query por `X-Signature-Token`. `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, redator de header e testes de access log/5xx/telemetria complementam o desenho.

**Alternativas consideradas**:
- *JWT assinado com claims de convite*: dispensaria a coluna de token, mas impede revogação real (só por
  denylist) e introduz uma segunda tecnologia de token no app. Rejeitado.
- *Não guardar o token, reemitir a cada cópia*: satisfaria o purismo de "não guardar segredo", mas invalidaria o
  link já enviado por e-mail a cada clique em "copiar", piorando segurança operacional e UX. Rejeitado.
- *Guardar em claro*: rejeitado; a cifra já existe e custa zero.

---

## R3 — Como o PDF final é gerado hoje?

**Achado** (`internal-report-signatures.js:writeFinalEvidencePdf`, linhas ~590-760):

1. lê o PDF-base e **revalida** `sha256` contra `version.sourceDocumentHash` → 409 se divergir;
2. `PDFDocument.load()` (`pdf-lib`), fontes Helvetica/HelveticaBold;
3. **adiciona uma página A4 nova** (`595.28 x 841.89`) com logo, status, nome do documento, data, projeto,
   hash do PDF-base, código de validação, URL de validação e QR desenhado retângulo a retângulo a partir de
   `createValidationQrCodeMatrix` (`lib/qr-code.js`), com link-annotation clicável;
4. por assinante: nome declarado, e-mail, papel, data/hora UTC, IP, navegador resumido e a **imagem da
   assinatura** embutida (`embedPng`/`embedJpg`) dentro de uma caixa de 180x64;
5. salva como `<original>-assinado.pdf` e devolve `finalDocumentHash`.

**Conclusão importante**: **não existe carimbo posicionado** no app. A assinatura vira uma página de evidências
anexa. Coordenadas dentro do PDF são funcionalidade nova.

**Decisão**: `lib/assinaturas/final-pdf.js` faz as duas coisas — carimba nas posições **e** anexa a página de
evidências — reutilizando os primitivos (`createValidationQrCodeMatrix`, `parseSignatureImageDataUrl`,
`sha256`) e duplicando ~120 linhas de layout.

**Alternativa rejeitada**: extrair `writeFinalEvidencePdf` para uma lib genérica agora. É refactor amplo no
caminho de finalização do RDO em produção — vetado pelo briefing e pelo escopo. Registrado como follow-up com
teste de golden-file.

---

## R4 — Preview de PDF: onde renderizar?

**Achado**:
- `frontend/package.json` **não** tem `pdfjs-dist` nem qualquer visualizador de PDF. As páginas públicas atuais
  abrem o PDF em nova aba (`<a href={publicSignaturePdfUrl(...)} target="_blank">`).
- `backend/package.json` tem `pdfjs-dist@^6.1.200` **e** `@napi-rs/canvas@^1.0.5`.
- `backend/scripts/import-manual-rdo-pdfs.js:673-687` já contém a receita completa:
  `pdfjsLib.getDocument({...}).promise` → `page.getViewport({scale})` → `createCanvas(w,h)` →
  `page.render({canvasContext, viewport}).promise` → `canvas.toBuffer('image/png')`.

**Decisão**: renderizar no backend, servir PNG por página, autorizado, com cache em disco.

**Racional**: zero dependência nova; a receita já está validada no repositório; a constitution fixa a stack e
"bibliotecas utilitárias pequenas" não cobre um visualizador de PDF com worker; e centralizar no servidor
mantém a autorização no lugar certo (o browser nunca precisa do PDF inteiro só para desenhar a prévia).

**Alternativa considerada**: `pdfjs-dist` no frontend. Melhor UX (zoom/scroll nativos, sem round-trip por
página) e tira carga do servidor. Custo: dependência nova, configuração de worker no Vite, ~1 MB gzip a mais no
bundle e o PDF completo trafegando. Fica como evolução se a latência do preview incomodar.

---

## R5 — Representação de coordenadas

**Achado**: não há precedente no app.

**Decisão**: normalizado `[0,1]` com origem no canto **superior esquerdo da página rotacionada como o usuário a
vê**, `Decimal(9,8)` no Postgres. `pageWidthPt`/`pageHeightPt`/`pageRotation` e caixas vêm da geometria
capturada no upload e são copiados pelo **servidor**; o cliente envia somente o retângulo normalizado.

**Racional**: CSS usa origem superior esquerda e aceita percentual diretamente (`left: x*100 + '%'`), então o
overlay do editor não precisa de conversão dependente de tela; a conversão para o `pdf-lib` fica em **um**
ponto do backend, por matriz afim compatível com o viewport PDF.js e testada em 0°/90°/180°/270° e
`CropBox`/`MediaBox`. A fórmula simples `x*W`, `H-(y+h)*H` vale apenas para rotação 0°. Guardar a geometria
autoritativa torna a evidência auditável e permite recusar um PDF cujas páginas mudaram.

**Alternativas**: pixels absolutos (quebra em qualquer DPI/zoom — rejeitado); pontos PDF absolutos no banco
(correto, mas obriga o frontend a conhecer a escala e falha silenciosamente com cropbox deslocado — rejeitado);
origem inferior esquerda também no banco (alinha com `pdf-lib` mas desalinha com CSS, movendo a conversão para
o frontend, onde é mais fácil errar — rejeitado).

---

## R6 — Permissões e registro de módulo

**Achado**: `shared/modules/registry.json` é fonte de verdade; `scripts/generate-module-registry.mjs` gera
`frontend/src/modules/registry.generated.ts`; `backend/src/lib/module-roles.js` deriva `AppModules`,
`ModuleRoleCodes`, `hasModuleRole`; `middleware/auth.js` expõe `requireModuleRole(...roles)` e guards nomeados
por módulo; `frontend/src/auth/RoleRoute.tsx` + `moduleRouteAccess()` fazem o gate no cliente. O CI valida a
sincronia registry↔generated↔enums Prisma. `scripts/new-module.mjs` (`npm run new:module`) faz o scaffold
completo, mas gera **duas** roles (manager/viewer).

**Decisão**: módulo `assinaturas`, uma role `assinaturas:user` (`ASSINATURAS_USER`), `accountTypes:
["ADMIN","INTERNAL"]`, `hub.roles: ["assinaturas:user"]`, `pathPrefixes: ["/assinaturas"]`,
`pathExclusions: ["/assinaturas/assinar"]` (precedente: o módulo EPI exclui `/epi/assinar`).
Rodar o scaffold e **ajustar** a entrada para uma role só.

---

## R7 — Storage e validação de upload

**Achado**:
- `backend/src/lib/documents/storage.js` é a abstração compartilhada: `writeManagedDocumentFile` (cria diretório,
  sanitiza nome, sufixa com token, grava com `flag:'wx'` para não sobrescrever), `resolveManagedDocumentPath`
  (rejeita `..`, path absoluto e escape do root; exige `requiredPrefix` opcional; confere que é arquivo),
  `unlinkManagedDocumentFile`, `inlineContentDisposition`, `publicPathForToken`, `publicUrlForPath`.
  Usada por Qualidade, Estoque e Equipamentos.
- Validação de PDF de referência: `lib/qualidade/attachments.js:parsePdfUpload` — regex de data URL, base64,
  `bytes.subarray(0,4).toString('utf8') === '%PDF'`, teto de 20 MB.
- `env.uploadDir === env.reportsDir` (`config/env.js:201-213`), default `<cwd>/Relatórios`.
- `app.js` ajusta o limite do `express.json` por prefixo de rota; base64 adiciona cerca de 33% ao tamanho bruto.

**Decisão**: reuso direto. Pastas `Assinaturas/Documentos/`, `Assinaturas/Assinados/`,
`Assinaturas/Previews/<documentId>/`. Bytes nunca são expostos por path direto: a área do dono exige sessão +
owner check e a área pública exige token válido no header; o padrão de "token público de anexo" incorporado à
URL (`/api/qualidade-anexos/:token`) é incompatível com este segredo. O parser JSON de **30 MB** existe somente
no upload de assinatura, comportando PDF bruto
de 20 MB; as rotas públicas continuam com parser de 3 MB. Se a escrita do arquivo ocorrer e a criação no banco
falhar, `createDocument` executa compensação explícita.

---

## R8 — Auditoria

**Achado**: `lib/audit/events.js` normaliza o evento (`module`, `entityType`, `entityId`, `relatedEntityId`,
`actorUserId`, `action`, `description`, `evidence.{ipAddress,userAgent}`) e faz o dispatch para
`reportAuditLog` ou `epiSignatureRequestAuditLog`, lançando `TypeError` para alvo desconhecido. Coberto por
`backend/test/audit-events.test.js`. Nenhum caminho de código faz update/delete nessas tabelas — apenas
`data-retention.js` **anonimiza** IP/UA após o cutoff.

**Decisão**: estender com `AUDIT_MODULES.ASSINATURAS` + `AUDIT_ENTITY_TYPES.SIGNATURE_DOCUMENT` e um terceiro
branch. Mudança aditiva de ~10 linhas, sem alterar os branches existentes. A tabela nova segue o formato do
`ReportAuditLog` (mais `signerId`). A trilha é append-only nos campos semânticos; a única mutação permitida é
anonimizar IP/UA qualificados por retenção, seguida de um novo evento `DADOS_ACESSO_ANONIMIZADOS`.

---

## R9 — E-mail

**Achado**: `lib/mailer.js` (`sendMail`/`sendClientMail`, logo por CID, `getMissingMailerConfig`,
`outboundEmailsEnabled` via `SEND_CLIENT_EMAILS`) + `lib/email-templates.js` (28 builders exportados, incluindo
`buildReportSignatureRequestEmailTemplate`, `buildReportSignatureReminderEmailTemplate`,
`buildReportSignatureCompletedEmailTemplate`, e `addNotificationPreferencesLink`).

Estratégia de falha do RDO (`reports.js:deliverIssuedSignatureRequestEmails`): quando o envio falha, os tokens
**não enviados são apagados** para serem reemitidos no retry.

**Decisão**: reusar transport e o arquivo de templates (+2 builders). **Divergir** da estratégia de falha: aqui
o token **permanece válido** mesmo com e-mail falhando, porque §13 exige que o dono possa copiar o link
manualmente. Estado de entrega por convite (`emailStatus`, `emailAttempts`, `emailClaimedAt`) + job de retry.

Para o aviso de conclusão, criar `SignatureDocumentCompletionNotification` na mesma transação que promove o
documento a `CONCLUIDO`, com destinatário snapshot e chave idempotente. O precedente
`DataSubjectRequestResponseAttempt` resolve o caso sutil de queda durante SMTP: falha confirmada recebe retry;
claim antigo com resultado desconhecido vira `REVISAO_NECESSARIA` e não é reenviado automaticamente. A mesma
regra se aplica ao convite, evitando a falsa promessa de “exactly once” entre PostgreSQL e SMTP.

---

## R10 — Jobs e concorrência

**Achado**:
- `lib/jobs/runner.js`: `acquireJobLock(name, {ttlMs, owner})` sobre a tabela `JobLock`, `JobRun` para
  histórico, `runningJobs` in-process.
- Advisory lock transacional: `internal-report-signatures.js:lockSignatureRoundForReport` usa
  `pg_advisory_xact_lock(hashtext($1), 0)`; `data-retention.js` usa `pg_advisory_xact_lock(<id>)`.
- Update condicional: `signInternalReportVersion` usa `updateMany({where:{id, status: PENDING}})` e trata
  `count !== 1` relendo o registro (idempotência vs. 409).
- Idempotência de job por linha: `reminderClaimedAt`/`reminderCount` em `ReportSignature`.
- `P2002` tratado como "outro request venceu a corrida" em `ensureInternalSignatureRound`.

**Decisão**: aplicar esses mecanismos à assinatura e acrescentar conclusão recuperável. A última assinatura,
sob advisory lock, faz somente `AGUARDANDO_ASSINATURAS → FINALIZANDO`. Um processador compartilhado com o job
`assinaturas:finalization` gera bytes determinísticos, grava em temporário, verifica hash, promove
atomicamente e faz a transição condicional `FINALIZANDO → CONCLUIDO` junto com caminho/hash/data. Claims,
tentativas e backoff sobrevivem a queda; retries reconhecem o mesmo arquivo e não duplicam auditoria/e-mail.
`tokenHash @unique` permanece a constraint dos convites e `emailClaimedAt` protege o job de envio.

---

## R11 — Soft delete, arquivamento e retenção

**Achado**: `deletedAt` em `Report`, `Project`, `ProjectManualCost`, `QualityRecord` (com índice dedicado);
`archivedAt` em `EpiRecord`. Os dois conceitos **já coexistem** e são distintos. `lib/data-retention.js` roda
diariamente com advisory lock, em lotes, e **anonimiza** trilhas de auditoria (IP/UA) em vez de apagá-las;
apaga sessões e tokens vencidos e drafts abandonados; grava `DataRetentionRun`; tem modo dry-run
(`npm run retention:dry-run`).

**Decisão**: `archivedAt` para arquivamento (reversível, sem efeito em assinatura/links) e `deletedAt` para
exclusão (invalida links imediatamente). Purga de **arquivos** após `ASSINATURAS_DELETED_RETENTION_DAYS`,
preservando a linha e a trilha — a mesma filosofia do job existente. `invalidationReason` separa revogação
manual, cancelamento e exclusão; restauração emite bytes novos somente para convites não assinados invalidados
pela exclusão.

Na exclusão física da conta, arquivos de documentos não concluídos são movidos primeiro para quarentena sob
manifesto durável. Falha antes do commit restaura; depois do commit, os bytes já estão inacessíveis e o job
`assinaturas:file-purge` repete a remoção física. Documentos concluídos ficam órfãos, conservam o nome
histórico do solicitante, a validação pública e o download final por convite assinado válido. Documento
`FINALIZANDO` bloqueia a exclusão da conta.

---

## R12 — Componentes de frontend reutilizáveis

**Achado**:
- `components/reports/SignatureDialog.tsx` (370 linhas): modo desenho (canvas + Pointer Events) ou upload de
  imagem, validação de nome completo, cache do nome do signatário em `localStorage`
  (`filtrovali.signature.v1:<identity>`), `confirmDisabled`/`notice` para o aviso de privacidade. **Já é
  compartilhado** por `PublicSignaturePage` (RDO) e `EpiPublicSignaturePage` (EPI) — reutilizar é o padrão, não
  a exceção.
- `components/ui/PdfDropzone.tsx`: drag & drop de PDF com `accept`, estado `dragOver`, arquivo atual, remoção.
- `components/ui/`: `Modal`, `Button`, `ConfirmDialog`, `Toast`/`ToastContext`, `SearchBar`, `Skeleton`,
  `ReasonDialog`, `InfiniteScrollSentinel`.
- `components/privacy/PrivacyNotice.tsx` com variantes por fluxo; versões em `constants/privacy.ts` e
  `lib/privacy-consent.js` (`signature_rdo_v1`, `signature_epi_v1`, ...).
- Shell de página pública: classe `survey-page-shell` + `auth-card`, usada por `PublicSignaturePage` e
  `SurveyPage`.
- Detalhe: blocos `det-section`/`det-row`/`det-label`/`det-val` (padrão de `ReportDetailPage`).

**Decisão**: reutilizar todos sem fork. Novidade real apenas em `PdfPageCanvas.tsx` (overlay de campos) e nos
componentes de listagem/detalhe específicos do módulo.

**Auditoria de dívida da fonte** (exigência da constitution antes de clonar/reutilizar): `SignatureDialog`,
`PdfDropzone`, `Modal`, `ConfirmDialog` e `PrivacyNotice` conferem com os princípios atuais (tokens, estados de
campo, mobile, rodapé de ações). Nenhuma tarefa de correção da fonte é necessária.

---

## R13 — Testes existentes do fluxo de assinatura

**Achado**: `backend/test/internal-report-signatures.test.js`, `epi-security.test.js` (30+ casos),
`signature-token.test.js`, `signatures-common.test.js`, `audit-events.test.js`, `restore-and-audit.test.js`,
`upload-security.test.js`, `stored-upload-paths.test.js`.

Padrão observado em `epi-security.test.js`: importa **funções exportadas da própria rota/lib**, injeta um
`client` fake com `$transaction` simulado, e testa regra pura sem banco. Casos de segurança são explícitos
("guards require explicit module roles even for admin accounts", "payload omits CPF and signature image data",
"expiration does not overwrite a concurrently signed request", "confirmation is idempotent after successful
signing").

**Decisão**: seguir exatamente esse padrão. Exportar do domínio (`lib/assinaturas/*`) tudo que precisa de teste
e injetar client fake. Ver seção M do `plan.md` para a matriz completa.
