# Feature Specification: Integração VR Ponto Mais

**Feature Branch**: `feat/integracao-pontomais`

**Created**: 2026-08-14

**Status**: In progress

**Input**: User description: "Substituir definitivamente o upload manual da planilha de ponto pela integração com o VR Ponto Mais. O backend deve sincronizar automaticamente todos os dias e importar todo o histórico. A jornada do Ponto Mais continua sendo a verdade do tempo e da viagem. O custo real mensal do colaborador não pode ser duplicado na aba Custos, mas os cards devem mostrar a jornada e o custo analítico integrais em cada projeto realmente executado no mesmo local. Agrupamentos de missões devem declarar se são apenas visuais, execução compartilhada ou consolidação excepcional em uma missão principal."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sincronizar a jornada sem planilha (Priority: P1)

Como gestor do Acompanhamento, quero que o sistema sincronize a jornada diretamente do Ponto Mais todos os dias para que o custo de mão de obra permaneça atualizado sem abrir a tela, selecionar períodos, exportar ou enviar arquivos.

**Why this priority**: A remoção da atividade manual é o objetivo principal da integração e fornece os dados que alimentam todos os cálculos posteriores.

**Independent Test**: Com o token configurado, o backend inicia a carga histórica sem interação humana, retoma do último lote após interrupção e, depois de concluí-la, atualiza diariamente a janela recente sem duplicar colaborador/dia.

**Acceptance Scenarios**:

1. **Given** que a integração está configurada e ainda não possui estado de automação, **When** o backend inicia, **Then** ele descobre a admissão mais antiga entre colaboradores ativos e inativos e importa continuamente desde essa data até o dia corrente, em lotes consecutivos de no máximo 31 dias e sem aguardar outro ciclo entre lotes.
2. **Given** que alguns lotes históricos já foram concluídos, **When** o processo reinicia ou uma tentativa é repetida, **Then** a carga continua do primeiro dia ainda não concluído sem recomeçar todo o histórico nem duplicar colaborador/dia.
3. **Given** que a carga histórica terminou, **When** chega o horário diário configurado, **Then** o backend atualiza automaticamente os 31 dias encerrados no dia anterior, incorporando correções recentes sem depender de navegador aberto.
4. **Given** que um mesmo período é atualizado novamente, **When** o cálculo lê a jornada vigente, **Then** os dados mais recentes prevalecem para os mesmos colaborador e dia sem dupla contagem.
5. **Given** que a integração está indisponível ou sem credencial válida, **When** o ciclo automático executa, **Then** a falha é registrada de forma sanitizada, o cursor permanece retomável e os dados vigentes ficam inalterados.
6. **Given** que um gestor abre a aba de ponto, **When** consulta o painel, **Then** vê o progresso da carga histórica, a última atualização diária e eventual falha, sem precisar selecionar período nem enviar planilha.
7. **Given** que uma correção do normalizador exige recompor snapshots já publicados, **When** a revisão canônica aumenta, **Then** o backend relê uma única vez todo o intervalo desde o início histórico, retoma do lote que falhar e só marca a nova revisão depois de concluir até hoje.

---

### User Story 2 - Separar folha real de apropriação analítica por projeto (Priority: P1)

Como gestor, quero conciliar a jornada do Ponto Mais com os RDOs em dois eixos para conservar a folha real do colaborador e, ao mesmo tempo, enxergar em cada projeto todo o custo das horas que aquele projeto utilizou.

**Why this priority**: A apropriação incorreta altera diretamente o custo dos projetos e pode duplicar despesas de pessoal.

**Independent Test**: Com um colaborador de 8 horas confirmado por RDO em dois projetos de um grupo compartilhado, cada card recebe 8 horas e seu custo analítico integral, o card mesclado soma 16 horas, e a aba Custos continua exibindo uma única folha mensal.

**Acceptance Scenarios**:

