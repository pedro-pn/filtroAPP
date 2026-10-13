import prisma from '../prisma.js';
import { formatCnpj } from '../cnpj.js';
import { currentCalibrationCertificateInclude } from '../calibration-certificates.js';
import { extractReportUploadAttachments } from '../report-upload-attachments.js';
import { calcularAvanco } from './progresso.js';
import { dataPt, montarServico, tipoDataBook } from './servicos.js';
import { quebrarAtividades, rascunharTextos, revisarTextoLivre, tituloServico } from './textos.js';
import { sugerirCertificados, sugerirFds, etapasProdutoDosRlqs } from './anexos.js';

export const EMPRESA = 'Filtrovali Serviços de Filtragem de Óleos Industriais e Limpeza de Tubulações Ltda';
export const TIPOS_TECNICOS = ['RLQ', 'RCPU', 'RTP', 'RLM'];
const STATUS_INCLUIDOS = ['APPROVED', 'SIGNED'];
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// Textos fixos dos modelos DOCX de RLQ e RTP (Modelos/definitivos).
export const CRITERIOS_RLQ = [
  'A inspeção visual final, com lanterna e/ou vídeo boroscópio quando necessário, comprovar a eficiência da limpeza;',
  'Não houver oleosidade, graxas, óxidos, carepas, borras de solda ou material livre no interior;',
  'O spool apresentar aspecto interno em tom cinza claro/escuro, conforme a metalurgia;',
  'As etapas de desengraxe, fase ácida, neutralização e passivação tiverem sido executadas (conforme a necessidade avaliada);',
  'As extremidades forem seladas após a inspeção final para evitar recontaminação.'
];
export const CRITERIOS_RTP = [
  'Não apresentar vazamentos durante o teste;',
  'A pressão de teste for aplicada conforme critério de projeto ou, na ausência de definição específica, até 1,2 ou 1,5 vezes a PMTA ou pressão designada;',
  'A pressão for mantida pelo tempo exigido — mínimo de 1 hora para inspeção, salvo especificação diferente, e de 30 a 60 minutos após estabilização quando aplicável;',
  'Não houver queda de pressão indicativa de vazamento;',
  'As soldas e áreas adjacentes forem inspecionadas visualmente;',
  'Os manômetros estiverem calibrados e posicionados conforme procedimento.'
];

export function dayKey(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export function hojePt(now = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
}

function minutosHHMM(min) {
  const total = Number(min) || 0;
  if (total <= 0) return '';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function temas(bloco) {
  return (Array.isArray(bloco?.temas) ? bloco.temas : [])
    .map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean).join('; ');
}

function textoChave(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9a-z]/gi, '').toUpperCase();
}

// ------------------------------------------------------------------ vínculo serviço ↔ relatório técnico
function chavesDoServico(service) {
  const d = service.extraData || {};
  return [service.id, d.__ongoingKey, d.__serviceLinkKey, d.__sourceServiceId, d.serviceId].map(v => String(v || '').trim()).filter(Boolean);
}

function chavesDoDerivado(report) {
  const sc = report.specialConditions || {};
  const sd = sc.serviceData || {};
  return [sc.serviceLinkKey, sc.serviceId, sd.__ongoingKey, sd.__serviceLinkKey, sd.__sourceServiceId, sd.serviceId]
    .map(v => String(v || '').trim()).filter(Boolean);
}

function tagsDoDerivado(report) {
  const sd = report.specialConditions?.serviceData || {};
  return textoChave(sd['Desenhos / TAGs'] ?? sd.drawingsTags ?? '');
}

/**
 * Liga cada serviço do RDO ao relatório técnico correspondente: vínculo explícito
 * (parentRdoId + serviceId), depois chaves de histórico na mesma data, depois data + tipo + tags
 * e, em último caso, data + tipo quando só houver um candidato.
 */
