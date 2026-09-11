# Refinamento do handover e da documentação antecipada

## Objetivo

Adequar o detalhe da gestão ao uso real: dados do Comercial são sinais de consulta vindos do CRM; o handover não replica esses sinais como pendências; requisitos documentais são acompanhados individualmente; checklists operacionais salvam automaticamente.

## Requisitos

1. Liberação comercial e contratual não oferece campos de confirmação no FiltroAPP, não cria pendências e não bloqueia planejamento, compra, contratação ou mobilização.
2. Os oito sinais comerciais continuam visíveis com origem, evidência e data quando recebidos do CRM.
3. Handover mostra projeto, líder, grupo de WhatsApp, participantes, propostas, anexos de origem, contato, data esperada, prazo e premissas como informações de consulta.
4. Propostas e documentos sincronizados pelo CRM aparecem por meio do catálogo de documentos do projeto.
5. A data esperada e o prazo comercial têm campos próprios, separados da mobilização operacional.
6. Documentação antecipada possui os tipos documentos/cadastros, exames, treinamentos e certificações. Para cada tipo, o planejador responde se ele é necessário.
7. Um tipo necessário aceita vários itens nomeados. Cada item possui situação pendente, solicitado ou confirmado, data da solicitação e data da confirmação.
8. Alterações dos itens documentais guardam autor, momento e valores anteriores e posteriores.
9. O tipo só fica concluído quando não é necessário ou quando todos os seus itens estão confirmados com as duas datas.
10. Os checklists operacionais salvam a situação ao selecionar e a observação ao sair do campo, sem botão Salvar.

## Critérios de aceite

- O Líder pode assumir o handover sem preencher sinais comerciais.
- Sinais comerciais incompletos não aparecem entre os bloqueios do gate de mobilização.
- Um tipo documental não respondido aparece em andamento e fica crítico a até 15 dias da mobilização.
- Um item confirmado sem as datas exigidas é rejeitado pelo servidor.
- O histórico permite consultar quando o item foi criado, solicitado e confirmado.
- Registros antigos de checklists removidos permanecem no banco, mas não são exibidos nem considerados pelos gates.