1. **Given** um dia com etiqueta de um único projeto reconhecido, **When** a jornada é calculada, **Then** as horas elegíveis desse dia são apropriadas a esse projeto.
2. **Given** um dia com dois RDOs de um agrupamento configurado como execução compartilhada, **When** o custo é apropriado, **Then** cada projeto recebe 100% da jornada normal e das horas extras do Ponto Mais, independentemente das horas lançadas em cada RDO.
3. **Given** o cenário compartilhado de 8 horas em dois projetos, **When** o gestor consulta os cards individuais e o card mesclado, **Then** os individuais mostram 8 horas cada e o mesclado mostra 16 horas e a soma dos dois custos analíticos.
4. **Given** qualquer quantidade de projetos em um mês, **When** o gestor consulta a aba Custos, **Then** a soma contábil entre projetos, sede e folga é exatamente igual à única folha mensal calculada para o colaborador; a soma analítica dos cards pode ser maior por representar consumo simultâneo de projetos.
5. **Given** etiquetas conflitantes ou não reconhecidas sem RDO suficiente para confirmar a alocação, **When** o cálculo é concluído, **Then** o sistema não inventa um rateio, preserva o valor na parcela não apropriada e sinaliza a pendência ao gestor.
6. **Given** uma única etiqueta reconhecida que diverge do único projeto informado pelo RDO no mesmo colaborador/dia, **When** a jornada é conciliada, **Then** o único projeto do RDO recebe integralmente as horas elegíveis e nenhuma pendência é criada.
7. **Given** uma única etiqueta reconhecida que não corresponde a nenhum de dois ou mais RDOs do colaborador/dia, **When** a jornada é conciliada, **Then** o sistema mantém as horas sem apropriação automática e exige seleção manual.
8. **Given** que as regras anteriores não produziram alocação, todas as etiquetas reconhecidas pertencem à mesma missão mesclada e exatamente um RDO do dia pertence a esse grupo, **When** a jornada é conciliada, **Then** esse único projeto com RDO recebe integralmente as horas elegíveis; com dois ou mais RDOs do grupo o dia continua pendente.
9. **Given** um agrupamento configurado para consolidar em uma missão principal, **When** um ou mais RDOs dos membros confirmam o colaborador no dia, **Then** a jornada é apropriada uma única vez na missão principal, inclusive no eixo analítico.
10. **Given** dois ou mais RDOs fora de um agrupamento com política de mão de obra, **When** não existe evidência inequívoca, **Then** o sistema mantém a pendência e não presume execução compartilhada.
11. **Given** uma etiqueta `EM VIAGEM`, **When** a jornada é classificada, **Then** ela altera o contexto de deslocamento da jornada apropriada, mas nunca identifica sozinha uma missão.
12. **Given** uma jornada com etiqueta `EM VIAGEM` sem destino resolvido no próprio dia, **When** a data coincide exatamente com a mobilização de um projeto e o mesmo colaborador aparece em RDO posterior desse projeto, **Then** essa evidência combinada apropria a viagem ao projeto; mais de um destino incompatível permanece pendente e políticas explícitas de grupo continuam determinando compartilhamento ou consolidação.

---

### User Story 3 - Conferir a qualidade da sincronização (Priority: P2)

Como gestor, quero visualizar o resultado e as pendências de cada sincronização para corrigir vínculos de colaboradores ou projetos antes de confiar no custo apresentado.

**Why this priority**: A integração precisa ser auditável, especialmente quando identificadores externos não correspondem ao cadastro interno.

**Independent Test**: Após uma sincronização contendo colaboradores e etiquetas não reconhecidos, o gestor consegue ver período, horário, quantidades processadas e pendências sem acessar logs técnicos.

**Acceptance Scenarios**:

