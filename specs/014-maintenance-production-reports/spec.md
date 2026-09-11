# Feature Specification: Relatórios de Manutenção e Produção

**Feature Branch**: `feat/maintenance-production-reports`

**Created**: 2026-09-03

**Status**: Ready for planning

**Input**: Criar relatórios internos de manutenção 5002 e produção 5004 em um módulo próprio “Manutenção e produção”, com permissões independentes, aprovação, manutenção avulsa, históricos operacionais, histórico consolidado das manutenções dos equipamentos, documento individual de manutenção e estatísticas na Sede.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Acessar o módulo conforme as permissões (Priority: P1)

Como colaborador, quero acessar um módulo próprio e ver somente as áreas de manutenção ou produção autorizadas para minha conta, para que estes fluxos fiquem separados do RDO de obra e das equipes sem relação com eles.

**Why this priority**: A separação por permissão é a barreira que impede exposição indevida dos novos fluxos e condiciona todas as demais jornadas.

**Independent Test**: Configurar contas com permissão de manutenção, produção, ambas e nenhuma e verificar a visibilidade do módulo, das abas, dos históricos e das ações de criação.

**Acceptance Scenarios**:

1. **Given** uma conta com somente permissão de manutenção, **When** abre o módulo, **Then** vê as abas “Manutenção”, “Programação” e “Histórico de manutenção”, sem visualizar produção.
2. **Given** uma conta com somente permissão de produção, **When** abre o módulo, **Then** vê somente a aba “Produção”.
3. **Given** uma conta com as duas permissões, **When** abre o módulo, **Then** vê as quatro abas e pode iniciar o fluxo correspondente diretamente em “Manutenção” ou “Produção”.
4. **Given** uma conta sem nenhuma das permissões nem capacidade de revisão aplicável, **When** navega pelo app ou tenta acessar o endereço diretamente, **Then** o módulo não é exibido e o acesso é recusado.
5. **Given** um colaborador autorizado apenas a emitir RDO de obra, **When** inicia um novo RDO, **Then** abre diretamente o fluxo de obra e não vê opções de manutenção ou produção.
6. **Given** um supervisor ou gestor que deve revisar uma área, **When** recebe a permissão correspondente e abre o módulo, **Then** vê o histórico da área e as ações de aprovação compatíveis com seu papel; a permissão não amplia quem pode aprovar.

---

### User Story 2 - Registrar e aprovar RDO de manutenção 5002 (Priority: P1)

Como colaborador autorizado da manutenção, quero registrar a jornada resumida do dia e uma ou mais manutenções de equipamentos no mesmo fluxo, para consolidar horas, atividades e serviços executados sem preencher sistemas separados.

**Why this priority**: Substitui o formulário externo e cria a base operacional da manutenção, preservando a apuração de jornada do RDO existente.

**Independent Test**: Criar um RDO 5002 com jornada diurna e noturna, duas manutenções, fotos e serviços de terceiros; submetê-lo, aprová-lo e confirmar os registros e documentos individuais.

**Acceptance Scenarios**:

1. **Given** um emissor autorizado, **When** cria um RDO de manutenção, **Then** o código 5002 é atribuído sem seleção e o formulário solicita data, entrada, saída, intervalo de almoço/janta, colaboradores, turno noturno opcional e descrição das atividades.
2. **Given** horários e colaboradores válidos, **When** a jornada é preenchida, **Then** horas trabalhadas e extras são calculadas pelas mesmas regras do RDO de obra e uma justificativa é exigida quando houver hora extra.
3. **Given** a etapa “Manutenções”, **When** o colaborador adiciona cartões, **Then** cada cartão representa exatamente um equipamento ativo e permite checklist, fotos opcionais, observações e qualquer quantidade de serviços de terceiros.
4. **Given** um RDO de manutenção pendente, **When** o supervisor global da manutenção ou um administrador o aprova, **Then** o RDO inteiro e todas as manutenções vinculadas são aprovados como uma unidade.
5. **Given** um RDO de manutenção pendente, **When** o aprovador o devolve, **Then** o conjunto volta para correção sem publicar manutenções no histórico dos equipamentos.
6. **Given** um RDO de manutenção aprovado, **When** a conclusão termina, **Then** nenhum documento geral de RDO é emitido, mas cada manutenção recebe seu próprio documento aprovado.

