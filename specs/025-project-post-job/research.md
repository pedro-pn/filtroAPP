# Research: Pós-job e fechamento técnico

## Fontes existentes

- O módulo Qualidade já possui o tipo `LICAO_APRENDIDA`, numeração anual, pesquisa textual, filtro por projeto e exclusão lógica.
- `ProjectPlannedService.serviceType` representa o serviço vendido e pode identificar históricos semelhantes.
- O Kanban gerenciado usa `ProjectWorkflow.stage`; a missão oficial já usa `FINAL_MEASUREMENT` depois da execução.
- Checklists existentes guardam situação, observação, autoria e data.

## Decisões

1. Manter feedbacks e aprendizados estruturados no projeto e sincronizar a síntese da lição com Qualidade.
2. Usar até dez históricos relacionados, excluindo o projeto atual.
3. Considerar correspondência por cliente sem diferenciar maiúsculas e por interseção dos serviços registrados.
4. Exigir o gate completo da desmobilização antes do avanço.
5. Preservar Pós-job como última etapa gerenciada até a entrega de Documentação / medição.
