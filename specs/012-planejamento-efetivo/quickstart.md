# Quickstart: Planejamento Completo do Efetivo Operacional

## Pré-requisitos locais

- Node.js e npm nas versões aceitas pelo repositório.
- PostgreSQL de desenvolvimento acessível pela `DATABASE_URL` já usada pelo backend.
- Dependências do monorepo instaladas sem modificar versões fora desta feature.

Não use nem encerre processos que já ocupem `localhost:5173`. Escolha uma porta livre para o frontend desta branch.

## Preparação local

Na raiz do repositório:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run prisma:generate
```

Para um banco descartável de desenvolvimento, aplique a migração versionada pelo comando já previsto no projeto:

```bash
npm --prefix backend run prisma:migrate
```

Esse comando é somente para ambiente local controlado. Migração em produção e reinício de serviços são responsabilidade do operador e não fazem parte da execução automática desta feature.

Na implantação desta entrega, execute o diagnóstico contra uma cópia autorizada ou diretamente no banco de destino durante a janela controlada, antes de aplicar a migration:

```bash
node backend/scripts/backfill-collaborator-job-roles.mjs --dry-run
```

O diagnóstico lista em `rolesToCreate` os nomes legados não vazios que serão criados como cargos canônicos provisórios. O gate aprova a migration quando indicar `readyForMigration: true`; somente nomes vazios ou correspondências ambíguas permanecem bloqueantes. Revise a lista e então materialize os cargos e vínculos:

```bash
node backend/scripts/backfill-collaborator-job-roles.mjs --apply
npm --prefix backend run prisma:deploy
npm --prefix backend run prisma:generate
```

O modo `--dry-run` é idempotente e não modifica dados. O `--apply` cria uma única função por chave normalizada ausente e atualiza `Collaborator.jobRoleId`; a migration repete essa materialização como proteção idempotente, cria o override EPI relacional, os snapshots e o calendário compartilhado antes de remover as colunas textuais antigas. Os cargos provisórios podem ser renomeados manualmente depois. Execute essa sequência a partir do artefato da nova versão antes de liberar o novo backend para tráfego.

Se algum ambiente já tiver registrado esta migration como falha antes da correção, o operador deve primeiro marcar a tentativa como revertida e então reaplicá-la:

```bash
# rode no servidor
cd backend
npx prisma migrate resolve --rolled-back 20260826160000_centralize_workforce_planning
npm run prisma:deploy
```

## Execução

Use os scripts existentes do backend e frontend em terminais separados. Se o Vite informar que 5173 está ocupado, aceite a próxima porta livre; não mate nem altere o processo existente.

## Validação automatizada

Executar da raiz, direcionando cada comando ao pacote que declara o script:

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend test
npm --prefix frontend test
npm run architecture:check
```

No backend, executar os testes de unidade e comportamento do Efetivo, incluindo:

- datas civis, dias úteis e feriados;
- capacidade e utilização móvel de 90 dias;
- conflito de ausência e dupla alocação;
- centralização de cargo, diagnóstico/backfill e invalidação de planejamento após troca canônica;
- override de cargo exclusivo do EPI e snapshots imutáveis em solicitação/PDF;
- calendário corporativo idêntico na capacidade e na hora extra;
- ausência superveniente, justificativa do RDO e alertas sem perda de horas do Ponto;
- prefill do RDO, RBAC sanitizado e projeção planejado × realizado;
- regressão de `laborCollaboratorIds` e do rateio existente no Acompanhamento;
- cronologia/demanda e autoalocação;
- permanência contínua e alertas de férias;
- isolamento, rollback, concorrência e idempotência de cenários;
- regressão da Produtividade baseada no Ponto Mais.

No frontend, validar helpers de calendário, URL e Kanban, além do build TypeScript.

## Roteiro funcional mínimo

