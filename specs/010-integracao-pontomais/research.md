# Research: Integração VR Ponto Mais

## 1. Fonte de dados externa

**Decision**: Consumir colaboradores, relatório diário de jornadas e relatório de batidas do VR Ponto Mais. Usar o token no header `access-token`, paginação de 500 itens e período máximo interno de 31 dias.

**Rationale**: A documentação oficial expõe `/external_api/v1/employees`, `/external_api/v1/reports/work_days` e `/external_api/v1/reports/time_cards`. O relatório diário fornece horas normais, extras, noturnas e identificadores; somente o relatório de batidas fornece `tag_manager`, a etiqueta digitada ao bater o ponto. Consultas somente leitura com a credencial local confirmaram esses campos no tenant atual.

**Alternatives considered**:

- Apenas `work_days`: rejeitado porque a etiqueta não aparece no relatório nem nas batidas resumidas nele.
- `period_summaries`: rejeitado como fonte principal porque os cabeçalhos de HE são genéricos e faltam data/etiqueta.
- Centros de custo como projeto: rejeitado porque os centros observados não correspondem às etiquetas de missão.

**Official references**:

- <https://materiais.vr.com.br/central-de-ajuda/extensao-api/>
- <https://documenter.getpostman.com/view/4785048/RWMCvVxN?version=latest>

## 2. Semântica observada das etiquetas

**Decision**: Tratar `tag_manager` como informação da batida, agregar etiquetas não vazias por colaborador/data e resolver apenas códigos introduzidos por “Missão” ou aliases manuais.

**Rationale**: Na amostra de 1 a 14 de agosto de 2026 havia aproximadamente 1,2 mil batidas. Etiquetas apareciam em entradas e saídas, muitas vezes em apenas parte das batidas do dia. Onze textos distintos foram observados, nove com códigos de missão, e os nove códigos existiam em `Project.code`. Houve um dia com duas etiquetas. Formar o conjunto diário evita escolher a primeira ou a última arbitrariamente.

**Alternatives considered**:

- Associar intervalos entrada/saída: rejeitado porque as etiquetas são parciais e podem mudar entre batidas.
- Extrair qualquer número: rejeitado porque texto livre pode conter outros identificadores. O parser exige “Missão” e projeto correspondente, ou alias explícito.

## 3. Correspondência de colaboradores

**Decision**: Resolver na ordem: vínculo persistido pelo ID externo, matrícula exata, CPF normalizado único e nome normalizado único. Ausência ou ambiguidade vira pendência.

**Rationale**: `/employees` fornece ID, matrícula, CPF e nome. `time_cards` normalmente fornece matrícula, mas não `employee_id`; `work_days` fornece o ID. Matrícula + data une os relatórios, e a lista de colaboradores permite enriquecer a correspondência com CPF. Vínculo persistido suporta correções sem depender de nome mutável.

**Alternatives considered**:

- Nome como chave primária: rejeitado por homônimos, acentos e alterações cadastrais.
- Criar colaboradores automaticamente: rejeitado porque cargo e perfil de custo não podem ser inferidos com segurança.

## 4. Modelo canônico e atomicidade

**Decision**: Manter `PontoImport` e `PontoPeriodSummary` como fonte canônica, adicionar a origem e criar `PontoSyncRun` separado para auditoria. Publicar o snapshot em uma transação após toda coleta e validação.

**Rationale**: `computeCollaboratorRates` já consolida imports e mantém a versão mais nova de cada colaborador/dia. Reutilizar esse consumidor reduz o raio de mudança. Auditoria separada impede que uma tentativa `FAILED` amplie o período ou seja tratada como ponto vigente.

**Alternatives considered**:

- Segundo consumidor exclusivo da API: rejeitado por duplicar consolidação e cálculo.
- Falha como `PontoImport`: rejeitado porque o escopo atual considera todos os imports.
- Atualização página a página: rejeitada porque publicaria dados parciais.

## 5. Representação diária versionada

