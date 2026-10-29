# API de integrações

Esta API fornece acesso controlado aos dados do Filtrovali sem conceder acesso direto ao banco, incluindo Qualidade, cadastros operacionais, salários por cargo, relatórios, estoque, manutenção e operações contratadas do CRM. A disponibilidade no ambiente depende da publicação e homologação do código pelo operador; esta implementação não executa deploy.

O endereço base comum a todas as áreas é `/api/integracoes/v1`. Acrescente o caminho da consulta desejada, como `/projetos`, `/estoque/itens` ou `/qualidade/registros`. O segmento `/qualidade` identifica apenas as consultas desse setor. Na exibição única do token, o exemplo em cURL usa uma consulta compatível com as permissões concedidas.

## Autenticação

Uma conta `ADMIN` gera a credencial em **Administração → Tokens de API**. O valor completo aparece uma única vez; guarde-o em um cofre de segredos e identifique o responsável e a finalidade. Sessões humanas do app não funcionam nesta árvore e tokens de integração não funcionam como login.

No formulário, defina finalidade e destinatário, início/vencimento, escopos, recorte de projetos, CIDRs permitidos e cotas. Nenhuma permissão vem selecionada. Prefira validade curta, projetos selecionados e somente as permissões necessárias ao consumidor; acrescente metadados, download ou excluídos quando necessário. Credencial sem expiração exige confirmação explícita de risco.

Configure o segredo no processo consumidor sem colocá-lo em código, URL, planilha ou log:

```bash
# O processo injeta esta variável a partir do cofre; não registre o valor no shell history.
# Exemplo conceitual: secretRef "filtro/bi-qualidade" -> env FILTRO_API_TOKEN.
test -n "$FILTRO_API_TOKEN" || exit 1
curl --fail-with-body \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H "Accept: application/json" \
  "https://seu-dominio/api/integracoes/v1/qualidade/registros?limit=100"
```

Todas as respostas usam `Cache-Control: no-store` e `X-Request-Id`. Registre o request ID, nunca o header `Authorization`.

## Simulação de escritas

Envie `Prefer: validate-only` em qualquer escrita de `/api/integracoes/v1` para
executar as mesmas permissões, recorte de projetos, cotas, validações e regras da
escrita real e desfazer a transação ao terminar. As cinco operações suportadas são
Qualidade, oportunidades, criação de projetos, fatos comerciais e documentos CRM.
Uma operação futura sem suporte recusa com `501 SIMULATION_NOT_SUPPORTED`.

Em **Administração → Tokens de API**, `writeMode: SIMULATE` obriga a simulação de
todas as escritas da credencial, inclusive quando o consumidor omite o cabeçalho.
`LIVE` é o padrão para credenciais existentes e permite escrita real quando não há
pedido de simulação. A listagem mostra o modo; nos detalhes, a alteração exige
justificativa e versão atual e fica na auditoria. O Playground usa simulação por
padrão; selecione **Real — salvar dados no FiltroAPP** para persistir com um token
LIVE. Um token SIMULATE continua simulando mesmo se o Playground pedir LIVE.

Para **Omni – desenvolvimento**, selecione SIMULATE e conceda
`qualidade.registros.create`. Se a credencial atual não possui esse escopo, use
**Rotacionar**, inclua a permissão e mantenha SIMULATE na substituta. Simulação
exige os mesmos escopos da operação real e não amplia a política do token.

Exemplo inteiramente fictício; injete o token pelo cofre de segredos:

```bash
curl --fail-with-body -X POST \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: validate-only' \
  -H 'Idempotency-Key: 6d655c60-2dc0-4d56-98c3-7349fc19612e' \
  --data-raw '{"type":"DESVIO","projectCode":"05776","eventDate":"2026-10-29","description":"Exemplo fictício de teste","impact":"MEDIO","actionOwnerEmail":"responsavel@example.test","externalRef":{"system":"omni","url":"https://example.test/checagem","reference":"exemplo"}}' \
  'https://seu-dominio/api/integracoes/v1/qualidade/registros'
```

Sucesso simulado é sempre HTTP 200, com `Preference-Applied: validate-only` e:

```json
{
  "simulated": true,
  "operation": "quality.records.create",
  "would": {
    "type": "DESVIO",
    "status": "EM_TRIAGEM",
    "origin": "OMNI",
    "projectCode": "05776",
    "actionOwnerUserId": "usuario-existente-ficticio",
    "eventDate": "2026-10-29",
    "description": "Exemplo fictício de teste",
    "impact": "MEDIO",
    "externalRef": { "system": "omni", "url": "https://example.test/checagem", "reference": "exemplo" },
    "previewNumber": "D-001/26"
  },
  "warnings": [],
  "requestId": "simulacao-ficticia"
}
```

