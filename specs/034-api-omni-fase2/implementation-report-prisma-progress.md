# Entrega para o Omni — vínculo Prisma e avanço oficial

04/11/2026. Implementação local; publicação e aplicação da migração pendentes.
Contrato de consumo: [prisma-progress.md](contracts/prisma-progress.md).

## Pendência 2: identidade oficial da missão

`GET /api/integracoes/v1/projetos` passa a retornar `prisma`, com os nomes finais
`missionId`, `number` e `numberScope`, ou `null`. Mantém o escopo `projetos.read`.
O identificador vem de `CrmProjectMapping`, restrito ao Prisma de produção e ao
tenant configurado, em uma consulta em lote somente para os projetos da página
autorizada. O número não participa da resolução do vínculo.

A migração `20261104120000_omni_prisma_mapping_watermark` mantém o incremental
de `/projetos`: alterações reais do vínculo atualizam `Project.updatedAt` na mesma
transação, inclusive em SQL direto. Remoção, mudança de namespace e troca de
projeto também são detectadas. O mapeamento bruto continua reservado.

OpenAPI, catálogo de escopos e serviço do Playground refletem o novo objeto.
O OpenAPI e o contrato incluem exemplos fictícios.

## Pendência 3: avanço oficial

O Omni deve usar o **avanço físico do Acompanhamento**. Os status individual e
em coleção agora consultam `computeProgressDetailsForProjects`, a mesma função
usada pela Gestão, em vez do agregador resumido. A consulta individual também
passa a usar o cliente de banco recebido para o cálculo.

`progressPercent` corresponde a `avancoFisico` da Gestão quando consultados
com as mesmas fontes. Preserva `progressMethod`, avanço manual, `null` e valores
acima de 100%. Etapa do workflow e versão não definem avanço. Os valores semanais
continuam representando o período consultado.

Os valores reais de 5856, 5833 e 5839 não foram auditados nesta implementação.
A conferência deve ocorrer após publicar e renovar a sincronização do Omni.

## Validação

- Testes de identidade: vínculo presente/ausente, números repetidos nos dois
  escopos, origem/tenant/ambiente, token SELECTED, exclusão lógica, campos mínimos,
  consulta em lote por página e igualdade entre rota e Playground.
- Testes de avanço: status individual e coleção iguais ao detalhamento,
  elegibilidade de datas, valores acima de 100%, avanço manual e releitura sem
  alteração da versão do workflow.
- Migração executada em PostgreSQL via PGlite: inserção, correções, remoção,
  troca de projeto/ambiente/tenant, repetição sem mudança e rollback atômico.

Resultado final: backend com **2.651 aprovados, 37 ignorados e zero falhas**;
frontend com **871 aprovados e zero falhas**. Build do frontend, contrato
OpenAPI, arquitetura e `git diff --check` aprovados. O backend foi executado com
URL sintética não conectável, `NODE_ENV=development` e concorrência 4; o teste
opcional de e-mail que exige um banco externo não foi habilitado. Os cenários
de PostgreSQL descartável e PGlite da suíte foram executados normalmente.

## Publicação e consumo

Aplicar a migração e publicar o backend. No Omni, adotar `prisma.missionId` como
vínculo oficial e fazer uma leitura completa inicial de `/projetos`, pois vínculos
antigos não recebem um carimbo retroativo. Depois retomar o incremental de
projetos e a leitura completa dos status. Revalidar os três projetos relatados.
