# Prompt para executar a homologação completa do CONECTA em lote

Precisamos concluir a homologação de RH CONECTA → FiltroAPP em uma rodada organizada, sem pedir um novo envio a cada cenário. Prepare os pré-requisitos, execute todos os testes sob seu controle e devolva um único pacote de evidências. Faça a implementação e os testes necessários no CONECTA, seguindo seus padrões existentes. Use somente homologação e dados fictícios.

## 1. Ambiente e ponto de partida

```text
Origem do FiltroAPP: https://filtrostaging.filtrovali.com.br
Saúde: GET /health
Recepção: POST /api/integracoes/v1/rh/conecta/eventos
Empresa: ca682be5-ab0c-43a8-8a26-d3f7eb1d7526

Authorization: Bearer <FILTROAPP_RH_TOKEN>
Content-Type: application/json
Idempotency-Key: <eventId>
```

O token de escrita de RH já foi usado com sucesso. A credencial emitida nesta rodada vence em **20/11/2026 às 15:48, horário de São Paulo**; se necessário, peça renovação antes do lote. Salários exigem `rh.conecta.eventos.write` e `rh.conecta.salarios.write`, acesso `ALL` e modo `LIVE`. `SIMULATE` e `Prefer: validate-only` não persistem dados.

Já foram aprovados pela origem: cargo operacional, pré-admissão sem data, `role_change.effectiveDate=null`, reenvio, revisão sem data e ativação com admissão oficial. Existem seis eventos distintos em `APPLIED` para essa empresa. A pessoa de referência está ativa:

```text
Nome: ZZZ Teste Homologação Pré Sem Data
personId: 3a863a37-1018-4a80-949b-914d087ad3ed
employmentId: a845c54c-387b-44ad-a226-31946cdd012b
employment: revisão 3, ACTIVE, admissionDate=2026-11-16
jobRoleId externo: 8b574de8-038b-45ab-bb3e-8551c1e0418b
role_change.id: d7a9f595-c7af-430c-a395-1fa9bfcebd9d
role_change: revisão 2, effectiveDate=2026-11-16
```

Use essa pessoa como referência de regressão e preserve seu estado. Os novos cenários devem ter UUIDs novos e nomes com prefixo **ZZZ HOMOLOG RH LOTE <runId>**. Como a data oficial coincidiu com a provisória no teste anterior, o deslocamento da vigência derivada para outra data ainda precisa de prova específica.

## 2. Preparar tudo antes do lote

Forneça em uma única entrega:

- URL HTTPS completa da API de leitura do CONECTA, terminando em `/api/integracoes/filtroapp/v1`.
- Credencial de leitura com `rh.leitura` e `rh.salarios.leitura`, por canal seguro, e uma credencial temporária sem escopo salarial para testar o isolamento da leitura.
- IP público de saída do backend/worker, caso seja necessária autorização adicional no staging.
- Comandos/scripts para preparar os dados, executar o lote, repetir entregas com segurança e coletar o relatório.
- Lista única dos pré-requisitos do FiltroAPP: configuração de URL/token de leitura e worker; credencial temporária de escrita sem escopo salarial; acesso para conferência de telas/mobilização; e fixtures locais necessárias para testar conciliação ambígua ou preservação de parâmetros manuais de custo.

O responsável pelo FiltroAPP configura `CONECTA_RH_API_URL` e `CONECTA_RH_READ_TOKEN` no backend e recria API/worker para carregar as variáveis. Não inclua segredos no Git, no frontend ou no relatório. Não altere diretamente o banco do FiltroAPP.

Mantenha o envio automático desligado nos testes manuais e de recuperação por feed. Organize os pré-requisitos e eventuais bloqueios de uma vez; não solicite aprovação para cada envio ou cada pessoa de teste.

## 3. Regras do lote e da evidência

- Use o contrato vigente, com envelopes completos de `schemaVersion="1.0"` e eventos `job_role.upserted`, `employment.upserted`, `role_change.upserted`, `job_role_salary.upserted` e `compliance.upserted`. Não adicione campos fora do contrato.
- Reenvio preserva corpo, `eventId` e `Idempotency-Key`. Alteração cria outro `eventId` e aumenta a revisão do mesmo agregado. Recontratação mantém a pessoa e cria outro vínculo.
- `202` confirma recebimento. Consulte o `statusUrl` com o mesmo Bearer e a mesma origem do FiltroAPP, até `APPLIED`, `SUPERSEDED` ou `FAILED`. Registre `reasonCode` enquanto `PENDING`. Use prazos de teste e relate falhas; não deixe polling infinito.
- Separe pessoas, cargos e ocorrências por cenário. Deixe fixtures finais distintas para pré-admissão sem data, pré-admissão futura, ativo, cancelado, desligado, recontratado, salário futuro e conformidades em cada estado.
- Capture checkpoints antes de aplicar uma alteração que substitua o estado anterior. Salve os envelopes fictícios e os resultados por etapa. Não faça todos os testes na mesma pessoa e devolva apenas seu último estado.
- Para verificações de telas/worker sem acesso disponível, entregue IDs, estados esperados e roteiro automatizável para conferência em lote pelo FiltroAPP. Marque `AGUARDANDO_FILTROAPP`; não declare aprovação apenas com o recibo `APPLIED`.