export function ligarRelatoriosTecnicos(rdos, derivados) {
  const livres = new Set(derivados.map(r => r.id));
  const porServico = new Map();
  const mesmoDia = (r, rdo) => dayKey(r.reportDate) === dayKey(rdo.reportDate);
  // Os dois primeiros critérios são vínculos registrados; os dois últimos são inferências e só
  // valem quando apontam um único relatório.
  const criterios = [
    { unico: false, casa: (r, rdo, s) => r.specialConditions?.parentRdoId === rdo.id && r.specialConditions?.serviceId === s.id },
    { unico: false, casa: (r, rdo, s) => mesmoDia(r, rdo) && chavesDoDerivado(r).some(k => chavesDoServico(s).includes(k)) },
    { unico: true, casa: (r, rdo, s) => {
      const tags = textoChave(s.extraData?.drawingsTags ?? s.extraData?.['Desenhos / TAGs']);
      return Boolean(tags) && mesmoDia(r, rdo) && tagsDoDerivado(r) === tags;
    } },
    { unico: true, casa: (r, rdo) => mesmoDia(r, rdo) }
  ];
  for (const { unico, casa } of criterios) {
    for (const rdo of rdos) {
      for (const service of rdo.services || []) {
        const tipo = tipoDataBook(service.serviceType);
        if (!tipo || service.finalized !== true || porServico.has(service.id)) continue;
        const candidatos = derivados.filter(r => livres.has(r.id) && r.reportType === tipo && casa(r, rdo, service));
        if (!candidatos.length || (unico && candidatos.length > 1)) continue;
        porServico.set(service.id, candidatos[0]);
        livres.delete(candidatos[0].id);
      }
    }
  }
  return { porServico, semRdo: derivados.filter(r => livres.has(r.id)) };
}

// ------------------------------------------------------------------ fotos
function legendaDoGrupo(label) {
  const t = String(label || '').replace(/^(imagens|fotos?)\s*(—|-|–|do|da|dos|das)?\s*(do|da|dos|das)?\s*/i, '').trim();
  return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : '';
}

function fotosDoRelatorio(report, { origem, numero, comLegenda, apenasServicos = false }) {
  const anexos = extractReportUploadAttachments(report)
    .filter(a => !a.mimeType || a.mimeType.startsWith('image/'))
    .filter(a => !apenasServicos || a.reportServiceId);
  return anexos.map(a => ({
    arquivo: `upload:${a.storagePath}`,
    origem,
    ...(numero != null ? { numero } : {}),
    ...(comLegenda && a.reportServiceId && legendaDoGrupo(a.label) ? { legenda: legendaDoGrupo(a.label) } : {})
  }));
}

// ------------------------------------------------------------------ equipe e dados técnicos
function montarEquipe(rdosDoIntervalo, lider) {
  const pessoas = new Map();
  for (const rdo of rdosDoIntervalo) {
    for (const rc of rdo.collaborators || []) {
      const nome = rc.collaborator?.name;
      if (!nome) continue;
      const funcao = rc.roleNameSnapshot || rc.collaborator?.jobRole?.name || '';
      const p = pessoas.get(rc.collaboratorId) || { nome, funcoes: [] };
      if (funcao && p.funcoes[p.funcoes.length - 1]?.funcao !== funcao) p.funcoes.push({ funcao, desde: dataPt(rdo.reportDate) });
      pessoas.set(rc.collaboratorId, p);
    }
  }
  const equipe = [...pessoas.values()].map(p => {
    const obs = [];
    if (lider && p.nome === lider) obs.push('Líder');
    if (p.funcoes.length > 1) obs.push(`${p.funcoes[p.funcoes.length - 1].funcao} a partir de ${p.funcoes[p.funcoes.length - 1].desde.slice(0, 5)}`);
    return { nome: p.nome, funcao: [...new Set(p.funcoes.map(f => f.funcao))].join(' / '), observacao: obs.join('; ') };
  });
  return equipe.sort((a, b) => (b.observacao.startsWith('Líder') ? 1 : 0) - (a.observacao.startsWith('Líder') ? 1 : 0));
}

