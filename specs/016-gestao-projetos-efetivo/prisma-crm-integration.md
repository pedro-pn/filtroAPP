# Integração do Efetivo com o CRM Prisma — levantamento de 30/09/2026

## Proprietários dos dados

O Prisma é a origem dos dados comerciais e dos aceites do cliente. O FiltroAPP é a origem do projeto operacional, das decisões da equipe e do progresso executado. A correlação deve usar o identificador nativo do Prisma e o `Project.code` do FiltroAPP; `CommercialProposal.codNectar` é um campo legado de importação do Access e não é um vínculo confirmado com o Prisma.

## Prisma → FiltroAPP

| Grupo | Dados necessários | Estado atual |
| --- | --- | --- |
| Projeto e oportunidade | ID do negócio no Prisma, código/nome do projeto, cliente, CNPJ, local, número/revisão da proposta, URL de origem e estado do negócio | `POST /api/integracoes/v1/efetivo/projetos` usa o mesmo serviço do webhook atual e cria o cadastro `Project` compartilhado por Relatórios e Efetivo. Recebe código, nome, cliente, CNPJ, proposta, revisão e local; cria idempotentemente com `registrationPending: true`. Não recebe ID nem URL do Prisma, e um reenvio com dados diferentes gera 409. |
| Handover comercial | Contato do cliente (nome, função, telefone e e-mail), responsável comercial, modalidade/local da execução, valor e prazo vendidos, datas esperadas de mobilização e início, quantitativos preliminares, premissas, exclusões e responsabilidades | Campos e telas existem parcialmente no Efetivo, mas ainda dependem de entrada manual ou importação legada. Falta conector contínuo. |
| Fatos comerciais | Para cada uma das 8 chaves de `PROJECT_WORKFLOW_COMMERCIAL_FACTS`: estado, data da ocorrência, referência/condição, ID e URL de origem, versão, `sourceUpdatedAt` e data de sincronização. Inclui proposta aceita, pedido recebido, contrato assinado, cadastro, medição e faturamento definidos. | `POST /api/integracoes/v1/efetivo/projetos/{id}/fatos-comerciais` atualiza um fato por envio. Exige gestão de efetivo iniciada. |
| Documentos comerciais | Tipo, título, ID, URL, versão, data de atualização, autor e estado da versão para propostas, pedido, contrato, desenhos, especificações e requisitos do cliente | `POST /api/integracoes/v1/efetivo/projetos/{id}/documentos` publica referências e versões. O contrato atual ainda não transporta autor nem o aceite do cliente. |
| Mudanças e aceites | Revisões/aditivos, mudanças de escopo/valor/datas e aceites do cliente com estado, responsável, data, versão e evidência; aprovação da medição deve ser distinta de envio e preparo | Ainda faltam contratos de evento, vínculo ao projeto e processamento externo. |

Todos os eventos de entrada precisam de identificador estável, versão, instante na fonte e comportamento documentado para reenvio e eventos fora de ordem. Webhook e consulta paginada periódica devem reconciliar a mesma informação.

## FiltroAPP → Prisma

| Dado | Campo do endpoint novo |
| --- | --- |
| Identidade | `projectId`, `projectCode` |
| Etapa e versão | `workflowStarted`, `stage`, `workflowVersion` |
| Datas operacionais | `plannedMobilizationDate`, `plannedExecutionStartDate`, `plannedExecutionEndDate`, `fieldCompletionDate`, `demobilizationDate`, `closedAt` |
| Sinais de liberação | `commercialReadiness`, `mobilizationReady`, `closureReady` |
| Pendências | `openIssueCount`, `criticalIssueCount`; descrições livres não são expostas |
| Avanço | `progressPercent`, `progressMethod` (`RDO`, `MANUAL` ou nulo) |

O status é um retrato calculado no momento da consulta. `workflowVersion` não é um cursor global: RDOs podem alterar `progressPercent` sem alterar essa versão. O Prisma deve consultar periodicamente ou acordar um contrato futuro de eventos de saída.

## Endpoints reais e lacunas

