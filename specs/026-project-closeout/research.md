# Research: Documentação e medição

## Decisões

### Uma única coluna `FINAL_MEASUREMENT`

A coluna já representa Medição final para missões e projetos legados. Ela passa a integrar o workflow gerenciado, evitando duas colunas com o mesmo significado.

### Evidências automáticas sem conclusão automática

RDOs e relatórios existentes indicam o estado documental, mas o sistema não conhece sempre o total contratualmente exigido nem todos os canais de aceite. O painel mostra esses dados como evidência e o Líder confirma os sete controles.

### Dimensões financeiras separadas

- Contrato previsto: orçamento e adicionais selecionados.
- Faturado: recebíveis Omie vinculados.
- Executado, medido e aprovado: registro próprio da gestão do projeto.
- Pendente de aprovação: medido menos aprovado.

Essa separação evita declarar uma medição aprovada apenas porque houve faturamento.

### Dependência futura do CRM

O contrato previsto usa a fonte interna atual. Uma futura integração com CRM poderá atualizar proposta, pedido e valor contratual sem alterar o modelo da medição.

## Alternativas descartadas

- Criar uma segunda aba ou um segundo Kanban para fechamento: contraria o fluxo único definido.
- Inferir todos os checklists pelos relatórios: cria falsos positivos quando existem documentos externos ou metas incompletas.
- Usar faturamento como valor aprovado: mistura eventos operacionais e financeiros diferentes.
