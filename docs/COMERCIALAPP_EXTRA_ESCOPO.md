# Extra escopo do ComercialAPP no filtroAPP

## Comportamento e persistência

Contrato do produtor: [PR 81](https://github.com/pedro-pn/comercialAPP/pull/81),
[EXTRA_ESCOPO.md em 109efb4](https://github.com/pedro-pn/comercialAPP/blob/109efb4/docs/EXTRA_ESCOPO.md).

Na versão investigada, seleção/consulta do ComercialAPP escreviam no `ProjectBudget` principal,
substituíam o código comercial e desmarcavam todas as seleções. A importação apagava todo o escopo
previsto, e orçamento/horas ignoravam adicionais Access quando a principal era ComercialAPP.

Agora `ProjectBudget.version=1` conserva a principal. `ProjectAdditionalProposal` conserva uma
seleção por projeto/origem/número, com versão crescente, origem da escolha, inclusão por campo e
referência exclusiva: `sourceProposalCodBd` no Access; `commercialAppProposalId` no ComercialAPP.
A mudança de revisão substitui somente essa seleção. O mesmo número não pode ficar ativo em duas
origens; a troca de origem exige retirar explicitamente a contribuição anterior.

`CommercialProposal.parentCodProp` continua representando a mãe Access. O código da mãe deve
coincidir com a principal efetivamente selecionada em qualquer origem. O vínculo não depende da
revisão atual da mãe: `sourceProposalId` e `sourceRevisionNumber` identificam sua revisão de base.
`additionalProposalId` é estável; `proposalId` identifica a revisão; `COMERCIAL_APP:{proposalCode}`
identifica a contribuição. `projectId` sempre identifica um projeto existente do filtroAPP;
`prismaProjectId` é armazenado separadamente e comparado quando a principal fornece essa referência.
Cliente/CNPJ e projeto são conferidos. Mãe ausente/não resolvida permanece `STAGED`, sem orçamento,
sem projeto novo e sem proposta mãe fictícia.

A migração `20261019180000_commercial_additional_contributions` é aditiva. As seleções Access,
seus IDs e inclusões por campo permanecem intactos. Existem duplicatas históricas Access de
número/revisão: elas recebem `legacyDuplicate=true`, sem excluir registros nem remapear seleções.
Um índice parcial impede novas duplicatas; o trigger proíbe criar novos aliases ou mudar a
identidade dos aliases legados. Reimportar o mesmo `codBd` continua permitido. O ComercialAPP
mantém unicidade de número/revisão em sua própria origem e protege a relação estável por trigger.

Transações serializáveis, trava do projeto e versões de seleção protegem consulta, push e escolha
manual. `CommercialAppDelivery` guarda o hash canônico do corpo completo e o ACK. Mesmo evento com
outro corpo, revisão com conteúdo incompatível ou documentos divergentes retorna conflito.
Repetir ACK `SELECTED` confirma a entrega histórica e não reaplica orçamento/escopo. Um ACK inicialmente
`STAGED` pode passar a `SELECTED` ao reconhecer que a gestão já selecionou exatamente aquela revisão;
isso apenas atualiza a confirmação. Eventos antigos não desfazem revisões superiores nem uma escolha
manual posterior à aprovação. Caches só são invalidados após o commit.

## Composição, escopo e documentos

Os agregadores usados por dashboard, cards, detalhe e grupos somam valores, custos e horas das
seleções ativas, respeitando `metricInclusion` e o percentual do projeto. A margem resulta do
lucro/venda compostos. Funciona nas duas combinações Access/ComercialAPP.

Serviços previstos possuem `contributionKey`. Sistemas/quantitativos importados pertencem a esses
serviços; o cadastro físico de equipamentos/sistemas pode ser compartilhado, preservando sua identidade
operacional. Atualizar uma revisão remove/recria somente os serviços daquela contribuição, sem
agrupar contribuições pelo título. O editor conserva os vínculos e marca `MANUAL_OVERRIDE` apenas
nos conjuntos alterados. Uma impressão digital impede salvar sobre uma atualização concorrente.
A gestão pode resolver o escopo de um adicional com `MANUAL` ou `COMMERCIAL`, motivo e versão corrente;
a segunda opção aceita explicitamente também o escopo vazio. A resolução é auditada e isolada.

Adicionais usam `CommercialProposalSyncJob`, uma fila por projeto/número. A principal conserva sua fila
legada. Antes de aplicar uma resposta, o worker confere requestId/estado, versão da seleção e identidade
da revisão. Uma resposta substituída é descartada junto com seus arquivos temporários.

Cada documento tem identidade `comercialapp:{proposalCode}:{tipo}`. Revisão, ID do documento e geração
compõem sua versão de origem; arquivos anteriores permanecem no histórico. A migração também corrige
as identidades antigas sem criar outro documento. Downloads usam o endpoint exato de proposta/revisão/
documento, Bearer e `X-Comercial-Contract: 3`, conferindo tamanho, geração e SHA-256 da consulta e os
metadados fixados no push. Consultas de revisões não selecionadas não substituem o documento atual de
uma revisão selecionada. O download pela tela exige autenticação do Acompanhamento e verifica o vínculo
do documento à proposta/revisão do projeto.

## Consulta, seleção e remoção

- `GET /api/acompanhamento/comercial/comercialapp/capabilities`: Bearer de serviço existente.
- `POST /api/acompanhamento/comercial/comercialapp/propostas`: push aprovado v1/v3, mesmo Bearer.
- `POST /api/acompanhamento/comercial/projetos/{id}/comercialapp/consultar-adicional`:
  gestão autenticada; `{ "proposalCode": "502", "revisionNumber": 0 }`; agenda a consulta v3.
- `GET .../projetos/{id}/comercialapp/revisoes`: principal/adicionais, mãe, situação, versão da seleção,
  inclusões por campo e documentos por revisão.
- `POST .../projetos/{id}/comercialapp/selecionar`: gestão; `externalId`, `expectedSelectionVersion`
  (zero para primeira seleção), inclusões opcionais. Revisão anterior exige também
  `allowOlderRevision: true` e `reason`. Consultar adicional não seleciona nem inventa aprovação;
  `approvedAt:null` permanece nulo na seleção manual.
- `POST .../projetos/{id}/comercialapp/resolver-escopo`: gestão; `proposalCode`,
  `expectedSelectionVersion`, `choice` (`MANUAL`/`COMMERCIAL`) e `reason`.
- `POST .../projetos/{id}/comercialapp/remover-adicional`: gestão; `proposalCode`,
  `expectedSelectionVersion` e `reason`. Registra `REMOVE`, desativa a contribuição e retira seu escopo
  automático. Preserva documentos, revisões, decisões e overrides manuais. Eventos posteriores não a
  reativam; isso exige seleção manual explícita. O Access usa a mesma operação pela rota de exclusão
  existente, agora com versão e motivo no corpo. Substituição é a seleção auditada de outra revisão.

Recusa/cancelamento do produtor não é comando de remoção do orçamento. Não existe retirada automática
por novo status comercial. O contrato do push continua aceitando apenas `UPSERT_ADDITIONAL_CONTRIBUTION`.
A retirada operacional explícita foi exercitada contra o receptor real em ambiente isolado.

Exemplo de push (campos de custo/escopo pertencem exclusivamente ao adicional):

```json
{
  "contractVersion": 3,
  "eventId": "22000000-0000-4000-8000-000000000001",
  "source": "COMERCIAL_APP",
  "proposalKind": "ADDITIONAL",
  "proposalId": "revision-502-0",
  "proposalCode": "502",
  "revisionNumber": 0,
  "additionalProposalId": "additional-502",
  "parentProposalCode": "500",
  "sourceProposalId": "revision-500-2",
  "sourceRevisionNumber": 2,
  "contributionKey": "COMERCIAL_APP:502",
  "budgetOperation": "UPSERT_ADDITIONAL_CONTRIBUTION",
  "projectId": "filtro-project-123",
  "prismaProjectId": "prisma-project-789",
  "nectarOpportunityId": null,
  "approvedAt": "2026-10-19T15:00:00.000Z",
  "client": { "name": "Cliente QA", "cnpj": "12345678000190", "contact": "", "email": "" },
  "title": "Extra escopo",
  "site": "Sede",
  "salePrice": 20000,
  "plannedTotalCost": 12000,
  "expectedMargin": 40,
  "scope": [{ "title": "Novo circuito", "description": "Somente o acréscimo" }],
  "costBreakdown": null,
  "estimateSummary": null,
  "proposalSnapshot": {},
  "documentsReference": { "proposalCode": "502", "revisionNumber": 0 },
  "documents": [
    { "id": "pdf-502-0-comercial", "kind": "COMERCIAL", "format": "PDF", "fileName": "502-0-comercial.pdf", "byteSize": 12345 },
    { "id": "pdf-502-0-tecnica", "kind": "TECNICA", "format": "PDF", "fileName": "502-0-tecnica.pdf", "byteSize": 12346 }
  ]
}
```

ACK com mãe resolvida (mãe ausente: mesmo ACK com `budgetStatus: "STAGED"`):

```json
{
  "contractVersion": 3,
  "budgetStatus": "SELECTED",
  "proposalId": "revision-502-0",
  "projectId": "filtro-project-123",
  "parentProposalCode": "500",
  "contributionKey": "COMERCIAL_APP:502",
  "budgetOperation": "UPSERT_ADDITIONAL_CONTRIBUTION"
}
```

## Implantação e homologação

1. Manter os contratos de adicionais desligados nos dois sistemas. Implantar primeiro a migração,
   depois backend, worker e frontend do filtroAPP da mesma versão. Não executar o backend antigo após
   ativar adicionais: seus agregadores desconhecem a nova origem. Rollback operacional exige desligar
   o envio e manter a versão com suporte a contribuições para consultar o histórico já recebido.
2. Configurar origem HTTPS e o Bearer existente (`COMERCIALAPP_API_URL`, `COMERCIALAPP_SERVICE_TOKEN`).
   As credenciais do ambiente isolado são próprias; não reutilizar as de produção.
3. Reexecutar o teste real abaixo no par de versões a implantar. Depois de confirmar toda a composição,
   definir **no filtroAPP** `COMERCIALAPP_ADDITIONAL_CONTRACT=3`. Só então capabilities anuncia:
   `{ "contractVersion": 3, "additionalProposals": true, "budgetMode": "CONTRIBUTIONS" }`.
   O padrão vazio mantém a capacidade desligada mesmo com o receptor instalado.
4. Conferir a capability autenticada. Somente depois definir **no ComercialAPP**
   `FILTROAPP_ADDITIONAL_CONTRACT=3`. O Compose de staging existente continua sem push ao filtroAPP;
   o teste usa dois servidores HTTP e PostgreSQL descartáveis em loopback, fora desses serviços.
5. Monitorar filas, conflitos e ACKs. Não automatizar retirada por cancelamento; usar a operação auditada.

O teste real usa o código do ComercialAPP em `109efb4`, suas migrações, banco PostgreSQL próprio,
exportador HTTP e `deliverToFiltro` reais, receptor HTTP e persistência do filtroAPP reais. Gera
propostas/levantamentos sintéticos independentes e PDFs válidos por revisão, sem depender de dados
ou credenciais comerciais. O transporte da entrega é real; apenas a perda de ACK é induzida após o
commit. O teste não comprova autenticação ou disponibilidade da infraestrutura de produção, nem a
aprovação do PrismaCRM, que permanece uma dependência externa para seu fluxo específico.

Preparação do produtor: checkout do commit acima, `npm ci`, build de `@comercialapp/rules`, Prisma
generate/deploy em `comercialapp_test` e `backend/test/setup-cost-configuration.js` com esse banco.
Este último insere exclusivamente parâmetros fictícios de teste. No filtroAPP, aplicar todas as
migrações em um banco vazio `filtroapp_bridge_test`. Nunca apontar esses testes para bancos reais.

```bash
DATABASE_URL="$FILTRO_TEST_URL" TEST_DATABASE_URL="$FILTRO_TEST_URL" \
COMMERCIALAPP_TEST_DATABASE_URL="$COMERCIAL_TEST_URL" \
COMMERCIALAPP_SOURCE_DIR=/caminho/checkout-isolado/comercialAPP \
node --test backend/test/commercial-additional-real.integration.test.js
```

A suíte CI adiciona o job **Commercial contributions (PostgreSQL)** para migração, seleções, fontes
mistas, eventos, custos/horas e regressão v1. A homologação real exige o checkout externo preparado
acima e é opt-in; não é substituída por mocks nem pelo job de banco. Evidências e limites do teste
executado estão em [COMERCIALAPP_EXTRA_ESCOPO_EVIDENCIAS.md](COMERCIALAPP_EXTRA_ESCOPO_EVIDENCIAS.md).

## Escopo operacional e Data Book independente

Ver [Escopo e Data Book por proposta](DATABOOK_POR_PROPOSTA.md): editor com origem do escopo, acompanhamento de serviços por contribuição, vínculos operacionais auditados e geração/numeração/histórico separados por proposta. A migração adicional `20261019210000_proposal_scope_databooks` deve preceder a atualização das aplicações.

### Consulta HTTP entre stagings

Em produção, a consulta continua exigindo HTTPS. Para um par de stagings publicado por IP/porta em HTTP, configurar explicitamente no filtroAPP:

```dotenv
APP_ENV=staging
COMERCIALAPP_ALLOW_STAGING_HTTP=true
COMERCIALAPP_API_URL=http://IP_DO_STAGING_COMERCIAL:8087/
```

As duas opções de staging são obrigatórias para essa exceção, mesmo com `NODE_ENV=production` no container. Credenciais embutidas, subcaminhos, query string, fragmentos e redirects continuam recusados. O Compose de staging informa `APP_ENV=staging`; a habilitação HTTP tem padrão `false`.

No ComercialAPP, `FILTROAPP_API_TOKEN` também autentica a exportação consultada pelo filtroAPP. Configurar somente a URL do consumidor deixa o exportador desativado (503). Para homologar o push, o produtor precisa de `FILTROAPP_API_URL`, do mesmo token de serviço do par de stagings e de `FILTROAPP_ADDITIONAL_CONTRACT=3`; conferir antes a capability e as entregas pendentes do produtor. Nunca utilizar credenciais de produção nesse par HTTP.