---

### User Story 3 - Registrar manutenção avulsa e consultar histórico do equipamento (Priority: P1)

Como colaborador da manutenção, quero registrar uma manutenção sem abrir um RDO e consultar as manutenções aprovadas no equipamento, para atender serviços pontuais e manter um histórico técnico confiável.

**Why this priority**: Nem toda manutenção ocorre durante o fechamento de um RDO, mas toda manutenção precisa do mesmo processo, documento e histórico.

**Independent Test**: Criar uma manutenção avulsa para um equipamento, submetê-la, aprová-la e abrir o histórico do equipamento para consultar e baixar o documento.

**Acceptance Scenarios**:

1. **Given** um emissor autorizado, **When** inicia uma manutenção avulsa, **Then** informa a data e preenche exatamente uma manutenção com os mesmos campos usados dentro do RDO 5002.
2. **Given** qualquer manutenção nova, **When** ela é salva, **Then** o responsável é automaticamente o usuário autenticado e não pode ser substituído por outro nome.
3. **Given** uma manutenção pendente ou devolvida, **When** o histórico do equipamento é consultado, **Then** ela não aparece como manutenção concluída.
4. **Given** uma manutenção aprovada, **When** o histórico do equipamento é consultado, **Then** ela aparece com data, responsável, serviços executados, observação, terceiros e documento anexado, sem indicar se nasceu avulsa ou em um RDO.
5. **Given** uma manutenção aprovada, **When** seu documento é gerado, **Then** ele usa o nome e a assinatura vigentes do supervisor global no momento da aprovação e permanece inalterado após futuras trocas de supervisor.
6. **Given** manutenções aprovadas de qualquer equipamento e origem, **When** a aba “Histórico de manutenção” é aberta, **Then** elas aparecem em uma consulta consolidada com data, TAG, equipamento, informações técnicas relevantes e link funcional para o PDF.

---

### User Story 4 - Registrar e aprovar produção 5004 (Priority: P2)

Como colaborador autorizado da produção, quero registrar a jornada e as limpezas químicas realizadas em quilogramas, para controlar internamente o volume decapado sem gerar documentos.

**Why this priority**: Cria a medição operacional da produção e aproveita o cálculo de jornada, sem misturar o fluxo documental dos demais relatórios.

**Independent Test**: Criar um relatório 5004 com jornada, hora extra e cartões para todos os materiais; aprová-lo e confirmar a soma dos quilogramas sem documento gerado.

**Acceptance Scenarios**:

1. **Given** um emissor autorizado, **When** cria um relatório de produção, **Then** o código 5004 é atribuído sem seleção e a jornada contém os mesmos campos e cálculos do RDO de manutenção.
2. **Given** a etapa “Limpeza química”, **When** adiciona cartões, **Then** cada cartão exige descrição, material e quantidade positiva em quilogramas.
3. **Given** o material “Outros”, **When** o cartão é salvo, **Then** um complemento textual do material é obrigatório.
4. **Given** um relatório pendente, **When** um aprovador permitido pelo fluxo atual de RDO o aprova ou devolve, **Then** o estado inteiro muda e a decisão fica auditada.
5. **Given** um relatório de produção aprovado, **When** a aprovação termina, **Then** nenhum DOCX, PDF, assinatura externa ou envio para assinatura é criado.

---

### User Story 5 - Configurar manutenção e acompanhar indicadores da Sede (Priority: P2)

Como administrador ou gestor, quero configurar o supervisor e os perfis de checklist e consultar indicadores dos códigos 5002 e 5004, para adaptar a operação sem alterar formulários externos e acompanhar horas, manutenções e quilogramas produzidos.

**Why this priority**: Garante autonomia administrativa, aprovação com identidade correta e visibilidade gerencial dos novos dados.

**Independent Test**: Definir supervisor e perfis, realizar registros aprovados em datas diferentes e validar os totais e agrupamentos no Acompanhamento da Sede.

**Acceptance Scenarios**:

