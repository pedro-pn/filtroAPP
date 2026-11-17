# Conferência dos envios do CONECTA em 16/11/2026

**As rodadas de pré-admissão e ativação enviadas pelo CONECTA foram aplicadas corretamente no staging.** Os seis eventos distintos estão em `APPLIED`, sem pendências ou falhas de aplicação. Na rodada inicial foram aprovadas oito verificações de banco, API e tela; a ativação foi conferida em seguida, conforme a seção específica abaixo. O aceite completo da integração continua pendente dos demais cenários e da API de leitura.

Esta conferência somente consultou os dados recebidos; não enviou nem alterou eventos de RH. O ambiente continua no commit `cc265f0a524c468df174aa87f12481436c0c79e4`, em `/root/apps/filtroAPP-staging`.

## Resultado da rodada

Empresa configurada na API e no worker: `ca682be5-ab0c-43a8-8a26-d3f7eb1d7526`.

| Evento recebido | Revisão | Resultado |
| --- | --- | --- |
| Cargo operacional | 1 | `APPLIED`, um único cargo local. |
| Vínculo em pré-admissão sem data | 1 | `APPLIED`, uma única pessoa local. |
| Ocorrência de cargo com `effectiveDate=null` | 1 | `APPLIED`, um único registro no histórico de cargo. |
| Atualização do mesmo vínculo, ainda sem data | 2 | `APPLIED`, preservou cadastro e referência inicial. |
| Ativação do mesmo vínculo, com admissão oficial | 3 | `APPLIED`, atualizou a mesma pessoa e retirou a marca provisória. |
| Mesma ocorrência de cargo, com vigência expressa | 2 | `APPLIED`, manteve um único registro de histórico. |

Os primeiros eventos chegaram em **16/11/2026 às 11:29:51**, horário de São Paulo. A revisão 2 do vínculo chegou às **11:30:28**. Os logs registram cinco respostas `202` para quatro eventos distintos, incluindo um reenvio; não houve duplicação dos registros. Também registram consultas de recibo respondidas com `200` pela origem. Na conferência, os quatro recibos foram novamente consultados via HTTPS e retornaram `APPLIED`.

## Cadastro na rodada inicial

| Campo | Resultado observado |
| --- | --- |
| Pessoa | `ZZZ Teste Homologação Pré Sem Data` |
| Cargo | `ZZZ Teste Homologação Cargo A` |
| Estado do RH | `PRE_ADMISSION` |
| Badge na tela | **Pré-admissão · aguardando RH** |
| Admissão local | **16/11/2026 (provisória)** |
| Primeiro recebimento do vínculo | `2026-11-16T14:29:51.529Z`, preservado após a revisão 2 |
| Data original no CONECTA | `admissionDate=null`, preservada na origem armazenada |
| Vigência local do cargo | **16/11/2026**, derivada da referência provisória |
| Histórico de cargo | Um registro, sem duplicação após a revisão 2 |
| Desligamento | Ausente, conforme o evento |
| Resultado da busca na tela | Uma pessoa |
| Conformidade | Nenhum item recebido para essa pessoa; a tela informa essa ausência |

