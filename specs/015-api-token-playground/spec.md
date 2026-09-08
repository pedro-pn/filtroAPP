# Feature Specification: API Playground e tokens de integração

**Feature Branch**: `015-api-token-playground`

**Created**: 2026-09-04

**Status**: Implemented — homologation pending

**Input**: Painel exclusivo para contas administradoras criarem, testarem, rotacionarem e revogarem tokens de integração temporários ou sem expiração, com permissões de leitura selecionáveis, inspirado no fluxo do Google OAuth 2.0 Playground. A primeira entrega deve expor os dados do módulo Qualidade e mapear todos os demais dados do app que possam virar endpoints.

## Implementation status

- Implementação de código e gates automatizados concluídos em 2026-09-04; evidências não sensíveis estão em `checklists/implementation.md`.
- O primeiro marco ligou 14 operações a handlers reais. Os dois incrementos de 2026-09-08 acrescentam 28 coleções operacionais e 3 downloads: contrato com 45 operações (10 administrativas e 35 externas).
- Os 126 modelos de negócio permanecem catalogados. Há 33 escopos concedíveis (5 de Qualidade, 12 operacionais iniciais e 16 da expansão de relatórios/estoque/manutenção); os outros 49 candidatos continuam bloqueados. A ampliação não altera tokens já emitidos.
- A migração Prisma foi gerada e validada, mas não aplicada por esta execução.
- As verificações operacionais do primeiro marco foram marcadas no checklist pelo usuário. Esta execução não realizou migração/deploy nem comprovou operações em banco real; o incremento requer validação própria do operador antes de publicação.

## User Scenarios & Testing *(mandatory)*

### Correções administrativas autorizadas — 2026-09-08

A revisão identificou lacunas C1/C2/I1–I4 apesar das tarefas historicamente marcadas. O usuário autorizou detalhar e implementar as correções de `contracts/admin-corrections.md`: validação nas duas pontas, redução/rotação com edição real de política, paginação, navegação persistente, erros completos de teste e campos explícitos de Qualidade. Esta fase não expõe os 49 candidatos futuros nem substitui a homologação T088.

Correções implementadas e verificadas localmente nas tarefas T107–T115. Evidências em `contracts/admin-corrections-evidence.md`, com suites completas, validação de build/arquitetura e cenários de navegador fictícios. OpenAPI 1.3.1; T088 continua pendente do operador.

### Teste genérico por permissão — 2026-09-08

O usuário solicitou que Testar API atenda qualquer permissão implementada. Contrato em `contracts/generic-playground.md`: seleção de credencial/permissão/operação, descritores completos de parâmetros e formulário RHF/Zod, sem ID individual obrigatório nas listagens. As 33 permissões e 35 operações existentes ficam cobertas; os quatro downloads ganham verificação JSON de autorização/disponibilidade (sem transferir arquivo). Nenhum novo escopo ou endpoint externo é criado. O console não comprova IP nem o segredo Bearer do consumidor; preserva cotas e evento TESTED. Este adendo substitui apenas a exclusão anterior de downloads do console, mantendo download binário fora dele.

### Ampliação operacional autorizada — 2026-09-08

Próximo incremento solicitado pelo usuário: tornar selecionáveis no próprio catálogo os dados operacionais de colaboradores/cargos, projetos/segmentos, relatórios RDO aprovados/DDS, manutenção aprovada/perfis, produção (limpezas aprovadas), equipamentos/categorias e cadastros de estoque. São coleções de leitura com projeções explícitas, paginação por `updatedAt,id`, cotas e auditoria existentes. Nenhuma permissão é acrescentada aos tokens já emitidos.