1. Entrar com `efetivo:manager` e abrir `Efetivo > Administração`.
2. Marcar funções operacionais, definir cores/prazos e cadastrar um feriado.
3. Em `Colaboradores`, vincular funções/admissões e criar uma folga de teste.
4. Em `Missões`, selecionar um projeto, informar a cronologia e escolher diretamente colaboradores pelo nome/cargo.
5. Salvar e conferir que demanda por função e equipe foram derivadas das pessoas selecionadas.
6. Tentar incluir uma pessoa em folga ou em outra missão e verificar o conflito com pessoa, período e caminho do registro, sem alteração parcial.
7. Validar a missão no calendário diário, semanal e mensal.
8. Conferir na Visão geral os totais, déficit, mobilizações e utilização de 90 dias.
9. Mover a missão no Kanban por arraste e pela alternativa acessível; cancelar um arraste e confirmar rollback visual.
10. Criar um cenário, alterar demanda, adicionar contratação hipotética e comparar com o oficial.
11. Descartar o primeiro cenário e verificar que o oficial não mudou.
12. Criar outro, aplicar e confirmar uma única troca do oficial e um evento de auditoria.
13. Abrir Produtividade e confirmar que os valores permanecem derivados somente do ponto.
14. Alterar o cargo canônico e confirmar a mesma leitura em Efetivo, RDO, Acompanhamento e EPI.
15. No EPI, escolher um cargo anterior, criar uma solicitação, limpar o override e confirmar que novas telas voltam ao cargo atual enquanto a solicitação mantém o snapshot anterior.
16. Abrir um RDO na data de missão confirmada, validar o prefill da equipe, alterar a equipe realizada e confirmar que a missão não foi reescrita.
17. Abrir o Acompanhamento e conferir os blocos Planejado, Observado e Exceções manuais separados.
18. Cadastrar ausência sobre missão já confirmada, confirmar que a ausência é salva e a missão fica pendente; tentar nova alocação sobre ausência e confirmar bloqueio.
19. Registrar trabalho no RDO durante a ausência, confirmar motivo obrigatório/auditoria e verificar que horas do Ponto são preservadas com divergência.
20. Cadastrar feriado manual e confirmar o mesmo tratamento na capacidade do Efetivo e no cálculo de hora extra de um novo RDO, sem recalcular RDO histórico.
21. Abrir a comparação de execução e conferir datas, equipe planejada/observada, horas, pendências do Ponto e sugestão de etapa sem movimentação automática.

## Matriz visual

Validar no mínimo 1440×900, 768×1024 e 390×844:

- nenhuma página produz scroll horizontal global;
- calendário mensal vira agenda vertical em 390 px;
- tabela de colaboradores vira cards com rótulos;
- Kanban vira seletor de etapa + lista única;
- modais mantêm cabeçalho/rodapé visíveis e corpo rolável;
- campos obrigatórios vazios exibem borda, `aria-invalid` e mensagem;
- combobox funciona com teclado, toque, loading, vazio, disabled e erro;
- seção, data, visão, filtros e item selecionado sobrevivem ao refresh.

## Evidência e entrega

- Registrar resultados de lint, build e testes.
- Capturar evidência visual apenas após dados de teste estarem consistentes.
- Não incluir cookies, tokens, nomes reais ou outros dados sensíveis em screenshots/logs.
- Entregar a migração para o operador executar no ambiente de destino conforme o procedimento vigente.

## Evidência final das integrações — 2026-08-26

Validações executadas após centralização de cargo, calendário compartilhado e planejado × realizado:

- backend: `150/150` arquivos aprovados com `DATABASE_URL` apenas sintática, sem conexão ou escrita em banco;
- frontend: `24/24` arquivos aprovados;
- lint frontend: zero erros e um aviso preexistente fora das superfícies alteradas, em `OmieCostCategoriesPanel.tsx`;
- build frontend: TypeScript e Vite aprovados, com 544 módulos transformados; permanece o aviso conhecido de chunk principal acima de 500 kB;
- Prisma: `validate` e `generate` aprovados para o schema final;
- arquitetura: `npm run architecture:check` aprovado;
- contratos OpenAPI: os dois arquivos YAML carregados com sucesso;
- higiene do diff: `git diff --check` aprovado.

Correção adicional do bootstrap de cargos, validada na mesma data:

- nomes legados não vazios sem cadastro são planejados e criados uma única vez por chave normalizada;
- todos os colaboradores com variantes equivalentes são vinculados ao mesmo `JobRole` e uma segunda execução não cria duplicatas;
- cargos usados somente pelo override EPI entram na mesma materialização;
- nomes vazios e duplicidades normalizadas existentes no catálogo continuam bloqueantes;
- a migration contém a proteção SQL equivalente antes do vínculo e do `jobRoleId NOT NULL`.