`would` reflete os dados calculados no banco antes do rollback, inclusive replays
e versões antigas ignoradas, sem IDs provisórios de registros, projetos,
oportunidades, documentos ou versões. Referências a usuários existentes são
preservadas. `previewNumber` é provisório e não reserva nem consome numeração.

Erros mantêm o código HTTP e o corpo da escrita real, também com
`Preference-Applied: validate-only`. Exemplo fictício: HTTP 422,
`{"code":"ACTION_OWNER_NOT_FOUND","message":"O e-mail deve identificar um único usuário ativo.","requestId":"simulacao-ficticia"}`.
O consumidor deve conferir cabeçalho e `simulated: true` em todo sucesso simulado.
Escritas reais preservam seus contratos, sem esses marcadores.

A simulação verifica conflitos com chaves reais, mas não salva sua chave. A mesma
Idempotency-Key pode ser usada depois na escrita real. Registros de domínio,
recibos, sequências, feed, notificações e auditoria de domínio ficam no rollback.
Nenhum e-mail, arquivo, job, chamada externa ou efeito pós-commit é produzido;
invalidações de cache das rotas de projetos são suprimidas. Cotas, último uso e o
log `ApiRequestLog.simulated = true` permanecem fora da transação de domínio.

Contrato OpenAPI em [openapi.yaml](../specs/015-api-token-playground/contracts/openapi.yaml)
e evidências por rota em [relatório da entrega](../specs/035-api-simulacao-escritas/implementation-report.md).

## Operações disponíveis

| Método | Caminho | Escopo obrigatório |
|---|---|---|
| `GET` | `/api/integracoes/v1/qualidade/registros` | `qualidade.registros.read` |
| `GET` | `/api/integracoes/v1/qualidade/registros/{id}` | `qualidade.registros.read` |
| `GET` | `/api/integracoes/v1/qualidade/naturezas` | `qualidade.naturezas.read` |
| `GET` | `/api/integracoes/v1/qualidade/evidencias/{id}/download` | registros + metadados + download |
| `GET` | `/api/integracoes/v1/cargos/{id}/salario?referenceDate=AAAA-MM-DD` | `cargos.salarios.read` |

`qualidade.evidencias.metadata.read` inclui metadados allowlisted. `qualidade.excluidos.read` é necessário para `includeDeleted=true`. Caminhos físicos, tokens públicos, sequências internas e identificadores de usuários não são publicados.

## Salários por cargo para o ComercialAPP

Na central **Administração → Tokens de API**, conceda **Consultar salário por cargo** (`cargos.salarios.read`). A operação **Consultar salário por cargo e data** também está disponível no playground. A permissão `cargos.read` permite descobrir os IDs pela listagem `/cargos`, mas não concede acesso a salários.

```http
GET /api/integracoes/v1/cargos/cargo_1/salario?referenceDate=2026-10-15
Authorization: Bearer <token>
```

```json
{
  "jobRoleId": "cargo_1",
  "jobRoleName": "Operador",
  "salary": "4086.57",
  "effectiveDate": "2026-07-01",
  "version": 2
}
```

`referenceDate` é obrigatória e deve ser uma data válida no formato `AAAA-MM-DD`. A consulta retorna o salário base mensal em BRL como texto decimal e seleciona a maior vigência até a data informada, inclusive; em empate, vale a maior versão dessa vigência. Uma versão cadastrada depois com vigência retroativa não substitui uma vigência mais recente. Um reajuste futuro só aparece em consultas a partir da sua vigência.

A resposta contém apenas identificação do cargo, salário, início da vigência e versão. A consulta é global, aceita cargos ativos e inativos e independe do recorte de projetos do token. Não aceita identificadores de colaboradores nem filtros adicionais. Se o cargo não existir, retorna `404 NOT_FOUND`; se não houver salário configurado na data, retorna `404 SALARY_NOT_FOUND`, sem antecipar reajustes nem usar um salário genérico. Tokens sem a nova permissão recebem `403 INSUFFICIENT_SCOPE`; tokens existentes precisam ser substituídos para ganhar o novo escopo.

## Paginação e sincronização

### Novas coleções operacionais

Os caminhos abaixo usam a mesma base `/api/integracoes/v1`, autenticação Bearer e resposta paginada de Qualidade:

