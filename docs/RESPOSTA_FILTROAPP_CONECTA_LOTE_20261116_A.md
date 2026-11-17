# Resposta do FiltroAPP ao lote 20261116-A

Conferimos o manifesto, os envelopes, os recibos e as projeções do lote. Foram aprovadas 28 verificações no staging e 31 testes automatizados. Mobilização de P01/P05, salários, histórico, recontratação, isolamento salarial e conformidade foram conferidos. Os fixtures continuam disponíveis. Não é necessário repetir o lote inteiro nem reenviar a carga completa apenas para repetir casos aprovados.

O FiltroAPP corrigiu e publicou no staging:

- Engenharia ativa e disponível para equipes, conforme decisão do responsável. `isOperational=false` permanece como classificação da origem; não impede atividade local dos vínculos publicados em `ACTIVE`/`PRE_ADMISSION`.
- Conformidade com `issuedOn=null`, permitido pelo contrato: o vencimento/isenção agora é respeitado sem transformar automaticamente itens válidos em pendentes.

Também foi feito o teste real de escrita salarial sem escopo, com `403 INSUFFICIENT_SCOPE` e sem persistência. A credencial temporária foi revogada; esse item não precisa voltar como bloqueio por falta de credencial.

## 1. Corrigir o vínculo que bloqueia o snapshot

```text
companyId: ca682be5-ab0c-43a8-8a26-d3f7eb1d7526
employmentId: 9cff896e-e637-42d1-ad26-9c18ae621ec8
revision atual: 1
status: TERMINATED
admissionDate: null
role_change dependente: bc01719c-08cb-455e-a1e2-785277b74ac3
```

O RH deve informar a admissão oficial; publicar nova revisão com novo `eventId`. Não criar uma data fictícia para passar na validação. A API de leitura também precisa devolver a versão corrigida. O worker já está configurado com a URL e a credencial fornecidas, mas para nesse evento sem avançar o watermark. Depois da correção, acompanhar a nova tentativa do worker e o recibo dependente.

## 2. Esclarecer a identidade da matrícula 103

```text
personId pendente: 4a510bb5-7928-4f0c-84e7-504babb8bdef
employmentId: 101170b1-22aa-4827-9493-80648756c209
outra pessoa de origem já vinculada à matrícula: 249d11af-5969-4589-9b17-08b92148c51f
role_change dependente: bf8052c8-c80e-46bf-85bd-ab58288aab78
```

A consulta atual encontrou uma matrícula coincidente com CPF e nome diferentes. Não fizemos fusão nem troca de CPF. Confirmar com o RH se a matrícula foi reutilizada ou se um identificador está incorreto. Se houver erro, corrigir os dados da origem e publicar nova revisão. Se a reutilização for legítima, confirmar que são pessoas distintas e informar o vínculo correto para resolvermos a conciliação explicitamente, preservando ambas.

## 3. Publicar efetivamente a Engenharia

O responsável confirmou a inclusão da Engenharia nas equipes. O receptor está pronto e foi testado, mas a base publicada ainda não contém vínculos com `isOperational=false`. Habilitar a publicação dos vínculos/ocorrências/conformidades da Engenharia, mantendo a classificação correta do setor, e devolver IDs para conferência de importação e disponibilidade.

## 4. Concluir snapshot e provar o feed sem push

A URL e a credencial de leitura já estão configuradas no backend e no worker do staging. A autenticação e os cinco recursos foram testados com sucesso; a carga só não conclui pelo item 1.

Após corrigir o dado e observar a primeira carga completa do FiltroAPP — incluindo acesso ao `/changes` após o snapshot, observável na API de origem — criar uma alteração fictícia nova apenas na origem, com push manual e automático desligados. Devolver `eventId`, agregado/revisão e horário. O FiltroAPP deve recebê-la exclusivamente pela leitura do feed, sem duplicar pessoas nem alterar referências iniciais. Não usar apenas uma atualização anterior ao snapshot como prova de feed exclusivo.

O teste real de falha parcial no worker já confirmou que o cursor não avança e que não há duplicação na tentativa interrompida. Esse comportamento não equivale a carga completa aprovada.

## 5. Finalizar correções e automações na origem

Disponibilizar a versão corrigida de D1/D1b/D4/D5 no backend que atende a integração e informar a versão efetivamente publicada. Comprovar que não há desligamento intermediário com data incorreta, encerramento do vínculo novo pela saída antiga ou ocorrência ativa após desistência. Não substituir uma data oficial de RH pela data de processamento como expediente de validação.

Sobre a pergunta de rede: na configuração atual, o staging autoriza todos os IPv4 (`0.0.0.0/0`). Não há bloqueio global de IP no FiltroAPP de produção nas configurações inspecionadas; a credencial das alocações também não tem restrição por IP. Não alteramos essas configurações. O Netlify não precisa de IP fixo para passar pela allowlist IPv4 atual do staging.

Configurar `FILTROAPP_RH_URL`/`FILTROAPP_RH_TOKEN` no formato esperado pelo código do emissor, com destino final:

```text
POST https://filtrostaging.filtrovali.com.br/api/integracoes/v1/rh/conecta/eventos
```

Depois de resolver as pendências obrigatórias, realizar ativação controlada da agenda no staging e comprovar uma alteração nova enviada automaticamente até `APPLIED`. A execução manual pelo mesmo código não substitui a prova do disparo agendado. Informar o estado final da flag. A credencial de escrita desta rodada vence em 20/11/2026 às 15:48, horário de São Paulo.

Também corrigir/comprovar a importação agendada das alocações no CONECTA, preservando `API_FILTROVALI`/`APP_FILTROVALI_TOKEN` e a separação do token de escrita RH. A requisição de 35 itens do relatório foi localizada em produção, com credencial `ALL`. Existem três pessoas com conferência confirmada; o volume não é causado por recorte da credencial. No staging não há linhas de conferência confirmadas; não aumentamos o volume com confirmações artificiais.

## 6. Completar as provas declaradas parciais

- P03: o evento `49b5eb5b-ae46-47d0-b6a2-5a66bc1c82d4` já chegou na carga completa às 15:10:42 de 16/11, horário de São Paulo. Não está mais retido. O estado final está correto e a regra derivada passou em reprodução isolada no FiltroAPP; para prova histórica pela origem, usar novo fixture e capturar o checkpoint antes de publicar a vigência expressa. Não repetir o envio retido como se o checkpoint ainda estivesse aberto.
- Se downloads de evidência fazem parte desta entrega, preparar um arquivo fictício de treinamento/documento permitido e comprovar expiração/substituição/revogação, sem usar ASO/toxicológico.
- Completar a troca de credencial no meio do feed com credenciais temporárias, respeitando a associação de snapshots à credencial que os criou. Não revogar a credencial de leitura instalada no FiltroAPP sem uma substituição coordenada.

Devolver uma única atualização: ações concluídas, versão publicada, IDs dos eventos novos, recibos/estados finais, provas de snapshot/feed/agenda, decisão do RH para a matrícula 103 e lista final de eventuais bloqueios. Não declarar aceite automático enquanto o snapshot estiver impedido ou houver conciliação de identidade sem resolução.
