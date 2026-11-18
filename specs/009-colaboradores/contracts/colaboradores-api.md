# Contract — API Colaboradores (Acompanhamento)

Todas as rotas exigem `requireAuth` + `requireAcompanhamentoManager` (manager-only, FR-015).
Entrada validada com Zod no backend (Princípio III). Respostas em pt-BR onde houver rótulo.

## GET /api/acompanhamento/colaboradores

Indicadores de produtividade + Taxa Geral + alocação, para o ano.

**Query params**
| Param | Tipo | Default | Regras |
|-------|------|---------|--------|
| `year` | int | ano corrente | 2000–2100 |
| `q` | string? | — | filtro por nome/código (opcional) |
| `disponivel` | bool? | — | quando `true`, filtra só disponíveis (situação atual = sede) |

**200 — resposta**
```json
{
  "year": 2026,
  "refMensal": 161,
  "taxaGeral": 0.18,
  "colaboradores": [
    {
      "collaboratorId": "ckxyz...",
      "code": "0123",
      "name": "Fulano de Tal",
      "role": "Encanador",
      "isOperational": true,
      "totalHHprodutivas": 1450.5,
      "mesesAtivos": 10,
      "mediaMensal": 145.05,
      "taxaIndividual": 0.099,
      "porMes": [
        { "mes": "2026-01", "hhProdutivas": 150.0, "acimaDaRef": false }
      ],
      "alocacao": {
        "situacaoAtual": "alocado",
        "projetoAtual": "Obra X",
        "disponivel": false,
        "periodos": [
          { "projeto": "Obra X", "inicio": "2026-05-02", "fim": "2026-07-20" }
        ]
      }
    }
  ]
}
```

**Regras de cálculo (espelham data-model.md)**
- `totalHHprodutivas` = Σ `monthly[YYYY-MM].normalMinutes` do ano ÷ 60 (extras excluídas).
- `mesesAtivos` = nº de meses do ano com registro de ponto (mês parcial = 1).
- `mediaMensal` = `totalHHprodutivas / mesesAtivos`.
- `taxaIndividual` = `max(0, (161 − mediaMensal) / 161)`.
- `taxaGeral` = média das `taxaIndividual` dos operacionais com `mesesAtivos > 0`.
- Apenas colaboradores **operacionais** entram em `taxaGeral`; administrativos podem aparecer na lista marcados `isOperational=false` mas **não** contam na taxa (definir na UI se são ocultados por padrão).

**Erros**
- `401/403` — sem sessão ou não é manager.
- `400` — `year` inválido.
- `200` com `colaboradores: []` e `taxaGeral: null` — sem dados de ponto no ano (estado vazio, FR-014).

## PUT /api/acompanhamento/custo/cargos/:id  *(estender endpoint de JobRole existente)*

Inclui a flag operacional na gestão de cargos usada pelo `JobRoleManager`.

**Body (Zod)**
```json
{ "isOperational": true }
```
- Reutiliza o endpoint/rota já existente de gestão de `JobRole` (não criar rota nova só para o toggle). Confirmar o path real do endpoint de cargos na implementação e adicionar o campo ao schema Zod existente.

**200** — cargo atualizado. **403** — não manager. **400** — corpo inválido.

## Notas de implementação
- Reutilizar `mergePontoPeriods`, `rdoDataByCollaboratorFromReports` e a classificação diária de `labor-cost.js`; não duplicar o cruzamento ponto × RDO.
- A rota apenas orquestra e valida; o cálculo vive em `collaborator-productivity.js` (funções puras testáveis).
