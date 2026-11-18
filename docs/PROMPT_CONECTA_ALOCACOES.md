# Prompt para o desenvolvedor do Conecta

Implemente no Conecta a importação e visualização da alocação diária dos
colaboradores, usando a conferência do FiltroAPP como fonte. Leia primeiro a
arquitetura e os padrões existentes do Conecta. O endpoint foi implementado no
FiltroAPP e precisa estar publicado no ambiente que será configurado.

**Atualização de 18/11/2026 — contrato de resposta 2.0:** importar também os dias
não conferidos. O FiltroAPP passou a retornar ajustes e sugestões automáticas
sem exigir conferência ou gravação prévia da semana. Aplicar esta alteração ao
importador existente e à apresentação do calendário no Conecta.

Contrato: `GET {FILTRO_API_BASE_URL}/api/integracoes/v1/efetivo/conferencia/alocacoes?from=2026-10-01&to=2026-10-31&limit=100`.
Base URL sem `/api`; autenticar com `Authorization: Bearer <token técnico>`.
URL/token ficam no backend, configurados por ambiente. Solicitar credencial
exclusiva com `efetivo.conferencia.read` e acesso `ALL` aos projetos. A documentação
anexa `INTEGRACAO_CONECTA_ALOCACOES.md` e seu OpenAPI são o contrato desta entrega.

Parâmetros: `from` e `to` obrigatórios, datas inclusivas `AAAA-MM-DD`, até 93 dias;
`collaboratorId` opcional; `limit` até 500 limitado pela credencial; `cursor`
opaco de `page.nextCursor`. Paginar mantendo os filtros até `page.hasMore=false`.
A resposta contém `{items, page, generatedAt, schemaVersion, requestId}`.

Cada item contém `id`, `date`, `kind`, `collaborator: {id, code, name,
registrationNumber}`, `projects: [{id, code, name, clientName, clientCnpj}]`,
`confirmationStatus`, `confirmedAt`, `weekStart`, `weekVersion` e `updatedAt`. `projects[].code` é o
número do projeto. Preservar zeros à esquerda em códigos, matrículas e CNPJ.
CNPJ possui 14 dígitos sem máscara ou `null`, devendo ser formatado só na tela.

Exibir calendário mensal por colaborador, com filtro de período e detalhamento
do dia: todos os projetos, seus números, cliente e CNPJ. Traduzir `kind`:

- `PROJECT`: projeto(s), podendo haver vários no mesmo dia.
- `TRAVEL`: “Viagem”, com exatamente um projeto de destino e seu CNPJ.
- `SEDE`: “Sede”, com `projects=[]`, sem inventar número de projeto ou CNPJ.
- `FOLGA`, `FERIAS`, `AFASTAMENTO`, `TREINAMENTO`: rótulos correspondentes,
  também sem projetos. Não inferir motivo clínico.
- `NONE`: “Sem informação”, sem projetos; não presumir sede, folga ou falta.

Persistir `confirmationStatus` (`CONFIRMED` ou `PENDING`) por colaborador/data.
Importar ambos, sem filtrar `confirmedAt != null`. Exibir **“Aguardando
confirmação”** no dia `PENDING`, com ícone/texto acessível além da cor; no detalhe,
explicar “Alocação ainda não conferida no FiltroAPP”. Exibir “Conferido” quando
`CONFIRMED`. Oferecer filtro para dias pendentes e diferenciar o aviso do tipo de
alocação: “Projeto 05747 · Aguardando confirmação”, por exemplo. Não tratar uma
sugestão automática sem divergências como conferida. A confirmação ocorre no
FiltroAPP por colaborador/semana; a tela do Conecta exibe o resultado recebido.

Aceitar `schemaVersion: "2.0"`, `confirmedAt: null` em pendentes,
`updatedAt: null` em sugestões automáticas e `weekVersion: 0` em semanas ainda
não gravadas. `id` pode ser sintético (`automatic:<collaboratorId>:<date>`) e mudar
ao salvar/conferir; usar sempre `(collaborator.id, date)` como chave de upsert.
Se a base atual exigir essas datas preenchidas ou versão positiva, ajustar a
migration/validação local. Registros legados do contrato 1.0 eram conferidos;
na migração, preencher seu status a partir de `confirmedAt`, sem marcar entradas
novas pendentes como confirmadas. Dias futuros são previsões pendentes.

Ao reimportar, atualizar alocação e status mesmo se só a confirmação mudou.
`PENDING → CONFIRMED` retira o aviso; `CONFIRMED → PENDING` recoloca o aviso e
mantém a alocação. Reiniciar a importação sem cursor na implantação e reimportar
os meses desejados para preencher também os dias antes omitidos.

Ausência de registro significa “Sem alocação publicada”; não deduzir sede,
folga, falta ou ausência de trabalho. Histórico de pessoas inativas e
projetos arquivados é válido. Dias com projetos indisponíveis para a API podem
ser omitidos por inteiro. Dados cadastrais refletem o cadastro atual.

Persistir vínculo entre `collaborator.id` do FiltroAPP e a pessoa/vínculo local.
Usar matrícula apenas quando conciliada e única; não associar automaticamente
somente por nome nem presumir igualdade entre código interno e matrícula.
Apresentar colaboradores não conciliados para resolução.

Importar todas as páginas para uma área temporária e só então substituir,
atomicamente, os dados provenientes do FiltroAPP no período e eventual
colaborador filtrados. Usar `(collaborator.id, date)` como chave lógica, mantendo
todos os projetos do dia. Remover dados previamente importados que estiverem
ausentes da nova consulta completa, inclusive em resposta vazia; preservar os
dados próprios do RH. Nunca aplicar um conjunto incompleto de páginas.

Se receber `409 ALLOCATION_REVIEW_CHANGED`, descartar a importação temporária e
reiniciar sem cursor: houve alteração durante a paginação. Cursor depende da
credencial e dos filtros; uma rotação de token exige reinício da consulta.
Não usar `updatedAt` ou `weekVersion` para sincronização incremental: sugestões
podem mudar sem edição do dia ou da semana; exclusões não geram tombstones.
Implementar atualização periódica dos meses recentes e reimportação
manual de qualquer período histórico, com última sincronização e erros visíveis.
Os intervalos da rotina devem ser configuráveis para respeitar cotas.

Tratar timeout/429/5xx com retry, backoff e `Retry-After`; 400 exige correção de
parâmetros e 401/403 exigem correção da credencial. Registrar `requestId` e
contagens, sem tokens ou payload pessoal em logs. Não acessar o banco do FiltroAPP.

Entregar código, persistência/migrations locais necessárias, telas, rotina,
configuração e testes cobrindo viagem, sede, múltiplos projetos, CNPJ ausente,
zeros à esquerda, paginação, conciliação, repetição idempotente, correção
retroativa, sugestão automática sem semana gravada, ajuste pendente, `NONE`,
confirmação posterior sem duplicar o dia, desconfirmação preservando a alocação,
datas nulas, versão zero, resposta vazia, falha em página intermediária,
409 durante importação e isolamento dos dados próprios do RH.
