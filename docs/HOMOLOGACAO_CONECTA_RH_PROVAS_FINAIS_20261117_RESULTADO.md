# Homologação CONECTA RH — provas finais de 17/11/2026

**Homologação funcional da integração encerrada no staging em 17/11/2026.** As duas provas funcionais finais passaram, e a revogação das credenciais temporárias A/B foi confirmada com `401 UNAUTHORIZED`. Foram aprovadas **35 verificações, sem falhas**: 30 da coleta funcional e cinco do encerramento. A credencial original continua respondendo `200` e o worker segue sem pendências.

Evidência estruturada: [conecta-rh-provas-finais-20261117.json](evidence/conecta-rh-provas-finais-20261117.json). Retorno pronto: [confirmação da coleta e encerramento de A/B](RESPOSTA_FILTROAPP_CONECTA_PROVAS_FINAIS_20261117.md).

## Execução

A prova HTTP ocorreu em **17/11/2026, das 15:18:36 às 15:23:56**, horário de São Paulo, a partir do container backend do staging na VPS. Os estados do aplicativo foram consultados antes/depois da conclusão. Ambiente: `/root/apps/filtroAPP-staging`, empresa `ca682be5-ab0c-43a8-8a26-d3f7eb1d7526`.

Foram conferidos a resposta `RESPOSTA_CONECTA_RH_PROVAS_FINAIS_20261117.md`, o ZIP, seu manifesto e os cinco PDFs fictícios. Tamanhos e hashes dos cinco arquivos coincidem com o manifesto. Os roteiros fornecidos foram inspecionados; a execução usou um consumidor HTTP isolado, sem executar a preparação de dados que depende do repositório e das permissões administrativas do CONECTA.

As credenciais temporárias foram recebidas por stdin do processo na VPS. Não foram configuradas no worker, passadas como argumentos de linha de comando ou incluídas no Git. As URLs assinadas ficaram somente na memória do processo; não constam dos relatórios nem dos logs de evidência.

## Troca de credencial no meio do feed

| Verificação | Resultado |
| --- | --- |
| Leitura com A | 100 eventos, em quatro páginas de 25. |
| Continuação com B | 42 páginas usando o último cursor obtido com A. |
| Comparação independente | Leitura integral com B em três páginas de até 500. |
| Sequência | 1.141 × 1.141 eventos, mesma ordem e mesmo hash da sequência. |
| Duplicação/lacunas | 1.141 `eventId` distintos; nenhuma diferença na sequência. |
| Checkpoint final | `200`, sem itens pendentes. |
| Snapshot criado por A | `201`; leitura com A retorna `200`. |
| B acessando snapshot de A | `404 NOT_FOUND`, com `requestId` rastreável. |
| Watermark de A no feed de B | `200`, sem exigir um snapshot novo. |

Snapshot isolado desta prova: `dc9e7afb-a5bb-4785-9a0c-43e259b12345`. A troca de credencial foi feita entre requisições desse consumidor isolado; a configuração do worker instalado foi preservada. O comportamento observado é compatível com o cliente publicado, que conserva o checkpoint entre execuções.

## Download e estados dos arquivos

| Caso | Resultado observado |
| --- | --- |
| A, NR-33 ativo | Emissão de link `200`; PDF `200`, `application/pdf`, 743 bytes, SHA-256 correto. |
| B v2, NR-06 atual | Emissão de link com B `200`; PDF `200`, 746 bytes, SHA-256 correto. |
| B v1 substituída | `410 EVIDENCE_SUPERSEDED`; nenhum link novo. |
| C, NR-12 revogado | `410 EVIDENCE_REVOKED`; nenhum link novo. |
| D, comprovante removido | `404 NOT_FOUND`; nenhum link novo. |
| ASO do fixture | `404`; arquivo não disponibilizado. |
| A, mesmo link após vencer | `400 InvalidJWT`, observado após a expiração real. |
| A, acesso renovado com B | Novo link `200`; PDF baixado novamente com tamanho e hash corretos. |