**Decision**: Evoluir o JSON `monthly` para dias com `workedMinutes`, `genericOvertimeMinutes`, `he70Minutes`, `he100Minutes`, `nightMinutes` e `tags`, mantendo leitura de `extrasMinutes` legado.

**Rationale**: `work_days.extra_time` pode retornar percentuais 70 e 100 explicitamente e também o bucket principal com `percent: null`. Preservar os explícitos evita reclassificação, enquanto o bucket genérico precisa seguir o teto mensal já usado pelo cálculo em vez de ser descartado. JSON versionado mantém compatibilidade sem uma tabela para cada batida.

**Alternatives considered**:

- Tabela por dia/batida: adiada porque o cálculo usa agregados diários e não precisa reproduzir cada batida.
- Somente HE total: rejeitado porque perde a classificação do fornecedor.

## 6. Algoritmo de projetos e RDO

**Decision**: Calcular pesos diários normalizados:

1. Uma etiqueta resolvida: peso 1 para o projeto quando não houver RDO divergente; se houver exatamente um RDO apenas em outro projeto, o RDO recebe peso 1.
2. Várias etiquetas resolvidas: intersectar com RDOs do colaborador/data. Um confirmado recebe peso 1; dois ou mais recebem `horasRdoProjeto / somaHorasRdoConfirmadas`.
3. Nenhuma etiqueta resolvida: preservar o fallback somente quando existir um único projeto de RDO no dia.
4. Etiqueta divergente de dois ou mais RDOs, ou outra ausência de confirmação inequívoca: peso total 0 e jornada não apropriada.

Os mesmos pesos dividem horas normais, HE70 e HE100 do ponto. A jornada integral de cada RDO participa apenas do peso.

**Rationale**: Um colaborador presente em dois projetos gera custo nos dois, mas seu custo mensal não pode ser duplicado. Pesos normalizados permitem o “erro para mais” relativo dos RDOs sem criar horas ou dinheiro.

**Alternatives considered**:

- Escolher o maior RDO: rejeitado porque elimina um projeto real.
- Aplicar 100% em cada projeto: rejeitado porque duplica custo.
- Divisão igual sempre: rejeitada porque ignora a evidência das jornadas dos RDOs.
- Rateio por intervalos das batidas: rejeitado pela etiquetagem incompleta.

## 7. Conservação do custo

**Decision**: Manter o cálculo único da folha e reconciliar apenas a distribuição. Horas de projetos são limitadas às horas do ponto, parcelas são não negativas e a saída fecha em centavos com resíduo determinístico.

**Rationale**: `computeCollaboratorCost` já busca `Σ projetos + sede + folga = folha`, mas o formato antigo impede múltiplos projetos por dia e usa ponto flutuante. Normalização evita estouro estrutural; fechamento em centavos torna a garantia observável.

**Alternatives considered**:

- Recalcular folha por projeto: rejeitado porque salário e custos fixos pertencem ao colaborador/mês.
- Aceitar diferença de arredondamento: rejeitado pelo requisito de não exceder nem duplicar.

## 8. Resiliência e segurança

**Decision**: Timeout por chamada, até três tentativas com backoff para `429` e `5xx`, nenhuma repetição em autenticação/validação e erros sanitizados. Nunca registrar headers, token, CPF completo ou corpo bruto.

**Rationale**: Os relatórios são leituras, então repetição limitada é segura. A publicação transacional preserva o último snapshot. Token dedicado e restrito reduz impacto de vazamento.

**Alternatives considered**:

- Retry ilimitado: rejeitado por bloquear a requisição e ampliar carga.
- Erro bruto ao gestor: rejeitado pelo risco de dados pessoais e detalhes internos.

## 9. Experiência e rollout

**Decision**: Com token configurado, o painel mostra o estado da automação, cobertura histórica, última atualização e pendências. Seleção de período e upload saem do fluxo normal. Sem token, o painel informa o bloqueio de configuração, sem sugerir a planilha como rotina alternativa. A novidade segue o contrato Driver.js já versionado.

