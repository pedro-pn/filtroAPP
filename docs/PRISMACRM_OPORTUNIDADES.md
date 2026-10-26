# Planejamento PrismaCRM → FiltroAPP — planning-1.0

Implementação do receptor e da interface do FiltroAPP. A ativação em staging/produção depende do emissor PrismaCRM e da homologação conjunta. A tag comercial **Quente** não solicita planejamento automaticamente.

## Decisões confirmadas

1. No Prisma, qualquer usuário autorizado a editar a oportunidade pode usar **Sinalizar para planejamento no FiltroAPP**, sem aprovação adicional.
2. Retirar a sinalização exige motivo; decisões, versões e vínculos anteriores permanecem no histórico.
3. Negociação adiada (`POSTPONED`) sinalizada fica em **Pausadas**, fora de **Futuros**.
4. Venda ganha com cadastro incompleto é aceita e permanece em **Futuros**, com **Fechada — cadastro pendente**. O número de projeto não é requisito para receber a oportunidade.

## Transporte e autorização

Base: `/api/integracoes/v1`. Bearer opaco emitido pelo painel administrativo de tokens. O receptor usa o catálogo, as cotas, a auditoria e o playground existentes.

| Método e caminho relativo | Escopos exigidos | Acesso |
| --- | --- | --- |
| `POST /acompanhamento/oportunidades` | `acompanhamento.oportunidades.write` **e** `efetivo.projetos.create` | `ALL` |
| `GET /acompanhamento/oportunidades/por-origem/prismaCRM/{externalId}` | `acompanhamento.oportunidades.read` | `ALL` |
| `GET /acompanhamento/oportunidades/vinculos?limit=100&after=...&updatedSince=...` | `acompanhamento.oportunidades.read` | `ALL` |

Tokens existentes não ganham novos escopos automaticamente. Leituras podem usar credencial separada, sem permissão de escrita.

O POST exige `Content-Type: application/json` e `Idempotency-Key` **igual ao `eventId`**. O playground monta esse cabeçalho. Respostas definitivas são síncronas: `201` na primeira aplicação e `200` nas seguintes/duplicadas/obsoletas, após a confirmação da transação. Não há `202` ou fila assíncrona no receptor.

`sourceSystem=prismaCRM`, `tenantId` e `environment` são verificados contra a configuração do servidor, sem permitir acesso a outro namespace pelo corpo. Configurações:

- `CRM_PLANNING_TENANT_ID`: padrão `filtrovali`.
- `CRM_PLANNING_ENVIRONMENT`: `sandbox` ou `production`. Se omitido, desenvolvimento/testes/staging usam `sandbox`; produção usa `production`.

Confirmar essa configuração e emitir tokens próprios em cada ambiente antes de conectar o emissor.

## Retrato completo

O [JSON Schema](prisma-planning.schema.json) e o [OpenAPI 1.8.0](../specs/015-api-token-playground/contracts/openapi.yaml) descrevem os campos, limites e respostas. Os [dez exemplos recebidos do Prisma](../backend/test/fixtures/crm-planning-events.json) são sintéticos e foram mantidos intactos como fixtures de contrato; não são instruções de envio em produção.

Todos os campos são obrigatórios na estrutura; valores desconhecidos aceitam `null` somente onde previsto. Não é PATCH: omitir uma propriedade obrigatória retorna `422`. Propriedades extras também são rejeitadas. Não inventar ator, motivo, CNPJ ou identificadores para preencher lacunas históricas.

Exceção aditiva para compatibilidade: `opportunity.client.segment` é opcional,
nullable e limitado a 100 caracteres. Quando informado pela principal, preenche
o segmento do projeto vinculado, respeitando ajustes manuais. Os eventos antigos
continuam válidos e mantêm seu hash original.

