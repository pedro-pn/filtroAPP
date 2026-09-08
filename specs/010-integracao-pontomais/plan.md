# Implementation Plan: Integração VR Ponto Mais

**Branch**: `feat/integracao-pontomais` | **Date**: 2026-08-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-integracao-pontomais/spec.md`

## Summary

Substituir o envio semanal do XLSX por uma sincronização automática com o VR Ponto Mais, sem trocar o contrato interno que alimenta o cálculo de mão de obra. Na primeira execução, o backend descobrirá a admissão mais antiga entre colaboradores ativos e inativos e percorrerá continuamente todo o histórico até o dia corrente em lotes retomáveis de até 31 dias, sem pausar entre grupos de lotes. Depois, às 03:00 de cada dia em `America/Sao_Paulo`, relerá os 31 dias encerrados ontem para absorver correções tardias. Cada lote só avança o cursor persistente depois da publicação atômica em `PontoImport`/`PontoPeriodSummary`.

O cálculo passa a publicar dois eixos deliberadamente diferentes. O eixo contábil, usado na aba Custos, conserva uma única jornada e uma única folha mensal com pesos normalizados. O eixo analítico, usado nos cards e detalhes, pode repetir a jornada integral do Ponto Mais em cada projeto confirmado de um agrupamento `SHARED_EXECUTION`; grupos `CONSOLIDATE_PRIMARY` apropriam uma única vez na missão principal e grupos `VISUAL_ONLY` preservam a regra anterior. Etiquetas reconhecidas definem projetos, RDOs confirmam participação e `EM VIAGEM` fornece contexto de deslocamento. Quando nenhuma evidência do próprio dia resolve o destino, a data exata de mobilização combinada com um RDO posterior do mesmo colaborador pode confirmar o projeto. Pendências continuam sendo o fallback seguro fora de políticas explícitas.

## Technical Context

**Language/Version**: JavaScript ESM no backend (Node.js atual do projeto) e TypeScript 5.8/React 19 no frontend

**Primary Dependencies**: Express 5, Zod 4, Prisma 7, PostgreSQL, React Query 5, Axios, react-hook-form, Driver.js; `fetch` nativo do Node para o serviço externo

**Storage**: PostgreSQL via Prisma; resumos diários permanecem no JSON mensal versionado de `PontoPeriodSummary`; `PontoSyncState` guarda o cursor; `PontoExternalEmployee` guarda o escopo; `AcompanhamentoMissionGroup` guarda a política de mão de obra e o projeto principal opcional

**Testing**: `node --test` em `backend/test/*.test.js`, testes frontend em `frontend/test/*.test.mjs`, build TypeScript/Vite e validação manual pelo quickstart

**Target Platform**: Serviço web Linux e navegadores desktop/mobile já suportados pelo aplicativo

**Project Type**: Aplicação web com backend e frontend separados

**Performance Goals**: Sincronizar cada lote de até 31 dias em até 60 segundos quando o fornecedor responder normalmente; processar todos os lotes históricos restantes na mesma execução de bootstrap; painel indica cobertura/progresso sem bloquear a navegação

**Constraints**: Paginação externa de até 500 linhas; token somente no servidor; nenhuma resposta parcial é publicada; cada consulta cobre no máximo 31 dias; cursor só avança após sucesso; exclusão mútua entre instâncias; retry limitado a falhas transitórias; custo contábil conservado em centavos; custo analítico não conservado por definição; compatibilidade de leitura com XLSX histórico

**Scale/Scope**: Conta atual com centenas de colaboradores ativos/inativos consultáveis, aproximadamente 1.200 batidas por quinzena na amostra inicial; um painel existente, três recursos externos e um fluxo de cálculo afetado

## Constitution Check

**Resultado pré-design**: PASS.

- Nenhuma operação de servidor ou deploy será executada; este plano cobre código e validação local.
- A interface permanece pt-BR e mobile-first, sem tabela ou controle que gere scroll horizontal da página.
- Rotas de contingência e vínculos usam Zod no backend; o fluxo automático não depende de formulário no frontend.
- A mudança de schema será uma migration Prisma versionada.
- Cliente, normalização, persistência e rateio recebem testes em `backend/test`.
- O painel passa a usar componentes do kit, estados de campo compartilhados e tokens existentes.
- Não há drag-and-drop; a subaba gerencial usa o parâmetro URL `pontoDetalhe`, com resumo como padrão.
- A novidade existente passa a explicar o estado automático e o diretório de colaboradores, por usuário/navegador, mantendo sua expiração global.

### Required visual evidence

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Painel “Ponto (jornada)” | `frontend/src/components/projects/PontoImportPanel.tsx` | `Button`, `ToastContext`, `page-card`, `sec`, `placeholder-copy`, `acp-seg`, `acp-table` | Estados de configuração, bootstrap, atualização diária, execução, falha e ignorado/considerado; não há período/upload no fluxo normal | N/A | Subaba gerencial persistida por `pontoDetalhe`; resumo é o padrão | O guia existente passa a apontar a automação e a subaba de colaboradores, expirando conforme a campanha já versionada | Resumo e ações empilham; pendências, diretório e históricos usam rolagem vertical local com foco; textos longos quebram com `min-width: 0` |

## Project Structure

### Documentation

```text
specs/010-integracao-pontomais/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/acompanhamento-pontomais-api.md
└── tasks.md
```

### Source Code

```text
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/<timestamp>_add_pontomais_sync/
├── src/
│   ├── config/env.js
│   ├── lib/pontomais/
│   │   ├── client.js
│   │   ├── job.js
│   │   ├── normalize.js
│   │   └── sync.js
│   ├── lib/acompanhamento/
│   │   ├── ponto-import.js
│   │   └── labor-cost.js
│   └── routes/resources/acompanhamento-ponto.js
└── test/
    ├── pontomais-client.test.js
    ├── pontomais-job.test.js
    ├── pontomais-sync.test.js
    └── acompanhamento-labor-cost.test.js

frontend/
├── src/
│   ├── api/acompanhamentoPonto.ts
│   ├── auth/moduleNavigation.ts
│   └── components/projects/
│       ├── PontoImportPanel.tsx
│       └── PontoMaisSyncNovelty.tsx
└── test/
```

**Structure Decision**: Manter a divisão atual backend/frontend. A integração externa fica isolada em `backend/src/lib/pontomais`; o adaptador grava no modelo canônico do Acompanhamento, e a regra de rateio continua em `labor-cost.js`. O painel atual é evoluído, sem página ou módulo novo.

## Design Decisions

1. **Publicação transacional**: a tentativa é auditada antes da coleta, mas `PontoImport` e todos os resumos só são criados juntos após validar colaboradores, jornadas e batidas. Falhas atualizam apenas a auditoria.
2. **Compatibilidade do consumidor**: snapshots da API usam `PontoImport.source = PONTOMAIS_API`; planilhas históricas permanecem `XLSX`. `mergePontoPeriods` continua escolhendo a versão mais recente de cada colaborador/dia.
3. **Identidade externa estável**: vínculo persistido por ID externo tem prioridade; depois vêm matrícula, CPF único e nome único. O ID externo vira a chave do resumo e evita colisão entre homônimos.
4. **Horas extras explícitas e genéricas**: percentuais 70/100 do Ponto Mais são preservados por dia. Itens sem percentual permanecem em um bucket diário genérico e recebem o teto/reclassificação mensal legado; snapshots de planilha continuam usando o mesmo bucket genérico.
5. **Etiquetas por dia**: todas as etiquetas não vazias das batidas do colaborador/data são preservadas. Somente “Missão <código>” ou alias manual inequívoco resolve projeto; centro de custo não substitui etiqueta.
6. **Dois eixos de apropriação**: o eixo contábil mantém pesos diários somando 1 e alimenta a aba Custos. O eixo analítico alimenta cards/detalhes e admite peso 1 simultâneo em cada projeto somente quando a política do grupo autoriza execução compartilhada.
7. **Conservação monetária delimitada**: o motor calcula uma única folha mensal no eixo contábil. Valores são fechados em centavos e o resíduo vai para sede, folga ou maior peso. O custo analítico usa a mesma base horária real, mas é calculado independentemente em cada projeto e não é reconciliado contra a folha agregada.
8. **Descoberta histórica**: `/employees` é consultado para ativos e inativos com `admission_date`/`initial_date`; a menor data válida inicia o cursor. Ausência de data válida falha de modo visível, sem assumir um corte parcial.
9. **Bootstrap retomável e contínuo**: `PontoSyncState` é um singleton. A primeira execução processa todos os lotes consecutivos de até 31 dias até alcançar a data corrente, sem um teto artificial por ciclo, e atualiza `nextPeriodStart`/`historyThrough` somente após o respectivo `runSync` concluir.
10. **Atualização diária móvel**: ao concluir o bootstrap, a cobertura histórica inclui hoje, mas a referência diária permanece ontem. Nos dias seguintes, após 03:00 BRT, a rotina relê os 31 dias encerrados ontem; assim o dia provisório do bootstrap é substituído depois de fechado e a rotina diária não publica jornadas correntes incompletas.
11. **Execução distribuída**: o agendador usa `runTrackedJob` e `JobLock` com TTL compatível com o bootstrap, além da admissão atômica de `PontoSyncRun`. Múltiplas instâncias e chamadas manuais não publicam lotes concorrentes.
12. **Observabilidade sem operação manual**: `GET /integration-status` agrega o estado automático e a última auditoria. A tela vira monitor/reconciliação; o formulário de período e o upload deixam de ser necessários e de aparecer como fluxo normal.
13. **Pendência derivada, não verdade permanente**: a auditoria preserva a pendência observada no lote, mas `GET /pending` reexecuta a regra normal com os snapshots API já armazenados, vínculos, projetos e RDOs atuais. Isso descobre retroativamente conflitos que a versão anterior não registrava e remove resíduos históricos sem reescrever auditoria.
14. **Escopo externo reversível**: cada colaborador retornado por `/employees` atualiza `PontoExternalEmployee`. Ignorados continuam no diretório/auditoria, mas são descartados na normalização e filtrados antes de consolidar o custo, inclusive para snapshots já existentes.
15. **Fallback conservador de missão mesclada**: a regra normal continua prioritária. Se ela não produzir alocação, todas as etiquetas reconhecidas pertencerem ao mesmo grupo ativo e somente um projeto desse grupo tiver RDO do colaborador/data, esse RDO recebe peso 1. Mais de um RDO do grupo, nenhum RDO ou ausência de etiqueta mantém a pendência, evitando desempate arbitrário.
16. **Precedência do RDO sobre etiqueta divergente**: uma etiqueta única deixa de prevalecer quando não corresponde aos RDOs do colaborador/data. Um único RDO divergente recebe peso 1 e resolve o dia automaticamente; dois ou mais RDOs divergentes mantêm o dia não apropriado até uma escolha gerencial persistida, auditada e aplicada antes das evidências automáticas.
17. **Revisão canônica e replay reparador**: `PontoSyncState` registra a revisão publicada e a revisão-alvo. Um incremento reinicia o cursor em `historyStart` uma única vez, preserva o alvo durante falhas e só promove a revisão depois de recompor todos os lotes até a data corrente. Isso corrige snapshots anteriores sem operação manual e sem perder retomabilidade.
18. **Política explícita por grupo**: `AcompanhamentoMissionGroup` recebe `laborAllocationMode` com padrão `VISUAL_ONLY` e `primaryLaborProjectId` obrigatório apenas em `CONSOLIDATE_PRIMARY`. O backend valida que o principal é membro ativo e a interface gerencial apresenta os efeitos antes de salvar.
19. **Execução compartilhada segura**: a replicação automática só ocorre quando pelo menos dois RDOs do colaborador/data pertencem exclusivamente ao mesmo grupo `SHARED_EXECUTION` e não há etiqueta resolvida fora dele. No eixo contábil esses mesmos candidatos são normalizados; no analítico cada um recebe peso 1.
20. **Consolidação excepcional**: em `CONSOLIDATE_PRIMARY`, evidência de qualquer membro é redirecionada uma única vez para o projeto principal. Esse modo atende o agrupamento operacional em torno da 5761 sem transformar a exceção em regra global.
21. **Semântica da viagem**: `EM VIAGEM` e variações são detectadas separadamente do resolvedor de missão. O marcador força contexto de viagem para as horas confirmadas do dia, inclusive em cada cópia analítica compartilhada, mas nunca cria candidato de projeto.
22. **Compatibilidade de consumidores**: `computeCollaboratorRates.byProject` permanece como distribuição contábil; uma nova projeção `analyticalByProject` alimenta `laborCostByProject` e os colaboradores do detalhe. Assim a aba Custos não muda de total e os cards passam a refletir o consumo completo.
23. **Viagem confirmada pela mobilização**: somente depois de escolhas manuais e evidências do próprio dia, uma tag normalizada de viagem pode usar `Project.mobilizationDate` igual à data do ponto e um RDO posterior do mesmo colaborador como confirmação de destino. A regra não copia as horas desse RDO para o dia de viagem. Um candidato único recebe a jornada do Ponto; múltiplos candidatos seguem `SHARED_EXECUTION`/`CONSOLIDATE_PRIMARY` ou permanecem pendentes quando incompatíveis.

## Post-Design Constitution Check

**Resultado**: PASS.

- A migration, contratos e modelo seguem Prisma/Zod e não introduzem tecnologia fora da stack.
- O token não atravessa a API interna e erros externos são sanitizados.
- Testes cobrem a regra financeira e a publicação atômica.
- O painel usa o kit compartilhado, comportamento mobile e novidade temporária.
- Não há violação a justificar.

## Complexity Tracking

Nenhuma violação da constitution requer justificativa.
