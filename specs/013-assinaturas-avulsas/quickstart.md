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

**Verificar**: `AppModule` contém `ASSINATURAS`, `ModuleRoleCode` contém `ASSINATURAS_USER`, e as seis tabelas
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
Também validar: PDF bruto de exatamente 20 MB dentro do body base64 cabe no parser de 30 MB; arquivo acima de
`ASSINATURAS_MAX_PDF_MB` → `400` (ou `413` se o próprio body exceder 30 MB); PDF com mais páginas que
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
4. Repetir com PDFs que tenham páginas rotacionadas em 90°, 180° e 270°.

**Esperado**:
- Cada campo mostra o nome do assinante e uma cor distinta.
- Redimensionar a janela do navegador (ou abrir no celular) **não** desloca os campos — a posição é percentual.
- Recarregar a página (F5) mantém documento e página abertos (`?doc=…&page=…`).
- O request de `PUT /campos` contém só `signerId`, página e coordenadas normalizadas — largura/altura em pontos
  e rotação não saem do browser — e o carimbo permanece correto em todas as quatro orientações.
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
- Cada link usa `/assinaturas/assinar#convite=...`; não há segredo em path ou query string.
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
- Nos logs, confirmar que **nenhuma linha contém o token completo** — nem em acesso/erro 5xx — e que eventos de
  telemetria também não o recebem:
  ```bash
  rg -l --fixed-strings "$TOKEN_DO_CONVITE" backend/logs   # esperado: nenhuma saída
  ```
- Simular erro confirmado do transport: o convite fica `FALHOU` e recebe retry. Simular processo interrompido
  após entrar em `EM_ENVIO`, sem resultado persistido: após o claim vencer, fica `REVISAO_NECESSARIA` e não é
  reenviado automaticamente até reconciliação explícita.

---

## 9. Fluxo do assinante

Abrir o link copiado em uma **janela anônima** (sem sessão).

**Esperado**:
- A página carrega sem login, com o nome do documento, a prévia e **apenas o nome do próprio assinante**.
- Antes de qualquer request, o fragmento `#convite=...` desaparece da barra por `history.replaceState`; o token
  não aparece em `localStorage`, `sessionStorage`, query keys ou URL. A API o recebe em `X-Signature-Token`.
- Inspecionar a resposta de `GET /api/assinaturas/publico`: **não** contém nome nem e-mail do outro assinante,
  nem o e-mail do dono.
- Aviso de privacidade precisa ser aceito antes de habilitar "Assinar".
- O `SignatureDialog` abre com desenho e upload de imagem.
- Após confirmar: mensagem de conclusão; a tela do dono mostra **1 de 2 assinaturas**.

Casos de erro a validar:
- Token alterado em um caractere → página "Link inválido" (404).
- Token de um convite revogado → "Link inválido".
- Convite expirado (ajustar `tokenExpiresAt` no banco para o passado) → "Link expirado" (410), com orientação
  de pedir um novo link, e o convite passa a `EXPIRADO` no painel do dono.
- **Dupla assinatura**: reenviar o mesmo `POST /api/assinaturas/publico/assinar` com o header → `200`
  idempotente, **uma** linha assinada e
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
- Status pode aparecer brevemente como **Finalizando**; nesse estado a UI faz polling, não reenvia a assinatura
  e não oferece download. Depois muda para **Concluído**, com `completedAt`, caminho e hash preenchidos.
- **Baixar PDF assinado** disponível para o dono (usuário B recebe 404) e, até a expiração, para cada assinante
  já assinado pelo próprio header de convite.
- No PDF: a imagem de cada assinatura está **na posição escolhida**, na página escolhida; ao final há a página
  de evidências com nome, e-mail (ou "—"), data/hora UTC, IP, navegador, hash do PDF-base e QR de validação.
- Escanear o QR (ou abrir `/validar-documento/<code>`) mostra o documento como válido, com os assinantes.

Integridade:
```bash
# corromper o PDF original no storage e tentar baixar/finalizar
printf 'x' >> "$UPLOAD_DIR/Assinaturas/Documentos/<arquivo>.pdf"
```
**Esperado**: `409` com mensagem sobre divergência de hash; **nenhum** PDF final é sobrescrito.

Recuperação: simular falha de escrita/rename na primeira tentativa. O documento deve ficar `FINALIZANDO`, com
`FINALIZACAO_FALHOU`; ao restaurar o filesystem e rodar o job, deve convergir para um único arquivo/hash,
`PDF_FINAL_GERADO`, `DOCUMENTO_CONCLUIDO` e e-mail. Repetir o job não duplica nenhum deles. Corromper o PDF
final depois de concluído faz **todo** endpoint de download responder 409.

Também interromper o processo depois do commit conclusivo e antes do envio ao proprietário: a linha em
`SignatureDocumentCompletionNotification` deve permanecer `PENDENTE` e o job deve enviá-la depois. Se a queda
ocorrer durante o SMTP e o resultado ficar desconhecido, deve ir para `REVISAO_NECESSARIA`, nunca para retry
cego.

