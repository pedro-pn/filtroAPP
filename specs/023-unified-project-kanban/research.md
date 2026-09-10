# Pesquisa: Kanban único de projetos

## Decisões

### Projeto como registro mestre

`ProjectWorkflow.stage` é a etapa canônica dos projetos que aderiram à gestão. Isso preserva checklists, gates, pendências, autorização e histórico no mesmo agregado.

### Missão como configuração operacional

`EfetivoMissionPlan` continua guardando equipe, ciclos, datas e confirmação. Sua etapa é sincronizada quando o projeto entra em Mobilização ou Execução porque Estoque, Romaneios e regras legadas ainda consultam essa projeção.

### Compatibilidade com projetos antigos

Um projeto sem workflow não recebe gestão implicitamente. A missão oficial existente determina apenas sua coluna visual no Kanban unificado. A adoção continua explícita pelo início do handover.

### Consistência

A alteração do workflow e a projeção da missão usam a mesma transação. A API antiga de mudança da etapa da missão recusa alterações para projetos gerenciados, eliminando duas fontes de verdade.

## Alternativas descartadas

- Duas abas de Kanban: criavam dois andamentos visuais para o mesmo projeto.
- Remover imediatamente a etapa da missão do banco: quebraria integrações operacionais já existentes.
- Criar workflows para todo o legado: presumiria handover, aceite e autorização sem evidência.
