const text = value => String(value ?? '').trim();
const normalizeNumber = value => text(value).replace(/^0+(?=\d)/, '');
const cents = value => Math.round(Number(value) * 100);

function parseDate(value) {
  const match = text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? date : null;
}

function paymentStatus(titles, amount) {
  const statuses = titles.map(title => text(title.status_titulo).toUpperCase());
  if (!titles.length) return 'UNKNOWN';
  const received = statuses.filter(status => status === 'RECEBIDO').length;
  const covered = titles.reduce((sum, title) => sum + cents(title.valor_documento || 0), 0) >= cents(amount);
  if (received === titles.length && covered) return 'RECEIVED';
  if (received || statuses.some(status => /PARCIAL/.test(status))) return 'PARTIAL';
  if (statuses.some(status => /ATRASAD|VENCIDO/.test(status))) return 'OVERDUE';
  if (statuses.every(status => ['A VENCER', 'VENCE HOJE', 'ABERTO', 'A RECEBER', 'EM ABERTO'].includes(status))) return 'OPEN';
  return 'UNKNOWN';
}

// Snapshot independente dos filtros incrementais do espelho financeiro.
// Cada nota usa o identificador fiscal Omie; parcelas nunca viram novas notas.
export function buildInvoiceSnapshot({ nfse, nfe, receivables, syncedAt = new Date() }) {
  const titles = [...new Map(receivables.map(row => [String(row.codigo_lancamento_omie), row])).values()]
    .filter(row => !/CANCELAD|^C$/i.test(text(row.status_titulo)));
  const byId = new Map(titles.map(row => [text(row.codigo_lancamento_omie), row]));
  const fiscalKey = (project, client, number, type) => JSON.stringify([text(project), text(client), normalizeNumber(number), type]);
  const byFiscal = new Map();
  const byOs = new Map();
  for (const row of titles) {
    const type = text(row.codigo_tipo_documento);
    if (!['NFS', 'NFE'].includes(type)) continue;
    const key = fiscalKey(row.codigo_projeto, row.codigo_cliente_fornecedor, row.numero_documento_fiscal, type);
    byFiscal.set(key, [...(byFiscal.get(key) ?? []), row]);
    if (type === 'NFS' && row.nCodOS) {
      const osKey = fiscalKey(row.codigo_projeto, row.codigo_cliente_fornecedor, row.nCodOS, type);
      byOs.set(osKey, [...(byOs.get(osKey) ?? []), row]);
    }
  }
  const candidates = [];
  for (const row of nfse) {
    const header = row.Cabecalho ?? {};
    if (header.cStatusNFSe !== 'F' || header.cAmbienteNFSe !== 'P') continue;
    candidates.push({
      source: 'NFSE', omieId: header.nCodNF,
      codigoProjeto: text(row.Adicionais?.nCodigoProjeto),
      numero: text(header.nNumeroNFSe), serie: text(header.cSerieNFSe) || null,
      dataEmissao: parseDate(row.Emissao?.cDataEmissao), valor: Number(header.nValorNFSe),
      clienteNome: header.cRazaoDestinatario || null, clienteCnpj: header.cCNPJDestinatario || null,
      clientCode: header.nCodigoCliente, os: row.OrdemServico?.nCodigoOS, titleIds: []
    });
  }
  for (const row of nfe) {
    const header = row.ide ?? {};
    const order = row.pedido ?? {};
    if (header.tpNF !== '1' || header.tpAmb !== '1' || header.dCan || header.dInut || header.cDeneg === 'S'
      || order.opPedido !== '11' || order.cCancelado === 'S') continue;
    const projectCodes = [...new Set((row.titulos ?? []).map(title => text(title.nCodProjeto)).filter(code => code && code !== '0'))];
    candidates.push({
      source: 'NFE', omieId: row.compl?.nIdNF,
      codigoProjeto: text(order.nIdProjeto || (projectCodes.length === 1 ? projectCodes[0] : '')),
      numero: text(header.nNF), serie: text(header.serie) || null,
      dataEmissao: parseDate(header.dEmi), valor: Number(row.total?.ICMSTot?.vNF),
      clienteNome: row.nfDestInt?.cRazao || null, clienteCnpj: row.nfDestInt?.cnpj_cpf || null,
      clientCode: row.nfDestInt?.nCodCli, titleIds: (row.titulos ?? []).map(title => text(title.nCodTitulo))
    });
  }
  // Repetição de número/série: não inferir pagamento por um número fiscal ambíguo.
  const keyCounts = new Map();
  for (const row of candidates) {
    const key = fiscalKey(row.codigoProjeto, row.clientCode, row.numero, row.source === 'NFSE' ? 'NFS' : 'NFE');
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const invoices = new Map();
  for (const row of candidates) {
    if (!row.codigoProjeto || row.codigoProjeto === '0') continue;
    if (!row.omieId || !row.numero || !row.dataEmissao || !Number.isFinite(row.valor) || row.valor < 0) {
      throw new Error('Nota fiscal faturada com dados incompletos; histórico anterior preservado.');
    }
    const type = row.source === 'NFSE' ? 'NFS' : 'NFE';
    const key = fiscalKey(row.codigoProjeto, row.clientCode, row.numero, type);
    let matching = row.titleIds.map(id => byId.get(id)).filter(title => title
      && text(title.codigo_projeto) === row.codigoProjeto && text(title.codigo_tipo_documento) === type
      && text(title.codigo_cliente_fornecedor) === text(row.clientCode));
    if (!matching.length && row.os) {
      matching = (byOs.get(fiscalKey(row.codigoProjeto, row.clientCode, row.os, type)) ?? [])
        .filter(title => !title.numero_documento_fiscal || normalizeNumber(title.numero_documento_fiscal) === normalizeNumber(row.numero));
    }
    if (!matching.length && keyCounts.get(key) === 1) matching = byFiscal.get(key) ?? [];
    const { omieId, clientCode, os, titleIds, ...invoice } = row;
    const id = `${row.source}:${omieId}`;
    invoices.set(id, { id, ...invoice, receiptStatus: paymentStatus(matching, row.valor), installmentCount: matching.length, syncedAt });
  }
  return [...invoices.values()];
}

async function listAll(call, path, method, rowsKey, { nfse = false, ...params } = {}) {
  let pages = 1;
  const records = [];
  for (let page = 1; page <= pages; page += 1) {
    const response = await call(path, method, {
      ...params,
      ...(nfse ? { nPagina: page, nRegPorPagina: 100 } : { pagina: page, registros_por_pagina: 100 })
    });
    pages = Number(nfse ? response.nTotPaginas : response.total_de_paginas);
    const total = Number(nfse ? response.nTotRegistros : response.total_de_registros);
    if (!Number.isInteger(pages) || pages < 0 || !Array.isArray(response[rowsKey])) {
      throw new Error(`Resposta incompleta de ${method}; histórico anterior preservado.`);
    }
    records.push(...response[rowsKey]);
    if (page >= pages && (!Number.isInteger(total) || records.length !== total)) {
      throw new Error(`Paginação incompleta de ${method}; histórico anterior preservado.`);
    }
  }
  return records;
}

export async function syncOmieInvoices({ triggeredBy = 'SCRIPT', db = null, call = null } = {}) {
  db ??= (await import('../prisma.js')).default;
  call ??= (await import('./client.js')).omieCall;
  const run = await db.integrationSyncRun.create({ data: { integration: 'OMIE', scope: 'invoices', status: 'RUNNING', triggeredBy } });
  try {
    const nfse = await listAll(call, '/servicos/nfse/', 'ListarNFSEs', 'nfseEncontradas', { nfse: true });
    const nfe = await listAll(call, '/produtos/nfconsultar/', 'ListarNF', 'nfCadastro', { tpNF: '1', tpAmb: '1', cDetalhesPedido: 'S' });
    const receivables = await listAll(call, '/financas/contareceber/', 'ListarContasReceber', 'conta_receber_cadastro', { apenas_importado_api: 'N' });
    const finishedAt = new Date();
    const invoices = buildInvoiceSnapshot({ nfse, nfe, receivables, syncedAt: finishedAt });
    const summary = { nfseRead: nfse.length, nfeRead: nfe.length, receivablesRead: receivables.length };
    // Publica somente após obter TODAS as páginas; falhas preservam a versão anterior.
    // Substituição atômica também retira notas canceladas/remapeadas desde o último ciclo.
    await db.$transaction(async tx => {
      await tx.omieInvoice.deleteMany({});
      if (invoices.length) await tx.omieInvoice.createMany({ data: invoices });
      await tx.integrationSyncRun.update({ where: { id: run.id }, data: {
        status: 'SUCCESS', finishedAt, recordsRead: nfse.length + nfe.length + receivables.length,
        recordsWritten: invoices.length, summary
      } });
    });
    return { ...summary, invoices: invoices.length };
  } catch (error) {
    await db.integrationSyncRun.update({ where: { id: run.id }, data: { status: 'ERROR', finishedAt: new Date(), error: error.message } });
    throw error;
  }
}