function maisFrequente(valores) {
  const contagem = new Map();
  for (const v of valores.filter(Boolean)) contagem.set(v, (contagem.get(v) || 0) + 1);
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function montarDadosTecnicos(dias, derivados) {
  const servs = dias.flatMap(d => d.servicos);
  const distintos = campo => [...new Set(servs.map(s => s[campo]).filter(Boolean))].join(', ');
  const unidades = [...new Set(derivados.flatMap(r => r.specialConditions?.resolvedUnits || []))].join(' · ');
  const contadores = [...new Set(servs.map(s => s.rcpu?.contador?.split(' – ')[0]).filter(Boolean))].join(', ');
  const efetivos = dias.map(d => d.efetivo).filter(n => n > 0);
  const efetivo = efetivos.length
    ? (Math.min(...efetivos) === Math.max(...efetivos) ? `${efetivos[0]} colaboradores` : `${Math.min(...efetivos)} a ${Math.max(...efetivos)} colaboradores`)
    : '';
  const jornada = maisFrequente(dias.map(d => d.jornada));
  return [
    ['Equipamento', distintos('equipamento')], ['Sistema', distintos('sistema')], ['Material', distintos('material')],
    ['Método de limpeza', distintos('metodo')], ['Tipo de inspeção', distintos('inspecao')],
    ['Unidades', unidades], ['Contador de partículas', contadores],
    ['Jornada', jornada ? `Turno diurno ${jornada}` : ''], ['Efetivo', efetivo]
  ].filter(([, v]) => v);
}

// ------------------------------------------------------------------ dias
function montarDia(data, rdosDoDia, servicosDoDia, fotos) {
  const [principal, ...extras] = rdosDoDia;
  const dia = { data: dataPt(data), dia_semana: DIAS_SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()], rdo: principal?.sequenceNumber ?? null };
  if (extras.length) dia.rdos_extras = extras.map(r => r.sequenceNumber).filter(Number.isInteger);
  if (principal) {
    const sc = principal.specialConditions || {};
    const recusada = sc.overtimeAccepted === false;
    dia.jornada = [principal.arrivalTime, principal.departureTime].filter(Boolean).join(' – ');
    dia.efetivo = principal.daytimeCount || (principal.collaborators || []).length || 0;
    const he = recusada ? '' : minutosHHMM(principal.daytimeOvertimeMinutes);
    if (he) dia.horas_extras = he;
    if (!recusada && principal.overtimeReason) dia.comentario = revisarTextoLivre(principal.overtimeReason);
    if (sc.standbyDetails?.total) dia.stand_by = { tempo: sc.standbyDetails.total, motivo: revisarTextoLivre(sc.standbyDetails.motivo || '') };
    const dds = sc.dds || {};
    if (dds.diurno?.enabled) dia.dds = { inicio: dds.diurno.inicio || '', fim: dds.diurno.termino || '', tema: temas(dds.diurno) };
    if (sc.noturno) {
      const n = sc.noturnoDetails || {};
      const jn = [n.inicio, n.termino].filter(Boolean).join(' – ');
      if (jn) dia.jornada_noturna = jn;
      if ((n.colaboradores || []).length) dia.efetivo_noturno = n.colaboradores.length;
      const hen = recusada ? '' : minutosHHMM(principal.nighttimeOvertimeMinutes);
      if (hen) dia.horas_extras_noturno = hen;
      if (dds.noturno?.enabled) dia.dds_noturno = { inicio: dds.noturno.inicio || '', fim: dds.noturno.termino || '', tema: temas(dds.noturno) };
    }
  }
  dia.atividades = rdosDoDia.flatMap(r => quebrarAtividades(r.dailyDescription));
  dia.servicos = servicosDoDia;
  const tags = [...new Set(servicosDoDia.map(s => s.tags).filter(Boolean))];
  const titulos = [...new Set(servicosDoDia.map(s => s.titulo))];
  dia.resumo = titulos.length
    ? `${titulos.join(', ')}${tags.length ? ` – ${tags.join(', ')}` : ''}`.slice(0, 120)
    : (dia.atividades[0]?.texto || '').split(/(?<=\.)\s/)[0].slice(0, 120);
  dia.fotos = fotos;
  return dia;
}