- Uma única lista pesquisável, agrupada por módulo, contém seleção, disponibilidade, dependências e detalhes de cada permissão. Não há quadro separado de permissões genéricas.
- O console recebe operações e parâmetros do catálogo do servidor; operações futuras não podem ser executadas.
- Relatórios e registros de produção são somente aprovados, não excluídos e de projetos não excluídos. Manutenções avulsas aprovadas só são visíveis no modo de projetos `ALL`.
- Colaboradores expõem apenas identificação operacional/cargo/ativo. Em `SELECTED`, somente quem consta da equipe de relatório aprovado de um projeto permitido; não significa alocação atual.
- Equipamentos, cargos, perfis, DDS, segmentos e itens/categorias de estoque são cadastros globais compartilhados, sem vínculo com projeto; isso é informado no catálogo. Não incluem saldos, movimentações, custos ou arquivos.
- Contatos, CPF, e-mail, salários, custos, assinatura, arquivos, campos JSON livres e observações livres dos novos recursos não são publicados. Demais candidatos continuam não concedíveis, aguardando incrementos próprios.
- Aceite: cada coleção tem contrato, autorização positiva/negativa, filtro por projeto antes da consulta quando aplicável, resposta por allowlist, cursor vinculado à operação/filtros/política e testes. Sem migração nem deploy nesta etapa.

### Segundo incremento: concluir relatórios, estoque e manutenção — 2026-09-08

Solicitação explícita posterior autoriza os 16 candidatos restantes desses três grupos. O contrato `contracts/operational-expanded-read.md` e OpenAPI 1.2 detalham 13 coleções e 3 downloads. Este adendo estende as exclusões do primeiro incremento apenas para custos de estoque com permissão financeira, metadados minimizados de assinaturas/auditoria e arquivos originais com permissão própria. Contatos, provas criptográficas, tokens e caminhos internos continuam excluídos.

Aceite: dependências de escopo verificadas na emissão e consumo; projetos/publicação aplicados antes da leitura; arquivos locais com propriedade/pasta validadas; paginação real por atualização, criação ou chave composta conforme o modelo; filtros disponíveis no console; custos como string decimal; testes positivos/negativos e documentação. Sem novos campos Prisma, migração ou deploy. Downloads não são simulados pelo console JSON. A homologação em ambiente publicado cabe ao operador.

### User Story 1 - Criar uma credencial de leitura com menor privilégio (Priority: P1)

Uma pessoa administradora entra na área de gestão de contas, abre o API Playground, identifica a integração e seu responsável, escolhe somente os escopos necessários, define validade e limites, revisa o resumo e gera um token. O segredo é exibido uma única vez para cópia segura.

**Why this priority**: A emissão controlada da credencial é a base para compartilhar dados sem fornecer acesso direto ao banco nem uma conta humana.

**Independent Test**: Uma conta administradora consegue gerar uma credencial limitada a leitura de registros de Qualidade, copiar o segredo uma vez e depois consultar apenas o identificador, o prefixo, as permissões e os metadados não secretos da credencial.

**Acceptance Scenarios**:

1. **Given** uma conta com tipo `ADMIN`, **When** ela preenche os dados obrigatórios, seleciona ao menos um escopo e confirma a emissão, **Then** o sistema cria a credencial e mostra o segredo completo uma única vez.
2. **Given** uma conta que não seja `ADMIN`, **When** tenta abrir a rota do painel ou chamar uma operação administrativa de credenciais, **Then** o acesso é negado sem revelar dados de tokens.
3. **Given** a opção de credencial sem expiração, **When** a pessoa administradora a seleciona, **Then** o sistema exibe um alerta destacado, exige confirmação digitada e mantém essa opção desmarcada por padrão.
4. **Given** uma credencial existente, **When** uma permissão é retirada, **Then** a redução vale imediatamente; **When** uma permissão é acrescentada, **Then** o sistema exige rotação ou emissão de nova credencial.

---

### User Story 2 - Extrair todos os registros permitidos de Qualidade (Priority: P1)

O colaborador responsável pela integração usa o token no cabeçalho da requisição para percorrer, de forma paginada e estável, os registros do módulo Qualidade, podendo fazer uma primeira carga completa e sincronizações incrementais posteriores.

**Why this priority**: É o caso de uso imediato que motivou a criação da API e comprova o valor do mecanismo de tokens.

**Independent Test**: Com uma credencial que tenha somente `qualidade.registros.read`, um cliente externo percorre todas as páginas de registros ativos, filtra alterações por data e não recebe evidências, caminhos internos, segredos nem dados de outros módulos.

**Acceptance Scenarios**:

