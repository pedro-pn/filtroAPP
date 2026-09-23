# Conciliação por medição

Acompanhamento → projeto → Conciliação reúne quantitativos importados e medições de serviços finalizados dos relatórios do app. O upload e o cronograma oferecem atalhos para essa tela, sujeitos à permissão do módulo.

É possível vincular uma linha ou selecionar até 200 linhas. O destino precisa ser compatível com todas as medições do lote: serviço, tipo de medição e diâmetro/unidade. A gravação é atômica e rejeita revisões desatualizadas. A restauração individual remove somente a escolha daquela linha e retoma a identificação original.

## Preservação dos dados

- Os históricos conservam seus vínculos individuais, nomes, quantidades e fingerprints.
- Os RDOs e relatórios independentes usam `ReportMeasurementLink`, separado do conteúdo e dos PDFs. Nenhum serviço é editado para salvar a conciliação.
- As equivalências de nomes existentes continuam válidas como identificação anterior. A nova tela não cria equivalências globais; as sugestões só viram vínculos nas linhas salvas.
- Relatórios derivados de RDO e serviços em andamento não entram na lista de medições realizadas.
- A identidade de uma medição nativa considera serviço, equipamento, nome, tipo, bitola, quantidade, vínculo original e a ocorrência entre repetições idênticas. Reordenar linhas ou recriar IDs de serviço preserva medições equivalentes. Alterar a quantidade ou incluir/excluir uma repetição idêntica exige revisão; o vínculo anterior não é transferido para outra linha. Vínculos sem correspondência são sinalizados.
- O avanço atual e a curva histórica aplicam a mesma conciliação. Abrir a tela ou instalar a estrutura nova não modifica percentuais.

## Publicação

Aplicar a migração `20260916140000_add_report_measurement_links` e gerar o Prisma Client antes de iniciar a versão nova do backend. A migração cria uma tabela vazia e seu relacionamento com `Report`; não transforma nem atualiza os dados existentes. Não há backfill automático.

## Validação

Os testes de `system-reconciliation.test.js` cobrem preservação, lotes mistos, seleção de metas, revisões, permissões, RDOs derivados, reordenação e alterações de quantidade. Os testes da interface cobrem vínculos antigos, consulta sem edição e bloqueio dos atalhos/rotas sem acesso ao módulo.

A migração também foi aplicada a um PostgreSQL 16 descartável com relatórios no esquema anterior. Foram verificados a preservação integral desses relatórios, a reversão de uma falha após a primeira escrita de um lote e o bloqueio de gravações concorrentes desatualizadas.
