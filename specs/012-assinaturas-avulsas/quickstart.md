# Quickstart — validação do módulo Assinaturas Avulsas

Guia de validação end-to-end. Detalhes de entidades em `data-model.md`, de endpoints em `contracts/api.md`.
Nenhum comando aqui é executado por agente de IA: os blocos marcados **"rode no servidor"** são para execução
manual pelo operador (Princípio I da constitution).

---

## 0. Pré-requisitos

- Backend e frontend rodando localmente (`backend: npm run dev`, `frontend: npm run dev`).
- Postgres local acessível via `DATABASE_URL`.
- `SIGNATURE_TOKEN_SECRET` definido no `backend/.env` (fora de produção há fallback, mas defina para exercitar
  o caminho real de cifra/decifra do link).
- SMTP configurado **ou** `SEND_CLIENT_EMAILS=false` — os dois cenários precisam ser validados (item 8).
- Um PDF de teste com pelo menos 3 páginas.

---

## 1. Preparar banco e registry

```bash
# local, na máquina do desenvolvedor
npm run modules:generate
cd backend && npx prisma migrate dev && npx prisma generate
```

**Rode no servidor** (staging/produção, execução manual pelo operador):

```bash
docker compose -f docker-compose.staging.yml exec backend npx prisma migrate deploy
docker compose -f docker-compose.staging.yml restart backend
```

**Verificar**: `AppModule` contém `ASSINATURAS`, `ModuleRoleCode` contém `ASSINATURAS_USER`, e as quatro tabelas
`SignatureDocument*` existem.

---

## 2. Conceder a permissão

Pelo hub, com conta ADMIN: `/admin/accounts` → usuário → marcar **Assinaturas - Usuário**.

**Esperado**: o card "Assinaturas" aparece em `/modulos` para esse usuário e **não** aparece para quem não tem
a role.

---

## 3. Bloqueio de acesso (usuário sem permissão)

```bash
curl -i -H "Authorization: Bearer $TOKEN_SEM_PERMISSAO" \
  http://localhost:4000/api/assinaturas/documentos
```
**Esperado**: `403 {"error":"Acesso restrito ao módulo."}`.
No frontend, `/assinaturas` redireciona (RoleRoute).

---

## 4. Upload de PDF

Pela UI: `/assinaturas` → **Novo documento** → arrastar o PDF.

**Esperado**: card na listagem com status **Rascunho**, nome do arquivo, contagem de páginas e data.

Rejeições a validar:

```bash
# arquivo que não é PDF
curl -s -X POST http://localhost:4000/api/assinaturas/documentos \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fileName":"x.pdf","pdfDataUrl":"data:application/pdf;base64,UEsDBBQAAAA="}'
```
**Esperado**: `400` com mensagem sobre PDF inválido (magic bytes `%PDF` ausentes).
Também validar: arquivo acima de `ASSINATURAS_MAX_PDF_MB` → `400`/`413`; PDF com mais páginas que
`ASSINATURAS_MAX_PAGES` → `400`; PDF protegido por senha → `400`.

---

## 5. Isolamento por proprietário (crítico)

Com o `id` do documento criado pelo usuário **A**, autenticado como usuário **B** (que também tem a permissão):

```bash
for path in "" "/pdf" "/pdf-final" "/paginas/1.png" "/auditoria"; do
  curl -s -o /dev/null -w "%{http_code} $path\n" \
    -H "Authorization: Bearer $TOKEN_USUARIO_B" \
    "http://localhost:4000/api/assinaturas/documentos/$DOC_ID$path"
done
```
**Esperado**: `404` em **todas** as linhas — nunca `403`, nunca `200`.
Repetir para `PATCH`, `PUT /assinantes`, `PUT /campos`, `POST /publicar`, `POST /arquivar`, `DELETE`.
O documento de A também **não** aparece em `GET /documentos` de B.

---

## 6. Configuração: assinantes e posicionamento

Abrir o documento → aba de configuração.

1. Adicionar **Assinante 1** com nome e e-mail.
2. Adicionar **Assinante 2** com nome e **sem** e-mail.
3. Selecionar o Assinante 1 e desenhar um campo na página 1; selecionar o Assinante 2 e desenhar na página 3.

**Esperado**:
- Cada campo mostra o nome do assinante e uma cor distinta.
- Redimensionar a janela do navegador (ou abrir no celular) **não** desloca os campos — a posição é percentual.
- Recarregar a página (F5) mantém documento e página abertos (`?doc=…&page=…`).
- Não há scroll horizontal de página em nenhuma largura.
- Tentar salvar assinante sem nome mostra o campo em vermelho com `.field-error` (não a validação nativa).

