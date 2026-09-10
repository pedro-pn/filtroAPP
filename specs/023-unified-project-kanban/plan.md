# Implementation Plan: Kanban único de projetos

## Decisão

`Project` permanece o registro mestre e `ProjectWorkflow.stage` passa a comandar a evolução dos projetos gerenciados. `EfetivoMissionPlan` continua sendo a fonte de equipe, ciclos e datas, com seu estágio mantido como projeção operacional sincronizada para compatibilidade com os módulos existentes.

Projetos sem workflow não serão migrados ou autorizados automaticamente. A listagem usa a missão oficial somente para posicioná-los visualmente no fluxo legado até a adoção explícita da gestão.

## Alterações

1. Remover o seletor de duas visões da seção Evolução.
2. Adicionar Mobilização ao workflow compartilhado, Prisma, regras, API e tela.
3. Incluir resumo da missão oficial nas consultas do Kanban mestre.
4. Projetar a etapa de projetos legados a partir da missão oficial.
5. Sincronizar workflow e missão oficial dentro da transação de mudança de etapa.
6. Atualizar gate, Romaneio, testes, documentação e tutorial temporário.

## Riscos e mitigação

- Projetos legados: nenhum workflow ou autorização será criado implicitamente.
- Programação incompleta: bloqueio explícito antes de entrar em Mobilização/Execução.
- Divergência transacional: atualização da missão acontece na mesma transação do workflow.
- Funcionalidades de equipe: permanecem disponíveis na seção Missões e no atalho do modal.
