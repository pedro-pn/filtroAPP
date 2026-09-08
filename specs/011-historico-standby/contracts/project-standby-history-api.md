# API Contract: Histórico de standby do projeto

## GET `/api/acompanhamento/comercial/projetos/:projectId/standby-historico`

Retorna o histórico diário de standby de um projeto individual.

### Autorização

- Sessão autenticada obrigatória.
- Mesmo acesso ao módulo de Acompanhamento exigido por `projetos-cards` e `detalhe`.

### Parâmetros

| Nome | Local | Tipo | Regras |
|------|-------|------|--------|
| `projectId` | path | string | Obrigatório, sem espaços nas extremidades, 1–200 caracteres |

### Resposta 200

```json
{
  "project": {
    "id": "project_123",
    "code": "MISSÃO-42",
    "name": "Filtragem da unidade"
  },
  "entries": [
    {
      "date": "2026-08-24",
      "standbyMinutes": 150,
      "collaboratorCount": 6,
      "reason": "Aguardando liberação do cliente"
    }
  ]
}
```

### Invariantes da resposta

- `entries` contém somente itens com `standbyMinutes > 0`.
- Existe no máximo uma entrada por `date`.
- `entries` está ordenado por `date` decrescente.
- `collaboratorCount` é `null` quando o relatório não preserva efetivo suficiente para uma contagem factual.
- `reason` é `null` quando nenhum motivo foi registrado.
- Um projeto sem standby retorna `entries: []`, não 404.

### Erros

| Status | Condição | Corpo esperado |
|--------|----------|----------------|
| 400 | `projectId` inválido | Erro de validação padronizado |
| 401 | Sessão ausente ou inválida | Erro de autenticação padronizado |
| 403 | Usuário sem acesso ao Acompanhamento | Erro de autorização padronizado |
| 404 | Projeto inexistente ou excluído | `{ "error": "Projeto não encontrado." }` |

### Compatibilidade

O endpoint é aditivo. Nenhum campo de `GET /projetos-cards` é alterado e não há mudança de schema ou escrita de dados.