## 4. Pré-admissão, datas e mobilização

Execute estes cenários com pessoas independentes. Considere `D` o dia do primeiro recebimento no fuso `America/Sao_Paulo`.

1. **Pré-admissão sem data:** `PRE_ADMISSION`, `admissionDate=null`, cargo conhecido e `role_change.effectiveDate=null`. O FiltroAPP deve ter uma pessoa, badge de pré-admissão e admissão provisória `D`; a vigência derivada do cargo também deve ser `D`. `occurredAt` pode ser de outro dia e não deve substituir a referência do recebimento.
2. **Idempotência e revisões:** repetir exatamente o evento e depois emitir revisão maior ainda sem data. Mesmo evento conserva recibo e `receivedAt`; revisão nova conserva a referência original do vínculo. Reiniciar o emissor e repetir uma entrega, sem duplicar pessoas ou mudar datas.
3. **Dependência fora de ordem:** enviar vínculo referenciando um cargo de teste ainda não enviado. Registrar `PENDING/JOB_ROLE_PENDING`. Depois enviar o cargo e consultar o recibo original até `APPLIED`; a referência continua sendo o primeiro recebimento do vínculo.
4. **Admissão oficial diferente da provisória:** em outra pessoa, partir de pré-admissão sem data e ocorrência de cargo com `effectiveDate=null`; ativar com admissão oficial diferente de `D`, por exemplo `D−2`. Manter os IDs e aumentar a revisão do vínculo. Conferir a nova data oficial, retirada da marca provisória e ajuste da vigência derivada. **Não enviar uma revisão de cargo com data preenchida antes desse checkpoint:** isso esconderia se o ajuste derivado funcionou. Se a rotina do CONECTA preencher a ocorrência automaticamente, prepare um cenário controlado e registre essa particularidade.
5. **Vigência expressa:** em outra pessoa, enviar uma vigência de cargo explícita, compatível com o vínculo e diferente da admissão oficial; alterar a admissão e conferir que a vigência expressa permanece a informada.
6. **Pré-admissão com data futura:** deixar outra pessoa em `PRE_ADMISSION`, com data prevista posterior a `D`; não marcá-la como admissão provisória e não ativá-la apenas pela passagem do calendário.
7. **Mobilização das duas modalidades:** deixar uma pré-admissão sem data e outra com data futura disponíveis para uma equipe de teste no FiltroAPP. Cancelar o aviso deve impedir persistência; confirmar deve permitir a inclusão. O status continua `PRE_ADMISSION`. A API deve exigir confirmação explícita e a autoalocação não deve concedê-la implicitamente. Os checkpoints de tela e persistência devem ser conferidos pelo FiltroAPP em lote, caso você não tenha acesso.

## 5. Desistência, desligamento, recontratação e cargo

1. Desistir de uma pré-admissão com `CANCELLED`: inativar sem inventar `terminationDate`.
2. Desligar outra pessoa com `TERMINATED`, admissão oficial e data válida de desligamento: inativar na projeção e preservar as datas informadas.
3. Recontratar a pessoa desligada: conservar `personId`, criar outro `employmentId` e manter um único colaborador local. Corrigir depois o vínculo antigo e verificar que ele não substitui o atual.
4. Fazer troca efetiva entre dois cargos de teste, preservando o histórico correto. Testar correção, cancelamento e substituição de uma ocorrência por `supersedesId`, sem excluir projeções de outra ocorrência ou outro vínculo. Para substituição no mesmo dia, conferir que não há duas atribuições incompatíveis.
5. Verificar conciliação com pessoa/cargo já existentes por identificadores inequívocos, sem usar nome como identidade de pessoa. Se houver fixture ambígua fornecida pelo FiltroAPP, esperar `PERSON_MAPPING_AMBIGUOUS`, sem associação arbitrária, e confirmar resolução após correção cadastral. Se faltar essa fixture, relatar o bloqueio de forma explícita.

## 6. Salários por cargo

Use somente valores fictícios da tabela mensal do cargo: `amount` decimal em string, `currency="BRL"`, `basis="MONTHLY"`. Não derive o valor da remuneração individual.

