# Complemento — desempenho do status da missão 5719

05/11/2026. Responde ao retorno de produção adicionado ao prompt do Omni.

## Causa confirmada localmente

A leitura da base local foi executada em transação somente leitura. A 5719 tem
135 RDOs, 89 relatórios técnicos, 46 registros históricos e 20 serviços previstos
com **297 linhas de escopo**. As fontes resultam em 133 serviços em 63 datas.
Os dois escopos e três equipamentos geram **11 recortes** de avanço.

O status precisava apenas do percentual e método atuais, mas usava o pacote
completo de avanço: recalculava o avanço em cada data e repetia a reconstrução
para os 11 recortes. O processamento desse pacote levou cerca de 3,6–4,0 s;
os gates levaram 46–95 ms. Na 5775, com duas linhas de escopo e nenhum recorte,
o pacote levou 18–30 ms. O custo extra está na reconstrução de históricos e
recortes, não em uma nova consulta por projeto.

## Alteração

Os status individual e em coleção usam `currentOnly` no mesmo
`computeProgressDetailsForProjects`. A agregação conserva a seleção das fontes,
as datas, a ordem de acumulação, os pesos, as correções e os históricos importados.
Calcula o avanço final uma vez, sem montar históricos de saída ou recortes, e
dispensa a consulta ao histórico manual que não participa do avanço atual.

O comportamento padrão do pacote completo, usado pelo Acompanhamento, custos,
semanas e divisões, foi preservado. Não há condição especial para o ID da 5719
nem cache novo.

## Medições locais

| Caminho | Antes | Depois |
| --- | ---: | ---: |
| Status individual da 5719 | 3.260 ms | 85 ms |
| Cálculo com fontes já carregadas | 3.979 ms | 24 ms |
| Enriquecimento da mesma página de 83 projetos | 7.158 ms | 1.605 ms |

A coleção com `limit=100`, incluindo a 5719, levou **1.442 ms**. A comparação
da página usou o código anterior da versão publicada e o novo código na mesma
base e transação somente leitura: todos os campos dos 83 resumos permaneceram
iguais, inclusive gates e avanço. Essas medições são locais; o resultado de
produção deve ser conferido após publicar esta otimização.

## Regressões

- Escopo com 297 linhas, 133 fontes, 63 datas e 11 recortes: avanço atual igual
  ao pacote completo, sem consultar o histórico manual; limite de 1 s para
  o cálculo atual nessa fixture.
- Fontes sem data, serviços em aberto, relatórios derivados, percentuais acima
  de 100%, avanço manual, zero e `null`.
- Histórico importado e correções posteriores à assinatura mantêm a paridade.
- Coleção com `limit=100`: fontes em lote e igualdade com status individual,
  workflow e custos; nenhuma consulta ao histórico manual.
- Teste de escopo denso incluído no job Omni do CI.

Validação local com Node 22: **2.677 aprovados, 38 ignorados e nenhuma falha**
na suíte completa do backend. Arquitetura e `git diff --check` aprovados.
O cenário HTTP de 90 projetos e 600 RDOs respondeu em 227,5 ms, com 40 SELECTs,
o mesmo total com páginas de 10.

Não exige migração nem mudança no consumidor Omni.