**Rationale**: A atualização precisa ocorrer mesmo sem navegador aberto. O painel atual continua sendo o lugar conhecido para acompanhar qualidade e corrigir vínculos, mas deixa de ser o gatilho da coleta.

**Alternatives considered**:

- Expor upload quando falta token: rejeitado porque recria a dependência operacional que a feature deve eliminar; imports antigos continuam apenas consultáveis.
- Página nova: rejeitada porque a jornada já possui painel próprio.

## 10. Carga histórica e agendamento diário

**Decision**: Consultar `/employees` separadamente com `active=true` e `active=false`, incluindo `admission_date` e `initial_date`, deduplicar por ID e usar a menor data válida como início. Persistir um cursor e processar continuamente, na mesma execução, todos os lotes consecutivos de no máximo 31 dias até alcançar a data corrente. Depois, executar diariamente às 03:00 de `America/Sao_Paulo`, relendo uma janela móvel de 31 dias encerrada ontem.

**Rationale**: A consulta read-only no tenant confirmou que ativos e inativos são conjuntos separados e que as datas de admissão usam `DD/MM/YYYY`. O cursor torna o backfill retomável sem impor esperas artificiais entre lotes. O dia corrente entra provisoriamente apenas no bootstrap para entregar a cobertura completa solicitada e é relido, já encerrado, pela janela diária seguinte.

**Alternatives considered**:

- Retroceder até encontrar meses vazios: rejeitado porque intervalos sem jornada não provam o começo do histórico.
- Usar somente colaboradores ativos: rejeitado porque perderia histórico de desligados.
- Exigir uma data inicial em variável de ambiente: rejeitado como padrão porque reintroduz configuração manual; a própria API fornece o limite inferior.
- Sincronizar somente ontem: rejeitado porque correções tardias ficariam ausentes.
- Fazer todo o histórico em uma requisição: impossível pelo limite externo e frágil a interrupções.

## 11. Coordenação entre instâncias

**Decision**: Executar a automação pelo runner compartilhado (`runTrackedJob`), com lock persistente e auditoria de job. O serviço de sync mantém seu lock transacional para impedir sobreposição com a contingência manual. O bootstrap continua até concluir todo o histórico disponível e persiste progresso depois de cada lote.

**Rationale**: O backend já usa esse padrão para rotinas recorrentes. Combinar lock de job e admissão de sync protege tanto múltiplas instâncias quanto chamadas originadas fora do agendador.

## 12. Verificação dos projetos 5761 e 5794

**Decision**: Revalidar as pendências históricas contra os RDOs atuais e aplicar missão mesclada somente como último fallback: todas as etiquetas reconhecidas devem estar no mesmo grupo ativo e exatamente um projeto desse grupo deve ter RDO no colaborador/dia.

**Rationale**: A inspeção somente leitura da base local confirmou que 5761 e 5794 estão no mesmo agrupamento ativo do Acompanhamento, junto com 5788 e 5805. Porém, a premissa de que 5794 não teria relatórios é falsa: 5761 possui 121 relatórios em 110 datas e 5794 possui 68 relatórios em 68 datas. Entre 151 pendências armazenadas contendo os dois códigos, distribuídas por 62 datas, ambos os projetos possuíam relatório em todas as datas. Nesses registros a regra normal continua suficiente e o grupo não altera o resultado. O fallback atende apenas outros dias em que uma etiqueta do grupo diverge dos RDOs e resta um único RDO dentro do mesmo grupo; ele nunca transforma ausência de etiqueta nem múltiplos RDOs do grupo em escolha automática.

**Alternatives considered**:

- Escolher qualquer projeto do agrupamento que possua relatório: rejeitado quando houver zero ou múltiplos candidatos; somente a unicidade do RDO dentro do grupo, apoiada por uma etiqueta reconhecida do mesmo grupo, é evidência suficiente.
- Reescrever resumos históricos: rejeitado porque alteraria a auditoria do que foi observado no lote. A projeção de pendências pode ser derivada da evidência atual sem perder o histórico.

