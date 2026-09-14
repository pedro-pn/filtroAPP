# Escopo e avanço por equipamento/UG e sistema do cliente

No **Cronograma → Serviços previstos**, preencha **Equipamento do cliente / UG** e **Sistema do cliente**, além do tipo de medição, bitola, unidade e quantidade. Cada combinação de UG e sistema recebe uma identidade estável no projeto. Salvar novamente o cronograma conserva essa identidade; remover uma meta não apaga os vínculos anteriores. Não existe vínculo com o cadastro dos equipamentos da empresa.

## Uso

1. Lance uma linha por serviço, UG, sistema e bitola. Para óleo, informe a meta em litros. Para tubulação, em metros. Para limpeza química sem tubulação, escolha **Sistemas completos (unidades)** e informe uma quantidade inteira positiva, sem bitola. O detalhe/trecho é descritivo, não uma segunda identidade.
2. Salve o escopo. Na criação e edição de relatórios, use a seta nos campos de equipamento e sistema para abrir as listas do **escopo atual**, ou digite para pesquisar. Nomes sem metas atuais não aparecem nas sugestões; seus cadastros e vínculos antigos são preservados. Os sistemas são filtrados pelo equipamento/UG informado. No cronograma em edição, as sugestões acompanham as linhas atuais do formulário, inclusive inclusões e remoções ainda não salvas. A digitação livre continua disponível; nomes novos não criam metas automaticamente. Se a lista estiver vazia, confira o projeto, o escopo salvo e o nome do equipamento/UG; falhas ao carregar são sinalizadas no campo.
3. Em **Acompanhamento → projeto → Previsto × realizado por UG e sistema**, confira as metas, realizados e pendências. O filtro de UG muda as linhas exibidas, não o percentual geral.
4. No cronograma, abra **Correspondência de nomes antigos** para confirmar equivalências como `UG01 / RV` → `Unidade Geradora 01 / Regulador de velocidade`. Uma equivalência só vale no mesmo projeto, para aquele equipamento original, nome e tipo de serviço. Pode ser removida depois.
5. Quando a correspondência depende de uma linha específica, use **Upload de relatórios antigos → Serviços históricos → Sistema no acompanhamento**. Salve o vínculo da medição. Ele tem precedência sobre a equivalência de nome e não altera o texto original, a quantidade, a data, o PDF ou as assinaturas.

Um nome composto, por exemplo “Mancais superior e inferior”, não é dividido automaticamente. Mantenha a medição pendente até identificar o escopo correto. Se a documentação permitir repartir a quantidade, edite as linhas do levantamento com essa divisão antes de associar; não atribua o total integral a cada sistema.

### Limpeza química de sistemas completos

Ao selecionar no relatório uma UG/sistema com escopo de limpeza exclusivamente em unidades, **Limpeza de tubulação?** passa para **Não**. Aparece apenas **Quantidade executada (unidades)**; o nome utilizado é o do campo **Sistema** no início do relatório, sem um segundo campo de nome. A quantidade fica vazia para preenchimento pelo colaborador; a meta nunca é copiada como realização. Se o mesmo sistema tiver metas em metros e unidades, escolha explicitamente Sim/Não conforme o serviço executado.

Também é possível marcar Não e digitar um sistema livremente. Informar nome e quantidade inteira positiva é obrigatório ao salvar. Alternar a modalidade limpa as medições da modalidade anterior. O RLQ gerado apresenta uma tabela **Sistema / Quantidade (un)**, sem diâmetro/comprimento. Relatórios antigos sem quantidade permanecem legíveis e não recebem uma unidade presumida; ao editá-los, complete a medição.

Na importação de serviços históricos, use `UN`, `unidade` ou `unidades`, quantidade inteira e diâmetro vazio, somente para limpeza química/RLQ. Unidades e metros do mesmo relatório são tratados separadamente. Não são criadas horas de trabalho nem alterados PDFs históricos.

## Regras do cálculo

- Normalização automática conservadora: maiúsculas/minúsculas, acentos e espaços. Abreviações e outras diferenças precisam de conferência; não há correspondência aproximada.
- Vínculo por projeto, equipamento/UG, sistema, serviço, tipo de medição e bitola. Uma medição alimenta no máximo uma meta. Linhas previstas da mesma identidade/bitola somam as metas.
- Metas sem bitola representam o restante sem discriminação de bitola. Quando houver também uma meta de bitola específica, ela tem prioridade; o mesmo metro não entra nas duas.
- Tubulação em `cm` é convertida para `m`; óleo em `mL`, para `L`. Diâmetro em `mm` e nominal em `pol` não são equiparados. Frações e decimais equivalentes na mesma unidade são comparáveis.
- Dentro de cada serviço, a execução de cada tipo de medição (metros, litros ou unidades) é proporcional ao seu quantitativo previsto, limitando o realizado à meta de cada linha antes da soma. Quando houver mais de um tipo de medição, usa-se a média de suas execuções, nunca a soma de metros com unidades/litros. O avanço geral respeita os pesos dos serviços. Serviços não finalizados não entram no realizado.
- Os históricos usam a data de emissão. A curva semanal e o ritmo necessário usam os mesmos vínculos do avanço atual. Relatórios derivados e históricos em conflito continuam excluídos para evitar duplicação.
- Escopos antigos sem UG/sistema mantêm o cálculo global anterior. Não é permitido misturar meta global com metas por sistema para o mesmo serviço/tipo de medição. Converta todas as linhas desse conjunto juntas.
- Associação de medição não muda o fingerprint do CSV: reenviar o levantamento idêntico continua sem duplicar dados. Ao editar o histórico, vínculos de medições inalteradas são preservados; mudanças de nome/quantidade/bitola pedem nova conferência.

## Projeto 5719 — todas as UGs

Referência: proposta técnica 3670, revisão 3, seção Ilha Solteira. A seção de Jupiá não faz parte deste cadastro.

| Equipamento do cliente | Sistemas a cadastrar conforme o levantamento |
| --- | --- |
| Unidade Geradora 01 | Mancal de escora; Mancal de guia inferior; Mancal de guia superior; Regulador de velocidade; Comporta de emergência |
| Unidade Geradora 02 | Mancal de escora; Mancal de guia inferior; Mancal de guia superior; Regulador de velocidade; Comporta de emergência |
| Unidade Geradora 14 | Mancal de escora; Mancais de guia; Regulador de velocidade; Comporta de emergência |

A proposta reúne tabelas de UG 01/02 e de UG 01/02/14, e volumes de óleo agrupados. A implantação **não cria nem distribui automaticamente essas quantidades**. Confirme o rateio antes de preencher as metas; não repita o total em cada UG ou em cada mancal. Também não inventa metas de teste de pressão onde não há quantitativo confirmado.

## Implantação e testes

A migração `20260914180000_project_service_systems` cria `ProjectServiceSystem` e um vínculo opcional no escopo previsto. Aplicar pelo fluxo normal de `prisma migrate deploy`, gerar o cliente Prisma e publicar backend/frontend juntos. É aditiva: não reescreve relatórios existentes nem exige script de correção de nomenclatura em produção. A correção específica de data do RLQ 017 continua sendo um procedimento separado.

Testes: `backend/test/project-service-systems.test.js`; integração HTTP/PostgreSQL em `backend/test/project-service-systems.integration.test.js`, opt-in com `SYSTEMS_TEST_DATABASE_URL` apontando exclusivamente para banco com nome terminado em `_test`, previamente migrado. Também executar as suítes de avanço, históricos, catálogo da API e frontend. O cadastro novo está classificado como reservado, sem publicar endpoint para tokens externos.