1. **Given** a configuração de Equipamentos, **When** um administrador escolhe o supervisor global, **Then** somente colaboradores ativos com conta interna ativa e assinatura cadastrada podem ser selecionados.
2. **Given** nenhum supervisor válido, **When** colaboradores criam e submetem manutenções, **Then** o fluxo permanece disponível, mas qualquer aprovação é bloqueada com orientação clara para configurar o supervisor.
3. **Given** os perfis iniciais importados do formulário legado, **When** um administrador edita os serviços de um perfil ou a associação de um equipamento, **Then** os próximos registros usam a configuração atualizada sem alterar manutenções antigas.
4. **Given** registros aprovados em 5002, **When** o gestor filtra um período na aba Sede, **Then** vê jornada, colaboradores, horas extras e totais de manutenção por período, tipo e equipamento.
5. **Given** registros aprovados em 5004, **When** o gestor filtra um período na aba Sede, **Then** vê jornada, colaboradores, horas extras, quilogramas totais e divisão por material.
6. **Given** registros pendentes, devolvidos ou fora do período, **When** os indicadores são carregados, **Then** eles não entram nos totais aprovados do período.
7. **Given** uma categoria de equipamentos, **When** o gestor configura seu intervalo preventivo em dias, **Then** todos os equipamentos ativos da categoria passam a ter a próxima manutenção calculada a partir da manutenção aprovada mais recente.
8. **Given** um equipamento cujo prazo calculado terminou antes da data atual, **When** a aba “Programação” é aberta, **Then** ele aparece destacado como manutenção vencida.

### Edge Cases