---

## 7. Publicação e validações

Clicar em **Publicar** sem posicionar campo para um dos assinantes.

**Esperado**: `400` e a UI lista as pendências ("Assinante 2 não tem campo de assinatura").

Corrigir, escolher validade (ex.: 15 dias) e publicar.

**Esperado**:
- Status muda para **Aguardando assinaturas**.
- Cada assinante tem um botão **Copiar link** e os links são **diferentes entre si**.
- O assinante com e-mail mostra "E-mail enviado"; o sem e-mail mostra "Sem e-mail — copie o link"
  e **nenhuma tentativa de envio ocorreu**.
- Tentar editar assinantes/campos agora → bloqueado (409).

Conferir tokens distintos no banco:
```sql
SELECT "name", left("tokenHash", 8) FROM "SignatureDocumentSigner" WHERE "documentId" = '<DOC_ID>';
```
**Esperado**: dois hashes diferentes e não nulos.

---

## 8. E-mail

- **Com SMTP**: o convite chega com nome do documento, quem solicitou, botão de assinatura e data de expiração.
- **Com SMTP quebrado** (host inválido no `.env`): a publicação **continua funcionando**, o assinante fica
  `emailStatus = FALHOU`, a UI mostra o aviso de falha e o botão **Copiar link** segue disponível.
  **Nenhum token é invalidado.**
- Nos logs, confirmar que **nenhuma linha contém o token completo** — só `tokenHash` truncado:
  ```bash
  grep -c "$TOKEN_DO_CONVITE" backend/logs/*.log   # esperado: 0 (ou "no such file")
  ```

---

## 9. Fluxo do assinante

Abrir o link copiado em uma **janela anônima** (sem sessão).

**Esperado**:
- A página carrega sem login, com o nome do documento, a prévia e **apenas o nome do próprio assinante**.
- Inspecionar a resposta de `GET /api/assinaturas/publico/:token`: **não** contém nome nem e-mail do outro
  assinante, nem o e-mail do dono.
- Aviso de privacidade precisa ser aceito antes de habilitar "Assinar".
- O `SignatureDialog` abre com desenho e upload de imagem.
- Após confirmar: mensagem de conclusão; a tela do dono mostra **1 de 2 assinaturas**.

Casos de erro a validar:
- Token alterado em um caractere → página "Link inválido" (404).
- Token de um convite revogado → "Link inválido".
- Convite expirado (ajustar `tokenExpiresAt` no banco para o passado) → "Link expirado" (410), com orientação
  de pedir um novo link, e o convite passa a `EXPIRADO` no painel do dono.
- **Dupla assinatura**: reenviar o mesmo `POST .../assinar` → `200` idempotente, **uma** linha assinada e
  **um** evento `ASSINATURA_REALIZADA` na auditoria.

---

## 10. Renovação e revogação

No painel do dono, **Renovar** o convite do assinante pendente.

**Esperado**: novo link diferente do anterior; abrir o **link antigo** → `404`; o novo funciona;
auditoria registra `CONVITE_RENOVADO`.

**Revogar** o outro convite: link deixa de funcionar imediatamente; auditoria registra `CONVITE_REVOGADO`.

---

## 11. Conclusão e PDF final

Assinar com o último assinante pendente.

**Esperado**:
- Status → **Concluído**, com `completedAt`.
- **Baixar PDF assinado** disponível **somente** para o dono (usuário B recebe 404).
- No PDF: a imagem de cada assinatura está **na posição escolhida**, na página escolhida; ao final há a página
  de evidências com nome, e-mail (ou "—"), data/hora UTC, IP, navegador, hash do PDF-base e QR de validação.
- Escanear o QR (ou abrir `/validar-documento/<code>`) mostra o documento como válido, com os assinantes.

Integridade:
```bash
# corromper o PDF original no storage e tentar baixar/finalizar
printf 'x' >> "$UPLOAD_DIR/Assinaturas/Documentos/<arquivo>.pdf"
```
**Esperado**: `409` com mensagem sobre divergência de hash; **nenhum** PDF final é sobrescrito.

---

## 12. Arquivamento e exclusão

- **Arquivar** um documento concluído: sai da listagem principal, aparece em Arquivados, status continua
  **Concluído**, PDF final continua baixável. **Restaurar** volta.