1. Enviar salário vigente e outra ocorrência com reajuste futuro. Conferir o valor anterior na véspera e o novo a partir da vigência, consultando a data de referência; não esperar o calendário real avançar.
2. Corrigir uma ocorrência com revisão maior e cancelar outra. Testar também substituição por `supersedesId`. Somente a projeção pertencente à integração deve mudar.
3. Com fixture local de custo preparada no FiltroAPP, conferir que encargos/benefícios e parâmetros manuais permanecem preservados. Ausência de salário não pode criar valor zero. Se não houver acesso para preparar/conferir essa fixture, incluir o caso na lista única de verificações do FiltroAPP.
4. Deixar cargos separados com salário futuro ativo, salário corrigido e salário cancelado para a conferência final. Não cancelar o único exemplo de reajuste futuro antes da conferência.
5. Testar envio com credencial sem `rh.conecta.salarios.write`: esperar `403`. Não reduzir nem revogar a credencial principal para simular essa condição.

## 7. Conformidade

Prepare itens fictícios e independentes, todos vinculados à pessoa conforme o contrato (`employmentId=null`):

- Válido até o vencimento, inclusive; vencido na consulta do dia seguinte.
- Revogado, com `REVOKED` prevalecendo sobre a data consultada.
- Sem vencimento (`hasNoExpiry=true`) e estados pendente/desconhecido, conforme os dados publicados.
- Alteração de validade com revisão maior, sem duplicar o item.

Deixe exemplos finais para conferir no painel **Conformidade do RH** do FiltroAPP. Quando houver evidência documental no CONECTA, teste autorização, versão, expiração e revogação do download segundo seu contrato. Não envie conteúdo clínico; o receptor recusa evidência para `ASO`/`TOXICOLOGICO`. A existência de evidência na API do CONECTA não comprova que um download foi implementado na tela do FiltroAPP.

## 8. Recusas, conflito e recuperação

Execute testes isolados e registre HTTP, `error.code` e `requestId`:

| Caso | Resultado esperado no receptor |
| --- | --- |
| Bearer inválido | `401` |
| Empresa diferente da configurada, com envelope válido | `403 COMPANY_NOT_ALLOWED` |
| Salário sem escopo salarial | `403 INSUFFICIENT_SCOPE` |
| Idempotency-Key ausente ou diferente do eventId | `400` |
| Mesmo eventId com corpo diferente | `409 EVENT_CONTENT_CONFLICT` |
| Mesma revisão com outro conteúdo e outro eventId | `409 REVISION_CONTENT_CONFLICT` |
| ACTIVE sem admissão oficial | `400 VALIDATION_ERROR` |
| Desligamento anterior à admissão ou data de desligamento em status incompatível | Erro de validação |
| Revisão antiga reenviada após uma mais nova | Sem regressão do cadastro; novo recibo de revisão antiga pode ser `SUPERSEDED`; replay de evento já aplicado conserva seu recibo |
| Vínculo antes do cargo | `PENDING`, depois `APPLIED` ao resolver a dependência |
| Credencial SIMULATE ou Prefer: validate-only, quando disponível | `200` simulado, sem recibo/projeção persistente |

Nos testes do emissor, provocar timeout, `429` com `Retry-After` e `5xx` em destino controlado. Conferir outbox durável, retry/backoff, retomada após reinício e preservação de `eventId`/corpo. Falha de entrega não pode impedir gravação do RH. Não interromper serviços reais da VPS para provocar esses erros. Distinguir erro de transporte, recusa de payload e pendência de aplicação no painel.

## 9. Snapshot e feed reais

Com o envio automático desligado e as credenciais de leitura prontas, executar os testes do servidor CONECTA e preparar a rodada do worker FiltroAPP:

```text
POST /api/integracoes/filtroapp/v1/snapshots?companyId=...
GET  /api/integracoes/filtroapp/v1/snapshots/:id/job-roles?companyId=...
GET  /api/integracoes/filtroapp/v1/snapshots/:id/employments?companyId=...
GET  /api/integracoes/filtroapp/v1/snapshots/:id/role-changes?companyId=...
GET  /api/integracoes/filtroapp/v1/snapshots/:id/compliance?companyId=...
GET  /api/integracoes/filtroapp/v1/snapshots/:id/job-role-salaries?companyId=...
GET  /api/integracoes/filtroapp/v1/changes?companyId=...&cursor=...&limit=500
```

Todos usam Bearer de leitura. O snapshot retorna `snapshotId`, `watermarkCursor` e `expiresAt`; todas as páginas devem manter o mesmo snapshot/watermark. Páginas dos recursos retornam `items`, `nextCursor`, `hasMore`, `snapshotId` e `watermarkCursor`; o feed retorna `items`, `nextCursor`, `hasMore` e `generatedAt`.

Cobrir:

