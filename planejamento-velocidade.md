# Planejamento de velocidade

## Objetivo

Reduzir a lentidao percebida no ambiente de producao, principalmente nos fluxos de enviar, editar, aprovar e assinar relatorios.

## Hipoteses principais

1. O backend faz trabalho pesado dentro da propria requisicao.
2. O frontend recarrega listas completas apos salvar pequenas alteracoes.
3. Fotos e documentos aumentam muito o tempo de processamento.
4. Algumas consultas do Postgres podem estar sem indices adequados.
5. A instancia/container atual pode estar limitada para tarefas de PDF/DOCX.

## Fase 1 - Medir antes de alterar

Adicionar logs de tempo no backend para identificar exatamente onde cada requisicao demora.

Medir nos endpoints de relatorio:

- tempo total da requisicao;
- tempo da transacao Prisma;
- tempo de `organizeAndPersist`;
- tempo de sincronizacao de relatorios derivados;
- tempo de geracao de PDF/DOCX;
- tempo de chamadas ZapSign;
- tempo de envio de email.

Rotas prioritarias:

- `POST /api/reports`
- `PUT /api/reports/:id`
- `PATCH /api/reports/:id/status`
- `POST /api/reports/:id/request-signature`
- `GET /api/reports`

Resultado esperado:

- Saber se o gargalo esta no banco, nas fotos, nos documentos, na ZapSign, no frontend ou na infraestrutura.

## Fase 2 - Ganhos rapidos

Evitar reload completo no frontend apos salvar relatorio.

Hoje varios fluxos chamam `refreshReportsCache()` e, em alguns casos, `refreshDbFromApi()` apos uma alteracao pequena. Isso pode baixar listas grandes de novo.

Ajustes sugeridos:

- ao salvar um relatorio, substituir apenas o item alterado em `reportsCache`;
- chamar listagens completas apenas quando mudar projeto, usuario ou dados mestres;
- manter `refreshReportsCache()` apenas para acoes que realmente criam/removem muitos relatorios derivados.

Resultado esperado:

- Melhorar a sensacao de velocidade imediatamente apos salvar/aprovar.

## Fase 3 - Tirar trabalho pesado da requisicao

Mover tarefas secundarias para processamento em background.

Candidatos:

- organizacao de fotos;
- geracao de PDF/DOCX;
- envio de email;
- sincronizacao de documentos derivados quando nao precisa bloquear a resposta;
- comunicacao com ZapSign quando for possivel retornar estado intermediario.

Abordagem simples inicial:

- responder ao usuario apos gravar o relatorio;
- disparar tarefas com fila leve ou job interno;
- registrar status de processamento no banco quando necessario.

Abordagem mais robusta:

- usar fila com Redis/BullMQ ou equivalente;
- criar workers separados do container web;
- permitir retry em tarefas que falham.

Resultado esperado:

- POST/PUT deixam de esperar tarefas caras que nao precisam bloquear a tela.

## Fase 4 - Banco de dados

Revisar indices no Postgres para consultas frequentes.

Indices candidatos:

- `Report(projectId, status)`
- `Report(projectId, reportType)`
- `Report(createdByUserId)`
- `Report(zapsignDocToken)`
- `Report(reportDate)`
- `Report(status, reportDate)`

Validar antes com:

- `EXPLAIN ANALYZE`;
- logs de queries lentas do Postgres;
- volume atual de registros na tabela `Report`.

Resultado esperado:

- Listagens, filtros e buscas por relatorio ficam mais estaveis conforme a base cresce.

## Fase 5 - Fotos e uploads

Reduzir custo de trafego e processamento de imagens.

Ajustes sugeridos:

- comprimir fotos no frontend antes do envio;
- limitar resolucao maxima;
- evitar base64 grande dentro de JSON quando possivel;
- preferir upload dedicado por arquivo;
- salvar somente URL/metadados no relatorio.

Resultado esperado:

- Menos payload em POST/PUT e menos uso de memoria no Node.

## Fase 6 - Documentos PDF/DOCX

Evitar gerar documentos repetidamente quando nada mudou.

Ajustes sugeridos:

- criar cache por versao do relatorio;
- invalidar documento somente quando dados relevantes mudarem;
- gerar PDF/DOCX em background apos aprovacao;
- servir arquivo ja gerado em downloads posteriores.

Resultado esperado:

- Menos CPU e menos tempo em fluxos de assinatura/download.

## Fase 7 - Infraestrutura AWS

Depois de medir, avaliar se a instancia esta subdimensionada.

Verificar:

- CPU durante geracao de PDF/DOCX;
- memoria do container backend;
- latencia entre backend e Postgres;
- performance do volume onde ficam relatorios;
- logs de restart ou throttling.

Possiveis acoes:

- aumentar instancia;
- separar worker de background do backend web;
- usar storage externo para arquivos;
- configurar monitoramento basico de CPU, memoria e latencia.

## Ordem recomendada

1. Colocar logs de tempo.
2. Testar fluxos reais em producao e coletar dados.
3. Reduzir reload completo no frontend.
4. Criar indices confirmados por consulta lenta.
5. Mover organizacao de fotos/documentos/email para background.
6. Otimizar imagens e cache de documentos.
7. Ajustar infraestrutura se os dados mostrarem falta de recurso.

## Criterios de sucesso

- salvar relatorio comum em ate 1 segundo, sem fotos pesadas;
- aprovar relatorio em ate 1 segundo quando nao houver geracao bloqueante;
- tela voltar responsiva imediatamente apos a acao;
- nenhuma requisicao comum acima de 3 segundos sem motivo externo claro;
- logs capazes de mostrar qual etapa ficou lenta.
