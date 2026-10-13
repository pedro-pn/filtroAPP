// Textos editoriais do Data Book: rascunhos automáticos a partir dos dados (o usuário edita na
// tela de revisão) e a revisão leve dos textos livres dos relatórios.

const HORA_NO_INICIO = /^\s*(\d{1,2})\s*[:hH]\s*(\d{2})\s*(?:h\b)?\s*[-–—:]?\s*(.*)$/;

function semAcento(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Revisão de texto livre (atividades, OBS): só forma — espaços repetidos, espaço antes de
 * pontuação e inicial maiúscula. Não troca palavras, para nunca alterar tags, horários,
 * números, medições ou nomes.
 */
export function revisarTextoLivre(texto) {
  let t = String(texto ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  t = t.replace(/ +([,.;:!?])(?=\s|$)/g, '$1');
  if (/^[a-zà-ú]/.test(t)) t = t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);
  return t;
}

/** dailyDescription do RDO → [{hora, texto}], uma linha por item; "08:30 – texto" vira hora. */
export function quebrarAtividades(descricao) {
  return String(descricao || '').split(/\n+/).map(linha => linha.replace(/^\s*[-•*●■]\s*/, '').trim()).filter(Boolean).map(linha => {
    const m = linha.match(HORA_NO_INICIO);
    if (m && Number(m[1]) < 24 && m[3]) {
      return { hora: `${m[1].padStart(2, '0')}:${m[2]}`, texto: revisarTextoLivre(m[3]) };
    }
    return { hora: null, texto: revisarTextoLivre(linha) };
  });
}

function lista(itens) {
  const xs = [...new Set(itens.filter(Boolean))];
  if (xs.length <= 1) return xs[0] || '';
  return `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}

function num(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

function ddmm(data) {
  return String(data || '').slice(0, 5);
}

const OCORRENCIAS = [
  [/vazament/, 'vazamento'],
  [/queda de energia|falta de energia/, 'queda de energia'],
  [/acidente|incidente/, 'acidente/incidente'],
  [/visita/, 'visita'],
  [/chuva|condic[oõ]es? clim/, 'condição climática']
];

function servicosDoPeriodo(dias) {
  return dias.flatMap(d => d.servicos.map(s => ({ ...s, data: d.data })));
}

/** Título do serviço para capa/cabeçalho, ex.: "Limpeza Química de APVs Verticais". */
export function tituloServico(dias) {
  const servs = servicosDoPeriodo(dias);
  const titulos = [...new Set(servs.map(s => s.titulo))];
  const equips = [...new Set(servs.map(s => s.equipamento).filter(Boolean))];
  const nome = titulos.length ? lista(titulos) : 'Serviços de campo';
  const capitalizado = nome.replace(/(^|\s)(\p{Ll})/gu, (_, sp, l) => sp + l.toLocaleUpperCase('pt-BR')).replace(/ E /g, ' e ');
  return equips.length === 1 ? `${capitalizado} de ${equips[0]}` : capitalizado;
}

/** Rascunhos de escopo, resumo executivo, destaques de SMS e considerações finais. */
export function rascunharTextos({ projeto, dias, escopoTotal, unidade, acumuladoInicial = 0 }) {
  const servs = servicosDoPeriodo(dias);
  const comRdo = dias.filter(d => d.rdo);
  const concluidoPeriodo = servs.reduce((soma, s) => soma + (Number(s.concluidas) || 0), 0);
  const concluido = acumuladoInicial + concluidoPeriodo;
  const total = escopoTotal || concluido || 1;
  const pct = Math.round(concluido / total * 100);
  const emitidos = servs.filter(s => s.relatorio);
  const aprovados = emitidos.filter(s => s.laudo === 'APROVADO');
  const reprovados = emitidos.filter(s => s.laudo === 'REPROVADO');
  const inicio = dias[0]?.data || '';
  const fim = dias[dias.length - 1]?.data || '';

  const titulos = [...new Set(servs.map(s => s.titulo.toLowerCase()))];
  const equips = [...new Set(servs.map(s => s.equipamento).filter(Boolean))];
  const materiais = [...new Set(servs.map(s => s.material).filter(Boolean))];
  const etapas = [...new Set(servs.flatMap(s => s.etapas || []))].map(e => e.toLowerCase());
  const escopo = titulos.length
    ? `Execução de ${lista(titulos)}${equips.length ? ` em <b>${lista(equips)}</b>` : ''}`
      + `${materiais.length ? ` (${lista(materiais).toLowerCase()})` : ''} da unidade <b>${projeto.name}</b>`
      + `${etapas.length ? `, compreendendo ${lista(etapas)}` : ''}.`
    : '';

  const porTipo = [];
  for (const [tipo, nome] of [['RLQ', 'RLQ'], ['RCPU', 'RCPU'], ['RTP', 'RTP'], ['RLM', 'RLM']]) {
    const xs = emitidos.filter(s => s.tipo === tipo);
    if (xs.length) porTipo.push(`${xs.length} ${nome} (${xs.filter(s => s.laudo === 'APROVADO').length} aprovado(s))`);
  }
  const standBys = comRdo.filter(d => d.stand_by?.tempo);
  let resumo = `Entre ${inicio} e ${fim} foram registrados ${comRdo.length} RDO(s)`
    + (porTipo.length ? ` e emitidos ${lista(porTipo)}` : '') + '. '
    + (unidade === '%'
      ? `O avanço físico ponderado passou de ${num(acumuladoInicial)}% para <b>${num(concluido)}%</b> do escopo.`
      : acumuladoInicial
      ? `No período foram concluídos <b>${num(concluidoPeriodo)} ${unidade}</b>, totalizando <b>${num(concluido)} de ${num(total)} ${unidade}</b> (${pct}% do escopo).`
      : `Foram concluídos <b>${num(concluido)} de ${num(total)} ${unidade}</b> (${pct}% do escopo).`);
  const isos = emitidos.filter(s => s.rcpu?.iso_final).map(s => s.rcpu.iso_final);
  if (isos.length) resumo += ` As contagens de partículas finais ficaram entre ISO ${lista([...new Set(isos)])}.`;
  if (reprovados.length) {
    resumo += ` Houve ${reprovados.length} laudo(s) reprovado(s): ${lista(reprovados.map(s => `${s.tipo} nº ${s.relatorio} (${ddmm(s.data)})`))}.`;
  }
  if (standBys.length) resumo += ` Registrado(s) stand-by em ${lista(standBys.map(d => ddmm(d.data)))}.`;

  const destaques = [];
  const comDds = comRdo.filter(d => d.dds);
  if (comRdo.length) destaques.push(`DDS realizados em ${comDds.length} de ${comRdo.length} dia(s) com RDO${comRdo.some(d => d.dds_noturno) ? ', incluindo o turno noturno' : ''}.`);
  let houveAcidente = false;
  for (const d of dias) {
    for (const a of d.atividades || []) {
      const t = semAcento(a.texto);
      const hit = OCORRENCIAS.find(([re]) => re.test(t));
      if (!hit) continue;
      if (hit[1] === 'acidente/incidente' && !/sem (registro de )?(acidente|incidente)/.test(t)) houveAcidente = true;
      destaques.push(`${ddmm(d.data)}: ${a.texto.replace(/\.$/, '')}.`);
    }
    if (d.stand_by?.tempo) destaques.push(`${ddmm(d.data)}: stand-by de ${d.stand_by.tempo}${d.stand_by.motivo ? ` – ${d.stand_by.motivo}` : ''}.`);
  }
  if (!houveAcidente) destaques.push('Sem registro de acidentes ou incidentes com pessoas no período.');

  const consideracoes = `Os serviços registrados entre ${inicio} e ${fim} foram executados conforme o escopo do Contrato/Proposta `
    + `${projeto.contractCode}, atingindo ${pct}% do escopo previsto`
    + (aprovados.length ? `, com ${aprovados.length} laudo(s) aprovado(s)` : '')
    + (reprovados.length ? ` e ${reprovados.length} reprovado(s), tratados conforme registrado no diário` : '') + '.';

  return {
    escopo,
    resumo_executivo: resumo,
    destaques_sms: destaques,
    consideracoes_finais: consideracoes,
    kpi_rotulo_concluidos: unidade === '%' ? 'Avanço físico (%)' : `${unidade} concluídos`,
    base_calculo: 'conforme quadro de progresso dos RDOs'
  };
}