- Um equipamento desativado após ter manutenções aprovadas continua no histórico antigo, mas não pode ser escolhido em novos registros.
- A troca de perfil de um equipamento não altera o checklist registrado anteriormente; cada manutenção conserva os rótulos efetivamente marcados.
- Uma manutenção deve selecionar ao menos um serviço de checklist; cartões incompletos impedem submissão e destacam os campos inválidos.
- Fotos de manutenção são opcionais, limitadas a 10 por manutenção; erro de upload mantém o rascunho e identifica somente a foto com falha.
- Serviços de terceiros são opcionais e ilimitados; ao adicionar um cartão, data, local e descrição tornam-se obrigatórios.
- Quantidade de produção aceita decimal positivo e rejeita zero, valor negativo, texto e valores sem unidade interpretável.
- O material “Outros” sem complemento impede submissão e o erro desaparece quando outro material é escolhido.
- Aprovações concorrentes não podem gerar dois documentos nem decisões contraditórias; a primeira transição válida prevalece e a segunda recebe o estado atualizado.
- Falha na geração de um documento de manutenção não aprova parcialmente o conjunto; a operação fica recuperável e idempotente para nova tentativa.
- Uma assinatura de supervisor removida depois da submissão bloqueia a aprovação até haver novamente um supervisor global elegível.
- Links diretos, abas e chamadas manuais à criação respeitam as permissões mesmo que o menu do módulo seja contornado.
- RDO de manutenção sem cartões de manutenção e RDO de produção sem cartões de limpeza química não podem ser submetidos.
- Um link direto para uma aba não autorizada deve selecionar a primeira aba permitida sem revelar dados da área proibida; sem qualquer acesso aplicável, deve exibir acesso negado.
- Manutenção aprovada sem anexo disponível deve continuar listada no histórico consolidado com ação de documento indisponível, sem link quebrado.
- A tabela do histórico consolidado deve virar cartões em telefone e nunca ampliar a viewport.
- Categoria sem intervalo preventivo permanece visível como “Não configurado”; equipamento com intervalo, mas sem manutenção aprovada, permanece visível como “Sem histórico” e não é classificado como vencido sem uma data-base.
- A aba “Programação” deve usar cartões em telefone e os menus internos do módulo não podem se sobrepor ao cabeçalho ou ao conteúdo durante a rolagem.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST manter permissões independentes por conta para RDO de obra, manutenção e produção; as permissões de manutenção e produção MUST controlar a visibilidade e a emissão em suas áreas do módulo próprio.
- **FR-002**: O sistema MUST preservar para contas atuais autorizadas a emitir RDO somente a permissão equivalente de obra durante a migração; manutenção e produção começam desabilitadas.
- **FR-003**: O sistema MUST manter o RDO de obra em seu fluxo atual e MUST iniciar manutenção ou produção exclusivamente a partir da aba correspondente do módulo “Manutenção e produção”, sem seletor entre esses tipos no fluxo de novo RDO.
- **FR-004**: O backend MUST validar a permissão correspondente em toda criação, alteração, submissão e upload relacionado ao tipo de relatório.
- **FR-005**: O relatório de manutenção MUST pertencer ao código fixo 5002 e o de produção ao código fixo 5004, sem permitir troca pelo emissor.
- **FR-006**: Os dois novos RDOs MUST registrar data, entrada, saída, intervalo de almoço/janta e colaboradores diurnos.
- **FR-007**: Os dois novos RDOs MUST permitir turno noturno opcional com entrada, saída, intervalo e colaboradores noturnos, seguindo as regras atuais do RDO de obra.
- **FR-008**: Os dois novos RDOs MUST calcular jornada e horas extras automaticamente pelas regras atuais e MUST exigir justificativa quando houver hora extra.
- **FR-009**: Os novos RDOs MUST excluir espera/standby, DDS, fotos gerais e os formulários de serviços do RDO de obra.
- **FR-010**: O RDO 5002 MUST oferecer uma etapa repetível “Manutenções” entre a jornada e a finalização e MUST aceitar quantos equipamentos forem necessários.
- **FR-011**: Cada manutenção MUST referenciar exatamente um equipamento ativo do módulo Equipamentos, pesquisável por código, nome ou categoria.
- **FR-012**: O sistema MUST derivar do equipamento o perfil de manutenção configurado e apresentar o checklist vigente desse perfil.
- **FR-013**: Cada manutenção MUST conservar uma cópia dos nomes dos serviços selecionados e numerá-los sequencialmente a partir de 1 no documento.
- **FR-014**: Cada manutenção MUST exigir ao menos um serviço marcado e permitir observação opcional.
- **FR-015**: Cada manutenção MUST permitir até 10 fotos opcionais, associadas somente àquela manutenção e processadas pelo fluxo seguro de imagens do app.
- **FR-016**: Cada manutenção MUST permitir zero ou mais serviços de terceiros, com data, local e descrição obrigatórios em cada item adicionado.
- **FR-017**: O responsável de uma manutenção MUST ser o usuário autenticado que iniciou seu preenchimento.
- **FR-018**: Uma manutenção criada dentro do RDO MUST herdar a data do RDO; uma manutenção avulsa MUST exigir data própria.
- **FR-019**: A manutenção avulsa MUST usar os mesmos campos, validações, estados e aprovação da manutenção do RDO e MUST conter exatamente um equipamento.
- **FR-020**: O sistema MUST tratar manutenções com e sem RDO como o mesmo tipo de registro em histórico e indicadores, sem rótulo de origem para o usuário.
- **FR-021**: O RDO 5002 MUST ser aprovado ou devolvido como unidade inteira, incluindo todos os seus cartões de manutenção.
- **FR-022**: Somente o supervisor global válido da manutenção e contas ADMIN MUST aprovar ou devolver RDOs 5002 e manutenções avulsas.
- **FR-023**: A ausência de supervisor global válido MUST permitir criação e submissão e MUST bloquear somente aprovação, com mensagem acionável.
- **FR-024**: Toda manutenção aprovada MUST gerar exatamente um documento individual a partir do modelo oficial de manutenção; o RDO 5002 não gera documento geral.
- **FR-025**: O documento MUST conter responsável, data, equipamento, TAG/código, linhas sequenciais dos serviços, terceiros, fotos, observações, nome e assinatura do supervisor.
- **FR-026**: O documento MUST usar sempre o supervisor global, inclusive quando um administrador realiza a aprovação, e MUST registrar separadamente o usuário que praticou a decisão.
- **FR-027**: O nome e a assinatura do supervisor MUST ser copiados no momento da aprovação para impedir alteração retroativa de documentos.
- **FR-028**: O histórico do equipamento MUST listar somente manutenções aprovadas e disponibilizar seus documentos anexos.
- **FR-029**: A configuração MUST manter um único supervisor global e restringir a escolha a colaborador ativo com assinatura e conta interna ativa vinculada.
- **FR-030**: A configuração MUST permitir criar, editar, ordenar, ativar e desativar perfis de manutenção e seus serviços de checklist.
- **FR-031**: A configuração inicial MUST incluir os perfis UFI, UTH, UFP regular, UFP pneu, UTO, UBP, ULQ regular, ULQ diesel, TRO e CMR com os serviços revisados do formulário legado.
- **FR-032**: Equipamentos MUST permitir associação editável a um perfil de manutenção; as variações UFP pneu e ULQ diesel são perfis configuráveis, não exceções fixas por TAG.
- **FR-033**: O relatório 5004 MUST conter uma etapa repetível “Limpeza química” e exigir pelo menos um cartão.
- **FR-034**: Cada limpeza química MUST exigir descrição, material e quantidade decimal positiva em quilogramas.
- **FR-035**: Material MUST aceitar Aço carbono, Inox, CuNiFe e Outros; “Outros” MUST exigir complemento textual.
- **FR-036**: O relatório 5004 MUST passar pelos estados Pendente, Aprovado e Devolvido usando os aprovadores já aplicáveis ao fluxo atual de RDO de obra.
- **FR-037**: O relatório 5004 MUST permanecer exclusivamente interno e MUST nunca gerar documento, assinatura externa, envio ou registro derivado de qualidade.
- **FR-038**: Toda decisão de aprovação ou devolução MUST registrar autor, data, estado anterior, estado novo e observação quando informada.
- **FR-039**: Indicadores de 5002 na aba Sede MUST mostrar horas, colaboradores, horas extras, total de manutenções e agrupamentos por período, perfil/tipo e equipamento.
- **FR-040**: Indicadores de 5004 na aba Sede MUST mostrar horas, colaboradores, horas extras, quilogramas totais e agrupamento por material.
- **FR-041**: Indicadores operacionais MUST considerar apenas registros aprovados e respeitar o período selecionado na aba Sede.
- **FR-042**: Os totais 5002 e 5004 MUST permanecer separados dos custos já existentes da Sede e não MUST alterar os cálculos de custo 5000, 5002 ou 5003.
- **FR-043**: O sistema MUST oferecer estados claros de carregamento, vazio, erro, rascunho, pendente, devolvido e aprovado para os novos fluxos.
- **FR-044**: Registros aprovados MUST ser imutáveis pelo fluxo de edição comum; correção posterior exige o mecanismo administrativo já adotado para relatórios aprovados, com auditoria.
- **FR-045**: A geração documental e as transições de estado MUST ser idempotentes para evitar documentos duplicados em repetição de requisições.
- **FR-046**: A função MUST registrar eventos suficientes para diagnosticar falhas de permissão, aprovação, geração do documento e processamento de fotos sem expor conteúdo sensível em logs.
- **FR-047**: O sistema MUST oferecer um módulo independente denominado “Manutenção e produção”, separado dos módulos RDO e Equipamentos.
- **FR-048**: O módulo MUST conter as abas “Manutenção”, “Produção”, “Programação” e “Histórico de manutenção”, persistindo a aba válida selecionada em `?tab=`.
- **FR-049**: A permissão de manutenção MUST tornar visíveis as abas “Manutenção”, “Programação” e “Histórico de manutenção”; a permissão de produção MUST tornar visível a aba “Produção”; usuários com ambas MUST visualizar as quatro.
- **FR-050**: A permissão da área MUST ser necessária também para supervisores, gestores e administradores visualizarem a respectiva aba; a capacidade de aprovação continua sendo verificada separadamente e a permissão não MUST conceder aprovação por si só.
- **FR-051**: A aba “Manutenção” MUST oferecer a criação de RDO 5002 e manutenção avulsa e MUST listar o histórico dos relatórios e manutenções já criados, incluindo rascunhos, pendentes, devolvidos e aprovados conforme a autorização do usuário.
- **FR-052**: A aba “Produção” MUST oferecer a criação de RDO 5004 e MUST listar o histórico dos relatórios já criados, incluindo rascunhos, pendentes, devolvidos e aprovados conforme a autorização do usuário.
- **FR-053**: A aba “Histórico de manutenção” MUST consolidar todas as manutenções de equipamentos aprovadas, independentemente de terem sido criadas em RDO 5002 ou avulsas, e MUST exibir no mínimo data, TAG/código, nome do equipamento, categoria/perfil, responsável, serviços realizados e acesso ao PDF.
- **FR-054**: O backend MUST filtrar cada listagem segundo as capacidades do usuário e MUST recusar consulta, criação, alteração ou revisão por acesso direto quando a permissão ou capacidade correspondente não existir.
- **FR-055**: O histórico consolidado MUST ordenar por data da manutenção decrescente, possuir paginação e busca por TAG, nome do equipamento ou categoria e manter os filtros compartilháveis na URL.
- **FR-056**: A listagem tabular do histórico consolidado MUST possuir alternativa em cartões para telefone, com as mesmas informações e ações, sem rolagem horizontal da página.
- **FR-057**: O histórico individual já disponível em cada equipamento e a configuração dos perfis no módulo Equipamentos MUST permanecer funcionais; o módulo novo não duplica nem move a configuração administrativa.
- **FR-058**: Em desktop, o módulo “Manutenção e produção” MUST usar a largura operacional disponível, sem permanecer limitado à largura estreita dos formulários mobile-first.
- **FR-059**: Os cabeçalhos Data, TAG, Equipamento, Categoria/perfil e Responsável do histórico consolidado MUST permitir alternar a ordenação crescente e decrescente no conjunto completo paginado e MUST persistir coluna e direção na URL.
- **FR-060**: Cada categoria de equipamento MUST aceitar um intervalo preventivo opcional entre 1 e 3650 dias, configurável no painel de Manutenção do módulo Equipamentos com validação Zod nas duas pontas.
- **FR-061**: A aba “Programação” MUST listar todos os equipamentos ativos agrupados por categoria e exibir TAG, nome, data da última manutenção aprovada, intervalo da categoria, próxima manutenção e situação.
- **FR-062**: A próxima manutenção MUST ser a data da manutenção `APPROVED` mais recente somada ao intervalo da categoria; registros pendentes ou devolvidos MUST ser ignorados.
- **FR-063**: O sistema MUST distinguir `Vencida`, `Vence hoje`, `Em dia`, `Sem histórico` e `Não configurado` e MUST destacar visualmente como vencidos somente os equipamentos cuja próxima data é anterior à data corrente de São Paulo.
- **FR-064**: A programação MUST possuir busca, filtro por categoria, filtro por situação, paginação e estado navegacional em query params, respeitando exclusivamente a permissão de manutenção.
- **FR-065**: As abas do módulo MUST caber sem sobreposição no desktop e no telefone; a navegação fixa dentro do contêiner rolável MUST permanecer abaixo do cabeçalho e sem cobrir o conteúdo.
- **FR-060**: Todos os campos obrigatórios dos formulários de manutenção e produção, inclusive os condicionais exibidos após ativar turno noturno, material “Outros” ou serviço de terceiros, MUST apresentar asterisco vermelho junto ao rótulo.