1. **Given** um token ativo com `qualidade.registros.read`, **When** consulta os registros com um tamanho de página permitido, **Then** recebe dados estáveis, cursor para a próxima página, data de geração e versão do esquema.
2. **Given** o mesmo token sem `qualidade.evidencias.metadata.read`, **When** consulta registros que possuem evidências, **Then** não recebe metadados nem links de evidência.
3. **Given** um token sem `qualidade.excluidos.read`, **When** faz uma carga completa, **Then** registros excluídos logicamente não são retornados.
4. **Given** filtros de `updatedSince` e cursor, **When** o cliente sincroniza alterações, **Then** alterações com a mesma data não são perdidas ou duplicadas por falta de critério de desempate.
5. **Given** token ausente, inválido, expirado ou revogado, **When** a consulta é feita, **Then** o sistema retorna falha de autenticação equivalente e não informa qual condição tornou o token inválido.

---

### User Story 3 - Explorar e testar a API no painel (Priority: P2)

Uma pessoa administradora usa um fluxo visual em três etapas — configurar credencial, selecionar permissões/gerar token e testar endpoint — com catálogo pesquisável à esquerda e console de requisição/resposta à direita, inspirado na organização do Google OAuth 2.0 Playground.

**Why this priority**: Reduz erros de configuração e permite validar uma integração antes de entregar o token ao destinatário.

**Independent Test**: Depois de criar uma credencial, a pessoa seleciona uma operação permitida de Qualidade, configura filtros válidos, envia o teste e visualiza requisição redigida, status, cabeçalhos seguros, tempo e corpo da resposta.

**Acceptance Scenarios**:

1. **Given** uma credencial recém-criada cujo segredo ainda está em memória, **When** a pessoa seleciona uma operação autorizada e executa o teste, **Then** vê a resposta e um exemplo de comando que usa uma variável de ambiente, sem incorporar o segredo.
2. **Given** uma operação fora dos escopos da credencial, **When** a pessoa tenta testá-la, **Then** o painel explica a permissão ausente e não executa a consulta.
3. **Given** o campo de operação do playground, **When** a pessoa o utiliza, **Then** só pode escolher métodos, caminhos e parâmetros registrados pelo sistema; não pode informar uma URL externa, cabeçalhos livres ou corpo arbitrário.
4. **Given** que a pessoa fecha ou recarrega a tela de revelação, **When** retorna à credencial, **Then** o segredo não é recuperado e o painel orienta a rotacionar o token caso ele não tenha sido salvo.

---

### User Story 4 - Administrar ciclo de vida, limites e auditoria (Priority: P2)

Uma pessoa administradora pesquisa credenciais por nome, destinatário, status ou permissão, acompanha uso recente, identifica expiração próxima e pode revogar ou rotacionar uma credencial com justificativa.

**Why this priority**: Credenciais de integração precisam continuar controláveis depois da entrega e deixar evidências suficientes para investigação.

**Independent Test**: É possível localizar uma credencial, consultar uso e eventos, rotacioná-la ou revogá-la e confirmar que chamadas posteriores respeitam imediatamente o novo estado.

**Acceptance Scenarios**:

1. **Given** uma credencial ativa, **When** a pessoa administradora a revoga com justificativa, **Then** novas chamadas deixam de funcionar imediatamente e o evento aparece na auditoria.
2. **Given** uma credencial ativa, **When** ela é rotacionada, **Then** um novo segredo é mostrado uma vez, a relação entre substituta e substituída é registrada e a política de sobreposição escolhida é aplicada.
3. **Given** limites por minuto, por dia, por volume de linhas ou por página, **When** uma chamada ultrapassa algum limite, **Then** ela é recusada com orientação segura sobre quando ou como reduzir a carga.
4. **Given** uma credencial próxima da expiração ou sem expiração, **When** a pessoa administradora consulta o painel, **Then** vê alerta de revisão/rotação sem exposição do segredo.

---

### User Story 5 - Consultar o catálogo de dados mapeados (Priority: P3)

