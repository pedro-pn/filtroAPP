# RH — Conecta → FiltroAPP

Implementação do receptor baseada na [resposta do Conecta de 11/11/2026](integracoes/conecta/integracao-rh-filtroapp.md) e no [OpenAPI de leitura recebido](integracoes/conecta/integracao-rh-filtroapp-openapi.yaml). O contrato do receptor integra o [OpenAPI do FiltroAPP](../specs/015-api-token-playground/contracts/openapi.yaml).

## Pré-admissão e datas

Decisão acordada com o responsável pelo FiltroAPP em 13/11/2026:

- `PRE_ADMISSION` aceita admissão prevista, inclusive futura, ou `null`.
- Quando `admissionDate=null`, o cadastro usa provisoriamente o dia do **primeiro recebimento do vínculo** no fuso `America/Sao_Paulo`. `occurredAt` não é a data de recebimento.
- A referência é persistida antes de resolver dependências. Reenvios, novas revisões sem data, reinícios e recuperação por feed não a alteram.
- O estado original do Conecta continua com `admissionDate=null`; o cadastro local marca `admissionDateProvisional=true`.
- Se a ocorrência de cargo também vier com `effectiveDate=null`, sua vigência acompanha essa referência. Quando vier a admissão oficial, a vigência derivada acompanha a data oficial. Uma vigência expressamente informada pelo RH permanece a informada.
- `ACTIVE` e `TERMINATED` exigem admissão oficial. O calendário não ativa a pessoa. A ativação é um novo evento de RH para o mesmo `employmentId`.
- Recontratação mantém a pessoa e cria outra referência no novo vínculo. Correções de vínculos anteriores ficam no histórico.
- O app identifica a pré-admissão e pede confirmação para mobilizar. A API também exige confirmação; a autoalocação não confirma essa condição automaticamente. Datas provisórias não geram alertas de férias.

**Adequação para o desenvolvedor do Conecta:** o OpenAPI recebido exige `role_change.effectiveDate` preenchida. O receptor aceita `null` para a ocorrência ligada à pré-admissão sem data, conforme a decisão acima; o emissor precisa permitir essa representação. Se o cargo já vier em `employment.currentJobRoleId`, o FiltroAPP já cria a referência provisória do cargo, mesmo antes da chegada da ocorrência.

## Recepção

`POST /api/integracoes/v1/rh/conecta/eventos`

- Bearer técnico existente, autorização `ALL`, escopo `rh.conecta.eventos.write`.
- `job_role_salary` exige também `rh.conecta.salarios.write`.
- `Idempotency-Key` obrigatório, igual ao `eventId`.
- `companyId` deve corresponder a `CONECTA_RH_COMPANY_ID`.
- Resposta `202 {receiptId, statusUrl, status, reasonCode?, receivedAt, requestId}`.
- `GET statusUrl`, com Bearer, retorna o estado atual. `PENDING` indica dependência ou conciliação pendente; `APPLIED` indica aplicação; `SUPERSEDED` indica revisão ultrapassada.
- Mesmo evento retorna o mesmo recibo e o mesmo recebimento inicial. Reutilizar evento ou revisão com outro conteúdo retorna `409`.
- Erros desse receptor usam `{error: {code, message}, requestId}`. Salários, CPF, tokens e corpos de eventos não integram a telemetria de requisições.
- `Prefer: validate-only` e credenciais `SIMULATE` executam o serviço com rollback, sem emitir recibo persistente.

Todos os cinco agregados são preservados, inclusive cancelamentos e revogações. Cargos são conciliados pela chave canônica; pessoas, por CPF ou matrícula exatos e inequívocos. Nome não é chave de pessoa. Sem correspondência cadastra-se uma pessoa com código `CONECTA-<personId>`. Correspondências ambíguas ficam pendentes, com `PERSON_MAPPING_AMBIGUOUS`, até a correção dos identificadores no cadastro. Os IDs externos ficam em tabelas de origem; não substituem os IDs locais.

Os salários alimentam parâmetros do cargo na vigência recebida, preservando os demais parâmetros de custo. Uma ausência de salário não cria valor zero. Ocorrências recebidas com cancelamento ou substituição removem somente a projeção pertencente à integração. A conformidade é mantida por pessoa e seu status é recalculado para a data consultada.

## Preparação e homologação

O [roteiro de homologação](HOMOLOGACAO_CONECTA_RH.md) detalha as 12 etapas, os testes nas telas e os resultados esperados.

1. Publicar a migration `20261113100000_conecta_rh` e os processos API/worker da mesma versão.
2. Configurar `CONECTA_RH_COMPANY_ID` com o UUID real da empresa, informado pelo Conecta.
3. Criar uma credencial técnica de RH com os escopos de eventos e, se desejado, de salário, ou rotacionar a credencial existente para ampliar os privilégios. Uma credencial `SIMULATE` não serve para ativar o envio real.
4. Para carga inicial e recuperação automática, configurar no backend `CONECTA_RH_API_URL` com a URL completa terminada em `/api/integracoes/filtroapp/v1` e `CONECTA_RH_READ_TOKEN` com o token de leitura emitido pelo Conecta. Não incluir segredos no frontend.
5. O worker executa `conecta-rh` a cada cinco minutos. Sem credencial de leitura, apenas reavalia as dependências dos eventos recebidos. Com a credencial, conclui todos os recursos do snapshot antes de gravar o watermark e depois consome o feed. Salários podem ser omitidos por falta de escopo. Cursores expirados iniciam outro snapshot; ausência em snapshot não exclui registros.
6. Homologar pré-admissão sem data, data prevista futura, ativação, desistência, desligamento, recontratação, troca de cargo, correção de salário e revogação de conformidade. Verificar a consulta de status pelo Conecta antes de ligar o envio automático.

As credenciais reais, a publicação e a ativação do envio não são feitas por essa alteração de código.

## Respostas às perguntas do Conecta

O receptor suporta `employmentId` estável por período e preserva as limitações declaradas de histórico de cargo e piso, sem inventar períodos anteriores. CPF continua opcional no contrato e pode ajudar a conciliar cadastros existentes. `statusUrl` fornece `status` e, quando houver pendência, `reasonCode`, além dos identificadores do recibo.