| Endpoint | Direção | Estado | Playground |
| --- | --- | --- | --- |
| `POST /api/integracoes/v1/efetivo/projetos` | Prisma → FiltroAPP | Adicionado; escopo `efetivo.projetos.create`, acesso a todos os projetos | Sim, operação `efetivo.projects.create` |
| `POST /api/integracoes/v1/efetivo/projetos/{id}/fatos-comerciais` | Prisma → FiltroAPP | Adicionado; escopo `efetivo.projetos.fatos-comerciais.write`, projeto autorizado | Sim, operação `efetivo.projects.commercialFact.post` |
| `POST /api/integracoes/v1/efetivo/projetos/{id}/documentos` | Prisma → FiltroAPP | Adicionado; escopo `efetivo.projetos.documentos.write`, projeto autorizado | Sim, operação `efetivo.projects.document.post` |
| `POST /api/webhooks/projects` | Prisma → FiltroAPP | Rota antiga permanece disponível com `PROJECT_INTAKE_WEBHOOK_TOKEN` próprio | Não |
| `GET /api/integracoes/v1/projetos` | FiltroAPP → Prisma | Existente; identifica projetos e IDs com escopo `projetos.read` | Sim |
| `GET /api/integracoes/v1/efetivo/projetos/{id}/status` | FiltroAPP → Prisma | Adicionado; escopo `efetivo.projetos.status.read`, recorte por projeto e resposta minimizada | Sim, operação `efetivo.projects.status.get` |
| Recepção de aditivos e aceites | Prisma → FiltroAPP | A desenhar com o desenvolvedor do Prisma; não há contrato de evento | Não |
| Eventos de saída do FiltroAPP | FiltroAPP → Prisma | A desenhar após definir API ou webhook receptor do Prisma; hoje o Prisma pode consultar o status | Não |

### Credenciais e escrita

- A credencial do CRM ainda não foi emitida. Quando for criada no painel, selecionar `projetos.read`, `efetivo.projetos.status.read` e os três escopos de escrita acima. Essa credencial autenticará os GETs e POSTs por `Authorization: Bearer <token>` em `https://app.filtrovali.com.br/api/integracoes/v1`.
- A criação exige recorte de projetos `ALL`, pois o novo projeto ainda não pode integrar a lista de IDs selecionados. Fatos e documentos respeitam `ALL` ou `SELECTED`; com `SELECTED`, o projeto precisa constar no token.
- O painel testa POSTs reais mediante confirmação explícita. Para uma credencial já emitida sem os novos escopos, emitir/rotacionar outra com as permissões corretas; a política de um token não pode ser ampliada em edição.
- O webhook antigo aceita reenvio idêntico, mas usa outra credencial. O Prisma deve migrar para a rota nova para usar o mesmo token. Nenhuma das rotas de criação atualiza campos de um projeto já criado com dados diferentes.
- O POST de criação usa exatamente os dados mínimos do webhook existente: `code`, `name`, `clientName`, `clientCnpj`, `proposalCode`, `revision` e `location`. Ele cria o cadastro do projeto usado em Relatórios e Efetivo, não cria um relatório/RDO. O projeto fica com `registrationPending: true` e só entra na seleção de novos relatórios após conferência e conclusão manual do cadastro por um gestor. A resposta traz `project.id` para os demais endpoints.
- Fatos comerciais retornam `CREATED`, `UPDATED`, `REPLAYED` ou `IGNORED_OLDER`. Versão e instante repetidos com conteúdo diferente geram `409`. Documentos retornam `CREATED`, `CURRENT_UPDATED`, `REPLAYED` ou `IGNORED_OLDER`.

### Contratos que faltam acordar

1. Identificadores nativos do Prisma para negócio, projeto, cliente, proposta e documento; relação entre eles e o código do projeto no FiltroAPP.
2. URL de homologação, rotação de credenciais, limites de envio e frequência de reconciliação.
3. Campos, enumerações e exemplos de cada evento; regras de cancelamento, revisão, exclusão, ordenação e data/hora.
4. Se o Prisma consumirá o endpoint de status por polling ou receberá eventos; caso receba, URL, autenticação, contrato de atualização e confirmação.
5. Histórico e endpoint de reconciliação desde uma data/cursor para carga inicial e recuperação de eventos perdidos.