1. **Given** uma sincronização concluída, **When** o gestor consulta o painel de jornada, **Then** vê o período, o momento da atualização e as quantidades de colaboradores, dias e pendências.
2. **Given** um colaborador externo sem correspondência segura, **When** a sincronização termina, **Then** seus dados não são atribuídos silenciosamente a outra pessoa e a pendência fica disponível para correção.
3. **Given** uma etiqueta que não identifica um projeto existente, **When** a sincronização termina, **Then** ela aparece como pendência sem causar duplicação ou perda do custo mensal.
4. **Given** uma pendência de dia ambíguo registrada por um lote antigo, **When** os RDOs atuais já fornecem evidência suficiente para o rateio, **Then** a pendência deixa de aparecer sem exigir nova sincronização daquele dia.
5. **Given** colaboradores do Ponto Mais que não pertencem à operação, **When** o gestor os marca como ignorados, **Then** eles deixam de aparecer nas pendências e no cálculo vigente, inclusive sobre snapshots históricos, e podem ser reativados depois.

### Edge Cases

- Uma batida pode não ter etiqueta, enquanto outras batidas do mesmo dia têm; a classificação do dia deve considerar todas as etiquetas reconhecidas, sem assumir que uma etiqueta ausente desfaz as demais.
- Um colaborador pode ter mais de duas etiquetas ou RDOs no mesmo dia; todos os projetos confirmados participam do peso normalizado.
- RDOs podem registrar horas totais cuja soma ultrapassa a jornada do ponto; essas horas são apenas pesos relativos, nunca horas adicionais nem custo adicional.
- Uma etiqueta pode conter texto livre além do código da missão; somente um código de projeto reconhecido pode produzir apropriação automática.
- Batidas podem chegar sem matrícula; o sistema deve usar apenas critérios alternativos seguros e deixar pendente qualquer correspondência ambígua.
- Uma nova sincronização pode trazer correções para dias já consolidados; prevalece a versão mais recente do mesmo colaborador e dia.
- Falhas de rede, limitação temporária do serviço externo ou resposta incompleta não podem apagar uma sincronização válida anterior.
- Períodos que cruzam meses devem conservar o custo separadamente em cada mês.
- A primeira carga pode durar bastante tempo, mas deve continuar na mesma execução até alcançar o dia corrente; cada lote concluído permanece aproveitável e o cursor avança somente após sua publicação atômica.
- O servidor pode ter mais de uma instância; apenas uma delas pode executar o ciclo automático por vez.
- Colaboradores desligados podem conter a jornada mais antiga e precisam participar da descoberta do início histórico.
- Uma correção pode ser lançada no Ponto Mais dias depois da batida; a atualização diária deve reler uma janela móvel, não somente o dia anterior.
- O dia corrente pode estar incompleto: ele é aceito provisoriamente somente no bootstrap inicial e é relido pela rotina diária depois de encerrado.
- Uma pendência armazenada pode ficar desatualizada após a criação ou correção de um RDO; a consulta de pendências deve revalidar o dia contra a evidência corrente.
- Colaboradores ativos ou inativos do Ponto Mais podem pertencer a áreas administrativas e devem continuar visíveis somente no diretório gerencial quando ignorados.
- Mais de um projeto pode ter a mesma data de mobilização e o colaborador pode aparecer posteriormente em RDOs de ambos; sem política explícita que una esses destinos, o dia de viagem continua pendente para seleção manual.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST sincronizar a jornada diretamente do Ponto Mais em background, sem exigir ação de gestor, navegador aberto ou envio de planilha.
- **FR-002**: O sistema MUST manter a credencial da integração exclusivamente no ambiente protegido do servidor e MUST NOT expô-la ao navegador, respostas, registros ou mensagens de erro.
- **FR-003**: O sistema MUST obter, para cada lote automático, colaboradores ativos e inativos, jornadas diárias, horas extras discriminadas, horas noturnas, batidas e etiquetas de projeto necessárias ao cálculo.
- **FR-004**: O sistema MUST associar colaboradores externos aos internos prioritariamente por matrícula e MUST utilizar CPF ou nome apenas como alternativas seguras e não ambíguas.
- **FR-005**: O sistema MUST deixar pendente qualquer colaborador que não possa ser associado com segurança, sem atribuir suas horas a outra pessoa.
- **FR-006**: O sistema MUST consolidar a jornada por colaborador e dia, preservando horas normais, horas extras de 70%, horas extras de 100%, horas noturnas e etiquetas reconhecidas.
- **FR-007**: O sistema MUST tratar uma nova sincronização como atualização idempotente: o mesmo colaborador e dia não pode ser contado mais de uma vez.
- **FR-008**: O sistema MUST preservar a última versão válida dos dados caso uma sincronização falhe ou retorne conteúdo incompleto.
- **FR-009**: O sistema MUST reconhecer projetos nas etiquetas somente quando houver correspondência inequívoca com um projeto interno ativo ou historicamente válido para o período.
- **FR-010**: Em dia com um único projeto reconhecido pela etiqueta, o sistema MUST apropriar as horas elegíveis desse dia ao projeto identificado quando não houver RDO divergente; se nenhuma etiqueta válida existir ou se a etiqueta divergir de exatamente um projeto confirmado por RDO, o único RDO MUST receber integralmente a jornada.
- **FR-011**: Em dia com múltiplos projetos reconhecidos, o sistema MUST usar os RDOs do colaborador e da data para confirmar em quais projetos houve trabalho.
- **FR-012**: No eixo contábil da aba Custos, quando dois ou mais projetos forem confirmados no mesmo dia, o sistema MUST usar a jornada total registrada em cada RDO como peso relativo e MUST normalizar os pesos antes da distribuição da única folha mensal.
- **FR-013**: No eixo contábil, as horas de RDO usadas como pesos MUST NOT aumentar a jornada vinda do ponto nem criar custo adicional; no eixo analítico dos cards, uma política explícita de execução compartilhada MAY repetir a jornada integral em cada projeto confirmado.
- **FR-014**: Para cada colaborador e mês, o eixo contábil da aba Custos MUST garantir que a soma dos custos de todos os projetos, sede e folga seja igual ao custo mensal calculado, respeitado o arredondamento monetário; essa garantia MUST NOT ser usada para limitar a soma analítica dos cards.
- **FR-015**: Diferenças residuais de arredondamento no eixo contábil MUST ser absorvidas de forma determinística por uma das parcelas existentes, mantendo a igualdade do requisito FR-014.
- **FR-016**: Se as etiquetas e os RDOs não permitirem confirmar uma alocação múltipla, o sistema MUST manter o custo correspondente na parcela não apropriada e MUST registrar uma pendência visível, sem escolher arbitrariamente um projeto.
- **FR-017**: O resultado da sincronização MUST informar período, data e hora, quantidades processadas, vínculos realizados e pendências de colaborador ou projeto, sem exibir dados pessoais desnecessários.
- **FR-018**: Somente gestores autorizados MUST poder usar a sincronização manual de contingência ou alterar vínculos; a rotina automática usa credenciais de servidor e usuários autorizados a consultar o Acompanhamento podem visualizar o estado da jornada conforme suas permissões atuais.
- **FR-019**: A fonte integrada MUST substituir o upload manual como fluxo normal de atualização do ponto, preservando a compatibilidade do cálculo de custo já usado pelo Acompanhamento.
- **FR-020**: O sistema MUST manter um histórico auditável de sincronizações suficiente para identificar origem, período, resultado e substituições de dados.
- **FR-021**: Com `PONTOMAIS_API_TOKEN` configurado, o backend MUST iniciar o agendador da integração automaticamente no boot e MUST executar uma verificação periódica independente de requisições HTTP de usuários.
- **FR-022**: Na ausência de estado de automação concluído, o sistema MUST descobrir o início histórico pela menor data de admissão válida entre colaboradores ativos e inativos retornados pela API.
- **FR-023**: A carga histórica MUST cobrir continuamente do início descoberto até o dia corrente em lotes consecutivos de no máximo 31 dias, na mesma execução automática e sem limite artificial de lotes por ciclo.
- **FR-024**: O sistema MUST persistir o início histórico, o último dia histórico publicado e o próximo dia a processar; o cursor MUST avançar somente depois que o snapshot do lote for publicado com sucesso.
- **FR-025**: Após concluir a carga histórica, o sistema MUST executar uma sincronização por dia, às 03:00 no fuso `America/Sao_Paulo`, relendo os 31 dias encerrados no dia anterior para capturar ajustes tardios.
- **FR-026**: A execução automática MUST usar exclusão mútua entre processos e MUST ser idempotente; ciclos concorrentes, reinícios e repetição do mesmo lote MUST NOT duplicar jornada nem custo.
- **FR-027**: A auditoria de cada tentativa MUST identificar se a origem foi carga histórica automática, atualização diária automática ou contingência manual.
- **FR-028**: O painel MUST apresentar configuração, estado da carga histórica, intervalo já coberto, próximo lote, última atualização diária e última falha sanitizada; seleção manual de período e upload de planilha MUST NOT ser necessários no fluxo normal.
- **FR-029**: A atualização diária MUST NOT publicar o dia corrente, pois a jornada ainda pode estar incompleta; o bootstrap inicial é a única exceção e seu último dia será relido pela atualização diária seguinte.
- **FR-030**: Uma falha em qualquer lote MUST preservar o cursor no primeiro dia não publicado, conservar os snapshots anteriores e permitir nova tentativa automática sem intervenção humana.
- **FR-031**: O sistema MUST manter um diretório dos colaboradores ativos e inativos descobertos na API, identificado pelo ID externo estável, com nome, matrícula, situação e última observação necessárias à gestão do escopo.
- **FR-032**: Um gestor MUST poder marcar e desmarcar um colaborador externo como ignorado; a preferência MUST ser persistente, reversível e auditável pelo usuário e momento da alteração.
- **FR-033**: Colaboradores ignorados MUST NOT produzir novos resumos ou pendências e seus resumos API já sincronizados MUST NOT participar do cálculo vigente, sem apagar a trilha histórica armazenada.
- **FR-034**: Antes de exibir uma pendência de dia ambíguo histórica, o sistema MUST reavaliá-la contra o vínculo atual do colaborador, projetos e RDOs vigentes; quando a regra normal de rateio já produzir alocação, a pendência MUST ser ocultada.
- **FR-035**: O fallback por projetos mesclados MUST NOT ser aplicado quando a regra normal de etiqueta + RDO já produzir rateio. Somente depois de as regras normais falharem, quando todas as etiquetas reconhecidas pertencerem ao mesmo agrupamento ativo e exatamente um projeto desse grupo possuir RDO para colaborador/data, esse projeto MUST receber peso 1; zero ou múltiplos RDOs do grupo MUST permanecer pendentes.
- **FR-036**: As listas de pendências, colaboradores encontrados e históricos MUST ter rolagem vertical localizada e acessível por teclado, sem aumentar indefinidamente a altura da página.
- **FR-037**: Horas extras retornadas pelo Ponto Mais sem percentual explícito MUST ser preservadas como horas extras genéricas por dia e classificadas pelo teto mensal legado, sem descartar minutos nem reclassificar percentuais 70/100 fornecidos explicitamente.
- **FR-038**: Quando uma única etiqueta reconhecida não corresponder a nenhum de dois ou mais projetos confirmados por RDO no mesmo colaborador/dia, o sistema MUST manter as horas sem apropriação automática, reconstruir a pendência também para snapshots históricos já armazenados, exibir os projetos candidatos e permitir uma seleção manual auditável que prevaleça somente naquele colaborador/dia.
- **FR-039**: Dias sem etiqueta reconhecida e com múltiplos RDOs MUST permanecer visíveis como pendência; códigos candidatos derivados de RDO MUST NOT ser reinterpretados como se fossem etiquetas para ocultar a ambiguidade.
- **FR-040**: O estado automático MUST versionar o formato canônico dos snapshots. Quando a revisão aumentar, o sistema MUST reler uma única vez todo o histórico desde `historyStart`, persistir a revisão-alvo durante o replay, retomar do primeiro lote incompleto após falha e promover a revisão vigente somente depois da cobertura integral até o dia corrente.
- **FR-041**: Cada agrupamento ativo de missões MUST possuir uma política explícita de mão de obra: `VISUAL_ONLY`, `SHARED_EXECUTION` ou `CONSOLIDATE_PRIMARY`, sendo `VISUAL_ONLY` o padrão compatível com grupos existentes.
- **FR-042**: Em `SHARED_EXECUTION`, quando dois ou mais RDOs do mesmo colaborador/data pertencem exclusivamente ao agrupamento, o eixo analítico MUST atribuir peso 1 à jornada do Ponto Mais em cada projeto confirmado, incluindo horas normais e extras.
- **FR-043**: No mesmo cenário `SHARED_EXECUTION`, o eixo contábil MUST manter pesos normalizados cuja soma seja 1, para que o custo real mensal permaneça único.
- **FR-044**: Em `CONSOLIDATE_PRIMARY`, qualquer evidência de um membro do grupo MUST apropriar a jornada uma única vez no projeto principal configurado, e o projeto principal MUST pertencer ao próprio agrupamento ativo.
- **FR-045**: Os cards individuais e o detalhe de projeto MUST consumir o eixo analítico; um card de agrupamento MUST somar os eixos analíticos de seus membros sem deduplicar horas ou custo simultâneos.
- **FR-046**: A aba Custos e seus totais mensais MUST consumir somente o eixo contábil e MUST NOT somar o custo analítico repetido dos cards.
- **FR-047**: A etiqueta `EM VIAGEM`, com variações de caixa, acento e complemento, MUST ser preservada como contexto de viagem e MUST NOT ser resolvida como projeto; quando a jornada for apropriada, esse contexto MUST acompanhar cada destino analítico confirmado.
- **FR-048**: Uma política de agrupamento MUST ser alterável somente por gestor, validada por Zod, auditável pela atualização do grupo e exposta em pt-BR junto aos membros afetados.
- **FR-049**: Depois de falharem escolhas manuais e todas as evidências do próprio dia, uma jornada com etiqueta `EM VIAGEM` MUST ser apropriada por mobilização somente quando a data do ponto for exatamente `Project.mobilizationDate` e o mesmo colaborador constar em pelo menos um RDO posterior do projeto. Um único candidato recebe peso 1; candidatos exclusivamente de `SHARED_EXECUTION` repetem a jornada apenas no eixo analítico e permanecem normalizados no contábil; `CONSOLIDATE_PRIMARY` recebe uma única apropriação no principal; combinações sem política compatível MUST permanecer pendentes. Horas do RDO posterior MUST NOT ser somadas à data de viagem.
- **FR-050**: Etiquetas de projeto não reconhecidas e dias ambíguos cujos códigos candidatos não correspondam a nenhum projeto cadastrado, inclusive inativo ou histórico, MUST ser separados das pendências operacionais em uma subaba gerencial própria. Um dia que possua ao menos um candidato cadastrado MUST permanecer na lista operacional; a subaba separada MUST manter rolagem local e a ação opcional de vincular uma etiqueta desconhecida a um projeto existente.

