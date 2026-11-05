# Correção — coleção de status com páginas de 100

05/11/2026. Implementação local, sem deploy nem migração.

## Diagnóstico

O avanço já era carregado em lote por `computeProgressDetailsForProjects`.
O N+1 estava no outro ramo de `enrichEfetivoProjectStatuses`: um
`getProjectWorkflow` completo por projeto, disparado em paralelo para toda
a página. Além das relações do workflow, cada chamada carregava históricos,
eventos, orçamento e, nas etapas de planejamento/preparação/mobilização,
catálogos de equipe, equipamentos e estoque. Esses dados não eram publicados
no resumo, mas multiplicavam as consultas e a concorrência pelo pool.

Os erros de espera pelo pool e de execução no PostgreSQL/Prisma chegavam ao
tratador genérico sem conversão para `REQUEST_TIMEOUT`, permitindo resposta
500 antes do timeout HTTP de 15 segundos.

Essa estrutura foi confirmada no código. Os três requestIds do relato não
constam nos arquivos de logs nem na tabela `ApiRequestLog` do PostgreSQL local
consultado. Sem os logs de produção, não foi possível confirmar qual erro
exato gerou cada uma das três respostas 500.

## Alteração

- Coleção e status individual usam `getProjectWorkflowStatuses`: uma carga
  dos projetos da página e de suas relações necessárias ao resumo, sem chamar
  o detalhe por projeto. A ordem da página é preservada por ID.
- Os gates reutilizam as regras existentes. Foram preservados documentos,
  fatos comerciais, questões críticas, equipe e checks de materiais/equipamentos,
  inclusive a seleção legada de uma categoria sem IDs explícitos.
- O avanço continua no cálculo oficial, com as mesmas fontes, sem cache novo.
  `MANUAL`, `RDO`, `null` e percentuais acima de 100% são preservados.
- Timeouts de execução/lock no PostgreSQL, Prisma (`P1002`/`P1008`/`P2024`), driver e pool
  retornam `504 REQUEST_TIMEOUT`, com o mesmo código na auditoria. Um resultado
  tardio após timeout HTTP também é registrado como timeout, sem log duplicado
  ou sucesso indevido.

## Medição e regressões

Teste HTTP com Bearer real, Prisma e PostgreSQL descartável via PGlite: **90
projetos, 72 workflows e 600 RDOs**, com avanço por RDO, manual e sem fonte.
A meta automática é **menos de 5 segundos** para `limit=100`.

Na validação final, a página respondeu **200 em 346,3 ms**; na suíte
completa, **439,3 ms**, incluindo autenticação,
cotas e auditoria. Foram **41 SELECTs**, exatamente o mesmo total com `limit=10`.
A contagem inclui as relações carregadas pelo Prisma: cada fonte de avanço é
consultada uma vez com os IDs da página. A medição é local e sintética; não é
uma medição do ambiente de produção.

As regressões cobrem `limit=100` com/sem `active=true`, recorte SELECTED e suas
fontes autorizadas, paridade com o workflow detalhado, status individual e
`/acompanhamento/projetos/custos`, gates liberados/bloqueados e timeouts de
consulta, pool, driver e HTTP. O teste foi incluído no job Omni do CI.

Validação: suíte completa do backend com **2.673 aprovados, 38 ignorados e zero
falhas**, regressão isolada com **7 aprovados** e rodada final de regressão,
autenticação e observabilidade com **17 aprovados**, `npm run architecture:check`
e `git diff --check` aprovados. Os testes usaram `NODE_ENV=development`, uma
`DATABASE_URL` sintética não conectável e concorrência 4; os cenários PGlite
executaram em banco descartável.

A falha intermitente do CI também revelou que a auditoria podia confundir uma
sequência numérica dentro de um UUID com CPF e substituir o requestId.
UUIDs válidos agora são preservados; os demais dados sensíveis continuam
ocultados. Há regressões unitárias e HTTP com UUIDs que reproduzem esse caso.
A rodada adicional de auditoria, autenticação, isolamento, status e Gestão
passou com 31 testes no Node 22.
A suíte completa repetida com Node 22 e PostgreSQL 16 isolado terminou com
**2.686 aprovados, 31 ignorados e nenhuma falha**.

A validação adicional identificou falta de isolamento no transporte PGlite:
o pool simulado entregava a mesma sessão para consultas e transações simultâneas.
O helper agora reserva essa sessão até o `release`, inclusive para leituras.
Uma regressão reproduziu a leitura de dados não confirmados antes da correção
e valida que uma leitura externa só observa o estado persistido após rollback.
Os testes de isolamento, status e Gestão passaram com Node 22, como no CI.

## Publicação

Publicar o backend e conferir a coleção em produção com `limit=100`, com/sem
`active=true`, registrando tempo e requestId. Depois dessa conferência, o Omni
pode voltar a usar páginas de 100. O cliente do Omni não foi alterado nesta entrega.
