# Volume para dosagem de limpeza química — LEC v1.3

Fonte conferida: `LEC - v1.3.xlsm`, aba `CUSTO.Produtos`.
SHA-256: `cd21685dd1cd63b11874d00d88b6f95e4c6c5d299fd7b78e75d73e6eb3473931`.
As fórmulas foram lidas diretamente do XML do arquivo, sem executar macros.

## Regras da planilha

| Material | Faixa de diâmetro | Reservatório | Mangueiras | Células |
| --- | --- | ---: | ---: | --- |
| Carbono | Até 3″ | 120 L | 50 L | O43 / R43 |
| Carbono | Acima de 3″ até 8″ | 240 L | 100 L | O44 / R44 |
| Carbono | Acima de 8″ | 1.000 L | 200 L | O45 / R45 |
| Inox | Até 3″ | 120 L | 50 L | O47 / R47 |
| Inox | Acima de 3″ até 8″ | 240 L | 100 L | O48 / R48 |
| Inox | Acima de 8″ | 1.000 L | 200 L | O49 / R49 |

- `L40` orienta desmembrar em sistemas de até 50 metros.
- `L43:L45` e `L47:L49` são entradas manuais de quantidade de sistemas.
- `T43 = (L43*O43)+(L43*R43)`, repetido nas demais bombas.
- `I43 = 3,14 × (E43/1000)² / 4 × G43 × 1000`, repetido nas tubulações.
- `L65 = SUM(T43:U45,I97)` e `L68 = SUM(T47:U49,I155)` somam as bombas e os tubos.
- `B8 = L65` e `D8 = L68` alimentam a dosagem de produtos.

## Automatização no aplicativo

Dentro de cada circuito, apenas tubos com limpeza química são agrupados por
material e faixa da bomba. Soma-se `quantidade × comprimento` antes de calcular
`ceil(comprimento / 50)`. Materiais, faixas e circuitos distintos não compartilham
o arredondamento. Esta seleção automática substitui a entrada manual da planilha.

O volume para dosagem é a soma de tubos (π = 3,14, como na LEC), reservatórios das
bombas, mangueiras e volumes informados em outros sistemas com limpeza química.
O preenchimento percentual afeta só o tubo; ciclos multiplicam toda a solução
uma única vez. Linhas zeradas não acrescentam bombas. Material “Outro” em tubo
químico exige correção na própria linha: não se presume uma bomba compatível.

Reservatórios e equipamentos avulsos não têm comprimento/diâmetro para escolher
essa bomba: contribuem com `quantidade × volume` informado, sem acréscimo automático.
Não são criados equipamentos nem custos de locação pelo número de sistemas.

O volume geométrico do circuito e o cálculo de efluente permanecem separados e
inalterados. A seleção de circuito do produto, perdas, densidade, embalagem e
dosagem manual permanecem com as regras existentes. A memória LEC fica visível
em Produtos químicos e também na planilha exportada.

Levantamentos anteriores sem cadastro de serviços conservam o cálculo antigo.
Os que têm limpeza química explicitamente selecionada recebem o novo cálculo.

Exemplo: 50 m de tubo de 2″ → 101,29012 L de tubo + 120 L de reservatório +
50 L de mangueiras = **271,29012 L para dosagem**, por ciclo.

## Diâmetros

`B57:B85` e `B115:B143` trazem 1/2″, 3/4″, 1″, 1 1/4″, 1 1/2″, 2″,
2 1/2″, 3″ e todos os inteiros de 4″ a 24″. A lista compartilhada do app
passa a conter todos eles, sem retirar os diâmetros menores e 3 1/2″ já existentes.
As linhas anteriores da planilha são medidas em **mm**, não novas polegadas.

Motor: `shared/comercial/src/chemical-cleaning.ts`.
Regressões numéricas: `backend/test/comercial-volume-quimico.test.js`.
