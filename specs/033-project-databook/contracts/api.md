# Databook API

Base /api/rdo/projects/:projectId/databooks; mesmos endpoints via /api/projects.

- GET /: histórico sanitizado, permissões e defaults min/max RDO (null se ausente).
- GET /sources?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD: fontes do período inclusivo, candidatos químicos e documentos técnicos.
- POST /: {title,startDate,endDate,summary,productsReviewed:true,reportIds,photos:[{key,caption,tag,phase}],products:[{itemId,documentId,revision,confirmed:true}],documentVersionIds,previousId?}. Retorna 202 com tarefa. previousId cria próxima revisão da família, outra chamada independente cria outra etapa. Validação estrita, seleções limitadas/vínculos checados. Conferência global de produtos obrigatória mesmo com seleção vazia.
- POST /:id/retry: FAILED→PENDING, snapshot/fonte revalidada; não muda pacote concluído.
- GET /:id/pdf e /:id/zip: somente COMPLETED, autenticação/alcance, hash verificado, no-store; download com nome seguro.
- GET /photos/:key?reportId=...&startDate=...&endDate=...: miniatura protegida da fonte validada, carregada sob demanda.
- GET /stock-documents/:id: PDF protegido vinculado a produto movimentado no projeto.

HTTP: 400 entrada inválida; 403 alcance/perfil; 404 projeto/registro/arquivo; 409 revisão/estado/fontes divergentes; 422 fontes incompletas; 413 volume excessivo. Sem rotas públicas por token e sem paths internos na serialização.
