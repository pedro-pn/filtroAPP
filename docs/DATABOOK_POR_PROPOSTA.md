# Escopo e Data Book por proposta

O mesmo projeto pode ter o escopo da principal e um escopo para cada adicional, inclusive misturando Access e ComercialAPP. O vínculo usa `ORIGEM:numero`, conservado entre revisões; o nome do serviço não identifica a contribuição.

## Uso

1. No acompanhamento, abra o projeto → **Consultar escopo** → **Escopo e execução por proposta**. Em projetos mesclados, o mesmo diálogo tem uma aba para cada projeto, com seu próprio escopo, propostas e serviços. Escolha a proposta para conferir metas e avanço dos serviços aprovados. O escopo consolidado do grupo continua disponível ao final.
2. Em **Vínculos dos serviços**, use a busca por TAG, sistema ou RDO e o filtro **Pendentes** para localizar os registros. Clique em **Vincular proposta** ou **Alterar vínculo**: seleção da proposta e ações aparecem dentro do próprio cartão do serviço. A alteração exige gestor do acompanhamento e versão corrente do relatório. Salve ou cancele antes de trocar de projeto. O vínculo é operacional: não altera o conteúdo nem o PDF aprovado do RDO. Relatórios técnicos derivados acompanham seu serviço de origem.
3. No editor do escopo previsto, **Proposta de origem** permite atribuir um grupo de serviços a um adicional, inclusive Access. A alteração marca somente a contribuição editada como `MANUAL_OVERRIDE`. O ajuste de pesos ocorre dentro da mesma contribuição.
4. No diálogo do Data Book, escolha **Projeto completo**, **Principal** ou um **Adicional**, além do período. Revise a prévia e salve. A proposta, origem e revisão aparecem também no histórico.

## Conteúdo do recorte

O previsto, o avanço anterior ao período e as quantidades do período usam apenas a contribuição escolhida. Entram seus serviços, relatórios técnicos vinculados, fotos de serviço, produtos/FDS e certificados de equipamentos utilizados por esses relatórios. O campo Contrato/Proposta do PDF identifica o número e a revisão escolhidos.

A associação automática usa o cadastro completo, antes do filtro. Quando tipo/sistema podem pertencer a várias propostas, o serviço fica pendente. Metas globais da principal também são candidatas; uma contribuição sem escopo estruturado exige vínculo explícito, em vez de presumir o dono pelo cadastro parcial das demais. O gestor resolve explicitamente; esconder a mãe nunca torna uma associação ambígua em única. Referências técnicas são resolvidas por IDs/chaves estáveis, sem inferir uma proposta somente por data, título ou TAG.

Quando um grupo do escopo previsto tem **Proposta de origem** definida, a seleção desse escopo no RDO também registra sua proposta. O backend valida a seleção no projeto e grava `extraData.__proposalScope` com o projeto e a contribuição; metadados enviados pelo cliente são substituídos pelo cadastro validado. Essa origem tem prioridade sobre a inferência por tipo/sistema, inclusive se outro adicional estiver sem escopo. A conferência manual em `contributionAssignments` continua prevalecendo. Relatórios técnicos derivados acompanham o serviço de origem; técnicos independentes não usam esses metadados exclusivos do RDO.

As opções de escopo distinguem proposta e nome. Dois grupos “Vasos” de propostas diferentes não são a mesma escolha. Rascunhos antigos que guardam só o nome continuam aceitos quando ele identifica uma única opção; se houver ambiguidade, a aplicação exige escolher o escopo novamente. Um único escopo com origem definida também registra a proposta, mesmo quando não há seletor na tela.

Um RDO misto conserva os serviços/fotos do recorte, mas omite descrição, fotos gerais e observações gerais de horas extras/stand-by: esses dados podem descrever outras propostas. Equipe, DDS e jornada do RDO que contém o serviço são contexto diário compartilhado, não horas ou custos exclusivos atribuídos ao adicional. Um aviso registra as omissões. RDOs inteiramente atribuídos à proposta conservam também sua descrição e fotos gerais.

O vínculo fica em `Report.contributionAssignments`, separado de `specialConditions` e dos IDs recriados na edição dos serviços. A chave usa o conteúdo do serviço/medição. Alterar esse conteúdo exige rever o vínculo. Registros de conteúdo idêntico recebem o mesmo vínculo e aparecem agrupados na interface. Uma atividade que efetivamente reúne escopos precisa ser registrada em serviços separados para permitir recortes exclusivos. Atribuições manuais têm histórico com autor e data; motivos registrados anteriormente são preservados. Após remoção de qualquer adicional, registros sem vínculo manual voltam à conferência; não migram automaticamente para a mãe.

## Persistência e concorrência

`ProjectDatabook.scopeKey` tem padrão `ALL`. A unicidade passa a ser projeto + período + escopo. Os documentos existentes, suas revisões e arquivos permanecem associados ao projeto completo. Principal, A e B podem ter documentos e revisões próprios no mesmo período. `scopeSnapshot` registra a proposta no documento e em cada revisão; o snapshot de entrada conserva o conteúdo emitido mesmo após troca de revisão comercial ou remoção de uma contribuição.