O acesso inicial a A venceu às **15:23:38.495** e o mesmo link foi recusado às **15:23:53.964**. A renovação com B emitiu acesso válido até **15:28:55.467**; o download correto terminou às **15:23:56.253**. Não foi simulada a passagem do tempo.

Os downloads usaram HTTPS e destino Supabase validado. O Bearer foi enviado somente à API do CONECTA; o armazenamento recebeu apenas o acesso assinado. O `expiresAt` do link é temporário e distinto da validade do documento e do `evidence.expiresAt` do envelope.

Conforme o contrato informado pelo CONECTA, links emitidos antes de substituição/revogação podem permanecer válidos até completar seus cinco minutos. As recusas desta prova impedem a emissão de links novos para versões substituídas/revogadas. A sobrevivência de um link emitido antes de uma transição não foi reproduzida: os casos foram recebidos em estados finais independentes, conforme o roteiro acordado.

## Aplicação no staging

Os quatro envelopes finais da origem estão na revisão 3 e em `APPLIED`, recebidos às 14:47 de 17/11:

| Caso | eventId | receiptId |
| --- | --- | --- |
| A | `8410afdf-a502-4d28-8a5e-4d3cc8913b64` | `cmwkziotp06wf01lcbd56708w` |
| B | `c976cb85-9ac6-4afa-846c-9200d098115f` | `cmwkzip0k06wj01lct7fp5amh` |
| C | `8b46afd6-ea19-4358-9b84-b877f6680b35` | `cmwkzip8b06wn01lcdoz61z1b` |
| D | `89bf0b2d-4ad7-48e1-a8ed-9e1beaca306b` | `cmwkzip9t06wr01lcf8s10wl8` |

O serviço de conformidade utilizado pelo painel retorna as versões atuais de A/B, C revogado e D sem evidência. Os arquivos fictícios novos alteraram deliberadamente os estados de P10: os resultados de 16/11 continuam como checkpoints históricos, e não como expectativa da fixture após esta preparação.

Estado ao encerrar a coleta: **1.136 recibos `APPLIED`, 3 `SUPERSEDED`, nenhum agregado pendente ou falho**. Os três jobs recentes estão `COMPLETED`, sem erro. O último observado iniciou às 15:22:05 e concluiu às 15:22:07. O fingerprint da credencial original e o hash do cursor do worker coincidem antes/depois da coleta.

Esta rodada conferiu a API de evidências da origem e a importação dos metadados/estados no FiltroAPP. Não foi criado ou homologado um novo fluxo de download na interface. Não houve alteração de código do app ou implantação nesta rodada.

## Encerramento

Após a confirmação de revogação pelo responsável, a VPS verificou o endpoint `/changes` em **17/11/2026 às 15:48:19**, horário de São Paulo:

| Credencial | Resposta | requestId |
| --- | --- | --- |
| A (`cnt_jW8XhK`) | `401 UNAUTHORIZED` | `8262fdcb-02de-4c54-91da-ada172bfedbc` |
| B (`cnt_EMEFkM`) | `401 UNAUTHORIZED` | `43a99634-1719-4d0e-91c7-4cf8da6ccf8a` |
| Original instalada (`cnt_4QhymN`) | `200`, feed válido | `c9b0657e-7c91-4760-aa40-c7d417da92db` |

Nas duas recusas, o `requestId` do corpo coincide com o cabeçalho. O fingerprint da credencial original continua coincidindo com o registrado na coleta funcional. O horário acima corresponde à observação do FiltroAPP; não foi atribuído um horário à operação administrativa feita no CONECTA.

Os três ciclos recentes do worker estão `COMPLETED`, sem erro; o último iniciou às 15:47:05 e terminou às 15:47:07. Há 1.136 recibos `APPLIED`, 3 `SUPERSEDED` e nenhum agregado pendente ou falho. Essas cinco verificações adicionais passaram e constam da evidência estruturada.

**Não restam pendências desta homologação funcional no staging.** A limpeza dos fixtures fictícios é uma etapa posterior, anterior ao uso definitivo dos cadastros. Os limites da prova de download e do checkpoint histórico P03 continuam registrados nos relatórios correspondentes.
