# Research: execução do projeto

## Decisões

- **Avanço e prazo**: usar `getProjectDetail` do Acompanhamento e expor somente `diasCorridos`, `avancoPct`, método e datas de término. Isso mantém o mesmo cálculo já visto no dashboard comercial.
- **RDOs**: consultar `Report` não excluído. Recebido significa persistido; liberado ao cliente significa `APPROVED` ou `SIGNED`; assinado significa `SIGNED`. Quantitativos e evidências usam as relações `services` e `attachments`.
- **Relatórios técnicos**: contar automaticamente RTP, RLQ, RCPU, RLM, RLF e RLI. Metas ficam em JSON no workflow porque são um conjunto fixo e pequeno, sem identidade própria.
- **RLR**: manter no painel como entrega planejável com realizado manual. O enum `ReportType` atual não possui RLR, portanto associá-lo a RLM/RLF/RLI produziria uma contagem falsa.
- **Versão do gate**: a transição para execução transporta a autorização para a nova versão. Metas e desvios geram auditoria, mas não incrementam a versão do gate, pois não alteram prontidão de mobilização.
- **Desvios**: criar `QualityRecord` do tipo `DESVIO`. A categoria é a origem e também uma natureza ativa, criada sob demanda quando ainda não existir. O painel não cria tabela paralela.
- **Consulta**: carregar o dashboard somente ao abrir um workflow em execução, evitando ampliar a consulta de todos os cards.