### Visual/UI Contract *(mandatory if feature touches frontend)*

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------------|------------------------|---------------------------|------------------------------|
| Módulo “Manutenção e produção” | Shell largo, cabeçalho e abas dos módulos atuais; histórico interno já existente | Registro central de módulos, `Button`, `SearchBar`, `Skeleton`, estados vazios e tokens globais | Ações de criação visíveis somente na aba autorizada | N/A | `?tab=manutencao|producao|historico-manutencao`; filtro/página na URL | Tutorial permanente de primeira entrada no novo módulo e selo temporário até 2026-09-14 | Abas quebram/rolam apenas internamente; listas viram cards em telefone; nenhum conteúdo amplia a viewport |
| Formulários RDO 5002 e 5004 | Etapas e cálculo do RDO atual em `frontend/src/pages/collaborator/NewReportPage.tsx` | `Button`, `SearchBar`, `ConfirmDialog`, toast e estilos globais `field-group` | React Hook Form + esquema declarativo; `.field-invalid`, `aria-invalid` e `.field-error` por controle | N/A | Tipo e etapa atual ficam em query params compatíveis e sobrevivem ao refresh | Integrado à mesma campanha temporária | Uma coluna no telefone, shell largo no desktop, cards com `min-width: 0`, ações empilháveis e sem overflow de página |
| Cartões de manutenção, terceiros e limpeza química | Cards repetíveis e seletores pesquisáveis já usados nos formulários do app | `Button`, `SearchBar`, `Modal`/`ConfirmDialog` quando necessário e tokens globais | Combobox compartilhado para equipamento; selects globais com foco, disabled, vazio e erro | N/A; inclusão/remoção não implica reordenação manual | Mantidos no estado do rascunho; etapa em URL | Pontos reais dos cartões fazem parte do tutorial | Grade usa `minmax(min(100%, ...), 1fr)` ou equivalente; textos, quantidades e ações quebram dentro do card |
| Configuração de manutenção em Equipamentos | Estrutura e navegação de `frontend/src/pages/equipamentos/EquipamentosPage.tsx` | Shell largo de Equipamentos, `Modal`, `Button`, `ConfirmDialog`, `SearchBar`, `Skeleton` | Formulários administrativos compartilhados, combobox de supervisor e erros por campo | Se houver ordenação de serviços: handle dedicado, live reorder, placeholder/ghost, cancelamento e Pointer Events mobile | Seção/perfil selecionado em query params, limpando parâmetros incompatíveis | Integrado à campanha temporária | Lista/tabela vira cards no telefone; abas cabem ou usam rolagem interna explícita; nenhum valor alarga a viewport |
| Histórico de manutenções do equipamento | Detalhes e anexos atuais do módulo Equipamentos | Cards/listas e botões de download compartilhados | Filtros e campos globais; estados vazio/erro/carregando | N/A | Equipamento e aba de histórico em query params | Integrado à campanha temporária | Tabela desktop ganha cartões mobile; nome de arquivo, status e ações quebram ou truncam sem overflow |
| Histórico consolidado de manutenção | Histórico individual em Equipamentos e tabelas responsivas existentes | `SearchBar`, `Button`, `Skeleton`, tabela desktop e cards mobile compartilhados | Busca por TAG/nome/categoria com vazio, foco, carregamento e erro | N/A | `tab`, `q` e `page` persistidos, removendo parâmetros incompatíveis ao trocar de aba | Etapa do tutorial permanente e da campanha temporária | Colunas essenciais na tabela; todos os dados e o PDF permanecem acessíveis nos cards a 360 px |
| Indicadores 5002 e 5004 na Sede | Aba Sede de Acompanhamento e cartões de métricas atuais | Shell largo de Acompanhamento, filtros, cards, `Skeleton` e tokens globais | Filtro de período no padrão existente | N/A | `tab=sede`, período e cartão selecionado preservados em query params | Integrado à campanha temporária | Cards encolhem com segurança, números grandes quebram/truncam e qualquer detalhe tabular vira cards mobile |