A prévia mantém a identidade e o token do escopo preparado. Se revisão/metas mudarem antes de montar a prévia, a API responde 409 e exige nova preparação. Edição de um Data Book histórico reabre seu snapshot e gera a próxima revisão do mesmo documento, sem consultar novamente relatórios ou selecionar uma proposta atual. Salvar uma prévia usa os dados visualizados, com o controle de concorrência já existente da numeração.

A atribuição de serviços usa transação, bloqueio do projeto e comparação da versão do relatório. Atualizações concorrentes/edições antigas retornam 409. O cache é invalidado depois da confirmação da transação.

## Projetos anteriores à origem por proposta

No caso investigado do projeto 5815, havia 32 RDOs aprovados, os grupos de APVs e “Extra Vaso compressor” estavam sem `contributionKey`, e os serviços não tinham atribuições por proposta. Selecionar o adicional 4586, portanto, não encontrava serviços atribuídos. O cadastro anterior do RDO guardava apenas o nome do escopo; o caminho de leitura para o formulário também não incluía a proposta do grupo. A ausência de escopo em outros adicionais impedia a inferência global. O diálogo de intervalo descartava os avisos do mapper, mostrando apenas zero, e filtrar uma proposta na revisão ocultava justamente os serviços pendentes.

A correção preserva a origem nos novos salvamentos e exibe os avisos já na escolha do período, incluindo proposta sem escopo previsto. A revisão mantém os serviços pendentes visíveis mesmo com uma proposta filtrada e sugere essa proposta ao abrir o vínculo.

Históricos que nunca registraram a origem precisam de conferência pela aplicação: atribua a proposta de origem ao grupo no editor do escopo para os próximos RDOs e use **Vínculos dos serviços** para os relatórios anteriores. O vínculo operacional auditado não reemite nem altera o PDF assinado. Não há migração que deduza a proposta por nomes como “extra”, TAG ou proximidade de datas; selecionar um adicional comercial não comprova quais serviços históricos lhe pertencem. A publicação desta correção não altera dados existentes nem vincula automaticamente os RDOs do projeto 5815.

## API

- `GET /api/acompanhamento/comercial/projetos/:id/escopos-propostas`: propostas, avanço independente, serviços e vínculos pendentes. Mesma autenticação do acompanhamento.
- `PUT /api/acompanhamento/comercial/projetos/:id/escopos-propostas/:reportId`: `{ serviceKey, contributionKey, version }`; gestor do acompanhamento. `reason` continua aceito como campo opcional para clientes anteriores. `contributionKey: null` deixa o serviço sem proposta definida, com registro no histórico.
- Os endpoints de intervalo, preparação, prévia e geração de Data Book aceitam `contributionKey` opcional (`ALL` preserva a geração anterior). A preparação devolve `proposta.version`, enviado como `scopeVersion` ao montar a prévia. A edição histórica usa a identidade da revisão armazenada.

## Implantação e validação

Aplicar `20261019210000_proposal_scope_databooks` antes de backend/frontend. Não é necessário habilitar o contrato adicional no ComercialAPP para usar os recortes de propostas já selecionadas. A ativação de push v3 continua seguindo `COMERCIALAPP_EXTRA_ESCOPO.md`.

Os testes de integração usam exclusivamente `filtroapp_bridge_test`: principal Access e dois adicionais ComercialAPP com o mesmo tipo/sistema, vínculo explícito de um RDO misto, acumulado anterior exclusivo, três documentos para o mesmo período, troca da revisão A, prévia desatualizada e reabertura do histórico. O teste gera um PDF com Python/ReportLab e extrai seu texto com pypdf para confirmar a presença de A e a ausência da mãe/B. O mapper também verifica a separação de FDS/certificados/fotos. Os testes de interface são simulados apenas no transporte e exercitam os componentes de produção em 360, 768 e 1440 pixels.

A regressão da origem por proposta reproduz oito dias de limpeza de dois vasos com outro adicional sem escopo: o Data Book inclui 8 RDOs e 2 RLQs sem criar atribuições de reparo. Também verifica o bootstrap e o salvamento HTTP do RDO, a substituição de metadados adulterados, seleções antigas, escopos homônimos, troca de projeto e prioridade da conferência manual. A interface verifica pendentes com filtro ativo e a identidade da proposta no seletor de escopos.

```sh
cd backend
DATABASE_URL=postgresql://.../filtroapp_bridge_test \
TEST_DATABASE_URL=postgresql://.../filtroapp_bridge_test \
DATABOOK_PYTHON=/caminho/python \
node --test test/proposal-scopes.test.js test/proposal-scope-databook.integration.test.js
```

A geração por proposta usa os serviços estruturados dos relatórios aprovados, como o Data Book completo atual. Um PDF histórico sem serviços estruturados precisa ser conferido/cadastrado antes de um recorte exclusivo; o arquivo inteiro não comprova a qual contribuição pertence cada atividade.

Quando a principal selecionada no Access tem seu escopo consultado no ComercialAPP (ou vice-versa), o mesmo número continua compondo o escopo principal, preservando a origem dos itens importados. A versão preparada do databook inclui essas metas. A [homologação no staging](COMERCIALAPP_STAGING_20261019.md) confirmou esse cenário, os vínculos do RDO misto e três PDFs separados no mesmo período.
