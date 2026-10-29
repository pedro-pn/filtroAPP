# Contrato Omni fase 2 — Entrega A

Base `/api/integracoes/v1`, Bearer existente, schemaVersion **1.0**.

## GET /eventos

Exige eventos.read mais o escopo de cada tipo. `limit` 1–500 (padrão 100,
limitado pela credencial), `cursor` opaco. Sem cursor lê a janela dos últimos 30 dias.
Resposta: items, page {limit, hasMore, nextCursor, snapshotAt}, generatedAt,
requestId, schemaVersion. Mesmo quando hasMore=false, guardar nextCursor para polling.
snapshotAt informa a leitura atual; não congela o feed. Manter mesmos escopos/política;
mudança exige reiniciar. Cursor atrasado: 410 CURSOR_EXPIRED; reconciliar e reiniciar.
Deduplicar pelo id; entrega pelo menos uma vez. Não há contagem global.

Tipos e permissões: rdo.criado/devolvido/assinado → rdo.relatorios.todos.read;
rdo.aprovado → rdo.relatorios.read OU rdo.relatorios.todos.read;
workflow.etapa_alterada → efetivo.projetos.status.read;
qualidade.criado/alterado → qualidade.registros.read;
romaneio.emitido → romaneios.read (liberado pela Entrega B);
projeto.responsaveis_alterados → projetos.responsaveis.read.

Alterações de evidências também geram qualidade.alterado; a transação evita duplicar
o evento quando registro e evidências são salvos juntos.

```json
{"items":[{"id":"evt_123","type":"rdo.aprovado","occurredAt":"2026-10-28T12:00:00.000Z","projectId":"projeto-ficticio","projectCode":"5850","resource":"rdo","resourceId":"rdo-ficticio"}],"page":{"limit":100,"hasMore":false,"nextCursor":"cursor-assinado-ficticio","snapshotAt":"2026-10-28T12:01:00.000Z"},"generatedAt":"2026-10-28T12:01:00.000Z","schemaVersion":"1.0","requestId":"request-ficticio"}
```

## GET /rdo/relatorios

rdo.relatorios.todos.read permite PENDING, RETURNED, APPROVED, SIGNED e filtro
`status=PENDING,RETURNED`. Nunca inclui ReportDraft. Acrescenta submittedAt,
returnedAt, signedAt, clientReleasedAt; approvedAt já existe e permanece no legado.
Sem esse escopo, somente APPROVED e exatamente os campos anteriores; status é
rejeitado. Os demais filtros/paginação permanecem. updatedSince reflete transições.
submittedAt representa o envio mais recente; legado recebe createdAt; signedAt
legado usa evidência disponível e pode ser nulo se não houver data confiável.

Exemplo parcial fictício de um item com o novo escopo (os demais campos de
identificação, projeto e horas permanecem no item):

```json
{"id":"rdo-ficticio","status":"RETURNED","submittedAt":"2026-10-28T12:00:00.000Z","returnedAt":"2026-10-28T14:00:00.000Z","approvedAt":null,"signedAt":null,"clientReleasedAt":null,"updatedAt":"2026-10-28T14:00:00.000Z"}
```

## POST /qualidade/registros

Exige qualidade.registros.create. Header Idempotency-Key UUID obrigatório, por
credencial; mesma chave/corpo retorna a resposta original 201, corpo diferente 409.
Aceita apenas type (DESVIO, INCIDENTE, RECLAMACAO_CLIENTE), projectCode OU projectId,
eventDate (data válida YYYY-MM-DD), description, impact (ALTO/MEDIO/BAIXO),
actionOwnerEmail e externalRef {system, url HTTP(S), reference}. Todos obrigatórios.
origin enviado é rejeitado; servidor fixa OMNI. Projeto precisa existir e estar no
recorte. Email resolve univocamente User ativo; ausência/ambiguidade retorna 422.
Cria EM_TRIAGEM sem natureza, FK actionOwnerUserId e actionOwner textual compatível.
ExternalRef é interna, sem ampliação automática da projeção de leitura.
Auditoria comum registra criação, credencial e origem OMNI na mesma transação;
evento qualidade.criado é gravado pelo banco.

```json
{"id":"qualidade-ficticia","number":"D-012/26","status":"EM_TRIAGEM","createdAt":"2026-10-28T12:00:00.000Z"}
```

Erros: 400 validação/chave ausente ou inválida, 403 escopo/recorte, 404 projeto
indisponível, 409 IDEMPOTENCY_CONFLICT, 422 ACTION_OWNER_NOT_FOUND. Cotas existentes.
Repetir POST após falha de rede/5xx usando exatamente a mesma chave e corpo.


## Entrega B

Contrato aditivo em [delivery-b.md](delivery-b.md): medição, notas, romaneios,
pendências e descarga/CT-e. Sem alteração dos contratos anteriores de escrita.