Uma pessoa administradora consulta, no seletor de permissões, todos os domínios de dados avaliados do app, sua sensibilidade, disponibilidade e os campos deliberadamente excluídos. Escopos sem endpoint homologado aparecem como planejados e não podem ser concedidos.

**Why this priority**: O catálogo cria uma base comum para expandir a API sem conceder acesso implícito a tabelas ou publicar dados sensíveis por acidente.

**Independent Test**: O catálogo apresenta cada domínio como disponível, sensível, reservado ou proibido, deixa Qualidade disponível na primeira entrega e impede selecionar escopos ainda não implementados.

**Acceptance Scenarios**:

1. **Given** a primeira entrega, **When** a pessoa pesquisa por Qualidade, **Then** encontra os escopos de registros, naturezas, evidências e excluídos, com suas dependências e alertas.
2. **Given** um domínio futuro como custos, privacidade ou assinaturas, **When** ele é consultado, **Then** o painel mostra sua classificação e justificativa, mas só habilita escopos que possuam contrato, serializador, autorização e testes aprovados.
3. **Given** um dado proibido como hash de senha, token interno ou caminho físico de arquivo, **When** o catálogo é consultado, **Then** ele aparece como exclusão explícita e nunca como permissão selecionável.

### Edge Cases

- Nenhum escopo selecionado impede a emissão da credencial e destaca o seletor de permissões.
- Data inicial igual ou posterior à data final, validade passada, limite zero/negativo, CIDR inválido e tamanho máximo de página fora da faixa são rejeitados no campo correspondente.
- Uma credencial agendada não funciona antes do início; uma credencial expirada ou revogada não volta a funcionar ao editar metadados.
- Alteração de relógio e chamadas exatamente no instante inicial/final usam tempo do servidor e limites inclusivos documentados.
- Rotação concorrente ou duplo clique não gera dois segredos sem que cada emissão fique registrada e identificável.
- Escopo removido, projeto retirado da lista permitida ou IP removido deixa de funcionar na próxima chamada.
- Lista vazia de projetos significa “todos os projetos permitidos pelo escopo” somente após confirmação explícita; não é interpretada silenciosamente.
- Uma restrição de IP atrás de proxy só usa a origem considerada confiável pelo servidor; cabeçalhos enviados livremente pelo cliente não a substituem.
- Cursor adulterado, expirado ou usado com filtros diferentes é rejeitado sem revelar detalhes internos.
- Registro de Qualidade atualizado ou excluído durante a paginação permanece sincronizável pelo par estável de ordenação e pela consulta incremental.
- Evidência sem arquivo, arquivo removido ou download não autorizado retorna erro controlado sem expor caminho de armazenamento ou token público.
- Resposta muito grande é limitada por paginação e cotas; não existe operação “baixar tudo” sem limites.
- O console lida com JSON extenso, texto longo e falhas sem causar rolagem horizontal na página; somente a área de código pode rolar internamente.
- Falha ao copiar o segredo mantém a janela aberta e oferece seleção manual, sem gravar o valor no navegador.
- A credencial continua auditável após revogação, sem permitir recuperar o segredo antigo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O painel, suas operações administrativas e seus dados MUST ser acessíveis somente a contas cujo tipo atual seja `ADMIN`, com autorização aplicada no servidor em toda requisição.
- **FR-002**: O módulo administrativo MUST oferecer navegação entre gestão de contas e gestão de tokens, preservada por rota compartilhável e sem colocar segredos na URL.
- **FR-003**: O fluxo de criação MUST ser organizado em três etapas: configuração da credencial; seleção de permissões e emissão; teste de operações permitidas, com console de requisição/resposta.
- **FR-004**: Cada credencial MUST registrar nome único compreensível, finalidade, destinatário/responsável, contato opcional, descrição opcional, criador e datas de criação/atualização.
- **FR-005**: Cada credencial MUST aceitar início imediato ou agendado e expiração predefinida (1 hora, 24 horas, 7, 30 ou 90 dias), personalizada ou inexistente.
- **FR-006**: A validade padrão MUST ser temporária e a opção sem expiração MUST exigir alerta de risco, confirmação digitada e lembrete de revisão/rotação.
- **FR-007**: A pessoa administradora MUST selecionar ao menos um escopo de leitura habilitado; permissões de escrita, exclusão, aprovação ou administração estão fora desta entrega.
- **FR-008**: Cada escopo MUST ter código estável, nome, descrição, domínio, sensibilidade, estado de disponibilidade, operações cobertas, campos expostos, campos excluídos e dependências de outros escopos.
- **FR-009**: A credencial MUST permitir restrição opcional por projetos, por endereços/faixas de IP, por formatos habilitados e por data de início/fim.
- **FR-010**: A credencial MUST definir limites configuráveis por minuto, por dia, por linhas diárias e por tamanho de página, dentro de mínimos e máximos globais seguros.
- **FR-011**: O segredo MUST ser aleatório, opaco, apresentado integralmente somente após criação ou rotação e nunca recuperável posteriormente pelo painel ou pelas listagens administrativas.
- **FR-012**: O segredo MUST possuir prefixo reconhecível e a gestão MUST exibir somente prefixo e últimos caracteres suficientes para identificação, nunca o valor completo ou seu verificador interno.
- **FR-013**: O segredo MUST ser aceito exclusivamente em cabeçalho de autorização; query string, corpo, cookie de sessão e parâmetros de URL não podem autenticar a API de integração.
- **FR-014**: Ausência, formato inválido, desconhecimento, expiração e revogação do token MUST produzir resposta de autenticação equivalente, sem confirmar a existência de credenciais.
- **FR-015**: Uma chamada autenticada MUST validar, nesta ordem lógica, estado e validade, IP permitido, escopo, restrições de recurso, parâmetros e cotas antes de consultar ou devolver dados.
- **FR-016**: O sistema MUST permitir revogação imediata com justificativa e rotação que gere novo segredo, registre a relação entre credenciais e permita escolher revogação imediata ou curta sobreposição explicitamente datada.
- **FR-017**: Reduções de escopo e de restrições MUST valer imediatamente; ampliações de privilégio MUST exigir nova emissão ou rotação confirmada.
- **FR-018**: O painel MUST listar e filtrar credenciais por texto, destinatário, situação efetiva, vencimento e escopo, mostrando último uso, volume recente e alertas sem revelar segredos.
- **FR-019**: A situação efetiva MUST distinguir agendada, ativa, próxima de expirar, expirada e revogada usando as datas e a revogação registradas, sem depender de atualização manual.
- **FR-020**: O sistema MUST auditar criação, revelação inicial, mudança de metadados/restrições, redução de escopo, tentativa de ampliação, teste, rotação e revogação, identificando ator, momento e resumo redigido.
- **FR-021**: Cada uso da API MUST registrar identificador de requisição, credencial, operação, escopo, horário, resultado, quantidade de itens, duração e origem necessária à segurança, sem registrar segredo, cabeçalho de autorização, corpo integral ou campos pessoais da resposta.
- **FR-022**: Eventos administrativos e registros de uso MUST permanecer consultáveis por no mínimo 365 dias, observada política de retenção mais restritiva que venha a ser definida para dados pessoais.
- **FR-023**: O playground MUST executar somente operações registradas e permitidas, com método e caminho predefinidos e parâmetros validados; URL externa, método livre, cabeçalhos arbitrários e corpo arbitrário são proibidos.
- **FR-024**: O console MUST redigir a autorização, limitar a exibição de resposta, permitir copiar exemplos com variável de ambiente e nunca persistir o segredo em armazenamento local, de sessão, histórico, telemetria ou mensagens de erro.
- **FR-025**: A API externa MUST possuir versão explícita e respostas uniformes com `items`, metadados de página/cursor, `generatedAt`, `schemaVersion` e `requestId` quando a operação retornar coleção.
- **FR-026**: Coleções MUST usar paginação por cursor, limite máximo controlado e ordem total estável; sincronização incremental MUST aceitar marco de atualização e desempate sem omitir itens com o mesmo horário.
- **FR-027**: A API MUST devolver somente representações públicas definidas para cada domínio, sem serializar modelos de banco diretamente.
- **FR-028**: A primeira entrega MUST disponibilizar leitura de registros e naturezas de Qualidade; metadados de evidências, download de evidência e registros excluídos MUST depender de escopos separados.
- **FR-029**: O contrato público de registro de Qualidade MUST contemplar identificador, número, tipo, datas, origem, projeto, natureza, descrição, impacto, recorrência calculada, RNC vinculada, disposição, ação definida, responsável, prazo, resumo textual de evidência, verificação de resultado, situação e datas de criação/atualização.
- **FR-030**: Caminhos de armazenamento, tokens públicos permanentes, contadores internos, hashes, dados de autenticação e referências internas de arquivo MUST ser excluídos das respostas de Qualidade.
- **FR-031**: Downloads autorizados MUST ser servidos por operação autenticada e identificador público/estável da evidência, sem redirecionar para caminho físico nem revelar token permanente existente.
- **FR-032**: Registros excluídos logicamente MUST ficar ocultos por padrão; quando o escopo específico estiver presente, a resposta MUST expor apenas os dados necessários à sincronização e o instante de exclusão.
- **FR-033**: O catálogo MUST mapear todos os domínios persistidos do app e classificá-los como disponível, planejado, sensível, reservado ou proibido; “mapeado” não significa “publicado”.
- **FR-034**: Um novo escopo só pode mudar para disponível após possuir contrato versionado, projeção explícita de campos, autorização, limites, auditoria e testes automatizados de concessão e negação.
- **FR-035**: O sistema MUST manter como proibidos em qualquer token desta funcionalidade credenciais humanas, senhas e hashes, sessões, tokens de redefinição/confirmação/notificação, segredos de integração, material criptográfico, estados de trava, contadores internos e caminhos físicos.
- **FR-036**: Dados de privacidade/LGPD, imagens ou provas de assinatura, dados brutos de importação, payloads brutos de integrações, dados pessoais completos e contatos de notificação MUST permanecer reservados até revisão funcional, jurídica e de minimização específica.
- **FR-037**: A API de integração MUST ser orientada a uso servidor-a-servidor e não habilitar acesso entre origens de navegador por padrão.
- **FR-038**: Toda resposta autenticada e toda tela que contenha o segredo MUST impedir cache compartilhado e orientar que o token seja armazenado em cofre de segredos pelo destinatário.
- **FR-039**: Erros MUST ter código estável, mensagem segura em português para o painel, mensagem adequada ao contrato externo e identificador de requisição, sem stack trace ou detalhes de banco.
- **FR-040**: Formulários MUST validar os mesmos limites e formatos no cliente e no servidor, destacando cada campo inválido sem depender apenas da validação nativa do navegador.
- **FR-041**: Criação, rotação e revogação MUST exigir uma chave de idempotência por ação, impedindo emissão duplicada em clique repetido ou retry; se a resposta de revelação se perder, o segredo não pode ser reexibido e a recuperação exige rotação.