## 13. Colaboradores fora da operação

**Decision**: Persistir um diretório por ID externo e uma preferência reversível de ignorar. Continuar consultando a lista necessária à API, mas descartar os ignorados antes da publicação e antes da consolidação financeira de snapshots existentes.

**Rationale**: Os relatórios externos são consultas amplas do tenant, e colaboradores administrativos não devem gerar ruído nem custo no Acompanhamento. Manter a preferência fora do snapshot preserva auditoria, permite reversão imediata e evita apagar dados históricos.

**Alternatives considered**:

- Apagar períodos já sincronizados: rejeitado por perda de auditoria e reversão cara.
- Ignorar somente na interface: rejeitado porque as horas continuariam entrando no custo.
- Criar colaboradores internos automaticamente: rejeitado porque pessoas fora da operação não possuem necessariamente cargo e perfil de custo válidos.

## 14. Precedência entre etiqueta única e RDO

**Decision**: Quando a etiqueta reconhecida aponta para um projeto, mas existe exatamente um RDO do mesmo colaborador/data somente em outro projeto, considerar o RDO como evidência decisiva e atribuir peso 1 ao seu projeto. Se existirem dois ou mais RDOs divergentes, registrar a união dos candidatos como pendência e persistir a seleção gerencial por colaborador/data.

**Rationale**: A presença nominal do colaborador em um único RDO identifica onde o trabalho foi efetivamente registrado, mesmo quando a etiqueta da batida ficou desatualizada ou incorreta. Com múltiplos RDOs, essa unicidade desaparece; o override diário conserva a jornada e o custo, resolve somente o caso conferido e não altera aliases globais.

## 15. Reparação de snapshots canônicos antigos

**Decision**: Versionar o formato canônico em `PontoSyncState`. Estados migrados recebem revisão 1; o job atual produz revisão 2 e, ao detectar diferença, persiste `targetDataRevision = 2`, reinicia `nextPeriodStart` em `historyStart` e percorre todos os lotes até hoje. A revisão vigente só é promovida no último lote.

**Rationale**: A releitura diária alcança somente 31 dias e não corrige snapshots históricos gravados antes de horas extras genéricas serem preservadas. Um alvo persistido separa “replay iniciado” de “replay concluído”, permite retomar a partir do lote posterior ao último sucesso e impede que cada ciclo recomece todo o histórico. As versões antigas continuam auditáveis; os snapshots mais novos prevalecem por colaborador/data na consolidação vigente.

**Alternatives considered**:

- Alterar diretamente o JSON histórico: rejeitado porque não há como reconstruir os minutos descartados sem consultar novamente a fonte e isso destruiria a trilha de auditoria.
- Depender apenas da janela móvel diária: rejeitado porque nunca alcançaria os meses anteriores à janela de 31 dias.
- Reiniciar o replay em toda falha: rejeitado por desperdício de API e risco de nunca alcançar a data corrente.

## 16. Execução simultânea e separação contábil/analítica

**Decision**: Separar a distribuição contábil, conservada, da apropriação analítica exibida nos projetos. Configurar a autorização de repetição no agrupamento de missões, e não inferi-la globalmente a partir de dois RDOs.

**Rationale**: A inspeção somente leitura da base local encontrou 193 ocorrências de colaborador/data com múltiplos projetos em RDO no ano de 2026. Destas, 179 eram do par 5761/5794 dentro do agrupamento excepcional já ativo; oito pertenciam ao conjunto UHE 5694/5810/5813 e seis estavam fora dos grupos ativos, incluindo combinações de cidades ou obras incompatíveis. Portanto, “aparece em dois RDOs” não é evidência global segura de simultaneidade. No conjunto UHE, 5810 e 5813 ocorreram juntos em três datas para Carlos e Almir no mesmo local, e 5694/5813 ocorreram juntos em outra data; os intervalos de serviço dos RDOs variaram e não servem como peso preciso. A jornada integral do Ponto Mais repetida por projeto é a representação analítica mais fiel nesses grupos explicitamente aprovados.

