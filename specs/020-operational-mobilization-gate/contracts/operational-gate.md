# Contract: controle operacional da mobilização

## Decisão interna

```json
{
  "projectId": "project-1",
  "enforced": true,
  "allowed": false,
  "status": "BLOCKED",
  "authorizationStatus": "SUSPENDED",
  "blockers": [{ "key": "QSMS_VERIFICATION_NOTE", "label": "QSMS", "reason": "Registrar o que foi verificado" }]
}
```

Projeto sem workflow retorna `enforced: false`, `allowed: true` e `status: LEGACY_NOT_ENFORCED`.

## Erro HTTP

Status `409`:

```json
{
  "error": "A mobilização deste projeto não está autorizada. Resolva os bloqueios na Gestão de Projetos.",
  "code": "PROJECT_MOBILIZATION_NOT_AUTHORIZED",
  "issues": [{ "message": "Liberação de QSMS confirmada: Pendente" }]
}
```

## Operações protegidas

- Missão oficial mudando para `MOBILIZATION` ou `EXECUTION`.
- Criação ou atualização de romaneio `OUTBOUND`.
- Movimento de estoque `USO_EM_PROJETO`.
- Integração automática de estoque de romaneio `OUTBOUND`.