### Visual/UI Contract *(mandatory if feature touches frontend)*

Esta funcionalidade usa o Google OAuth 2.0 Playground apenas como referência de organização da interação em etapas, seletor pesquisável e console lateral. Não há portabilidade de identidade visual: os tokens, componentes e padrões visuais do FiltroApp continuam obrigatórios, portanto a exceção do Princípio VI não se aplica.

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------------|------------------------|---------------------------|------------------------------|
| Rota administrativa e lista de credenciais | `frontend/src/pages/admin/AdminAccountsPage.tsx`, `frontend/src/modules/moduleRoutes.tsx`, classes `admin-toolbar`, `page-card`, `admin-card-grid` | `Shell`, `TopBar`, `SearchBar`, `Button`, `Skeleton`, badges de estado e cartões do kit existente | Filtros com `SearchBar` e controles compartilhados; ações destrutivas com `ConfirmDialog` e justificativa | N/A | Rotas `/admin/accounts` e `/admin/tokens`; busca, status, escopo e página no query string | Selo “Novo” por 10 dias após a data de implementação e tutorial guiado no primeiro acesso ao painel | Desktop pode usar tabela; em celular cada credencial vira cartão, ações quebram linha, rótulos longos truncam com acesso ao conteúdo e não há rolagem horizontal da página |
| Playground em três etapas | Organização funcional do Google OAuth 2.0 Playground e cartões/métricas de `frontend/src/pages/OperationsPage.tsx` | `Shell`, `TopBar`, `Button`, `SearchBar`, `SearchCombobox`, `HelpTip`, `Skeleton`, cards e badges compartilhados | React Hook Form + esquema compartilhado; `field-group`, `field-invalid`, `field-error`; operações vêm de combobox pesquisável, nunca de texto livre | N/A | `?etapa=configuracao|permissoes|teste` e identificador não secreto da credencial; o segredo nunca entra na URL | O tutorial de 10 dias apresenta as três etapas, risco de token sem expiração e revelação única; pode ser reaberto por “Ajuda” | Em telas largas, etapas/catálogo ficam à esquerda e console à direita; em telas estreitas os blocos empilham, etapas viram seletor compacto e somente áreas de código têm rolagem interna |
| Seletor de permissões | Filtros e cartões de `AdminAccountsPage`; `SearchCombobox` e `HelpTip` compartilhados | Busca, acordeões por domínio, checkbox acessível, badge `Disponível/Sensível/Planejado/Proibido`, resumo fixo no fluxo | Ao menos um escopo habilitado; dependências confirmadas; escopos planejados/proibidos ficam desabilitados com explicação | N/A | Busca e domínio podem ficar no query string; seleção em estado do formulário, não persistida antes da criação | Destaques do tutorial explicam menor privilégio e escopos separados para excluídos/downloads | Uma coluna no celular, resumo deixa de ser fixo e passa ao fim da etapa; textos quebram linha e badges podem envolver |
| Formulário de validade e restrições | Formulários administrativos e diálogos de `AdminAccountsPage` | `Button`, `HelpTip`, controles compartilhados e `Modal` para confirmações | Campos obrigatórios usam padrão vermelho compartilhado; presets e modo personalizado; CIDRs em lista validada; confirmação digitada para “sem expiração” | N/A | Estado do rascunho permanece somente durante o fluxo atual e não contém segredo | Tutorial destaca validade temporária recomendada, rotação e limites | Grade de duas colunas vira uma; unidades permanecem junto aos valores e mensagens de erro não alargam a página |
| Revelação única, rotação e revogação | `frontend/src/components/ui/Modal.tsx`, `ConfirmDialog.tsx`, padrões de diálogo administrativo | `Modal` com corpo rolável/rodapé fixo, `Button`, aviso de risco e confirmação explícita | Copiar por botão; fallback de seleção manual; justificativa obrigatória para revogar e política de sobreposição explícita para rotacionar | N/A | N/A; segredo permanece somente na memória do componente até fechar/recarregar | Faz parte do tutorial de 10 dias e reaparece como aviso contextual em toda emissão | Modal respeita largura da viewport, segredo quebra visualmente sem inserir espaços no valor copiado e rodapé continua acessível |
| Console de requisição e resposta | Cartões operacionais de `OperationsPage` e padrão `page-card` | Painéis com cabeçalhos, badges de status, botão copiar, skeleton e área de código com fonte monoespaçada | Somente parâmetros descritos pela operação; erro no campo específico; resposta truncada com indicação | N/A | Operação e filtros não sensíveis podem ficar no query string; token e conteúdo de resposta não | Tutorial indica autorização redigida e exemplo por variável de ambiente | Requisição e resposta empilham no celular; blocos de código rolam internamente; status, duração e tamanho quebram linha sem overflow global |

