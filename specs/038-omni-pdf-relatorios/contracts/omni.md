# Contrato Omni

Contrato executável: `specs/015-api-token-playground/contracts/openapi.yaml`, versão 1.14.0.

- GET /api/integracoes/v1/rdo/relatorios/:id/pdf: rdo.relatorios.read + rdo.relatorios.pdf.download (PERSONAL).
- GET /api/integracoes/v1/rdo/relatorios: campo pdf apenas com o novo escopo; todos.read preserva política atual de estados.
- GET /api/integracoes/v1/colaboradores: emailCorporativo/userId apenas com colaboradores.contato_corporativo.read (PERSONAL), dependente de colaboradores.operacional.read.
- Documento pronto: 200 application/pdf, Content-Length, Content-Disposition seguro, no-store, nosniff.
- Ausente/invisível/caminho inválido: 404. Sem preparação/frescor/hash: 409 PDF_NOT_READY com Retry-After: 30. Grande: 413 FILE_TOO_LARGE. Projeto externo ao token: 403 PROJECT_NOT_ALLOWED.
- RDO_MAINTENANCE: 404 no PDF do relatório; descobrir pdf.maintenanceAttachmentIds e usar /manutencao/anexos/:id/download com base + metadata + download de manutenção.