### Visual/UI Contract *(mandatory if feature touches frontend)*

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------------|------------------------|---------------------------|------------------------------|
| Painel “Ponto (jornada)” no Acompanhamento | `frontend/src/components/projects/PontoImportPanel.tsx`; padrão visual do próprio módulo | `Button`, controle `acp-seg`, contexto compartilhado de `Toast`, `page-card`, `sec`, `placeholder-copy`, `acp-table` | Estados visíveis de configuração, carga histórica, atualização diária, execução, falha e preferência ignorado/considerado; sem período/upload no fluxo normal | N/A | Subabas `pontoDetalhe=missing-projects` e `pontoDetalhe=employees` persistidas na URL; resumo é o padrão e omite o parâmetro | Aviso centralizado e tutorial guiado aponta a automação e o diretório de colaboradores, com chave por usuário/navegador e expiração global já versionada | Em celular, as três subabas, estados e ações empilham; pendências, projetos não encontrados, diretório e históricos têm rolagem vertical local com foco; não há scroll horizontal da página |

### Key Entities *(include if feature involves data)*

- **Sincronização de jornada**: Execução auditável para um período, com origem, horário, resultado, contagens e estado de sucesso ou falha.
- **Estado da automação**: Registro único e persistente com início descoberto, cursor do próximo lote, cobertura histórica, revisão canônica vigente/em processamento, última atualização diária e última falha sanitizada.
- **Jornada diária do colaborador**: Totais diários de horas normais, extras por percentual e noturnas, vinculados a um colaborador interno quando houver correspondência segura.
- **Batida etiquetada**: Registro de entrada ou saída que pode conter a identificação informada pelo colaborador sobre o projeto.
- **Candidato de projeto do dia**: Projeto reconhecido a partir do conjunto de etiquetas daquele colaborador e data.
- **Confirmação por RDO**: Evidência de trabalho do colaborador em um projeto e data, incluindo a jornada total usada como peso relativo.
- **Apropriação contábil mensal do colaborador**: Distribuição conservada da única folha entre projetos, sede e folga, usada exclusivamente na aba Custos.
- **Apropriação analítica de projeto**: Projeção de jornada e custo por projeto consumido, que pode repetir a mesma jornada entre projetos de execução compartilhada.
- **Política de mão de obra do agrupamento**: Define se o agrupamento é apenas visual, replica execução entre seus membros ou consolida tudo em um projeto principal.
- **Pendência de conciliação**: Colaborador, etiqueta ou dia ambíguo que não pode ser associado automaticamente com segurança.
- **Colaborador externo descoberto**: Entrada do diretório gerencial do Ponto Mais, com preferência reversível de participação na sincronização e no cálculo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A jornada é atualizada diariamente sem interação do gestor; em até 2 minutos de navegação ele consegue verificar cobertura, última execução e eventuais pendências.
- **SC-002**: Em 100% dos recálculos, a soma contábil mensal por colaborador entre projetos, sede e folga é igual ao custo mensal do colaborador, com diferença máxima de um centavo antes do ajuste determinístico e diferença zero depois dele.
- **SC-003**: Repetir a sincronização do mesmo período não aumenta a quantidade de dias nem o custo total por duplicidade.
- **SC-004**: Em cenários `SHARED_EXECUTION`, cada projeto confirmado recebe 100% da jornada analítica do Ponto Mais, enquanto o eixo contábil distribui exatamente 100% da folha sem excedente.
- **SC-005**: Falhas da integração preservam 100% dos dados da última sincronização válida.
- **SC-006**: Todos os colaboradores, etiquetas e dias não conciliados automaticamente ficam identificados no resultado da sincronização, sem atribuições silenciosas.
- **SC-007**: A primeira carga cobre, em uma única execução bem-sucedida, 100% dos dias entre a admissão mais antiga disponível e o dia corrente, em lotes de no máximo 31 dias, e pode ser retomada sem perder lotes já concluídos quando houver interrupção.
- **SC-008**: Depois da carga histórica, existe no máximo uma atualização diária efetiva por data de referência, sem necessidade de acesso à tela.
- **SC-009**: Uma interrupção após qualquer lote mantém 100% dos snapshots publicados e a execução seguinte retoma no primeiro dia ainda não coberto.
- **SC-010**: A rotina diária nunca publica o dia corrente e relê os 31 dias anteriores para absorver correções tardias.
- **SC-011**: Em 100% das consultas, colaboradores ignorados não aparecem em pendências nem no custo vigente, e voltar a considerá-los restaura sua participação sem nova carga histórica obrigatória.
- **SC-012**: Pendências ambíguas já resolvidas por RDO atual deixam de aparecer, enquanto dias ainda sem evidência permanecem visíveis.
- **SC-013**: Em 100% das jornadas consultadas, a soma das horas extras genéricas e explícitas armazenadas corresponde ao total diário retornado pela API; divergências com RDO único são apropriadas nesse RDO, enquanto divergências com múltiplos RDOs permanecem sem apropriação até uma escolha manual.
- **SC-014**: Em 100% dos fallbacks por missão mesclada, a alocação automática ocorre somente quando há um único RDO elegível no grupo; dias sem etiqueta ou com mais de um RDO elegível continuam visíveis para decisão manual.
- **SC-015**: Cada incremento de revisão canônica dispara exatamente um replay histórico completo e retomável, sem novo replay após a revisão vigente alcançar a revisão-alvo.
- **SC-016**: Para o exemplo de 8 horas em dois membros compartilhados, os cards individuais exibem 8 horas cada, o agrupamento exibe 16 horas e a aba Custos mantém uma única jornada de 8 horas e uma única folha.
- **SC-017**: Em 100% das etiquetas de viagem sem código de missão, nenhum projeto é inventado; o contexto de viagem só é aplicado após a confirmação do destino por RDO, política ou decisão manual.
- **SC-018**: Em 100% dos fallbacks por mobilização, a data do ponto coincide com a mobilização do destino e existe RDO posterior do mesmo colaborador; a apropriação usa somente as horas do Ponto Mais do dia de viagem e destinos incompatíveis continuam selecionáveis como pendência.
- **SC-019**: Em 100% das consultas de pendências, etiquetas sem projeto e dias cujos candidatos estão integralmente ausentes do cadastro aparecem somente na subaba “Projetos não encontrados”; dias com qualquer candidato cadastrado continuam disponíveis para conciliação operacional.

