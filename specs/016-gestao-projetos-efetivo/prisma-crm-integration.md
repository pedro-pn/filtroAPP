# Integração do Efetivo com o CRM Prisma — levantamento de 30/09/2026

## Proprietários dos dados

O Prisma é a origem dos dados comerciais e dos aceites do cliente. O FiltroAPP é a origem do projeto operacional, das decisões da equipe e do progresso executado. A correlação deve usar o identificador nativo do Prisma e o `Project.code` do FiltroAPP; `CommercialProposal.codNectar` é um campo legado de importação do Access e não é um vínculo confirmado com o Prisma.

## Prisma → FiltroAPP

| Grupo | Dados necessários | Estado atual |
| --- | --- | --- |
| Projeto e oportunidade | ID do negócio no Prisma, código/nome do projeto, cliente, CNPJ, local, número/revisão da proposta, URL de origem e estado do negócio | `POST /api/webhooks/projects` recebe somente código, nome, cliente, CNPJ, proposta, revisão e local; cria idempotentemente e exige conferência. Não recebe ID nem URL do Prisma, e um reenvio com dados diferentes gera 409. |
| Handover comercial | Contato do cliente (nome, função, telefone e e-mail), responsável comercial, modalidade/local da execução, valor e prazo vendidos, datas esperadas de mobilização e início, quantitativos preliminares, premissas, exclusões e responsabilidades | Campos e telas existem parcialmente no Efetivo, mas ainda dependem de entrada manual ou importação legada. Falta conector contínuo. |
| Fatos comerciais | Para cada uma das 8 chaves de `PROJECT_WORKFLOW_COMMERCIAL_FACTS`: estado, data da ocorrência, referência/condição, ID e URL de origem, versão, `sourceUpdatedAt` e data de sincronização. Inclui proposta aceita, pedido recebido, contrato assinado, cadastro, medição e faturamento definidos. | O banco possui metadados `CRM`, mas não há endpoint HTTP público para atualizá-los. |
| Documentos comerciais | Tipo, título, ID, URL, versão, data de atualização, autor e estado da versão para propostas, pedido, contrato, desenhos, especificações e requisitos do cliente | Há adaptador interno idempotente para versões e referências do CRM; falta rota externa autenticada. |
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
| `POST /api/webhooks/projects` | Prisma → FiltroAPP | Existente; payload mínimo e token próprio `PROJECT_INTAKE_WEBHOOK_TOKEN` | Não: playground atual aceita GET com token de integração, e este webhook tem autenticação separada |
| `GET /api/integracoes/v1/projetos` | FiltroAPP → Prisma | Existente; identifica projetos e IDs com escopo `projetos.read` | Sim |
| `GET /api/integracoes/v1/efetivo/projetos/{id}/status` | FiltroAPP → Prisma | Adicionado; escopo `efetivo.projetos.status.read`, recorte por projeto e resposta minimizada | Sim, operação `efetivo.projects.status.get` |
| Recepção de fatos, documentos, aditivos e aceites | Prisma → FiltroAPP | A desenhar com o desenvolvedor do Prisma; não há rota pública para esses dados | Não |
| Eventos de saída do FiltroAPP | FiltroAPP → Prisma | A desenhar após definir API ou webhook receptor do Prisma; hoje o Prisma pode consultar o status | Não |

### Contratos que faltam acordar

1. Identificadores nativos do Prisma para negócio, projeto, cliente, proposta e documento; relação entre eles e o código do projeto no FiltroAPP.
2. Autenticação dos webhooks e da API do Prisma, assinatura, rotação, URL de produção/homologação, limites e paginação.
3. Campos, enumerações e exemplos de cada evento; regras de cancelamento, revisão, exclusão, ordenação e data/hora.
4. Se o Prisma consumirá o endpoint de status por polling ou receberá eventos; caso receba, URL, autenticação, contrato de atualização e confirmação.
5. Histórico e endpoint de reconciliação desde uma data/cursor para carga inicial e recuperação de eventos perdidos.
