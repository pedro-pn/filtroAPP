# Simulação de escritas v1

Aplicável a quality.records.create, acompanhamento.opportunities.post,
efetivo.projects.create, efetivo.projects.commercialFact.post e
efetivo.projects.document.post.

Header de entrada: `Prefer: validate-only` (aceita lista de preferências).
Credencial: `writeMode: LIVE | SIMULATE`. SIMULATE prevalece sobre o cliente.
Header de saída em sucesso/erro simulado: `Preference-Applied: validate-only`.

HTTP 200:
```json
{"simulated":true,"operation":"quality.records.create","would":{"type":"DESVIO","status":"EM_TRIAGEM","origin":"OMNI","projectCode":"05776","actionOwnerUserId":"usuario-existente","eventDate":"2026-10-29","previewNumber":"D-001/26"},"warnings":[],"requestId":"exemplo-ficticio"}
```

Erros mantêm o contrato v1, inclusive idempotência 409 e responsável 422.
501 SIMULATION_NOT_SUPPORTED impede execução sem suporte. Não salvar recibos
simulados. Chaves reais existentes continuam verificadas. Não retornar IDs
temporários de projeto, oportunidade, documento, versão ou registro de Qualidade.

PATCH administrativo: `{ expectedVersion, reason, writeMode }`, sem outros
campos nesse comando. Evento METADATA_UPDATED com modo anterior e novo.
Playground: `writeMode` opcional, padrão SIMULATE; LIVE solicita escrita real
somente quando a credencial também permite. Resposta do console inclui headers.
O contrato OpenAPI completo continua em ../015-api-token-playground/contracts/openapi.yaml.