| Dados | Caminhos GET | Permissão |
|---|---|---|
| Colaboradores e cargos | `/colaboradores`, `/cargos` | `colaboradores.operacional.read`, `cargos.read`, respectivamente |
| Projetos e segmentos | `/projetos`, `/clientes/segmentos` | `projetos.read`, `clientes.segmentos.read`, respectivamente |
| Responsáveis por projeto | `/projetos/responsaveis` | `projetos.responsaveis.read` (PERSONAL) |
| Status operacional em coleção | `/efetivo/projetos/status` | `efetivo.projetos.status.read` |
| Relatórios aprovados e DDS | `/rdo/relatorios`, `/rdo/dds` | `rdo.relatorios.read`, `rdo.dds.read`, respectivamente |
| Manutenções aprovadas | `/manutencao/registros` | `manutencao.registros.read` |
| Perfis e itens de manutenção | `/manutencao/perfis`, `/manutencao/perfis/itens` | `manutencao.perfis.read` |
| Limpezas de produção aprovadas | `/producao/limpezas` | `producao.limpezas.read` |
| Equipamentos e cadastro do RDO | `/equipamentos`, `/equipamentos/rdo` | `equipamentos.read` |
| Categorias de equipamentos | `/equipamentos/categorias` | `equipamentos.categorias.read` |
| Itens e categorias de estoque | `/estoque/itens`, `/estoque/categorias` | `estoque.itens.read` |

As permissões-base de relatórios incluem número, código/nome do projeto, tipo, datas, horas, descrição diária e motivo de horas extras; colaboradores trazem código/nome/cargo/ativo; equipamentos e estoque trazem cadastros. Arquivos e custos exigem permissões adicionais descritas abaixo. Consulte os campos exatos em [Contrato operacional](../specs/015-api-token-playground/contracts/operational-read.md).

Exemplo com uma credencial que contenha `rdo.relatorios.read`:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H "Accept: application/json" \
  "https://seu-dominio/api/integracoes/v1/rdo/relatorios?limit=20"
```

No modo de projetos selecionados, relatórios/produção respeitam o projeto; colaboradores são limitados à equipe de relatórios aprovados desses projetos. Manutenções avulsas só aparecem em `ALL`. Cargos, segmentos, DDS, perfis, equipamentos e itens/categorias de estoque são cadastros globais compartilhados e não aceitam filtros de projeto.

Toda coleção vinculada a projeto aceita `projectCode`, que é o filtro recomendado para integrações, e `projectId`, mantido para compatibilidade. O código é texto e preserva zeros à esquerda. Não envie os dois filtros juntos. Em tokens com projetos selecionados, ambos continuam sujeitos ao recorte da credencial.

```bash
curl --fail-with-body --get \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H "Accept: application/json" \
  --data-urlencode "projectCode=05776" \
  --data-urlencode "limit=100" \
  "https://seu-dominio/api/integracoes/v1/rdo/servicos"
```

### Receita: consultar os RCPUs de um projeto

Para listar somente os relatórios RCPU aprovados do projeto de código `5800`, a operação é `operational.Report.list`, exige `rdo.relatorios.read` e usa esta URI:

```http
GET /api/integracoes/v1/rdo/relatorios?projectCode=5800&reportType=RCPU&limit=100
```

```bash
curl --fail-with-body --get \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H "Accept: application/json" \
  --data-urlencode "projectCode=5800" \
  --data-urlencode "reportType=RCPU" \
  --data-urlencode "limit=100" \
  "https://seu-dominio/api/integracoes/v1/rdo/relatorios"