- **Excluir** um documento aguardando assinaturas: confirmação explícita avisando que os links serão
  invalidados. Após confirmar, abrir um link ativo → `410`/`404`. Auditoria registra `DOCUMENTO_EXCLUIDO`.
- **Excluir** um concluído: confirmação reforçada; as assinaturas e a trilha **permanecem** no banco.
- Retenção: com `ASSINATURAS_DELETED_RETENTION_DAYS=0` e o job de manutenção acionado, os arquivos somem do
  disco, `sourceStoragePath`/`finalStoragePath` viram `NULL`, `filesPurgedAt` é preenchido e a
  **auditoria continua íntegra**.

---

## 12b. Exclusão de conta (D16)

Com o usuário A tendo 2 documentos em rascunho/aguardando e 1 concluído, entrar como ADMIN em
`/admin/accounts` e iniciar a exclusão da conta de A.

**Esperado**:
- A confirmação avisa: *"2 documentos de assinatura serão excluídos permanentemente. 1 documento concluído será
  preservado."*
- Após confirmar: os 2 documentos e seus arquivos **somem do banco e do disco na hora**.
- O documento concluído **permanece** no banco com `ownerUserId = NULL`, com PDF final e trilha intactos, e
  ganha o evento `PROPRIETARIO_REMOVIDO`.
- Nenhum usuário — **inclusive ADMIN** — consegue abrir o documento órfão pela aplicação (404 em todas as rotas).
- Conferir no disco que os arquivos dos 2 apagados sumiram e o do preservado continua lá.

```sql
-- rode no servidor apenas se precisar inventariar órfãos
SELECT id, title, "completedAt", "validationCode" FROM "SignatureDocument" WHERE "ownerUserId" IS NULL;
```

Validar também que excluir uma conta **sem** documentos de assinatura continua funcionando exatamente como
antes (regressão do módulo de contas).

---

## 13. Auditoria

Aba **Auditoria** do documento.

**Esperado**, em ordem cronológica: `DOCUMENTO_CRIADO` → `CONFIGURACAO_ATUALIZADA` → `DOCUMENTO_PUBLICADO` →
`CONVITE_CRIADO` (×N) → `EMAIL_SOLICITADO`/`EMAIL_ENVIADO` → `LINK_ACESSADO` → `DOCUMENTO_VISUALIZADO` →
`ASSINATURA_REALIZADA` → `DOCUMENTO_CONCLUIDO` → `PDF_FINAL_GERADO`.

Conferir que os eventos de assinatura trazem IP e navegador, e que **nenhum** evento contém token.

---

## 14. Suíte automatizada

```bash
cd backend && npm test
cd ../frontend && npm run lint && npm test && npm run build
cd .. && npm run architecture:check
```

**Esperado**: tudo verde, incluindo `backend/test/assinaturas-*.test.js` e
`frontend/test/assinaturas-coordinates.test.mjs`.

---

## 15. Checklist de aceite

- [ ] Sem a permissão: 403 na API e redirect na UI
- [ ] Com a permissão: módulo acessível
- [ ] Usuário A não vê nem acessa documento de B (404 em todas as rotas)
- [ ] Upload de PDF válido funciona; arquivo inválido é rejeitado
- [ ] Assinante com e-mail e assinante sem e-mail convivem
- [ ] Campos posicionados corretamente em diferentes larguras de tela
- [ ] Publicação valida tudo antes de emitir os links
- [ ] Links distintos por assinante
- [ ] E-mail só para quem tem e-mail; falha de e-mail não bloqueia nada
- [ ] Assinatura válida grava IP/UA/data e é idempotente
- [ ] Token incorreto, expirado e revogado tratados com mensagem adequada
- [ ] Renovação invalida o token anterior
- [ ] Progresso parcial correto; conclusão após a última assinatura
- [ ] PDF final com carimbo posicionado + página de evidências + QR
- [ ] Trilha de auditoria completa, sem token em nenhum registro ou log
- [ ] Arquivar preserva assinaturas; excluir invalida links
- [ ] Download isolado por proprietário
- [ ] Exclusão de conta apaga não concluídos, preserva concluídos e avisa a contagem antes
- [ ] Documento órfão inacessível por qualquer usuário, inclusive ADMIN
- [ ] Excluir conta sem documentos continua funcionando como antes
- [ ] Sem scroll horizontal de página em mobile em todas as telas