Não se aplica a exceção de identidade portada: todas as superfícies seguem o kit visual e os tokens globais do app. A campanha de novidade terá data de implementação registrada no código e expiração global exatamente dez dias corridos depois; após a expiração, não será exibida nem para usuários novos.

### Key Entities *(include if feature involves data)*

- **Permissão de emissão de relatório**: Capacidades independentes da conta para obra, manutenção e produção.
- **RDO de manutenção**: Registro diário do código 5002 com jornada, colaboradores, atividades, horas extras e uma ou mais manutenções.
- **Manutenção**: Registro técnico de um equipamento, com data, responsável, perfil aplicado, serviços selecionados, fotos, observações, terceiros, estado e documento aprovado.
- **Serviço de terceiro**: Item repetível pertencente a uma manutenção, composto por data, local e descrição.
- **Perfil de manutenção**: Configuração editável de serviços de checklist que pode ser associada a equipamentos.
- **Supervisor global da manutenção**: Único colaborador elegível cuja identidade e assinatura aprovam documentalmente as manutenções.
- **Snapshot de supervisão**: Cópia imutável do nome e assinatura usados no documento aprovado.
- **RDO de produção**: Registro diário do código 5004 com jornada, colaboradores, atividades e limpezas químicas.
- **Limpeza química**: Item de produção com descrição, material, complemento opcional e quantidade em quilogramas.
- **Decisão de aprovação**: Evento auditável que registra autor e transição de estado de RDO ou manutenção.
- **Indicador operacional da Sede**: Agregação por período dos registros aprovados de 5002 ou 5004.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em testes de aceitação, 100% das combinações de permissões exibem somente o módulo, as abas e as ações autorizadas e toda tentativa direta não autorizada é recusada.
- **SC-002**: Um colaborador treinado consegue concluir um RDO 5002 com duas manutenções em até 8 minutos e uma manutenção avulsa simples em até 4 minutos.
- **SC-003**: 100% das manutenções aprovadas geram exatamente um documento individual com os serviços numerados e a assinatura do supervisor global; nenhuma manutenção pendente ou devolvida aparece no histórico.
- **SC-004**: Repetir uma solicitação de aprovação não cria documento duplicado nem altera uma decisão já concluída em 100% dos testes de concorrência previstos.
- **SC-005**: 100% dos relatórios 5004 aprovados atualizam a soma de quilogramas por material e nenhum deles gera arquivo ou solicitação de assinatura.
- **SC-006**: Os totais exibidos para 5002 e 5004 coincidem com a soma dos registros aprovados no período em todos os cenários de validação do guia rápido.
- **SC-007**: Todas as novas telas podem ser concluídas em viewport de 360 px sem rolagem horizontal da página, corte de ações ou dependência exclusiva de interação por mouse.
- **SC-008**: Toda submissão inválida destaca 100% dos campos obrigatórios afetados com mensagem visível junto ao controle e mantém os demais dados já preenchidos.
- **SC-009**: Consultas comuns de listas, histórico e indicadores apresentam resultado ou estado de erro em até 3 segundos para o volume operacional esperado de até 50 mil manutenções e 100 mil itens de limpeza.
- **SC-010**: A campanha de novidade aparece no máximo uma vez por usuário e navegador durante os 10 dias definidos e nunca depois da data global de expiração.
- **SC-011**: 100% das manutenções aprovadas, vinculadas ou avulsas, aparecem no histórico consolidado em ordem decrescente e seus PDFs disponíveis podem ser abertos pela ação da linha ou do cartão.
- **SC-012**: Usuários de RDO de obra sem manutenção/produção não veem o novo módulo nem qualquer seletor desses relatórios no fluxo de obra em 100% dos cenários de permissão.
- **SC-013**: Em desktop, o módulo ocupa a largura operacional; em 360 px continua sem rolagem horizontal; e 100% dos campos exigidos pelo esquema exibem a indicação visual de obrigatoriedade.
- **SC-014**: Em todos os cenários de datas testados, 100% das próximas manutenções correspondem à última manutenção aprovada mais o intervalo da categoria e todos os equipamentos vencidos ficam destacados no desktop e no mobile.