```

Se o objetivo for consultar os **serviços registrados dentro desses RCPUs**, use `operational.ReportService.list`. Essa operação exige `rdo.relatorios.read` e `rdo.servicos.read`:

```http
GET /api/integracoes/v1/rdo/servicos?projectCode=5800&reportType=RCPU&limit=100
```

`reportType` aceita `RDO`, `RDO_MAINTENANCE`, `RDO_PRODUCTION`, `RTP`, `RLQ`, `RCPU`, `RLM`, `RLF` e `RLI`. Para consultar mais de um tipo, separe os códigos por vírgula, por exemplo `reportType=RCPU,RTP`.

Tokens existentes não ganham permissões: gere um novo token com os escopos necessários no catálogo unificado. Os demais candidatos continuam desabilitados.

### Expansão de relatórios, estoque e manutenção

Foram acrescentadas 16 permissões específicas (13 consultas e 3 downloads). Cada uma exige a permissão-base do grupo; o catálogo seleciona as dependências automaticamente.

| Grupo | Novas consultas GET |
|---|---|
| Relatórios | `/rdo/versoes`, `/rdo/equipe`, `/rdo/servicos`, `/rdo/anexos`, `/rdo/assinaturas`, `/rdo/auditoria` |
| Estoque | `/estoque/lotes`, `/estoque/movimentos`, `/estoque/documentos`, `/estoque/custos` |
| Manutenção | `/manutencao/terceiros`, `/manutencao/anexos`, `/manutencao/auditoria` |

O [contrato da expansão](../specs/015-api-token-playground/contracts/operational-expanded-read.md) lista as permissões e os dados de cada operação. Assinaturas expõem situação/papel/datas, não nomes, imagens ou provas. Auditoria expõe ação/transição e data, não atores ou observações. `estoque.custos.read` requer também `estoque.movimentos.read` e `estoque.itens.read`; custos/quantidades decimais são strings, sem perda de precisão. Documentos de estoque são globais; lotes com projeto selecionado exigem movimento no projeto, mas não representam saldo por projeto.

Filtros por `projectCode`/`projectId`, `reportType`, `reportId`, `maintenanceId` e `itemId` estão disponíveis apenas onde indicados no catálogo. As coleções sem `updatedAt` aceitam `createdSince`, que detecta somente criações. Equipe não possui timestamp: ordena por `(reportId,collaboratorId)` e exige leitura completa para reconciliação. Não envie `updatedSince` nessas operações.

```bash
# Escopos: estoque.itens.read + estoque.movimentos.read
curl --fail-with-body --get \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H "Accept: application/json" \
  --data-urlencode "limit=100" \
  --data-urlencode "createdSince=2026-09-01T00:00:00Z" \
  "https://seu-dominio/api/integracoes/v1/estoque/movimentos"
```

Downloads autenticados: `/rdo/anexos/{id}/download`, `/estoque/documentos/{id}/download` e `/manutencao/anexos/{id}/download`. Exigem base + metadados + `.download`. O console verifica acesso/disponibilidade e retorna JSON, sem transferir o arquivo; use um cliente HTTP para baixar. Os arquivos originais podem conter dados pessoais/financeiros e não são redigidos. Limite de 50 MiB por arquivo, medição de bytes e cotas de requisições existentes; não há nova cota diária de bytes.

```bash
# Escopos: rdo.relatorios.read + rdo.anexos.metadata.read + rdo.anexos.download
# ANEXO_ID deve vir da consulta /rdo/anexos. Escolha um arquivo de saída novo.
curl --fail \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  --output "anexo-baixado.bin" \
  "https://seu-dominio/api/integracoes/v1/rdo/anexos/${ANEXO_ID}/download"