// ------------------------------------------------------------------ carga do banco
async function carregar(client, projetoId, inicio, fim) {
  const ate = new Date(`${fim}T23:59:59.999Z`);
  const desde = new Date(`${inicio}T00:00:00.000Z`);
  const [projeto, rdosAvanco, rdos, derivados] = await Promise.all([
    client.project.findUnique({
      where: { id: projetoId },
      include: {
        operator: { select: { name: true } },
        plannedServices: { orderBy: [{ order: 'asc' }], include: { systems: { orderBy: [{ order: 'asc' }], include: { projectSystem: true } } } }
      }
    }),
    client.report.findMany({
      where: { projectId: projetoId, reportType: 'RDO', deletedAt: null, status: { in: STATUS_INCLUIDOS }, reportDate: { lte: ate } },
      select: { id: true, reportType: true, sequenceNumber: true, reportDate: true, createdAt: true, services: true, measurementLinks: true }
    }),
    client.report.findMany({
      where: { projectId: projetoId, reportType: 'RDO', deletedAt: null, status: { in: STATUS_INCLUIDOS }, reportDate: { gte: desde, lte: ate } },
      orderBy: [{ reportDate: 'asc' }, { sequenceNumber: 'asc' }, { createdAt: 'asc' }],
      include: {
        services: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        collaborators: { include: { collaborator: { select: { id: true, name: true, jobRole: { select: { name: true } } } } } }
      }
    }),
    client.report.findMany({
      where: { projectId: projetoId, reportType: { in: TIPOS_TECNICOS }, deletedAt: null, status: { in: STATUS_INCLUIDOS }, reportDate: { gte: desde, lte: ate } },
      orderBy: [{ reportDate: 'asc' }, { reportType: 'asc' }, { sequenceNumber: 'asc' }],
      include: { services: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
    })
  ]);
  const codigos = [...new Set(derivados.map(r => r.specialConditions?.resolvedCounter?.code).filter(Boolean))];
  const contadores = codigos.length
    ? await client.particleCounter.findMany({ where: { code: { in: codigos } }, include: currentCalibrationCertificateInclude })
    : [];
  return {
    projeto, rdosAvanco, rdos, derivados,
    contadores: new Map(contadores.map(c => [c.code, {
      expiresAt: c.expiresAt, calibratedAt: c.calibratedAt, certificateId: c.calibrationCertificates?.[0]?.id || null
    }]))
  };
}

/** Datas padrão do diálogo: primeiro e último RDO aprovado do projeto. */
export async function intervaloPadrao(projetoId, client = prisma) {
  const where = { projectId: projetoId, reportType: 'RDO', deletedAt: null, status: { in: STATUS_INCLUIDOS } };
  const [primeiro, ultimo] = await Promise.all([
    client.report.findFirst({ where, orderBy: [{ reportDate: 'asc' }], select: { reportDate: true } }),
    client.report.findFirst({ where, orderBy: [{ reportDate: 'desc' }], select: { reportDate: true } })
  ]);
  return primeiro ? { inicio: dayKey(primeiro.reportDate), fim: dayKey(ultimo.reportDate) } : null;
}

/**
 * Monta a entrada do gerador (schema.json) para o projeto no intervalo [inicio, fim] (YYYY-MM-DD).
 * Arquivos ficam como referências do app ("upload:", "stockdoc:", "cert:"), resolvidas por
 * anexos.js#materializar antes de chamar o Python.
 */
export async function montarDadosDatabook(projetoId, inicio, fim, { client = prisma, documento = {}, agora = new Date() } = {}) {
  const { projeto, rdosAvanco, rdos, derivados, contadores } = await carregar(client, projetoId, inicio, fim);
  if (!projeto) throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  const avisos = [];
  const avanco = calcularAvanco(rdosAvanco, projeto.plannedServices, { dataInicio: inicio, dataFim: fim });
  const { porServico, semRdo } = ligarRelatoriosTecnicos(rdos, derivados);

  const datas = [...new Set([...rdos, ...derivados].map(r => dayKey(r.reportDate)))].sort();
  const dias = datas.map(data => {
    const rdosDoDia = rdos.filter(r => dayKey(r.reportDate) === data);
    const servicos = [];
    const fotos = [];
    for (const rdo of rdosDoDia) {
      fotos.push(...fotosDoRelatorio({ ...rdo, services: [] }, { origem: 'RDO', numero: rdo.sequenceNumber }));
    }
    for (const rdo of rdosDoDia) {
      for (const service of rdo.services || []) {
        if (!tipoDataBook(service.serviceType)) continue;
        const derivado = porServico.get(service.id) || null;
        const item = montarServico({ service, derivado, concluidas: avanco.porServico.get(service.id) || 0, contadores });
        servicos.push(item);
        const origem = item.relatorio ? item.tipo : 'RDO';
        fotos.push(...fotosDoRelatorio({ ...rdo, specialConditions: {}, services: [service] },
          { origem, numero: item.relatorio ?? rdo.sequenceNumber, comLegenda: origem !== 'RDO' && origem !== 'RLQ', apenasServicos: true }));
      }
    }
    for (const derivado of semRdo.filter(r => dayKey(r.reportDate) === data)) {
      const service = derivado.services?.[0];
      if (!service) {
        avisos.push(`${dataPt(data)}: ${derivado.reportType} nº ${derivado.sequenceNumber} sem dados de serviço; não incluído.`);
        continue;
      }
      // Relatório técnico sem RDO correspondente: entra com os dados do próprio relatório; não soma no avanço.
      const item = montarServico({ service: { ...service, finalized: true }, derivado, concluidas: 0, contadores });
      if (!item) continue;
      servicos.push(item);
      fotos.push(...fotosDoRelatorio(derivado, { origem: item.tipo, numero: item.relatorio, comLegenda: item.tipo !== 'RLQ' }));
    }
    return montarDia(data, rdosDoDia, servicos, fotos);
  });

  const lider = rdos.map(r => r.specialConditions?.__leaderSnapshot?.name).find(Boolean) || projeto.operator?.name || '';
  const temTipo = tipo => dias.some(d => d.servicos.some(s => s.tipo === tipo));
  const etapasProduto = etapasProdutoDosRlqs(dias);
  const [fds, certificados] = await Promise.all([
    sugerirFds(client, projeto, etapasProduto),
    sugerirCertificados(client, derivados)
  ]);
  avisos.push(...fds.avisos, ...certificados.avisos);

  const unidade = avanco.escopo.unidade;
  const dados = {
    projeto: {
      missao: `Missão ${projeto.code} – ${projeto.name}`,
      cliente: projeto.clientName,
      cnpj: formatCnpj(projeto.clientCnpj) || '',
      contrato: projeto.contractCode,
      local: projeto.location,
      servico: tituloServico(dias),
      doc: documento.doc || `DB-${projeto.code}-01`,
      rev: String(documento.rev ?? 0),
      emissao: hojePt(agora),
      empresa: EMPRESA,
      periodo: `${dataPt(inicio)} a ${dataPt(fim)}`
    },
    ...(avanco.escopo.total ? { escopo_total: avanco.escopo.total } : {}),
    unidade_escopo: unidade,
    acumulado_inicial: avanco.acumuladoInicial,
    ...(avanco.escopos.length ? { avanco_escopos: avanco.escopos } : {}),
    ocorrencias_sms: 0,
    dados_tecnicos: montarDadosTecnicos(dias, derivados),
    equipe: montarEquipe(rdos, lider),
    etapas_produto: etapasProduto,
    criterios_aceitacao: temTipo('RLQ') ? CRITERIOS_RLQ : [],
    criterios_rtp: temTipo('RTP') ? CRITERIOS_RTP : [],
    textos: rascunharTextos({ projeto, dias, escopoTotal: avanco.escopo.total, unidade, acumuladoInicial: avanco.acumuladoInicial }),
    dias,
    fds: fds.selecionadas,
    certificados: certificados.itens,
    aprovacoes: {}
  };

  const contar = tipo => dias.reduce((n, d) => n + d.servicos.filter(s => s.tipo === tipo && s.relatorio).length, 0);
  const resumo = {
    inicio, fim,
    dias: dias.length,
    rdos: rdos.length,
    ...Object.fromEntries(TIPOS_TECNICOS.map(t => [t.toLowerCase(), contar(t)])),
    fds: dados.fds.length,
    certificados: dados.certificados.length
  };
  return { dados, avisos, resumo, sugestoes: { fds: fds.candidatas, certificados: certificados.itens } };
}
