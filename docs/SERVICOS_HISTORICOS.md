# Serviços históricos

No Painel do gestor, abra **Upload de relatórios antigos** no resumo ou no cartão de um projeto ativo/arquivado e selecione a aba **Serviços históricos**. A aba **PDFs antigos** mantém o envio dos documentos. As duas abas compartilham o projeto selecionado e preservam os dados preenchidos ao alternar entre elas; trocar o projeto reinicia a prévia e o formulário de serviços para evitar lançamentos no projeto errado. Baixe o modelo CSV, substitua os exemplos e importe. A prévia não grava dados; **Confirmar importação** grava o lote inteiro apenas se não houver erros ou conflitos.

Cada linha representa uma medição final de um relatório emitido. As linhas são agrupadas pelo tipo e número do relatório dentro do projeto. Equipamento do cliente e sistema são textos livres, sem vínculo com os equipamentos da empresa. Não são necessárias etapas, horários, colaboradores, RDO ou PDF para cadastrar os quantitativos.

## CSV

Cabeçalho do modelo:

```csv
Relatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro (pol);Quantidade;Unidade
RLQ;001;01/01/2026;Limpeza química;Unidade Geradora 01;Kaplan;2';3500;cm
RLQ;001;01/01/2026;Limpeza química;Unidade Geradora 01;Kaplan;3pol;45;m
RCPU;001;02/01/2026;Filtragem de óleo;Unidade Geradora 01;Kaplan;;5000000;mL
RTP;001;03/01/2026;Teste de pressão;Unidade Geradora 01;Kaplan;2;35;m
RCPU;002;04/01/2026;Flushing;Unidade Geradora 01;Kaplan;3;45;m
```

- Relatórios: RLQ para limpeza química; RTP para teste de pressão; RCPU para filtragem de óleo ou flushing, seguindo os tipos existentes no app.
- Datas: DD/MM/AAAA ou AAAA-MM-DD. Todas as linhas do mesmo relatório devem ter a mesma data.
- Diâmetros: em polegadas, como `2`, `2pol`, `2'`, `2"` ou `1 1/2`. Também é aceita uma coluna opcional **Unidade do diâmetro**, com `pol`, `'` ou `"`. No Excel, use formato Texto para preservar frações. Aspas duplas literais precisam do escape normal do CSV, feito pelo próprio Excel ao salvar.
- Comprimentos: `cm` ou `m`. Volumes: `L` ou `mL`. A unidade original fica visível e os totais são convertidos para metros/litros.
- Limpeza e teste de pressão usam comprimento; filtragem usa volume; flushing aceita ambos. Deixe o diâmetro vazio nas linhas de volume.
- Quantidade positiva, sem unidade na célula; aceita vírgula decimal (`35,5`, `1.234,5`) ou ponto decimal (`35.5`). Não use separador de milhar sem vírgula decimal: `3500` é preferível a `3.500`.
- Uma medição por relatório/serviço/equipamento/sistema/diâmetro. Linhas repetidas são rejeitadas; consolide sua quantidade.
- Separador ponto e vírgula ou vírgula, campos entre aspas, UTF-8 com/sem BOM e arquivos do Excel em Windows-1252. Limites: 500 KB, 2.000 linhas e 500 relatórios por lote.

## Consulta e correção

O histórico permite filtrar por serviço, período e texto (equipamento, sistema, diâmetro e relatório), com totais separados por serviço e unidade. **Adicionar relatório** permite lançar medições sem CSV. **Editar** substitui as medições do relatório, com controle de revisão para impedir perda de alterações simultâneas.

Reenviar dados iguais não duplica registros, inclusive quando o arquivo troca cm por m ou mL por L equivalentes. Dados diferentes para um relatório já importado geram conflito e devem ser corrigidos pelo histórico. A identidade é protegida por uma restrição única no banco e cada lote é transacional.

Se existir um relatório no app com o mesmo projeto/tipo/número, ele aparece como documento de origem. A data é conferida. Relatórios com serviços próprios ou derivados de RDO bloqueiam a importação para evitar contagem dupla. Se esses serviços forem cadastrados depois da importação, passam a prevalecer nos totais de avanço; o histórico sinaliza o conflito. O PDF original e sua assinatura não são modificados.

## Reflexo no Acompanhamento

As medições históricas entram no **realizado dos serviços**, no cálculo do **percentual de avanço** e na **curva histórica semanal** do Acompanhamento. Cada medição é considerada finalizada na data do relatório informada no CSV, não na data em que foi importada. Comprimentos são somados em metros e volumes em litros.

Para calcular o percentual, o projeto precisa ter **escopo previsto com quantidades**: por exemplo, 1.000 m de limpeza química previstos e 569,12 m realizados representam 56,9% nesse serviço. O avanço geral respeita os pesos dos serviços cadastrados. Sem quantidades previstas, a importação não inventa metas: o módulo mantém o avanço manual, quando existir, ou fica sem percentual calculável. Cadastrar as metas depois permite aproveitar também as medições já importadas.

O cálculo atual é agregado por tipo de serviço e medida (tubulação em m / óleo em L). Equipamento do cliente, nome do sistema e diâmetro ficam no detalhamento da aba **Serviços históricos**, mas não criam automaticamente metas nem curvas separadas por equipamento/sistema/diâmetro no Acompanhamento. A importação de medições não lança horas, custos ou uso dos equipamentos da empresa.

Um relatório histórico em conflito com uma fonte nativa não entra novamente no realizado. Após importar ou editar, reabra/atualize o Acompanhamento para consultar os dados atualizados. Importar somente o PDF, sem informar medições, não acrescenta quantitativos ao avanço.

Para a divergência de data específica do RLQ 017 do projeto 5719, veja [o procedimento de correção manual em produção](CORRECAO_RLQ_017_PROJETO_5719.md).

## Instalação e validação

A migração `20260914150000_add_historical_service_reports` cria uma tabela adicional. No deploy, execute o fluxo habitual de `prisma migrate deploy` e `prisma generate` antes de iniciar o backend novo.

Testes específicos:

```bash
cd backend
node test/historical-services.test.js
# Cálculo do Acompanhamento com consultas simuladas; não se conecta ao banco:
DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:1/historical_unit_test' node test/historical-services-progress.test.js
# Banco isolado, com nome terminado em _test e todas as migrações aplicadas:
HISTORICAL_TEST_DATABASE_URL='postgresql://usuario:senha@localhost:5432/historical_test' node test/historical-services.integration.test.js
```

O teste de integração verifica permissões HTTP, prévia sem gravação, lote inválido sem gravação parcial, reimportação, edição com revisão, concorrência, conversão das unidades e avanço sem duplicar relatórios nativos. O teste `historical-services-progress.test.js` exercita o cálculo dos quatro serviços, os pesos, a curva semanal por data de emissão, o avanço manual sem escopo e o aproveitamento do histórico quando as metas são cadastradas depois. O frontend também possui teste de ida e volta entre formulário e parser CSV em `frontend/test/historical-services-form.test.mjs`.
