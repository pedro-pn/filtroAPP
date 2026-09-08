# API Contract — Módulo de Registros de Qualidade

Base: `/api` (montado em `routes/index.js` como `router.use('/qualidade', qualidadeRouter)`).
Todas as rotas exigem `requireAuth` + `requireQualidadeAccess`. Mutações exigem
`requireQualidadeManager`. Validação de corpo via `shared/schemas/qualidade.js`
(`makeQualidadeSchemas(z)`). Erros em pt-BR, formato `{ error: string }` (padrão do app).

## Registros

### GET /qualidade/registros
Lista paginada. Query: `page`, `pageSize`, `q` (busca em number/descrição/origem), `type`,
`status`, `impact`, `projectId`, `natureId`.
Resposta `200`:
```json
{
  "items": [{
    "id": "...", "number": "D-001/26", "type": "DESVIO",
    "registeredAt": "2026-07-22", "origin": "Reunião semanal Operação",
    "project": { "id": "...", "code": "5794", "name": "..." },
    "eventDate": "2026-07-20",
    "nature": { "id": "...", "name": "Stand By" },
    "description": "...", "impact": "BAIXO",
    "occurrences12m": 3, "recurrent": true,
    "linkedRnc": "-", "disposition": "MONITORAR",
    "definedAction": null, "actionOwner": null, "actionDeadline": null,
    "evidence": null,
    "evidences": [
      { "id": "...", "kind": "LINK", "label": null, "url": "https://..." },
      { "id": "...", "kind": "ATTACHMENT", "label": null, "fileName": "foto.png", "mimeType": "image/png", "publicUrl": "/api/qualidade-anexos/..." }
    ],
    "resultVerification": null, "status": "ABERTO"
  }],
  "page": 1, "pageSize": 50, "total": 1
}
```
`project` = `null` quando Interno/SGQ. `occurrences12m`/`recurrent` são derivados.

### GET /qualidade/registros/:id
Retorna um registro (mesmo shape do item acima). `404` se não existir.

### POST /qualidade/registros  *(manager)*
Corpo (validado por Zod): `type`, `registeredAt`, `origin`, `projectId|null`, `eventDate`,
`natureId`, `description`, `impact`, `linkedRnc?`, `disposition`, `definedAction?`, `actionOwner?`,
`actionDeadline?`, `evidence?` (legado, primeira URL http/https), `evidences?`
(lista com itens `LINK` ou `ATTACHMENT`), `resultVerification?`, `status`.
Regra: se `disposition === "TRATAR"` então `definedAction` é obrigatório (`superRefine`).
Regra: cada item de `evidences` é um link http/https ou um anexo imagem/PDF. É permitido enviar
mais de um link e mais de um arquivo no mesmo registro.
Efeito: gera `number` atômico por (type, year=ano de `registeredAt`). Resposta `201` com o registro.
Erros: `400` validação; `409` colisão de numeração (retry improvável após transação).

Payload de evidências:
```json
{
  "evidences": [
    { "kind": "LINK", "url": "https://exemplo.com/evidencia" },
    { "kind": "ATTACHMENT", "fileName": "foto.png", "mimeType": "image/png", "dataUrl": "data:image/png;base64,..." },
    { "kind": "ATTACHMENT", "fileName": "documento.pdf", "mimeType": "application/pdf", "dataUrl": "data:application/pdf;base64,..." }
  ]
}
```
Na edição, anexos já existentes podem ser mantidos enviando `{ "kind": "ATTACHMENT", "id": "..." }`.

### PUT /qualidade/registros/:id  *(manager)*
Atualiza campos editáveis (todos, exceto `number`/`type`-ano-seq que geram a numeração — `type`
editável **não** re-emite o número na v1; ver Assumptions). Mesma validação do POST. `200`.

> Decisão v1: `type` é imutável após criação (evita re-numeração). O modal de edição desabilita o
> campo Tipo. Alterar tipo = criar novo registro.

### DELETE /qualidade/registros/:id  *(manager)*
Soft delete do registro. `204`. O registro deixa de aparecer nas listagens/exportações, mas é
preservado no banco para recuperação operacional.

### GET /qualidade-anexos/:token
Download público por token aleatório de cada anexo de evidência. Retorna `404` quando o token não existe,
o arquivo não existe ou o registro foi removido via soft delete.

### GET /qualidade/registros/export
Exporta os registros para `.xlsx` (acesso: qualquer papel com acesso ao módulo — é leitura). Aceita
os **mesmos filtros** de `GET /qualidade/registros` (`q`, `type`, `status`, `impact`, `projectId`,
`natureId`) — sem paginação (exporta todo o conjunto filtrado).
Resposta `200`:
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="registros-qualidade-AAAA-MM-DD.xlsx"`
- Corpo: binário do `.xlsx`. Uma linha por registro; colunas na ordem da referência FR-3-4-11-01:
  Nº Registro, Data do Registro, Tipo, Origem, Obra/Projeto, Data do Evento, Natureza, Descrição,
  Impacto, Ocorrências 12m, Recorrente?, RNC vinculada, Disposição, Ação definida, Responsável pela
  ação, Prazo da ação, Evidência, Verificação do resultado, Status. A evidência exporta todos os
  links/URLs dos anexos, um por linha na célula. Datas como texto `dd/mm/aaaa`;
  Obra/Projeto = código/nome do projeto ou "Interno/SGQ"; Recorrente? = "SIM"/"não".

### GET /qualidade/registros/projeto/:projectId/desvios
Atalho para a seção do card do projeto. Retorna somente `type = DESVIO` do projeto, campos enxutos:
```json
[{ "id": "...", "number": "D-001/26", "nature": { "name": "Stand By" },
   "impact": "BAIXO", "status": "ABERTO" }]
```
Array vazio quando não houver.

## Naturezas

### GET /qualidade/naturezas
Query opcional `includeInactive` (default false → só ativas, para o formulário).
Resposta `200`: `[{ "id": "...", "name": "Stand By", "isActive": true, "inUse": true }]`
(`inUse` indica se há registros vinculados — usado para bloquear exclusão na UI).

### POST /qualidade/naturezas  *(manager)*
Corpo: `{ "name": string }`. `name` único case-insensitive. `201`. `409` se duplicado.

### PUT /qualidade/naturezas/:id  *(manager)*
Corpo: `{ "name": string }`. Renomeia. `200`. `409` se duplicado.

### PATCH /qualidade/naturezas/:id/ativo  *(manager)*
Corpo: `{ "isActive": boolean }`. Ativa/desativa. `200`.

### DELETE /qualidade/naturezas/:id  *(manager)*
Exclui **somente** se não houver registros vinculados. `204` ou `409`
`{ "error": "Natureza em uso; desative-a em vez de excluir." }`.

## Enums expostos (para popular selects no frontend)

Podem vir de um endpoint utilitário `GET /qualidade/meta` ou constantes compartilhadas:
`types` (com rótulos pt-BR), `impacts`, `dispositions`, `statuses`.
