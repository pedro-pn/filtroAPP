# Retorno do FiltroAPP — homologação CONECTA RH de 17/11/2026

Conferimos a resposta e os registros reais do FiltroAPP. A carga inicial concluiu em 16/11 às 18:17, o worker está concluindo os ciclos sem erro e o feed responde normalmente. Há 1.129 recibos `APPLIED`, 3 `SUPERSEDED` e nenhum pendente. Os 1.084 agregados dos cinco recursos estão aplicados.

O cancelamento do vínculo sem admissão foi aplicado sem data oficial inventada. A matrícula 103 e a matrícula 800001 estão em pessoas distintas, com CPFs distintos, e as ocorrências dependentes foram aplicadas. Não há matrículas duplicadas entre as pessoas mapeadas. Aceitamos o esclarecimento de que a Engenharia está no setor Operacional no cadastro atual; não é necessário publicar vínculos fictícios `isOperational=false`.

Confirmamos o evento P04 `150be3fc-79a7-43c9-b742-c932e369ae01` pelo feed às **09:32:06 de 17/11**, antes da ativação do push. O job executou nesse intervalo, sem requisição RH de entrada. A primeira recepção de P09 ocorreu às **10:12:07** e a de P07 às **11:47:07**, também antes dos envios HTTP da agenda. Os recibos estão `APPLIED`; os envios posteriores reutilizam os recibos existentes. Confirmamos chamadas `202` às 10:35 e 11:50, mas os horários do emissor/polling não devem ser registrados como os primeiros recebimentos ou como aplicação inicial exclusiva por push.

Confirmamos ainda as duas consultas de alocações em produção às 10:01:03 de 17/11, ambas `200`, com 17 e 18 itens. P03 permanece aceito com a limitação histórica já registrada. Não é necessário repetir os cenários aprovados nem reenviar toda a carga.

Todos os horários deste retorno são de São Paulo.

## Preparar somente as duas provas restantes

### 1. Troca de credencial de leitura

- Criar duas credenciais temporárias A/B para a mesma empresa, com os mesmos escopos necessários, válidas por pelo menos 24 horas após a entrega. Fornecer os segredos por canal seguro, separados do relatório.
- Preservar a credencial instalada `cnt_4QhymN`, o envio automático e o consumo corrente do FiltroAPP. O teste será uma leitura isolada; não requer trocar o token do worker.
- Informar se o cursor do feed é reutilizável entre A/B e documentar a resposta e o procedimento esperado se houver vinculação à credencial. Snapshots devem continuar sendo lidos com a credencial que os abriu; não apresentar reutilização de snapshot de A com B como troca válida.
- Entregar um roteiro executável para ler parte do feed com A e continuar com B, com paginação forçada, IDs/eventos esperados e verificação de ausência de lacunas. Se o contrato exigir novo snapshot, explicitar como esse procedimento se relaciona ao comportamento do cliente publicado.
- Manter A/B disponíveis até a coleta do FiltroAPP e, ao final, revogar apenas essas credenciais temporárias. Registrar a revogação no relatório final.

### 2. Download de evidência fictícia

- Deixar um arquivo fictício de NR/CNH disponível para download autenticado pelo FiltroAPP. Nenhum dos 581 itens atuais tem arquivo; anexar, substituir e remover tudo antes da nossa coleta impede essa prova.
- Preparar casos independentes, para que possam ser conferidos numa única rodada: versão ativa; arquivo substituído com versão nova ativa e comportamento esperado da antiga; arquivo revogado/removido; e expiração de acesso temporário, se esse mecanismo fizer parte da API.
- Fornecer `complianceId`, `evidenceId`, versões, caminhos de download autenticados, MIME, tamanho, SHA-256 dos arquivos fictícios e os HTTP/erros esperados em cada estado. Documentar a diferença entre expiração do link e revogação do documento, incluindo renovação de link quando aplicável.
- Manter o caso ativo disponível por pelo menos 24 horas. Para expiração, fornecer um roteiro que gere acesso de curta duração no momento da prova, sem expirar as credenciais A/B nem eliminar os demais casos.
- Não incluir ASO, toxicológico, documentos reais ou URLs assinadas/segredos no relatório. Usar arquivos fictícios e os tipos permitidos pelo endpoint.

Entregar juntos o manifesto dos casos, os roteiros, a validade das credenciais e os estados esperados. O FiltroAPP fará as leituras e downloads e devolverá uma única evidência final. Se alguma etapa exigir uma transição ao vivo, indicar antes qual ação precisa ocorrer após o checkpoint; não executar essa transição antes da coleta.

O aceite completo continua pendente dessas duas provas. Não há necessidade de reabrir os impedimentos cadastrais já resolvidos ou os demais cenários aprovados.