```

Arquivos sem armazenamento local válido, com pasta de outro projeto, com links simbólicos ou fora das pastas gerenciadas retornam 404. Anexos legados de RDO fora da pasta atual do projeto não são liberados por fallback. Documentos legados de estoque em `Estoque/FISPQ` são suportados sem expor seu token.

### Identificação e dados técnicos de RDO e serviços

`GET /rdo/relatorios` retorna `sequenceNumber` (número salvo no relatório), `reportNumber` (por exemplo, `RDO 27` ou `RLQ 3`), `projectCode` (número/código do projeto, preservado como texto), `projectName`, `dailyDescription` e `overtimeReason`, além dos campos já existentes. Um relatório ainda sem sequência tem os dois campos de numeração nulos. O número é contextualizado pelo projeto e pelo tipo de relatório.

`GET /rdo/servicos` inclui `reportId`, `reportNumber`, `reportSequenceNumber`, `reportType`, `reportDate`, `projectId`, `projectCode`, `projectName`, `equipmentName` e `equipmentCode`, além do tipo de serviço, sistema, material, horários e conclusão. O relatório associado pode ser um RDO ou um relatório técnico derivado (RLQ, RTP, RCPU, RLM, RLF ou RLI); filtre com `reportType=RCPU`, por exemplo, para evitar misturar registros diários e consolidações.

O objeto `serviceData` contém os campos técnicos preenchidos no formulário:

| Dados | Campos |
|---|---|
| Medidas | `tubes[]`: `diameter`, `diameterUnit`, `length`, `lengthUnit` |
| Aprovação e descrição | `clientApproved`, `stages`, `drawingsTags`, `notes` |
| Limpeza | `cleaningPiping`, `cleaningMethods`, `cleaningLocations`, `inspectionTypes`, `cleaningUnits` |
| Teste de pressão | `testedEquipment`, `testedEquipmentOther`, `workingPressure`, `testPressure`, `testFluid`, `testOil`, `hydrostaticUnits`, `manometers` |
| Flushing e filtragem | `flushingPiping`, `flushingType`, `oilType`, `oilVolume`, `flushingUnits`, `filtrationUnits` |
| Partículas e umidade | `particleCounting`, `particleCounters`, `initialNas`, `finalNas`, `initialIso`, `finalIso`, `dehydration`, `dehydrationUnits`, `moistureAnalysis`, `initialMoisturePpm`, `finalMoisturePpm` |
| Inibição | `vessel`, `lines`, `steps`, `reportTypes` |
| Equipe do serviço | `collaborators[]`: `id`, `name`; requer também `rdo.equipe.read`, caso contrário retorna `null` |

Pressões e volume são objetos `{ value, unit }`. Unidades, manômetros e contadores retornam listas de `{ id, code, name }`; códigos/nomes registrados no relatório são preservados e os dados faltantes são resolvidos no cadastro. Referências antigas sem cadastro correspondente mantêm o identificador e os rótulos salvos, deixando os demais campos nulos. O equipamento atendido usa o nome informado no relatório; `equipmentCode` é nulo quando não existe vínculo com o cadastro de equipamentos de serviço.

`totalLengthMeters`, na raiz do serviço, soma os comprimentos em metros com precisão decimal e retorna texto. As medidas originais em `serviceData.tubes` mantêm os valores e unidades preenchidos, inclusive vírgulas e diâmetros fracionários. Sem medidas ou com algum comprimento/unidade inválido, o total é `null`, em vez de um total parcial. Campos não preenchidos são `null` ou listas vazias.

Exemplo parcial de um item de `/rdo/servicos`:

```json
{
  "reportNumber": "RDO 27",
  "reportSequenceNumber": 27,
  "reportType": "RDO",
  "projectCode": "05776",
  "projectName": "Projeto demonstrativo",
  "equipmentName": "Bomba principal",
  "system": "Hidráulico",
  "material": "Aço inox",
  "totalLengthMeters": "1.5",
  "serviceData": {
    "tubes": [{ "diameter": "1 1/2", "diameterUnit": "pol", "length": "150", "lengthUnit": "cm" }],
    "testPressure": { "value": "15", "unit": "bar" },
    "stages": ["Execução do teste"],
    "notes": "Sem vazamentos."
  }
}
```

A ampliação usa as permissões existentes `rdo.relatorios.read` e `rdo.servicos.read`, incluindo dados de relatórios já salvos. O catálogo e o Playground mostram os novos campos. Os textos operacionais preenchidos passam a fazer parte dessas projeções; metadados/arquivos de fotos e anexos continuam nos endpoints e permissões próprios. O JSON interno, chaves de continuação, caminhos, tokens e assinaturas não são devolvidos.

A paginação continua usando `updatedAt` do registro consultado. Renumeração do relatório, alteração do nome do projeto ou de um equipamento relacionado não necessariamente atualiza o serviço; para refletir essas mudanças de contexto, faça reconciliação completa periódica.

### Dados de projetos para o Omni

`GET /projetos` acrescenta `clientName`, `clientCnpj`, `commercialProposalCode`, `endDate`, `includesSaturday`, `includesSunday`, `workdayHours`, `weekendWorkdayHours` e `executedAtHeadquarters`. O CNPJ contém 14 dígitos; legado inválido/ausente retorna null. O campo de sede vem do workflow e é null quando não existe. Os campos e filtros atuais permanecem; updatedSince continua usando Project.updatedAt, portanto mudanças somente no workflow exigem reconciliação completa desse campo derivado.

`GET /projetos/responsaveis` exige o novo escopo AVAILABLE/PERSONAL `projetos.responsaveis.read`. Cada item contém somente `projectId`, `projectCode`, `role`, `userId`, `collaboratorId`, `name`, `email` e `updatedAt`. LEADER vem de leaderUserId (Líder de Projetos), PLANNER de plannerUserId (Gestor de Contrato) e FIELD_OPERATOR de operatorId (colaborador de campo). Somente User.email no domínio exato `filtrovali.com.br`; e-mail pessoal/ausente retorna null, sem fallback para username ou e-mail do colaborador. Aceita limit, cursor, snapshotAt, updatedSince e projectCode/projectId. O carimbo é max(Project.updatedAt, ProjectWorkflow.updatedAt); a ordem é projectId/role. Alterações de cadastro de pessoas e remoções exigem reconciliação completa periódica.

`GET /efetivo/projetos/status` usa o escopo existente `efetivo.projetos.status.read`, agora também para coleção paginada. Cada item repete a projeção individual e acrescenta `commercialExpectedMobilizationDate`, `commercialExpectedStartDate`, `commercialExpectedDurationDays` e `actualMobilizationDate`. A consulta individual por id conserva seu contrato. Filtros: active, projectCode/projectId, stage; paginação: limit, cursor, snapshotAt. Inclui projetos elegíveis no Efetivo, ativos/inativos conforme active; projetos excluídos, exclusivos do gestor e centros de sede ficam fora.

**A coleção de status exige leitura completa e rejeita updatedSince/createdSince.** O avanço muda por RDO sem alterar workflowVersion. SnapshotAt limita a criação dos projetos e fixa a paginação por id, mas não congela gates/avanço. Para 42 projetos com limite de 100, uma requisição substitui 42 consultas individuais.

```http
GET /api/integracoes/v1/projetos/responsaveis?projectCode=05776&limit=100
GET /api/integracoes/v1/efetivo/projetos/status?active=true&stage=EXECUTION&limit=100
```

O Playground oferece as duas novas operações e seus parâmetros. O envelope continua em **schemaVersion 1.0**. Campos exatos, exemplos completos com dados fictícios e testes estão no [contrato/relatório Omni](../specs/033-api-omni-projetos/contracts/omni-read.md). Para acrescentar o novo escopo ao Omni, emita outro token ou rotacione a credencial; não há ampliação automática.

### Omni fase 2 — Entrega A

Escopos novos **AVAILABLE**: `eventos.read`, `rdo.relatorios.todos.read` e
`qualidade.registros.create`. O envelope mantém **schemaVersion 1.0**. Tokens
existentes precisam de rotação ou nova emissão para receber essas permissões.

`GET /eventos?limit=100` lê identificadores das mudanças em feed vivo, gravado na
mesma transação e independente das notificações de usuários. Exige eventos.read
mais a permissão de leitura de cada recurso. Escopos e projetos filtram antes da
paginação; não há contagem global. A janela pública é de **30 dias**; os eventos
não são apagados automaticamente nesta entrega e não há backfill histórico.

```json
{
  "items": [{ "id": "evt_123", "type": "rdo.aprovado", "occurredAt": "2026-10-28T12:00:00.000Z", "projectId": "projeto-ficticio", "projectCode": "5850", "resource": "rdo", "resourceId": "rdo-ficticio" }],
  "page": { "limit": 100, "hasMore": false, "nextCursor": "cursor-assinado-ficticio", "snapshotAt": "2026-10-28T12:01:00.000Z" },
  "generatedAt": "2026-10-28T12:01:00.000Z", "schemaVersion": "1.0", "requestId": "request-ficticio"
}
```

Guarde nextCursor **mesmo quando hasMore=false**, para o próximo polling.
SnapshotAt informa a leitura e não congela o feed. A sequência respeita a ordem
de commit; deduplique pelo id. Cursor assinado vincula credencial, política e
escopos. Cursor atrasado retorna **410 CURSOR_EXPIRED**: reconcilie os recursos e
reinicie sem cursor. Limit aceita 1–500, padrão 100, limitado pela credencial.

| Eventos | Permissão de recurso |
|---|---|
| `rdo.criado`, `rdo.devolvido`, `rdo.assinado` | `rdo.relatorios.todos.read` |
| `rdo.aprovado` | `rdo.relatorios.read` ou `rdo.relatorios.todos.read` |
| `workflow.etapa_alterada` | `efetivo.projetos.status.read` |
| `qualidade.criado`, `qualidade.alterado` | `qualidade.registros.read` |
| `romaneio.emitido` | `romaneios.itens.read` — ainda bloqueado; evento já persistido |
| `projeto.responsaveis_alterados` | `projetos.responsaveis.read` |

Envio inicial e reenvio para PENDING geram rdo.criado. ReportDraft fica fora.
Qualidade inclui alterações de evidências e exclusão lógica, sem duplicar o evento
quando o registro e suas evidências mudam juntos. Romaneio OUTBOUND é emitido ao receber PDF/DOCX;
regenerar o documento não reemite o evento.

`GET /rdo/relatorios` com `rdo.relatorios.todos.read` funciona sem o escopo antigo,
inclui PENDING, RETURNED, APPROVED e SIGNED e aceita `status=PENDING,RETURNED`.
Acrescenta submittedAt, returnedAt, signedAt e clientReleasedAt; approvedAt já
existia. Sem o escopo novo, preserva apenas APPROVED e os campos anteriores; status
exige o novo escopo. UpdatedSince reflete mudanças de status. SubmittedAt representa
o envio mais recente (createdAt para legado); signedAt legado usa evidência de
assinatura/auditoria disponível e pode ser nulo.

`POST /qualidade/registros` exige `qualidade.registros.create` e header
`Idempotency-Key` UUID. Mesma chave/corpo/credencial retorna o mesmo **201**;
corpo diferente retorna **409 IDEMPOTENCY_CONFLICT**. Após falha de rede/5xx, repita
com a mesma chave e corpo. Os recibos não expiram nesta entrega.

```json
{
  "type": "DESVIO", "projectCode": "5850", "eventDate": "2026-10-28",
  "description": "Mobilização adiada: exemplo fictício.", "impact": "MEDIO",
  "actionOwnerEmail": "qualidade@filtrovali.com.br",
  "externalRef": { "system": "omni", "url": "https://omni.filtrovali.com.br/exemplo", "reference": "pergunta-ficticia" }
}
```

Tipos: DESVIO, INCIDENTE, RECLAMACAO_CLIENTE. Impactos: ALTO, MEDIO, BAIXO.
Informe projectCode ou projectId no recorte. Email deve resolver um único User ativo,
sem diferenciar caixa; ausência/ambiguidade retorna **422 ACTION_OWNER_NOT_FOUND**.
Grava FK actionOwnerUserId e actionOwner textual. Origem fixa **OMNI**; não envie
origin no corpo. Cria em **EM_TRIAGEM, sem natureza**, para classificação posterior.
ExternalRef é preservada internamente. A auditoria comum registra a credencial
como ator e a origem; qualidade.criado é emitido na mesma transação.

Resposta fictícia:

```json
{ "id": "qualidade-ficticia", "number": "D-012/26", "status": "EM_TRIAGEM", "createdAt": "2026-10-28T12:00:00.000Z" }
```

O Playground inclui as operações e o campo Idempotency-Key; POST grava dados reais
com a confirmação existente. Entrega B fica planejada; o Omni mantém seu calendário.
Veja o [contrato e decisões](../specs/034-api-omni-fase2/contracts/omni-phase2.md).

### Como percorrer páginas

Coleções retornam `items`, `page`, `generatedAt`, `schemaVersion` e `requestId`. Use `page.nextCursor` exatamente como recebido. O cursor é assinado, fixa `snapshotAt`, inclui a posição de ordenação da coleção e está vinculado à operação, filtros e política de projetos; não o edite nem reutilize com outros filtros.

Para uma carga completa:

1. faça a primeira chamada sem cursor;
2. processe `items` de forma idempotente pelo `id` (equipe: `reportId` + `collaboratorId`; responsáveis: `projectId` + `role`; status: `projectId`);
3. repita os mesmos filtros com `cursor=page.nextCursor` até `hasMore=false`;
4. grave o maior `updatedAt` confirmado somente ao concluir o snapshot, onde essa coluna existir; `createdAt` acompanha apenas criações e equipe não possui watermark.

Para sincronização incremental, informe `updatedSince` em UTC. Em Qualidade, para remoções, conceda o escopo de excluídos e use `includeDeleted=true`; `deletedAt` funciona como tombstone. As novas coleções operacionais não têm tombstones: faça reconciliação completa periódica para remoções ou mudanças de visibilidade/vínculos. O teto não é um snapshot transacional; use upsert e sobreposição temporal para alterações concorrentes. Em caso de falha intermediária, retome pelo último cursor confirmado.

## Limites e erros

- `400 VALIDATION_ERROR` ou `INVALID_CURSOR`: corrija parâmetros; não repita automaticamente.
- `401 INVALID_TOKEN`: token ausente, inválido, agendado, expirado ou revogado. As causas são deliberadamente indistinguíveis.
- `403 INSUFFICIENT_SCOPE`, `PROJECT_NOT_ALLOWED` ou `IP_NOT_ALLOWED`: a política da credencial não permite a operação.
- `404 NOT_FOUND`: o recurso não existe ou não pertence ao recorte permitido.
- `409`: conflito administrativo de versão/idempotência.
- `410 CURSOR_EXPIRED`: cursor do feed fora da retenção; reconciliar e reiniciar.
- `422 ACTION_OWNER_NOT_FOUND`: responsável não resolve um único User ativo.
- `413 FILE_TOO_LARGE`: arquivo excede 50 MiB.
- `429 RATE_LIMITED`/`QUOTA_EXCEEDED`: respeite `Retry-After` e aplique backoff com jitter.
- `5xx`: repita apenas operações `GET`, com backoff e o mesmo cursor.

O limite efetivo por página é o menor entre o valor global (500) e o limite da credencial. Cotas de minuto/dia e linhas/dia são persistidas e compartilhadas entre instâncias do backend.

## Rotação e incidente

Para ampliar qualquer permissão, projeto, rede, validade ou limite, rotacione a credencial. Reduções e revogações têm efeito na chamada seguinte. Em suspeita de vazamento, revogue imediatamente, preserve somente request IDs/evidências não sensíveis e gere uma substituta com o menor privilégio possível.

O contrato completo está em `specs/015-api-token-playground/contracts/openapi.yaml`.

## Administração e auditoria

### Gerenciar a política do token

Em **Meus tokens**, use os filtros e **Próxima página** para encontrar a credencial. **Ver detalhes** abre suas ações, consumo e histórico paginado, com responsável, justificativa e resumo da alteração. **Abrir no Playground** seleciona explicitamente esse token para o teste. A seleção e o detalhe ficam na URL pelo identificador público da credencial, inclusive após atualizar a página; nunca pelo segredo. Uma credencial indisponível não é substituída automaticamente por outra.

- **Reduzir acesso** permite retirar permissões e dependentes, restringir projetos/IPs, reduzir os quatro limites e antecipar ou definir expiração. Uma política já restrita não pode virar irrestrita. Justificativa obrigatória; erros aparecem junto aos campos.
- **Rotacionar** copia a política atual para um editor de substituta, permitindo revisar permissões, projetos, IPs, validade e limites. Informe justificativa, sobreposição de 0/15/30/60 minutos e digite `ROTACIONAR`. Revise antes de gerar. Validade sem expiração exige uma nova confirmação `SEM EXPIRAÇÃO`.
- **Revogar** exige justificativa e o texto `REVOGAR`. A ação é terminal. Nunca informe o segredo na justificativa.

Erros do teste aparecem no console com status HTTP, código, mensagem e requestId, quando recebido; uma nova tentativa limpa o resultado anterior. Falha de conexão não inventa status ou requestId. O envelope administrativo mantém `error` e inclui `message`, `code`, `requestId` e, quando aplicável, `fields`, sem stack ou dados secretos.

### Testar qualquer permissão implementada

1. Em **Testar API**, escolha a credencial e **Permissão a testar**. Todas as permissões implementadas estão disponíveis para seleção; o botão de execução só libera as concedidas ao token.
2. Escolha uma das operações correspondentes. Uma permissão pode participar de várias operações; o painel não a transforma em acesso irrestrito.
3. Preencha somente os parâmetros exibidos. Listagens não exigem ID individual; os filtros são opcionais. Consulta individual e downloads indicam qual ID copiar e de qual listagem. Cursor e snapshot estão em **Paginação e snapshot**.
4. Execute o teste. Nos quatro downloads, **Verificar acesso ao arquivo** retorna id, MIME e tamanho, sem bytes do arquivo, links públicos ou caminhos. A verificação é limitada a 50 MiB e consome requisição/cota do JSON devolvido, não o volume total do arquivo.
5. Para comprovar o download, o token Bearer e o IP permitido, execute o cURL fora do painel, no ambiente real do consumidor. Defina `FILTRO_API_BASE_URL` com a origem do app, sem barra final (ex.: `https://app.exemplo.com`), e `FILTRO_API_TOKEN` com o segredo de teste no terminal. A simulação administrativa não recupera o segredo do token e não comprova a rede do consumidor.