---

## 12. Arquivamento e exclusão

- **Arquivar** um documento concluído: sai da listagem principal, aparece em Arquivados, status continua
  **Concluído**, PDF final continua baixável. **Restaurar** volta.
- **Excluir** um documento aguardando assinaturas: confirmação explícita avisando que os links serão
  invalidados. Após confirmar, abrir um link ativo → `410`/`404`. Auditoria registra `DOCUMENTO_EXCLUIDO`.
- **Restaurar excluído** dentro da retenção: assinante pendente recebe link novo; link anterior continua 404;
  assinante já assinado e convite revogado manualmente não mudam.
- Documento `FINALIZANDO` recusa exclusão com 409.
- **Excluir** um concluído: confirmação reforçada; as assinaturas e a trilha **permanecem** no banco.
- Retenção: com `ASSINATURAS_DELETED_RETENTION_DAYS=0` e o job de manutenção acionado, os arquivos somem do
  disco, `sourceStoragePath`/`finalStoragePath` viram `NULL`, `filesPurgedAt` é preenchido e a
  **auditoria continua semanticamente íntegra**. Quando a retenção anonimizar IP/UA, um evento
  `DADOS_ACESSO_ANONIMIZADOS` é acrescentado e nenhum outro campo de evento é alterado.

---

## 12b. Exclusão de conta (D16)

Com o usuário A tendo 2 documentos em rascunho/aguardando e 1 concluído, entrar como ADMIN em
`/admin/accounts` e iniciar a exclusão da conta de A.

**Esperado**:
- A confirmação avisa: *"2 documentos de assinatura serão excluídos permanentemente. 1 documento concluído será
  preservado."*
- Se houver documento `FINALIZANDO`, a confirmação fica bloqueada e a API retorna 409 sem mover arquivos.
- Após confirmar: os 2 documentos somem do banco; os arquivos saem dos caminhos servidos imediatamente e vão
  para uma quarentena com manifesto. A remoção física é tentada na hora.
- O documento concluído **permanece** no banco com `ownerUserId = NULL`, com PDF final e trilha intactos, e
  ganha o evento `PROPRIETARIO_REMOVIDO`.
- Nenhum usuário — **inclusive ADMIN** — consegue abrir o documento órfão pela aplicação (404 em todas as rotas).
- O código público ainda valida o órfão; um convite assinado e não vencido ainda baixa o PDF final e mostra o
  nome histórico de quem solicitou.
- Simular falha no segundo move: todos os moves anteriores são restaurados e a conta permanece. Simular falha
  de remoção pós-commit: bytes ficam somente na quarentena, registro `FALHOU`; o job posterior remove e marca
  `CONCLUIDO`. O arquivo do documento preservado nunca entra no manifesto.

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
`ASSINATURA_REALIZADA` → `FINALIZACAO_INICIADA` → `PDF_FINAL_GERADO` → `DOCUMENTO_CONCLUIDO`.

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
- [ ] PDF bruto no limite cabe no body; acima do limite é rejeitado; falha de banco compensa arquivo
- [ ] Assinante com e-mail e assinante sem e-mail convivem
- [ ] Campos posicionados corretamente em diferentes larguras de tela
- [ ] Campos corretos em páginas 0°/90°/180°/270° e geometria física nunca vem do cliente
- [ ] Publicação valida tudo antes de emitir os links
- [ ] Links distintos por assinante
- [ ] Token só no fragmento/memória/header; não aparece em path, query, cache, logs, erros ou telemetria
- [ ] E-mail só para quem tem e-mail; falha de e-mail não bloqueia nada
- [ ] Assinatura válida grava IP/UA/data e é idempotente
- [ ] Token incorreto, expirado e revogado tratados com mensagem adequada
- [ ] Renovação invalida o token anterior
- [ ] Progresso parcial correto; conclusão após a última assinatura
- [ ] `FINALIZANDO` é recuperável e idempotente; não há concluído sem PDF/hash íntegros
- [ ] PDF final com carimbo posicionado + página de evidências + QR
- [ ] Trilha de auditoria completa, sem token em nenhum registro ou log
- [ ] Arquivar preserva assinaturas; excluir invalida links
- [ ] Restaurar excluído reemite só convites elegíveis; links antigos/revogações manuais não voltam
- [ ] Download autenticado isolado por proprietário; convite assinado válido baixa o final
- [ ] Exclusão de conta apaga não concluídos, preserva concluídos e avisa a contagem antes
- [ ] Exclusão de conta usa quarentena/manifesto, recupera falhas e bloqueia `FINALIZANDO`
- [ ] Documento órfão inacessível autenticado; validação e convite assinado válido continuam públicos
- [ ] Excluir conta sem documentos continua funcionando como antes
- [ ] Sem scroll horizontal de página em mobile em todas as telas