| Grupo | Conteúdo |
| --- | --- |
| Envelope | `contractVersion=planning-1.0`, `eventId` UUID, namespace, `externalId`, `sourceVersion`, `sourceUpdatedAt` |
| `change` | Tipo do evento, instante, motivo e ator nullable |
| `opportunity` | Título, descrição nullable, decisão de planejamento, estado comercial e decisão, responsável nullable |
| `client` | ID de origem, nome, razão social e CNPJ nullable; CNPJ conhecido com 14 dígitos |
| `proposal` | Objeto nullable com sistema, IDs, código, revisão e aceite nullable |
| `scope` | `PRIMARY`, `ADDITIONAL` ou `UNCLASSIFIED`; principal, proposta mãe, adicional e contribuição nullable |
| `project` | Objeto nullable com `prismaMissionId`, `number`, `numberScope`, `filtroappProjectId`, todos nullable |
| Demais dados | Local nullable, valor nullable (`amount` decimal em texto com duas casas, `currency=BRL`), três datas previstas nullable, fechamento nullable, tombstone booleano e URL HTTP(S) |

`externalId` identifica a oportunidade e nunca é reaproveitado. `prismaMissionId` identifica a missão na origem. `number` é o número visível do projeto e não substitui esses IDs. IDs são textos opacos; zeros e formatos não são normalizados para procurar projetos. `sourceVersion` é inteiro positivo crescente por oportunidade, até `9007199254740991`, persistido como BIGINT. Lacunas entre versões são aceitas porque cada evento contém o retrato inteiro.

Tipos de evento: `PLANNING_REQUESTED`, `PLANNING_WITHDRAWN`, `STATE_UPDATED`, `COMMERCIAL_STATUS_CHANGED`, `SOURCE_RECORD_DELETED`. O tipo explica a mudança; o retrato determina o estado. Retirada exige `planningRequested=false` e motivo tanto em `change.reason` quanto em `planningDecision.reason`. Mesmo um `STATE_UPDATED` que muda de sinalizada para não sinalizada exige motivo de retirada. Exclusão exige `sourceRecordDeleted=true`. A data final prevista não pode preceder a inicial.

As invariantes entre campos e transições são aplicadas pelo serviço além da validação estrutural do JSON Schema. Para regenerar os dois schemas estruturais: `node backend/scripts/generate-crm-planning-contract.js`.

## Visibilidade e criação do projeto

| Estado recebido, sem projeto confirmado | Resultado |
| --- | --- |
| `OPEN` e `planningRequested=true` | Futuros, em negociação |
| `POSTPONED` e `planningRequested=true` | Pausadas |
| `WON`, mesmo sem sinalização ativa | Futuros enquanto faltar cadastro/vínculo |
| Retirada, `LOST`, `DISCARDED`, `CANCELLED` ou tombstone | Fora das listas ativas; histórico e consulta de reconciliação preservados |

A oportunidade não cria fluxo operacional, RDO, reserva de equipe ou orçamento durante a negociação. Valores recebidos são estimativas comerciais.

Ao receber `WON` principal, o receptor cria o cadastro operacional pelo fluxo normal somente quando há classificação `PRIMARY`, missão estável, número e escopo do número, nome do cliente, CNPJ, local e proposta aceita com código/revisão suportados pelo cadastro atual. Os sete campos do cadastro são derivados desse retrato. Os demais dados podem continuar nullable. O registro antecipado mantém o mesmo `accompanimentId` e passa a guardar `projectId`; o acompanhamento exibe um único card de projeto. Orçamento comercial ainda pendente continua indicado pelo fluxo existente.

O exemplo `05_ganho_principal` tem `client.taxId=null`: ele é **válido e resulta em `PENDING_DATA`**. Para homologar a criação, usar outra versão/evento com CNPJ conhecido e os demais dados completos, sem alterar/reutilizar a versão original.

Identificação de projeto existente exige mapeamento confirmado da missão ou `filtroappProjectId` explícito, validando número, cliente e proposta mãe quando conhecidos. Coincidência de número, nome ou CNPJ não estabelece vínculo. Se o número já existir sem mapeamento, o evento fica em `NEEDS_REVIEW`, motivo `EXISTING_PROJECT_MAPPING_REQUIRED`; uma nova versão com ID confirmado resolve o vínculo. IDs/numeração contraditórios retornam `409`.

Retirada, perda, cancelamento, exclusão ou reabertura não removem `projectId` nem cancelam o projeto operacional. Referência de projeto ausente em retrato posterior preserva o vínculo e sinaliza conferência. Remapeamento de missão/projeto ou troca de classificação consolidada exige correção administrativa auditada; não é feito por eventos comuns.