1. Carga inicial dos cinco recursos e paginação real, com múltiplas páginas forçadas nos testes de contrato do CONECTA. IDs/eventos/revisões devem coincidir com os envios.
2. Reimportação dos registros já recebidos, sem duplicar pessoas, cargos ou referências provisórias.
3. Alteração durante o snapshot, recuperável pelo feed após o watermark, sem perder atualizações.
4. Alteração criada somente na origem, sem push manual/automático, recuperada pelo worker do FiltroAPP pelo feed. O worker executa ao iniciar e a cada cinco minutos; registrar os ciclos observados.
5. Página vazia ainda devolve checkpoint válido. Persistir `nextCursor` mesmo sem itens.
6. Falha parcial em um recurso não pode avançar o watermark como se a carga estivesse completa; a retomada deve ser idempotente.
7. Cursor expirado (`410 CURSOR_EXPIRED`) inicia novo snapshot. Testar também expiração de snapshot e isolamento por empresa/credencial.
8. Ausência em snapshot não implica exclusão: publicar cancelamento/revogação/inativação explícitos e conferir sua recuperação.
9. Sem `rh.salarios.leitura`, o feed omite salários e o recurso salarial responde `403`, sem impedir os demais recursos.
10. Testar rotação de credencial de leitura usando credenciais temporárias, respeitando o contrato de cursores e snapshots. Documentar retenção, expiração e limites reais.

Testes com mock comprovam o código correspondente, não o funcionamento do worker contra o servidor real. Se a configuração do FiltroAPP ainda não estiver carregada, entregue os dados de conexão e o script pronto para executar essa fase; marque o teste integrado como pendente.

## 10. Automação e regressão de alocações

Após as verificações anteriores, realizar ativação controlada do envio automático **somente no staging**. Criar uma alteração nova na origem e comprovar o percurso completo: gravação → outbox → envio automático → `202` → recibo `APPLIED` → estado correto no FiltroAPP. Verificar retomada do emissor após reinício e ausência de duplicação quando o mesmo evento também chega pelo feed.

Conferir o consumidor existente de alocações:

```text
GET /api/integracoes/v1/efetivo/conferencia/alocacoes?from=AAAA-MM-DD&to=AAAA-MM-DD&limit=...
```

Usar a credencial própria com `efetivo.conferencia.read` e acesso `ALL`; não substituir essa autorização pelo token de escrita de RH. Testar período com dados efetivamente confirmados, paginação, interpretação/importação no CONECTA e retomada conforme o contrato. Uma resposta `200` com lista vazia, sozinha, não aprova o consumo real.

Se houver verificação obrigatória bloqueada, manter a automação desligada ao fim do lote e informar o estado final da flag. Não alterar produção.

## 11. Entrega única e critério de conclusão

Devolver tudo junto:

1. **Matriz completa**, com cada caso identificado e marcado como `PASSOU`, `FALHOU` ou `AGUARDANDO_FILTROAPP`, sem omitir testes não executados. Distinguir teste unitário/mock, endpoint real, recibo aplicado e resultado conferido no app.
2. **Manifesto JSON/CSV dos fixtures**, com `runId`, caso, nomes fictícios, `companyId`, `personId`, `employmentId`, cargos/ocorrências externos, revisões, eventos, datas e estado final esperado. Incluir checkpoints intermediários e envelopes fictícios necessários à auditoria.
3. Para cada envio: `eventId`, `aggregateId`, revisão, `Idempotency-Key`, horário, HTTP, `requestId`, `receiptId`, `statusUrl`, estado inicial/final e `reasonCode`/`error.code` quando houver. Explicar as recusas intencionais separadamente de erros inesperados.
4. Evidências de snapshot/feed reais: recursos/páginas, checkpoints, watermark, ciclo do worker e comparação antes/depois. Não registrar tokens, links assinados nem dados pessoais reais.
5. URL de leitura, instruções de configuração e entrega segura dos tokens; scripts/comandos para executar e repetir o lote sem recriar identificadores de um reenvio.
6. Uma única lista de defeitos, incompatibilidades e pré-requisitos ainda faltantes, indicando o responsável CONECTA/FiltroAPP e o procedimento de reprodução. Incluir o estado final do envio automático.

Execute todos os cenários independentes mesmo se um deles falhar. Não pare após um `APPLIED` nem entregue apenas um resumo “tudo certo”. Preserve os fixtures para a conferência em lote do FiltroAPP. Se algo não puder ser comprovado por falta de acesso, credencial ou configuração, identifique a dependência sem inventar resultado.

O aceite final exige ausência de duplicação, estados/datas corretos, salários e conformidade corretos por referência, recusas esperadas, recuperação real de falhas e consumo de alocações comprovado. A aprovação conjunta ocorre após a conferência das evidências e das verificações pertencentes ao FiltroAPP.