### Key Entities *(include if feature involves data)*

- **Credencial de API**: Identidade não humana da integração, com nome, finalidade, responsável, validade, restrições, limites, prefixo identificável, estado derivado, criador, último uso, revogação e eventual credencial substituta.
- **Escopo de API**: Permissão estável e documentada que associa um domínio e operações de leitura a uma projeção explícita de dados, sensibilidade, disponibilidade, dependências e exclusões.
- **Concessão de escopo**: Associação entre credencial e escopo aprovada no momento da emissão/rotação, preservando o conjunto efetivamente concedido.
- **Restrição de recurso**: Limite aplicável a uma credencial, inicialmente projetos permitidos, IPs/faixas, formatos, datas e cotas.
- **Evento de credencial**: Trilha administrativa imutável de criação, revelação, alteração, teste, rotação e revogação com resumo sem segredo.
- **Registro de uso da API**: Evidência resumida de uma requisição externa, com operação, resultado, volume, duração, origem de segurança e identificador de correlação.
- **Contador de uso**: Acumulado por janela usado para aplicar limites de requisições e linhas de forma consistente.
- **Operação de API**: Endpoint permitido e versionado, com método, caminho, parâmetros, escopo exigido, projeção pública e limites.
- **Projeção pública de Qualidade**: Representação externa estável de registro, natureza ou evidência de Qualidade, desacoplada do modelo persistido e sem campos internos.
- **Entrada do catálogo de dados**: Avaliação de um conjunto de entidades do app, sua finalidade, sensibilidade, campos excluídos e estágio de publicação.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa administradora treinada consegue criar uma credencial temporária de Qualidade, copiar o segredo e executar uma consulta de teste em até 5 minutos.
- **SC-002**: 100% das tentativas de abrir ou operar o painel por contas não administradoras são negadas por validação do servidor.
- **SC-003**: 100% dos testes automatizados de matriz de escopos confirmam tanto os acessos permitidos quanto as negações esperadas, inclusive excluídos e evidências.
- **SC-004**: Uma carga de qualquer volume suportado pode ser concluída percorrendo páginas de no máximo 500 itens, sem perda em empates de data e sem resposta individual acima do limite configurado.
- **SC-005**: Revogações e expirações bloqueiam novas chamadas na requisição seguinte; reduções de escopo também passam a valer na requisição seguinte.
- **SC-006**: Nenhuma amostra de log, auditoria, telemetria, URL, listagem ou resposta administrativa contém o segredo completo, seu verificador ou cabeçalho de autorização.
- **SC-007**: A projeção pública de Qualidade passa por testes que garantem ausência de todos os campos proibidos e presença dos campos documentados.
- **SC-008**: O catálogo cobre 100% dos modelos persistidos atuais, cada um associado a um domínio e a uma classificação, sem modelo não avaliado.
- **SC-009**: Nas larguras de 360 px, 768 px e desktop, nenhuma tela nova produz rolagem horizontal no documento, e todas as ações essenciais continuam alcançáveis por teclado e toque.
- **SC-010**: Todas as criações, rotações e revogações aparecem na auditoria com ator, horário e justificativa aplicável; pelo menos 99% das chamadas autenticadas aparecem no registro de uso ou no contador agregado correspondente.

