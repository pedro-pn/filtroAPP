# Classificação de colaboradores

Administradores acessam **Administração → Colaboradores e classificação** (`/admin/workforce`).

O cadastro conserva todos os colaboradores. A participação em módulos operacionais é uma decisão local do filtroAPP, independente da situação do vínculo no RH e das permissões de login da conta.

| Classificação aplicada | EPI por padrão | Demais listagens por padrão |
| --- | --- | --- |
| Operacional | Permitido | Permitido |
| Não operacional | Permitido | Bloqueado |
| Aguardando classificação | Permitido | Bloqueado |

A aba **Visibilidade por módulo** permite ao ADM alterar esses padrões. A situação do vínculo, o acesso a projetos e as permissões do usuário continuam sendo verificados independentemente da classificação.

## Administração

A aba de colaboradores permite buscar por nome, código e matrícula, filtrar cargo, setor, situação, classificação ou divergência com o Conecta. A seleção em lote limita a alteração à página selecionada (até 100 pessoas na interface). A API aceita até 200 pessoas por transação.

Em **Padrões por cargo**, a classificação é aplicada às pessoas que herdam o cargo. Uma classificação individual tem precedência. Escolher **Herdar padrão do cargo** remove a exceção individual. O setor é informativo e não concede participação automaticamente.

Toda alteração exige motivo e a versão que estava sendo visualizada. Um conflito de versão desfaz o lote completo. O histórico registra antes/depois, motivo, data e autor; o histórico individual deve ser consultado em conjunto com o do cargo quando há herança.

Os editores existentes de cargo continuam respeitando suas permissões. Ao alterar a opção Operacional, também atualizam a classificação local e o histórico. Alterações de nome, cor ou limite de permanência não classificam o cargo implicitamente.

## Visibilidade por módulo

Em **Visibilidade por módulo**, cada linha é uma listagem e cada coluna é uma classificação. O ADM pode permitir qualquer combinação, inclusive nenhuma classificação, separadamente para RDO, planejamento do Efetivo, conferência de alocação, produtividade e ausências, Acompanhamento e ponto, supervisores de equipamentos, Romaneio e logística, API de integrações e EPI.

A interface apresenta o antes/depois antes de salvar, exige motivo e controla a versão da configuração. Uma edição desatualizada recebe `VISIBILITY_VERSION_CONFLICT`, sem gravar alterações parciais. **Restaurar padrão** apenas prepara o formulário; o ADM precisa salvar com motivo. O histórico registra a matriz anterior e a nova, o autor e a data.

A matriz é global e não altera a classificação de nenhuma pessoa. A API de integrações tem sua própria regra, aplicada também ao playground. A regra controla consultas, seletores e novas inclusões por ID. Na administração do cadastro e no vínculo de contas, todas as pessoas continuam disponíveis para revisão. Entregas e assinaturas de EPI já existentes permanecem acessíveis pelas permissões habituais.

A configuração é persistida na chave reservada `workforce.visibility.v1` de `EfetivoSetting`. Backend e worker carregam a matriz antes de iniciar e consultam a versão a cada cinco segundos. Cada requisição mantém uma configuração consistente; caches são separados por listagem e versão. Se uma atualização periódica falhar, o processo mantém a última configuração carregada e registra a falha. Uma configuração inválida impede a inicialização.

Restringir uma classificação no planejamento do Efetivo sinaliza as missões futuras ou em andamento afetadas para replanejamento. Não apaga equipes, documentos ou dias já conferidos. Mudanças na regra da API invalidam os cursores de paginação anteriores; o consumidor deve reiniciar a paginação.

## Sincronização e restrições

O Conecta atualiza nome, cargo, vínculo e a classificação de origem separadamente. Receber um vínculo ou uma mudança de cargo nunca torna um cargo operacional automaticamente nem apaga exceções locais. Cargos novos recebidos sem regra local ficam aguardando classificação. Uma pessoa nova recebida como não operacional em um cargo local operacional aguarda revisão individual.

A política compartilhada em `backend/src/lib/collaborators/workforce-policy.js` aplica a matriz aos seletores, Efetivo, produtividade, conferência, equipes de relatórios, supervisão de equipamentos, EPI e consultas externas. Escritas autenticadas e integrações validam os IDs de colaboradores; os serviços de alocação, equipe, ausência e relatório também validam a política. Administração do cadastro e recepção de RH conservam os dados de todos os setores. O Conecta não modifica a matriz definida pelo ADM.

Registros históricos e consultas financeiras que os utilizam não são excluídos ou recalculados por uma reclassificação. Missões futuras ou em andamento afetadas são sinalizadas para replanejamento. Alocações e documentos antigos permanecem armazenados.

## Implantação e revisão inicial

1. Fazer o backup habitual do banco antes da implantação.
2. Gerar o cliente Prisma e aplicar `20261118150000_workforce_classification`, `20261118160000_workforce_visibility` e `20261118170000_workforce_classification_read_revision` pelo fluxo normal de migrações (`prisma migrate deploy`). A última mantém a nova tabela de auditoria no mecanismo compartilhado de invalidação de cache. Backend, worker e frontend devem usar a mesma versão.
3. A migração recupera a classificação original dos agregados Conecta, restringe vínculos não operacionais, conserva cargos locais já não operacionais e registra a classificação inicial. Ela não remove colaboradores, entregas de EPI, dias conferidos ou alocações.
4. Revisar **Padrões por cargo**, os filtros **Aguardando classificação** e **Somente divergências com o Conecta**, e a aba **Visibilidade por módulo**, definindo as exceções de negócio no aplicativo. A migração da visibilidade mantém o padrão da tabela acima e preserva uma configuração já existente.
5. Depois da revisão, os consumidores externos devem reconciliar a lista completa e reler os períodos da conferência. Registros de classificações desabilitadas saem das consultas; dados já copiados no sistema consumidor precisam ser reconciliados por ele.

O teste `backend/test/workforce-classification.integration.test.js` usa PostgreSQL WASM descartável com Prisma real, sem acessar o banco da aplicação. Ele executa a migração real e cobre herança, exceções, conflitos de versão, autorização HTTP, sincronização, replanejamento e preservação do histórico.

`backend/test/workforce-visibility.integration.test.js` usa o mesmo banco descartável para validar a migração da matriz, filtros e inclusões por ID em diferentes listagens, seleção vazia, cargos disponíveis, autorização do ADM, concorrência, auditoria, caches, propagação entre processos, API Bearer e invalidação de cursores.