[Abrir a pessoa no staging](https://filtrostaging.filtrovali.com.br/efetivo?section=colaboradores&date=2026-11-16&search=ZZZ%20Teste%20Homologa%C3%A7%C3%A3o&colaborador=cmwjd15xx000g1gpntyfd1kil).

## Ativação e admissão oficial

Os eventos seguintes chegaram em **16/11/2026 às 11:46:46**, horário de São Paulo. Os identificadores informados pelo desenvolvedor coincidem com os registros da API; os dois envios responderam `202`, em modo persistente, e as consultas autenticadas dos recibos retornaram `200` com `APPLIED`.

| Evento | eventId | receiptId | Estado |
| --- | --- | --- | --- |
| `employment.upserted`, revisão 3 | `b92464dd-dce0-4e8c-a0e6-262a912df343` | `cmwjdmx3m001r1gpnwdxni7mv` | `APPLIED` |
| `role_change.upserted`, revisão 2 | `9368eb4a-9aea-4f95-9e66-6b70d217b801` | `cmwjdmxa5001w1gpn9mzr0jih` | `APPLIED` |

Resultado final: a mesma pessoa `cmwjd15xx000g1gpntyfd1kil` e o mesmo vínculo `a845c54c-387b-44ad-a226-31946cdd012b` estão **ACTIVE**, com `isActive=true`, admissão oficial **16/11/2026** e `admissionDateProvisional=false`. A referência do primeiro recebimento permaneceu `2026-11-16T14:29:51.529Z`. Não houve duplicação da pessoa, do vínculo ou do histórico de cargo. Na tela, a busca retornou uma única pessoa, a data aparece sem “provisória” e o badge de pré-admissão desapareceu.

A mesma ocorrência de cargo permaneceu vinculada ao mesmo registro de histórico, com vigência **16/11/2026**. Como a data oficial e a referência provisória eram iguais, e o CONECTA também enviou uma vigência expressa, esta rodada confirma a retirada do caráter provisório e o estado final do histórico; não demonstra deslocamento de uma vigência derivada para uma data diferente.

[Evidência da ativação](evidence/conecta-rh-ativacao-20261116.json) e [captura da admissão oficial na tela](../output/playwright/conecta-activation-20261116/admissao-oficial.png).

## Saúde e registro anterior

API, worker, Nginx e PostgreSQL estavam saudáveis. `/health` respondeu `200 {"ok":true}`. As últimas execuções do job `conecta-rh` terminaram em `COMPLETED`, sem erro. O job está apenas conciliando os recebimentos: URL e token de leitura do CONECTA continuam sem configuração e não existe cursor de sincronização para a empresa.

Há um `400 VALIDATION_ERROR` anterior à rodada válida, às 11:15:31, com `requestId=df37874e-d91f-49f4-9492-4583f1bba980`. O log não preserva o corpo e não permite atribuir a causa exata. Os envios válidos posteriores foram aceitos e aplicados; não ficou recibo pendente decorrente dessa tentativa. A validação `SIMULATE` feita pelo FiltroAPP às 11:24 foi separada dos envios persistidos do CONECTA.

## Próxima rodada com o desenvolvedor

A ativação com admissão oficial está concluída para essa pessoa. A próxima rodada deve cobrir pré-admissão com data futura e mobilização, seguida dos demais cenários abaixo. Para comprovar o ajuste de uma vigência derivada para outra data pela origem, usar em um cenário separado uma admissão oficial diferente da referência provisória e conferir o resultado antes de enviar uma vigência expressa de cargo.

Ainda não foram recebidos nesta empresa eventos suficientes para homologar pré-admissão com data futura, mobilização nesta rodada, desistência, desligamento, recontratação, troca de cargo, salários e conformidade pela origem. Essas verificações constam do [roteiro](HOMOLOGACAO_CONECTA_RH.md) e do [prompt de homologação completa em lote](PROMPT_CONECTA_RH_HOMOLOGACAO_COMPLETA.md).

Também faltam configurar a URL e o token de leitura emitido pelo CONECTA, testar snapshot/feed reais e conferir a ativação do envio automático e o consumidor de alocações. Os recebimentos desta rodada aprovam os casos enviados, sem comprovar os cenários que ainda não chegaram.

## Evidências

- [Verificações, eventos, recibos e requestIds](evidence/conecta-rh-origem-20261116.json).
- [Captura da pessoa na tela](../output/playwright/conecta-real-20261116/pre-admissao-recebida.png).

As evidências e a conferência original foram preservadas na VPS em `/root/backups/filtrovali-staging/conecta-rh-20261116/`. Nenhum token foi incluído nos arquivos públicos. As alterações locais de código de outras tarefas foram preservadas.