### Exemplo ilustrativo de `GET /api/integracoes/v1/efetivo/projetos/{id}/status`

```json
{
  "projectId": "proj_123", "projectCode": "05776", "workflowStarted": true,
  "stage": "EXECUTION", "workflowVersion": 4,
  "plannedMobilizationDate": "2026-10-01", "plannedExecutionStartDate": "2026-10-03",
  "plannedExecutionEndDate": "2026-10-18", "fieldCompletionDate": null,
  "demobilizationDate": null, "commercialReadiness": "RELEASED",
  "mobilizationReady": true, "closureReady": false,
  "openIssueCount": 2, "criticalIssueCount": 1,
  "progressPercent": 42, "progressMethod": "RDO", "closedAt": null,
  "generatedAt": "2026-09-30T18:00:00.000Z", "schemaVersion": "1.0",
  "requestId": "2c0b0d48-6954-4b92-8a90-34a1f24b88ea"
}
```

O exemplo mostra o formato contratado, não o estado de um projeto real. `stage`, datas, readiness, gates e avanço podem ser nulos conforme o momento do projeto.

## Mensagem para o desenvolvedor do Prisma

> A base da API do FiltroAPP é `https://app.filtrovali.com.br`. A credencial do CRM **ainda será criada** em Tokens da API e compartilhada por canal seguro. Depois da emissão, usaremos `Authorization: Bearer <token>` para consultar e enviar dados. Os escopos previstos são `projetos.read`, `efetivo.projetos.status.read`, `efetivo.projetos.create`, `efetivo.projetos.fatos-comerciais.write` e `efetivo.projetos.documentos.write`. Para criar projetos, a credencial precisa de acesso `ALL`. Usaremos `Content-Type: application/json` nos POSTs.
>
> Endpoints disponíveis: `GET /api/integracoes/v1/projetos`, `GET /api/integracoes/v1/efetivo/projetos/{id}/status`, `POST /api/integracoes/v1/efetivo/projetos`, `POST /api/integracoes/v1/efetivo/projetos/{id}/fatos-comerciais` e `POST /api/integracoes/v1/efetivo/projetos/{id}/documentos`. O exemplo de resposta de status está acima e os esquemas completos estão no OpenAPI da PR. O status usa o ID interno do projeto retornado na criação ou listagem. Os POSTs do playground gravam dados reais.
>
> O POST de projeto substitui o uso do webhook atual com os mesmos campos: `code`, `name`, `clientName`, `clientCnpj`, `proposalCode`, `revision` e `location`. Ele cria o cadastro único `Project`, utilizado pelos módulos Relatórios e Efetivo, e retorna `project.id`. O cadastro nasce pendente de conferência (`registrationPending: true`) e só pode ser escolhido para novos relatórios após revisão de um gestor. Esse POST não cria um relatório/RDO. Reenvio idêntico é aceito; se o mesmo código vier com dados diferentes, a API responde `409`.
>
> Preciso de exemplos reais, sem dados pessoais sensíveis, e do contrato da API do Prisma para: (1) IDs estáveis do negócio, projeto, cliente, proposta/revisão e documento e a relação deles com nosso `Project.code`; (2) payload e enumerações de criação/alteração de negócio, proposta aceita, pedido, contrato, cadastro, medição e faturamento, com `externalId`, `sourceVersion`, `sourceUpdatedAt` e reenvio fora de ordem; (3) revisões/aditivos, cancelamento e aceites do cliente, distinguindo preparo/envio de medição de aprovação pelo cliente; (4) endpoint paginado de carga inicial e reconciliação desde data/cursor; (5) URL e autenticação de homologação, limites e política de retry; (6) se o CRM vai consultar o status periodicamente ou se precisa receber eventos operacionais, com URL, autenticação e formato do receptor. Não vamos presumir IDs ou campos que o Prisma ainda não confirmou.