O code-review-graph foi reconstruído por completo e registrou 12.170 nós, 65.095 arestas, 970 fluxos e 11 comunidades. `detect_changes` classificou o diff amplo como alto risco (`0,95`) e `get_affected_flows` encontrou 351 fluxos potencialmente atingidos. A associação automática `tests_for` reconheceu cobertura para parte dos símbolos rastreados, mas não associou vários helpers novos e testes focais; essa limitação foi compensada pelas regressões específicas de cargo/EPI, calendário/workforce, contexto oficial e execução, além das suítes completas acima. Nenhum risco bloqueante permaneceu após a revisão.

Limitações e ações deliberadamente não executadas nesta sessão:

- a migration versionada não foi aplicada em banco local, homologação ou produção;
- o diagnóstico/backfill não foi executado contra dados reais, portanto o operador ainda deve cumprir o gate `--dry-run` → correção de pendências → `--apply` antes do deploy da migration;
- o módulo Efetivo ainda não possui dados produtivos e sua estrutura própria pode ser remodelada diretamente; colaboradores, cargos, EPI, RDO, Ponto e Acompanhamento continuam protegidos pelos gates e snapshots da migration;
- o teste PostgreSQL transacional de concorrência permaneceu desabilitado por exigir banco descartável migrado; o teste unitário do lock passou na suíte comum. Para executá-lo: `cd backend && EFETIVO_DB_TESTS=1 DATABASE_URL=<banco-descartavel> node --test test/efetivo-allocation-concurrency.test.js`;
- não houve deploy, reinício de serviço, escrita externa nem validação manual autenticada no navegador.

## Evidência anterior registrada em 2026-08-26

As evidências abaixo descrevem o estado do módulo antes das integrações deste plano. Elas não substituem a reexecução dos gates após centralização de cargo, calendário compartilhado e planejado × realizado.

Validações executadas nesta branch:

- backend: `139/139` arquivos de teste aprovados com `NODE_ENV=test` e uma `DATABASE_URL` sintática, sem conexão nem escrita no banco de desenvolvimento;
- frontend: `23/23` arquivos de teste aprovados;
- lint frontend: zero erros e um aviso preexistente fora do módulo (`OmieCostCategoriesPanel.tsx`);
- build frontend: TypeScript e Vite aprovados; permanece apenas o aviso conhecido de chunk principal acima de 500 kB;
- Prisma: `generate` e `validate` aprovados para o schema novo;
- arquitetura: verificação do repositório aprovada;
- contrato OpenAPI: YAML válido;
- visual funcional em `localhost:5175`: criação com duas pessoas de cargos diferentes, demanda derivada `1/1` por cargo, edição com pré-seleção, remoção de uma pessoa, exclusão lógica da programação e retorno do projeto à lista pendente; os dados de teste foram removidos ao final;
- visual em sessão limpa: lista com 47 colaboradores e seus cargos, busca por `mantenedor`, seleção com resumo `Mantenedor I · 1` e zero erros no console;
- concorrência PostgreSQL real: `2/2` casos aprovados no container local `filtrovali-local-backend`, incluindo duas transações simultâneas disputando o mesmo colaborador; apenas uma alocação foi persistida e os dados aleatórios do plano de cenário foram removidos pelo próprio teste.

Medição sintética da projeção diária + utilização de 90 dias, com 500 colaboradores, 100 missões confirmadas e 500 alocações:

- antes do índice em memória por colaborador: `4273,59 ms`;
- depois do índice em memória de ausências/missões e agregação única de demanda: `138,96 ms`;
- ganho observado na mesma execução: aproximadamente `30,8×`.

Pendências exclusivamente operacionais (revisadas em 2026-08-26):

- nenhuma migração foi criada ou aplicada por este ajuste; o banco PostgreSQL local fornecido pelo usuário já estava migrado;
- o teste de concorrência permanece ignorado por padrão nas suítes comuns; para repeti-lo, use `EFETIVO_DB_TESTS=1 DATABASE_URL=<banco descartável> node --test test/efetivo-allocation-concurrency.test.js` a partir de `backend/` (ele cria e remove os próprios dados em um plano de cenário, sem tocar no planejamento oficial);
- somente o backend local foi reiniciado para carregar as correções; banco e frontend do ambiente Docker fornecido não foram reiniciados;
- a auditoria visual reutilizou `localhost:5175` e encerrou apenas a sessão automatizada do navegador ao final.