## Assumptions

- O horário padrão de atualização diária é 03:00 no fuso `America/Sao_Paulo`, quando o dia anterior já está encerrado; a rotina verifica periodicamente se o ciclo daquele dia está pendente.
- O limite externo de 31 dias é um detalhe interno: a carga histórica divide e retoma os lotes sem exigir seleção de período.
- A menor `admission_date`/`initial_date` válida entre colaboradores ativos e inativos representa o início consultável do histórico da conta.
- A matrícula é o identificador preferencial entre o Ponto Mais e o cadastro interno; CPF e nome normalizado são alternativas apenas quando produzem uma única correspondência.
- Etiquetas de projeto contêm um código de missão que pode ser associado ao código do projeto interno, mesmo quando acompanhado de texto livre.
- Para uma única etiqueta de projeto reconhecida no dia, ela é evidência suficiente quando não há RDO conflitante; se existir exatamente um RDO divergente, ele prevalece, enquanto dois ou mais RDOs divergentes exigem seleção manual.
- O agrupamento ativo de missões só complementa a evidência da etiqueta depois das regras normais: todas as etiquetas reconhecidas devem pertencer ao mesmo grupo e apenas um projeto desse grupo pode ter RDO no dia.
- Fora de `SHARED_EXECUTION`, as horas totais de cada RDO representam somente a importância relativa do projeto no eixo contábil; dentro de `SHARED_EXECUTION`, os RDOs confirmam participação e não limitam a jornada analítica integral recebida por cada membro.
- Jornadas sem etiqueta continuam usando um único projeto confirmado por RDO como fonte de apropriação, preservando o comportamento vigente; sem etiqueta e sem projeto confirmado, permanecem em sede ou na parcela não apropriada conforme as regras atuais do cálculo.
- A combinação data exata de mobilização + etiqueta de viagem + presença posterior do mesmo colaborador em RDO é evidência suficiente apenas como último fallback; não existe janela máxima arbitrária, e qualquer multiplicidade incompatível é encaminhada para decisão manual.
- O cálculo financeiro vigente continua sendo a fonte do custo mensal; a integração altera a origem da jornada e a apropriação, não as fórmulas salariais.
- O histórico de planilhas já importadas permanece consultável para auditoria, mas a interface não depende de novos uploads e a automação passa a ser a única fonte normal de atualização.
