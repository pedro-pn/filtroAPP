# Homologação CONECTA RH — conferência de 17/11/2026

Atualização posterior: [as duas provas funcionais finais e a revogação de A/B foram aprovadas](HOMOLOGACAO_CONECTA_RH_PROVAS_FINAIS_20261117_RESULTADO.md), com `401` confirmado e a credencial original funcionando. A homologação funcional no staging está encerrada. O texto abaixo registra o checkpoint anterior ao recebimento do pacote final.

**O fluxo principal de sincronização foi confirmado no staging.** A carga inicial concluiu, os dois impedimentos cadastrais foram resolvidos e o feed está sendo consumido. O aceite completo continua pendente de duas provas: troca de credencial durante a leitura e download de evidência com arquivo fictício.

Esta conferência responde a `RESPOSTA_CONECTA_RH_HOMOLOGACAO_20261117.md`. Foram aprovadas **13 verificações** com consultas ao banco do staging, ao feed real e aos logs de alocações em produção. Evidência: [conecta-rh-staging-20261117.json](evidence/conecta-rh-staging-20261117.json). Encaminhamento: [resposta pronta ao CONECTA](RESPOSTA_FILTROAPP_CONECTA_20261117.md).

## Ambiente e limites

- Worktree: `/home/relat/apps/filtroAPP-conecta`, branch `feat/conecta-rh-integration`.
- VPS: `/root/apps/filtroAPP-staging`, base `cc265f0a`, com os patches de Engenharia e conformidade já publicados na rodada anterior.
- Empresa: `ca682be5-ab0c-43a8-8a26-d3f7eb1d7526`.
- Coleta principal: 17/11/2026 às 14:26, horário de São Paulo.
- Os hashes de `projection.js` e `schema.js` coincidem entre a worktree e o container do staging.
- A conferência fez leituras. Não alterou configurações, cadastros, credenciais ou implantação; não enviou eventos RH. A consulta de alocações em produção também foi somente de leitura.

As versões, migrações e execuções internas da agenda do CONECTA foram informadas pelo seu desenvolvedor. Esta conferência corrobora os dados e as chamadas recebidas no FiltroAPP; não constitui auditoria do código ou da base do outro sistema.

## Situação verificada

| Item | Resultado no FiltroAPP |
| --- | --- |
| Vínculo sem admissão | Revisão 3 `CANCELLED`, `APPLIED`, sem admissão oficial nem desligamento na origem; cadastro local inativo. |
| Matrícula 103 | Preservada para a pessoa original; a outra pessoa tem matrícula 800001 e cadastro local distinto. CPFs distintos, sem fusão. |
| Dependências dos dois vínculos | Ocorrências aplicadas; nenhuma permanece `DEPENDENCY_PENDING`. |
| Recibos | 1.129 `APPLIED`, 3 `SUPERSEDED`, nenhum pendente ou falho. |
| Agregados | 1.084, todos `APPLIED`: 141 cargos, 116 vínculos, 119 ocorrências de cargo, 581 conformidades e 127 salários. |
| Recuperação do snapshot | Primeiro job completo após a última falha: 16/11 às 18:17:05–18:17:15. Cursor persistido. |
| Worker atual | Cinco ciclos recentes `COMPLETED`, sem erro; a última falha registrada é anterior à recuperação do snapshot. |
| Feed atual | `200`, página vazia, `hasMore=false` e checkpoint válido. |
| Evento criado sem push | P04 revisão 4 recebido às 09:32:06 de 17/11, durante o job do feed e antes da ativação do push. |
| Entregas do emissor | Requisições `202` às 10:35 e 11:50, coerentes com a agenda informada; recibos P09/P07 em `APPLIED`. |
| Alocações | Duas consultas `200` em produção às 10:01:03, com 17 e 18 itens. |

Os horários acima são de São Paulo.

## Cancelamento e conciliação cadastral

O vínculo `9cff896e-e637-42d1-ad26-9c18ae621ec8` está na revisão 3, com recibo `cmwjrkz2n01fl01lcak1nijvr` em `APPLIED`. A origem conserva `admissionDate=null` e `terminationDate=null`; a ocorrência `bc01719c-08cb-455e-a1e2-785277b74ac3` foi cancelada, aplicada e não mantém histórico local ativo.

O cadastro local cancelado conserva a referência interna de 16/11 marcada como **provisória**, está inativo e não tem desligamento. Essa referência de primeiro recebimento não se tornou uma admissão oficial do RH.