## Assumptions

- O fluxo de aprovação de produção reutiliza os mesmos perfis de aprovação atualmente aceitos para RDO de obra; somente manutenção recebe a regra exclusiva de supervisor global ou ADMIN.
- A permissão de manutenção cobre tanto o RDO 5002 quanto a manutenção avulsa.
- Supervisores, gestores e administradores recebem explicitamente a permissão das áreas que devem consultar; a permissão controla visibilidade/emissão e o papel de revisão controla separadamente a aprovação/devolução.
- Como a funcionalidade ainda não foi publicada em produção, o módulo próprio será a única entrada apresentada desde o primeiro lançamento e não haverá período de convivência com o seletor provisório em “Novo relatório”.
- O projeto/código 5002 já existe no domínio da Sede; o código 5004 será criado ou assegurado pela migration/seed da feature.
- Os nomes de checklist revisados do Google Forms são a fonte inicial, mas passam a ser configuração interna editável depois da implantação.
- A lista de equipamentos, suas categorias, identificadores e estado ativo vem exclusivamente do módulo Equipamentos existente.
- O modelo oficial está em `Modelos/definitivos/Manutenção/Modelo Manutenção.docx`; a geração deve tolerar o placeholder legado `{{tag}}}` e preencher observações e datas de terceiros sem exigir edição manual do modelo.
- Fotos usam a política atual de armazenamento e retenção dos anexos de equipamentos/relatórios.
- A correção administrativa de registros aprovados segue as regras existentes; esta feature não cria cancelamento, exclusão definitiva ou versionamento documental adicional.
- Custos da Sede permanecem fora do escopo: a feature adiciona indicadores operacionais, não altera integrações financeiras nem apropriação de custos.
- Importar respostas históricas do Google Forms está fora do escopo; apenas novos registros serão criados no app.
- Não haverá emissão de RDO geral para manutenção nem qualquer documento para produção.
