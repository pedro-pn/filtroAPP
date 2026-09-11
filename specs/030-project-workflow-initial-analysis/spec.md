# Refinamento da análise inicial

## Objetivo

Adequar a análise inicial ao uso operacional, removendo confirmações redundantes, exibindo datas comerciais vindas do CRM e registrando o contato inicial com o cliente de forma estruturada.

## Requisitos

1. Remover da análise inicial as confirmações de revisão das propostas técnica e comercial, entendimento de escopo e quantitativos, premissas e exclusões.
2. Substituir a confirmação genérica de datas por dois campos de data somente para leitura: mobilização estimada e início estimado, ambos reservados à sincronização do CRM.
3. Manter como checklists operacionais somente responsabilidades Filtrovali/cliente e dúvidas comerciais levantadas/esclarecidas.
4. Substituir o checklist genérico de contato por uma pergunta Sim/Não.
5. Quando o contato tiver sido realizado, exigir nome e data do contato.
6. Salvar a resposta e os dados do contato sem botão de salvamento.
7. Remover o campo Área da edição de pendências, preservando internamente a área definida pela origem da pendência.
8. Garantir que campos, seletores e ações dos demais checklists não ultrapassem a largura dos cards.

## Critérios de aceite

- Registros antigos dos checklists removidos não aparecem nem participam do gate da análise.
- A ausência das datas do CRM não cria uma pendência operacional.
- A análise exige que o Líder responda se houve contato inicial.
- Uma resposta positiva sem nome ou data é rejeitada.
- A edição de pendência não permite alterar sua área de origem.
- Os checklists permanecem legíveis no diálogo e em telas pequenas.