O exemplo de Carlos em 22/07/2026 confirma também a diferença entre fontes: o Ponto Mais armazenou 528 minutos normais e 19 minutos de hora extra genérica (9h07), enquanto cada RDO 5810 e 5813 registrou 9h. Os cards devem, portanto, mostrar 9h07 apropriadas em cada projeto e manter 9h de relatório como métrica separada; um card mesclado soma 18h14 apropriadas e 18h reportadas. A aba Custos conserva uma única jornada de 9h07 e uma única folha.

**Alternatives considered**:

- Repetir todo dia com múltiplos RDOs: rejeitado pelos seis casos fora de grupos e pelas combinações geograficamente incompatíveis.
- Ratear pela duração de serviço do RDO: rejeitado porque esses intervalos não representam a permanência total do colaborador e variaram entre frentes executadas no mesmo local.
- Limitar os cards ao custo mensal pago: rejeitado porque esconde o custo-hora efetivamente consumido por cada contrato simultâneo.
- Duplicar a folha na aba Custos: rejeitado porque o desembolso mensal do colaborador existe uma única vez.

## 17. Semântica de `EM VIAGEM`

**Decision**: Classificar `EM VIAGEM` como marcador de deslocamento diário, separado do parser de `MISSÃO <código>`.

**Rationale**: Nas datas UHE investigadas, as etiquetas estavam vazias ou continham `EM VIAGEM` com complemento, sem código de missão. Logo, a etiqueta não pode escolher entre 5694, 5810 ou 5813. Ela ainda é informação operacional útil: depois que RDO/política confirma os projetos, o mesmo contexto de viagem acompanha a jornada apropriada e seus componentes variáveis de custo.

**Alternatives considered**:

- Tratar `EM VIAGEM` como missão: rejeitado porque não identifica contrato nem projeto.
- Ignorar completamente a etiqueta: rejeitado porque perderia uma evidência explícita de deslocamento disponível no Ponto Mais.
- Exigir que a etiqueta contenha simultaneamente viagem e missão: rejeitado porque a amostra real não segue esse padrão.

## 18. Destino de viagem pela data de mobilização

**Decision**: Usar a combinação de três evidências como último fallback: etiqueta diária `EM VIAGEM`, data do ponto exatamente igual a `Project.mobilizationDate` e presença do mesmo colaborador em um RDO posterior desse projeto. A jornada apropriada continua sendo exclusivamente a do Ponto Mais na data da viagem.

**Rationale**: A mobilização declara o dia em que a equipe se desloca para iniciar a missão, enquanto o RDO posterior comprova que aquele colaborador efetivamente chegou ao projeto. Isoladamente, nenhuma das duas informações é segura; juntas com a etiqueta explícita de viagem formam uma evidência operacional forte sem exigir que o colaborador conheça ou digite o código da missão durante o deslocamento.

Quando houver um único destino, ele recebe peso 1. Múltiplos destinos do mesmo grupo `SHARED_EXECUTION` recebem a jornada integral no eixo analítico e pesos normalizados no contábil; `CONSOLIDATE_PRIMARY` recebe uma única apropriação no principal. Projetos sem uma política comum continuam como pendência manual. As horas do RDO posterior não entram no dia de mobilização e não são duplicadas.

**Alternatives considered**:

- Escolher o RDO cronologicamente mais próximo: rejeitado porque proximidade sem data de mobilização pode associar viagem a uma obra anterior ou posterior.
- Impor uma janela fixa de poucos dias: rejeitado porque atrasos, finais de semana e mobilizações longas variam; a data exata de mobilização já é o limitador determinístico.
- Usar qualquer colaborador do RDO: rejeitado porque a confirmação precisa ser nominal para a mesma pessoa que bateu o ponto em viagem.
