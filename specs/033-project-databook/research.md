# Research

Pesquisa delegada somente leitura conforme speckit-plan, grafo antes da fonte.

- Decision: fontes por reportDate UTC e min/max dos tipos RDO, RDO_MAINTENANCE e RDO_PRODUCTION não excluídos. Rationale: padrão completo independente da paginação e da data contratual. Alternative: início/fim do workflow não reflete registros reais.
- Decision: adapter mínimo exportando include/downloader oficial de reports.js. Rationale: preserva versões/hash/assinaturas e fallback de cache. Alternative: renderização nova perderia evidência. Registrar efeitos de cache/reconciliação já presentes no downloader.
- Decision: fotos do JSON e tabelas de anexo, com chave por relatório/serviço/path. Rationale: dados legados e ordem original; seleção não altera originais. Alternative: só tabela perde anexos.
- Decision: estoque de todo projeto como candidatos com movimentos do período identificados, escolha FDS explícita por produto e confirmação de uso/correspondência. Rationale: transferência não comprova consumo e StockItemDocument não classifica FDS.
- Decision: incluir documentos técnicos correntes selecionados; links externos apenas no manifesto. Rationale: não expor contrato/proposta comercial automaticamente nem executar fetch externo.
- Decision: histórico interno por família/etapa; uma revisão por tarefa persistida. Rationale: pacote concluído imutável, outra etapa independente, retry de falha sem destruir anterior.
- Decision: leitores internos RDO coordenador e Efetivo/Acompanhamento; emissão ADMIN ou manager dos módulos. Rationale: booleano canManage do Acompanhamento também inclui viewer, portanto autorização específica no backend.
- Decision: compartilhamento manual por PDF/ZIP. Rationale: não inventar entrega/aceite nem expor pacote a cliente antes de fluxo de publicação definido.
- Decision: integrar Gestor ativo/arquivado, detalhe do Acompanhamento e closeout do Efetivo. Rationale: mesma UI e datas agregadas, sem depender de projeto ativo/fechado.
