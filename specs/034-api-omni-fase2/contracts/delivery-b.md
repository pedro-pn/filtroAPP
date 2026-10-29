# Contrato Omni — Entrega B

Base /api/integracoes/v1; Bearer; schemaVersion 1.0. Apenas mudanças aditivas.
Coleções: items, page {limit,hasMore,nextCursor,snapshotAt}, generatedAt,requestId,
schemaVersion. Filtros: limit,cursor,snapshotAt,updatedSince,projectId OU projectCode.
Recorte e vínculo de projetos aplicados antes da paginação; nenhum total global.

## B1

GET /efetivo/projetos/medicoes; GET /efetivo/projetos/{id}/medicao.
Escopo efetivo.projetos.medicao.read (INTERNAL). Campos projectId,projectCode,
preparedAt,sentAt,approvedAt,situacao,saldoPendente,updatedAt. Datas ISO UTC ou null.
Situação APROVADA > ENVIADA > PREPARADA > SEM_MEDICAO por presença das datas.
Saldo true quando aprovado < executado; null quando faltar um dos dois valores.
Escopo efetivo.projetos.medicao.valores.read (FINANCIAL), dependente do base,
acrescenta executedAmount,measuredAmount,approvedAmount (strings decimais ou null),
currency BRL. Valores omitidos sem escopo. Evento medicao.alterada exige base.

## B2

GET /omie/notas; omie.notas.read (FINANCIAL).
id,projectId,projectCode,tipo (NFSE/NFE/ND),numero,serie,dataEmissao,valor (decimal
string BRL),situacaoRecebimento (RECEBIDA/PARCIAL/EM_ABERTO/ATRASADA/DESCONHECIDA),updatedAt.
Ligação exata codigoProjeto → OmieProject.codigo → Project.id via projectId.
Não usar número de OS nem descrição como fallback. Sem vínculo atual: não publicar.
Eventos nota.emitida (primeira publicação por nota/projeto), nota.recebimento_alterado.
Sincronização idêntica não altera updatedAt nem duplica eventos.

## B3

GET /romaneios; romaneios.read (INTERNAL), independente de romaneios.itens.read futuro.
id,projectId,projectCode,tipo (SAIDA/RETORNO),data,emitidoEm,quantidadeItens (linhas),
pesoCarga (string decimal ou null),unidadePeso,updatedAt. Sem motorista,placa,assinatura,URL.
Evento romaneio.emitido exige romaneios.read. Retornos também têm emittedAt.

## B4

GET /omie/projetos/pendencias; omie.pendencias.read (FINANCIAL).
projectId,projectCode,aPagar,aReceber,atualizadoEm. Cada agregado:
{quantidade,valorEmAberto,proximoVencimento}; valores BRL como string decimal,
zero "0.00" quando sem pendências; valor null se título parcial não tem saldo
confiável. Datas ISO UTC/null. Cancelados e quitados não contam. Sem lançamentos ou
pessoas. Inclui projetos zerados para reconciliação. Evento pendencia.alterada.

## B5

GET /logistica/descargas; logistica.descargas.read (PERSONAL: email corporativo).
Campos id,romaneioId,projectId,projectCode,tipo (PARCIAL/TOTAL),confirmadaEm,
confirmadaPorEmail,cte (null ou {numero,emissao,transportadora}),updatedAt.
POST /logistica/descargas; logistica.descargas.create (PERSONAL), sem dependência
implícita de leitura. Corpo estrito {romaneioId,tipo,confirmadaEm,confirmadaPorEmail}.
Idempotency-Key UUID obrigatório. 201 criação/replay; 409 chave/corpo divergente
ou tentativa de acrescentar etapa após TOTAL; 422 email inativo/ambíguo/sem acesso;
404 romaneio indisponível; 403 escopo/recorte. Apenas romaneio OUTBOUND.
Email resolve usuário existente com acesso ao projeto. TOTAL repetido retorna o
registro original; mesma parcial/timestamp não duplica. Histórico parcial preservado.
Simulação Prefer: validate-only ou credencial SIMULATE: 200, Preference-Applied,
{simulated:true,operation:"logistics.unloadings.create",would,warnings:[],requestId}.
Sem IDs temporários em would; nenhum recibo/evento/auditoria persistido.
Evento descarga.confirmada exige leitura, além de eventos.read.

Interface interna confirma com sessão do líder. CT-e importado explicitamente por
ID conhecido do Omie usando ObterCTe (/produtos/dfedocs/), associado ao romaneio e
projeto selecionados; NF opcional validada no mesmo projeto. Não há endpoint Omie
documentado de descoberta/listagem CT-e. Dados CT-e ficam separados de OmieInvoice.
B6 permanece futuro; contratos da Entrega A e CRM preservados.