## Várias oportunidades e extra escopo

O relacionamento é vários-para-um: principal e diversos adicionais podem apontar para a mesma missão/projeto.

- `targetProjectId` registra a referência operacional já resolvida, inclusive para adicional ainda em negociação.
- `projectId` confirma a associação comercial no ganho; um vínculo confirmado permanece preservado.
- `ADDITIONAL` nunca cria projeto. É necessário resolver a missão e conferir a proposta mãe. Se a principal ainda não chegou, o adicional fica em `PENDING_LINK` e em Futuros quando elegível.
- Ao confirmar o vínculo da principal, o receptor tenta resolver adicionais pendentes da mesma missão; registra essas mudanças no histórico de vínculos.
- `UNCLASSIFIED` fica em `NEEDS_REVIEW`; não cria projeto.

O evento de planejamento não aplica valores ao orçamento nem acrescenta serviços. O ComercialAPP e o fluxo existente de contribuições continuam responsáveis pelo orçamento, escopo e documentos. `contributionKey` recebido é referência comercial preservada no retrato; não substitui automaticamente a chave interna de contribuição. A homologação precisa comprovar que um adicional aparece uma vez no orçamento pelo fluxo comercial existente, independentemente dos reenvios deste webhook.

## Confirmação e confiabilidade

Exemplo de ACK (IDs sintéticos):

```json
{
  "eventId": "2a9b7110-424a-52bc-9266-21726dd866c4",
  "externalId": "deal-synthetic-primary-100",
  "receivedSourceVersion": 1,
  "currentSourceVersion": 1,
  "disposition": "applied",
  "accompanimentId": "fapp-opportunity-synthetic",
  "projectId": null,
  "targetProjectId": null,
  "projectLinkStatus": "NOT_REQUESTED",
  "projectLinkReason": null,
  "receivedAt": "2026-10-20T12:00:00.000Z",
  "requestId": "synthetic-request"
}
```

| Situação | Resultado |
| --- | --- |
| Evento novo, versão maior | `applied`; grava retrato, evento, recibo e eventuais projeto/vínculo na mesma transação |
| Mesmo evento e conteúdo | `duplicate`; não reaplica efeitos |
| Mesmo evento com conteúdo diferente | `409 EVENT_CONTENT_CONFLICT`, inclusive evento antigo |
| Outro evento, mesma versão e mesmo conteúdo de versão | `duplicate_version`; grava novo recibo, sem reaplicar |
| Mesma versão com conteúdo divergente | `409 VERSION_CONTENT_CONFLICT`, inclusive versão antiga |
| Evento novo e versão antiga ainda não conhecida | `stale_ignored`; registra retrato/recibo no histórico, sem regredir o estado |

Hash de evento: SHA-256 do JSON validado, com chaves de objetos ordenadas recursivamente e ordem dos arrays preservada. Hash canônico de versão: mesma operação excluindo apenas `eventId`. O serviço valida/normaliza espaços nos campos de texto previstos. Metadados, datas e demais campos fazem parte do conteúdo; mudar uma data textual não é uma retentativa idêntica. `canonicalHash` nas consultas é o hash da versão atual, não o do vínculo operacional.

ACKs de reenvio informam o estado **atual**, que pode estar em versão superior à recebida. `receivedAt` é o instante deste recebimento. Histórico de versões e recibos é imutável pelo serviço; histórico de vínculos registra reconciliações internas que não alteram a versão comercial.

| `projectLinkStatus` | Significado |
| --- | --- |
| `NOT_REQUESTED` | Nenhum vínculo operacional resolvido ou exigível nesta etapa |
| `PENDING_DATA` | Ganho recebido, faltam dados do cadastro |
| `PENDING_LINK` | Aguarda missão/projeto/proposta principal |
| `LINKED` | Referência operacional resolvida; conferir `projectId` e `targetProjectId` para distinguir ganho de planejamento |
| `NEEDS_REVIEW` | Cadastro, classificação ou referência exige conferência; motivo em `projectLinkReason` |

