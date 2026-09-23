# Implementation Plan: Pós-job e fechamento técnico

## Decisão

`ProjectWorkflow.stage` ganha `POST_JOB`. A missão oficial permanece projetada em `FINAL_MEASUREMENT`, pois a operação de campo já terminou e a medição operacional não deve criar outro card.

Os dados estruturados ficam em `ProjectWorkflowPostJob`, um registro único por projeto. Quando há texto em lições aprendidas, o serviço cria ou atualiza um `QualityRecord` do tipo `LICAO_APRENDIDA` na mesma transação. O histórico relacionado usa o cliente do projeto e o snapshot dos tipos de serviço do escopo planejado.

## Alterações

1. Estender enum, contratos compartilhados, Prisma e migration.
2. Adicionar duas seções e nove itens de checklist do pós-job.
3. Implementar gate de saída da desmobilização e retorno controlado.
4. Persistir o formulário estruturado com versão e auditoria.
5. Sincronizar a lição aprendida com Qualidade.
6. Expor históricos relacionados por cliente e serviço.
7. Renderizar coluna, progresso, formulário e histórico no Kanban único.
8. Cobrir regras, sincronização, serviço e interface com testes.

## Constitution Check

- UI em pt-BR, modal rolável e layout responsivo preservados.
- Formulário usa RHF e schema Zod compartilhado com o backend.
- Modelo novo é entregue por migration Prisma versionada.
- Escrita do pós-job e da lição é atômica e testada no backend.
- Qualidade continua sendo a fonte dos registros de lições aprendidas.
- A campanha temporária vigente do Kanban é atualizada sem criar sobreposição.

## Riscos e mitigação

- Duplicidade em Qualidade: vínculo único mantém um registro ativo por pós-job.
- Serviço ausente: o nome do projeto é preservado como fallback de escopo.
- Remoção de lição: o registro de Qualidade recebe exclusão lógica e o pós-job perde o vínculo ativo.
- Missão operacional: a projeção continua em Medição final e não altera equipe ou ciclos.