## Assumptions

- A necessidade é uma integração servidor-a-servidor. O destinatário guardará o token em um cofre de segredos e não o usará diretamente em JavaScript de navegador, planilha pública ou URL.
- A solução emite tokens opacos próprios com escopos de leitura; não implementa autorização delegada, consentimento de usuário nem os fluxos do protocolo OAuth 2.0.
- A primeira entrega publica somente operações homologadas de Qualidade. Os demais domínios são catalogados agora e serão habilitados incrementalmente após revisão e testes próprios.
- “Todos os registros de Qualidade” significa todos os registros ativos acessíveis ao escopo e às restrições da credencial. Excluídos lógicos e evidências exigem permissões explícitas separadas.
- O formato principal da primeira entrega é JSON. Downloads de arquivos mantêm seus tipos originais; formatos tabulares adicionais dependem de operação documentada e limite próprio.
- A validade temporária é o padrão recomendado; credenciais sem expiração continuam disponíveis por solicitação do negócio, mas recebem controles e alertas adicionais.
- A autenticação de contas e a definição existente de `accountType = ADMIN` continuam sendo a fonte de autoridade para o painel.
- O catálogo de escopos é mantido como contrato versionado da aplicação, não como permissão livre criada por administradores.
- Os endpoints externos usam uma base versionada distinta das rotas de sessão e nunca aceitam a sessão humana como substituta de token.
- O prazo de 365 dias para auditoria é a referência inicial e pode ser reduzido por obrigação jurídica ou política de privacidade formalmente aprovada.