Erros comuns: `400` para cabeçalho/filtros/cursor, `401` para token, `403` para escopo/recorte/namespace, `409` para conflito de identidade/conteúdo ou concorrência, `422` para retrato inválido e `429` para cotas. Retentativas de timeout, `429`, `5xx` e `CONCURRENT_UPDATE` mantêm mesmo evento/conteúdo, com backoff e respeito a `Retry-After`. Conflitos de conteúdo exigem análise; não gerar evento novo para contornar uma divergência de versão.

## Reconciliação

A consulta individual retorna versão/evento/hash atuais, decisões comerciais, tombstone, IDs e estado/motivo do vínculo. A listagem inclui todos os estados recebidos do namespace, sem eliminar retiradas/perdas/exclusões. Não expõe os retratos com dados pessoais.

`limit` vai de 1 a 500, limitado também pelo token e pelo teto global. `after` recebe `page.nextCursor`; repetir os mesmos filtros até `hasMore=false`. `updatedSince` é inclusivo. Cursor assinado é vinculado à operação, namespace e filtros.

A paginação lê **registros atuais** até `page.snapshotAt`; não oferece snapshot histórico entre requisições. Uma atualização concorrente pode mover uma linha para depois desse limite. Ao terminar, fazer nova varredura desde `page.reconcileFrom` (snapshotAt menos 60 segundos), com sobreposição, e repetir incrementalmente. Atualizar o estado local por `externalId` e `updatedAt`; não descartar uma resposta só porque `currentSourceVersion` é igual, pois reconciliações internas podem mudar o vínculo sem nova versão do Prisma. Na dúvida, consultar o ID individual. O Prisma precisa oferecer sua própria consulta de estado completo para a reconciliação nos dois sentidos.

## Transição e homologação com o Prisma

A migração preserva oportunidades/eventos do contrato inicial em namespace `legacy`, sem convertê-los automaticamente em novas sinalizações. O antigo payload `HOT/WITHDRAWN` não é aceito por este endpoint após a atualização. Eventual reaproveitamento de vínculos legados deve ser confirmado por ID; não presumir equivalência só pelo número.

Durante a transição, escolher **um criador por missão**: oportunidades já exportadas por este fluxo usam o ganho neste endpoint; as demais podem continuar pelo cadastro anterior. O conector antigo precisa repassar o ID de projeto confirmado antes de associar uma oportunidade já existente. Essa escolha e o mapeamento ficam no emissor, evitando dois pedidos concorrentes de criação.

O desenvolvedor do Prisma deve implementar a ação/retirada com as permissões confirmadas, motivo obrigatório, ID estável, versões crescentes, outbox transacional, tombstones, retentativas e consultas de reconciliação. Não usar a tag Quente como gatilho. Registrar o ACK e os IDs retornados sem mudar a identidade da oportunidade.

Homologar em sandbox: sinalização sem número; atualização; retirada com motivo; nova sinalização; adiamento/Pausadas; ganho incompleto; complemento/criação única; projeto pré-existente com ID confirmado; dois adicionais no mesmo projeto; adicional antes da principal; perdas/exclusão após ganho; duplicidades/conflitos/fora de ordem; timeout/reenvio e reconciliação. Antes de produção, alinhar os hosts/tokens, valores exatos de namespace, criador por missão e como o ComercialAPP identifica a contribuição de cada adicional.

## Verificação local — 2026-10-20

- 803 testes de frontend aprovados, incluindo separação das listas e cabeçalho no console.
- 539 verificações de backend aprovadas nas suites de API, acompanhamento, contrato e cadastro; seis testes de outras integrações dependentes de banco ficaram condicionados aos respectivos ambientes.
- 13 testes aprovados no fluxo HTTP com PostgreSQL descartável, incluindo concorrência, rollback, permissões, reconciliação, vários adicionais e coincidência de código com proposta do Access.
- Migrações aplicadas em banco de teste vazio; preservação dos dados do contrato inicial também verificada em PGlite. Schema Prisma validado e cliente gerado.
- Build de produção do frontend e verificação de arquitetura aprovados.
- Cards conferidos com Playwright em desktop e celular (390 px), usando dados sintéticos; contadores, mudança de aba, busca por projeto de referência e ausência de overflow verificados.

Essas verificações cobrem o receptor e a interface local. Envio real do PrismaCRM e implantação em staging/produção ainda dependem da homologação entre os dois sistemas.