A revisão 2 do vínculo `101170b1-22aa-4827-9493-80648756c209` foi aplicada com matrícula 800001. A revisão 1 passou a `SUPERSEDED`, e a ocorrência dependente `bf8052c8-c80e-46bf-85bd-ab58288aab78` está `APPLIED`. As duas pessoas envolvidas permanecem em cadastros distintos. Não foram encontradas matrículas duplicadas entre as 115 pessoas mapeadas desta empresa.

Na publicação atual não há `TERMINATED` sem admissão, `TERMINATED` sem desligamento nem `CANCELLED` com desligamento preenchido. A recontratação de P07 mantém o vínculo atual ativo e a saída de 07/11 no vínculo anterior, sem regressão para o cadastro desligado.

## Prova do feed e distinção dos horários

O evento `150be3fc-79a7-43c9-b742-c932e369ae01`, P04 revisão 4, foi criado às 09:31:45 e recebido no FiltroAPP às **09:32:06.486**. O job `conecta-rh` rodou de 09:32:05.701 a 09:32:06.856 e concluiu. Não há requisição RH de entrada na janela de 90 segundos antes/depois do recebimento. O push, segundo a origem, só foi ligado às 10:08. Esses registros confirmam a recuperação pelo feed, antecipando o horário de 10:07 citado como referência no relatório do CONECTA.

Os horários de envio/consulta da agenda não representam necessariamente o primeiro recebimento no FiltroAPP:

| Fixture | Primeiro recebimento persistido | Envio HTTP posterior informado pela origem |
| --- | --- | --- |
| P04 | 09:32:06.486 | Reenvio após ativação do push |
| P09 | 10:12:07.006 | 10:35:17 |
| P07 | 11:47:07.202 | 11:50:18 |

Os recibos atuais dos três eventos estão `APPLIED`. O feed recebeu P07 e P09 antes do push, e o reenvio utiliza o recibo já existente. Os logs confirmam chamadas `202` nos horários da agenda informada. Isso corrobora entrega e idempotência entre os dois caminhos; não deve ser apresentado como aplicação inicial exclusiva por push. O modelo de recibos não guarda um `appliedAt` histórico separado, portanto a consulta atual também não permite usar o horário de polling como horário exato de aplicação.

## Engenharia

O CONECTA esclareceu que a Engenharia pertence ao setor Operacional no cadastro atual e já é publicada com `isOperational=true`. Foram encontrados zero vínculos publicados com `isOperational=false`, em conformidade com essa explicação. Não se mantém uma exigência de criar vínculos fictícios de outro setor para encerrar esta conferência.

A compatibilidade do FiltroAPP com profissionais publicados de outros setores, conforme decisão do responsável, permanece coberta pelos testes e pela reprodução isolada da rodada anterior. A classificação setorial real da Engenharia foi informada pelo CONECTA; o payload atual não permite auditar por si só quais pessoas pertencem à Engenharia.

## Alocações agendadas

Foram localizadas em produção, usando a credencial de alocações já identificada na conferência anterior:

| requestId | Horário | HTTP | Itens |
| --- | --- | --- | --- |
| `f25e049f-f760-49d1-bc6a-452d8c29f542` | 17/11 10:01:03.129 | 200 | 17 |
| `cd7cfb7f-15ae-4677-a35d-a75b5670fd38` | 17/11 10:01:03.943 | 200 | 18 |

O total é 35. Os logs confirmam as consultas no horário informado. O mês de cada consulta e a persistência da importação no CONECTA são informações do emissor; o log do FiltroAPP não conserva os filtros dessas duas requisições nem comprova a gravação no outro sistema.

## O que falta

1. **Troca de credencial no meio do feed**, com credenciais temporárias e leitura isolada, preservando a credencial e o cursor do worker instalado. É necessário confirmar a regra real de portabilidade de cursores entre credenciais e o isolamento dos snapshots.
2. **Download de arquivo fictício permitido**, incluindo versão ativa, substituição, revogação e expiração. Os 581 itens publicados estão sem evidência de arquivo no estado consultado. O teste já feito pelo CONECTA não substitui o download pelo FiltroAPP, pois o arquivo foi substituído/removido antes desta coleta.

P03 mantém a limitação histórica já aceita: o estado final e a regra derivada foram aprovados, mas não houve checkpoint real da origem antes de preencher a vigência expressa. Não é necessário repetir o lote inteiro ou reenviar o evento antigo para representar esse checkpoint.

O [encaminhamento ao CONECTA](RESPOSTA_FILTROAPP_CONECTA_20261117.md) solicita somente a preparação necessária para essas duas provas. A credencial de escrita desta rodada vence em 20/11/2026 às 15:48, horário de São Paulo, conforme registro anterior; a rodada pendente usa principalmente credenciais temporárias de leitura e não altera esse prazo.