Ao trocar permissão, operação ou credencial, parâmetros e resposta são limpos. A navegação preserva a seleção na URL, mas nunca o ID consultado, a resposta ou o segredo. Tokens antigos não ganham permissões; use outro token ou rotacione quando necessário.

O painel lista status efetivo, prefixo/últimos quatro caracteres, escopos, projetos, validade, último uso, linhagem de rotação e consumo recente. A trilha administrativa registra criação, redução, teste, rotação e revogação; os logs de uso guardam apenas operação, template de caminho, contagens, duração, resultado e filtros allowlisted. Headers, corpos, respostas, token e verificador não são persistidos.

Uma edição só pode reduzir acesso. Para ampliar escopo, projetos, CIDRs, validade ou limites, use **Rotacionar**, armazene o novo segredo no cofre e encerre a sobreposição em até 60 minutos. **Revogar** é terminal e exige motivo; nunca cole o segredo no motivo.

O catálogo do painel contém os 173 modelos de negócio em 20 domínios. Há 44 permissões disponíveis, selecionáveis dentro de cada domínio, incluindo o escopo próprio de responsáveis e as operações do CRM; candidatos sem contrato implementado continuam bloqueados. Campos e endpoints podem ser consultados na própria linha. Somente as projeções e arquivos explicitamente contratados são publicados. Tokens antigos não recebem permissões novas automaticamente: emita outro ou rotacione com as permissões desejadas.

## Oportunidades quentes do PrismaCRM

O contrato de oportunidades sem número de projeto, exibição em Futuros e vínculo
no fechamento está em [PRISMACRM_OPORTUNIDADES.md](PRISMACRM_OPORTUNIDADES.md).
