import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import { calcularAvanco } from '../src/lib/databook/progresso.js';
import { ligarRelatoriosTecnicos, montarDadosDatabook } from '../src/lib/databook/montar-dados.js';
import { aplicarEdicoes, validarIntervalo } from '../src/lib/databook/service.js';
import { quebrarAtividades, revisarTextoLivre } from '../src/lib/databook/textos.js';
import { buildRdoProgressRows } from '../src/lib/reports/rdo-progress-table.js';

const schema = JSON.parse(await readFile(new URL('../databook/databook/schema.json', import.meta.url), 'utf8'));
const validar = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const d = dia => new Date(`2026-10-${dia}T12:00:00.000Z`);
const tubo = metros => [{ d: '1', unit: 'pol', c: String(metros), lengthUnit: 'm' }];
const projeto = {
  id: 'p1', code: '9001', name: 'UNIDADE EXEMPLO', clientName: 'CLIENTE EXEMPLO S.A.', clientCnpj: '00000000000100',
  contractCode: '9999 REV 0', location: 'Macaé, RJ', operator: { name: 'Carlos Souza' },
  plannedServices: [{ serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: 300 }] }]
};
const colab = (id, name, role) => ({ collaboratorId: id, roleNameSnapshot: role, collaborator: { id, name, jobRole: { name: role } } });
const fotosRdo = nomes => ({ generalUploads: nomes.map(n => ({ url: `/relatorios/Missão 9001 - UNIDADE EXEMPLO/RDO/${n}`, label: 'Fotos de registro' })) });
const uploads = (label, nomes) => [{ label, files: nomes.map(n => ({ url: `/relatorios/Missão 9001 - UNIDADE EXEMPLO/SERV/${n}` })) }];

function rdo(id, seq, dia, services, extra = {}) {
  return {
    id, reportType: 'RDO', sequenceNumber: seq, reportDate: d(dia), createdAt: d(dia), status: 'APPROVED',
    arrivalTime: '07:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 4,
    daytimeOvertimeMinutes: 0, nighttimeOvertimeMinutes: 0, overtimeReason: null,
    dailyDescription: extra.descricao || '07:30 - início das atividades.\nOrganização da área (5S).',
    specialConditions: { dds: { diurno: { enabled: true, inicio: '07:00', termino: '07:15', temas: [{ id: 't', name: 'Uso de EPI' }] } },
      __leaderSnapshot: { name: 'Carlos Souza' }, ...extra.sc },
    services, measurementLinks: [],
    collaborators: [colab('c1', 'Carlos Souza', 'Encarregado'), colab('c2', 'Ana Lima', extra.funcaoAna || 'Assistente')]
  };
}

const rdos = [
  rdo('r1', 1, '01', [{ id: 's1', serviceType: 'limpeza', finalized: true, extraData: { tubes: tubo(50), drawingsTags: 'L-100' } }]),
  rdo('r2', 2, '02', [{ id: 's2', serviceType: 'limpeza', finalized: true, startTime: '07:30', endTime: '17:00',
    extraData: { tubes: tubo(48), drawingsTags: 'L-101', etapas: ['Fase ácida', 'Fase passivante'], aprovadoCliente: 'Sim',
      material: 'Aço carbono', metodos: ['Circulação pressurizada'], tipoInspecao: ['Visual'], __uploads__: uploads('Imagens — tubulação', ['rlq4.jpg']) } }],
  { sc: fotosRdo(['rdo2-a.jpg', 'rdo2-b.jpg']) }),
  rdo('r3', 3, '03', [{ id: 's3', serviceType: 'flushing', finalized: false, extraData: { tubes: tubo(90), drawingsTags: 'L-102', __ongoingKey: 'k-l102' } }],
    { sc: { noturno: true, noturnoDetails: { inicio: '18:00', termino: '06:00', colaboradores: ['c3', 'c4'] },
      dds: { diurno: { enabled: true, inicio: '07:00', termino: '07:15', temas: ['Riscos'] }, noturno: { enabled: true, inicio: '18:00', termino: '18:10', temas: ['Fadiga'] } } },
    descricao: 'Vazamento em flange durante o enchimento; reaperto realizado.' }),
  rdo('r4', 4, '04', [
    { id: 's4', serviceType: 'flushing', finalized: true, extraData: { tubes: tubo(90), drawingsTags: 'L-102', __ongoingKey: 'k-l102' } },
    { id: 's5', serviceType: 'pressao', finalized: true, extraData: { tubes: tubo(48), drawingsTags: 'L-101', __uploads__: uploads('Fotos do manômetro', ['man.jpg']) } }
  ], { funcaoAna: 'Técnica' }),
  rdo('r5', 5, '05', [{ id: 's6', serviceType: 'mecanica', finalized: true, extraData: { drawingsTags: 'TQ-01' } }], { funcaoAna: 'Técnica' }),
  rdo('r6', 6, '05', [], { descricao: 'Apoio à equipe de mecânica.', funcaoAna: 'Técnica' })
];
const derivado = (id, tipo, seq, dia, sc, services = []) => ({ id, reportType: tipo, sequenceNumber: seq, reportDate: d(dia), status: 'APPROVED', specialConditions: sc, services });
const derivados = [
  derivado('q4', 'RLQ', 4, '02', { parentRdoId: 'r2', serviceId: 's2', serviceData: { 'Desenhos / TAGs': 'L-101', 'Aprovado pelo cliente?': 'Sim',
    'Método de limpeza': ['Circulação pressurizada'], 'Tipo de inspeção': ['Visual'] } }),
  // só a chave de histórico (sem parentRdoId) liga o RCPU ao serviço finalizado em 04/10
  derivado('c3', 'RCPU', 3, '04', { serviceLinkKey: 'k-l102', resolvedUnits: ['UF 004'], totalMinutes: 1560,
    resolvedCounter: { code: 'CP-03', serialNumber: 'PC-1', certificate: { id: 'cert-cp' } },
    serviceData: { 'Desenhos / TAGs': 'L-102', 'Aprovado pelo cliente?': 'Sim', 'Houve contagem de partículas?': 'Sim',
      'Contagem inicial ISO': '19/17/14', 'Contagem final ISO': '15/13/10', 'Contagem inicial NAS': '10', 'Contagem final NAS': '6',
      'Houve análise de umidade?': 'Não', 'Tipo de óleo': 'ISO VG 46' } }),
  // vínculo inferido por data + tipo + tags
  derivado('t2', 'RTP', 2, '04', { resolvedUnits: ['UTH 003'], serviceData: { 'Desenhos / TAGs': 'L-101', 'Aprovado pelo cliente?': 'Sim',
    'Fluido de teste': 'agua', 'Pressão de trabalho': '210 bar', 'Pressão de teste': '315 bar' },
  resolvedManometers: [{ code: 'MAN-012', scale: '0 a 400 bar', certCode: 'CAL-1', calibratedAt: '2026-03-12', expiresAt: '2027-03-12', certificate: { id: 'cert-man' } }] }),
  derivado('m1', 'RLM', 1, '05', { parentRdoId: 'r5', serviceId: 's6', serviceData: { 'Aprovado pelo cliente?': 'Sim' } }),
  // relatório técnico em dia sem RDO
  derivado('c4', 'RCPU', 4, '06', { serviceData: { 'Desenhos / TAGs': 'TQ-01', 'Aprovado pelo cliente?': 'Não', 'Houve contagem de partículas?': 'Sim',
    'Contagem final ISO': '17/15/12' } }, [{ id: 'sv-c4', serviceType: 'filtragem', finalized: true, extraData: { drawingsTags: 'TQ-01',
    __uploads__: uploads('Foto do laudo', ['laudo.jpg']) } }])
];

function clienteFalso() {
  const entre = (r, where) => {
    const dt = r.reportDate.toISOString();
    return (!where.reportDate?.gte || dt >= where.reportDate.gte.toISOString()) && (!where.reportDate?.lte || dt <= where.reportDate.lte.toISOString());
  };
  return {
    project: { findUnique: async () => projeto },
    report: {
      findMany: async ({ where }) => {
        if (where.reportType === 'RDO') return rdos.filter(r => entre(r, where));
        return derivados.filter(r => where.reportType.in.includes(r.reportType) && entre(r, where));
      }
    },
    particleCounter: { findMany: async () => [{ code: 'CP-03', expiresAt: new Date('2027-01-20'), calibratedAt: new Date('2026-01-20'), calibrationCertificates: [{ id: 'cert-cp' }] }] },
    stockItem: { findMany: async () => [
      { id: 'i-acido', name: 'Ácido Cítrico Fino Granulado', fdsSynonyms: ['Ácido cítrico'], fdsCode: 'DT-LAB-100', fdsRevision: '05',
        fdsDate: new Date('2025-05-05'), manufacturer: 'BSC Química Ltda.', documents: [{ id: 'doc-acido' }] },
      { id: 'i-nitrito', name: 'Nitrito de Sódio', fdsSynonyms: [], manufacturer: 'BSC Química Ltda.', documents: [{ id: 'doc-nitrito' }] }
    ] },
    stockMovement: { findMany: async () => [{ itemId: 'i-acido' }] },
    romaneioItem: { findMany: async () => [] },
    calibrationCertificate: { findMany: async ({ where }) => where.id.in.map(id => ({ id, particleCounter: id === 'cert-cp'
      ? { calibratedAt: new Date('2026-01-20'), expiresAt: new Date('2027-01-20'), calibrationCertificates: [{ id: 'cert-cp' }] } : null })) }
  };
}

const montado = await montarDadosDatabook('p1', '2026-10-02', '2026-10-06', { client: clienteFalso(), documento: { doc: 'DB-9001-01', rev: 0 } });
const { dados } = montado;

test('o dict montado valida contra schema.json do gerador', () => {
  assert.equal(validar(dados), true, JSON.stringify(validar.errors, null, 1));
});

test('acumulado_inicial + soma das concluídas = acumulado do último RDO do intervalo (quadro de progresso)', () => {
  assert.equal(dados.unidade_escopo, 'm');
  assert.equal(dados.escopo_total, 300);
  assert.equal(dados.acumulado_inicial, 50);
  const soma = dados.dias.flatMap(x => x.servicos).reduce((s, x) => s + x.concluidas, 0);
  const ultimo = rdos.filter(r => r.reportDate <= d('06')).at(-1);
  const linha = buildRdoProgressRows(ultimo, projeto.plannedServices, rdos)[0];
  const acumuladoRdo = Number(linha.totalprogress.split(' ')[0].replace('.', '').replace(',', '.'));
  assert.equal(dados.acumulado_inicial + soma, acumuladoRdo);
});

test('um item por data com relatório, em ordem, incluindo dia só com relatório técnico', () => {
  assert.deepEqual(dados.dias.map(x => x.data), ['02/10/2026', '03/10/2026', '04/10/2026', '05/10/2026', '06/10/2026']);
  const semRdo = dados.dias.at(-1);
  assert.equal(semRdo.rdo, null);
  assert.equal(semRdo.servicos[0].tipo, 'RCPU');
  assert.equal(semRdo.servicos[0].relatorio, 4);
  assert.equal(semRdo.servicos[0].concluidas, 0);
});

test('serviço em andamento que continua no dia seguinte aparece nos dois dias sem duplicar o avanço', () => {
  const [d03, d04] = [dados.dias[1], dados.dias[2]];
  assert.equal(d03.servicos[0].status, 'Em andamento');
  assert.equal(d03.servicos[0].concluidas, 0);
  assert.equal(d03.servicos[0].relatorio, null);
  assert.equal(d04.servicos[0].status, 'Finalizado');
  assert.equal(d04.servicos[0].tags, 'L-102');
  assert.equal(d04.servicos[0].concluidas, 90);
});

test('vínculos: explícito (RLQ), por chave de histórico (RCPU) e por data + tags (RTP)', () => {
  const { porServico, semRdo } = ligarRelatoriosTecnicos(rdos.filter(r => r.reportDate >= d('02')), derivados);
  assert.equal(porServico.get('s2').id, 'q4');
  assert.equal(porServico.get('s4').id, 'c3');
  assert.equal(porServico.get('s5').id, 't2');
  assert.equal(porServico.get('s6').id, 'm1');
  assert.deepEqual(semRdo.map(r => r.id), ['c4']);
  const rcpu = dados.dias[2].servicos[0].rcpu;
  assert.equal(rcpu.iso_final, '15/13/10');
  assert.equal(rcpu.contador, 'CP-03 – série PC-1');
  assert.equal(rcpu.contador_validade, '20/01/2027');
  assert.equal(rcpu.tempo_total, '26:00:00');
  const rtp = dados.dias[2].servicos[1].rtp;
  assert.equal(rtp.pressao_teste, '315 bar');
  assert.equal(rtp.manometros[0].validade, '12/03/2027');
});

test('dia com dois RDOs, turno noturno e DDS', () => {
  assert.deepEqual(dados.dias[3].rdos_extras, [6]);
  assert.equal(dados.dias[1].jornada_noturna, '18:00 – 06:00');
  assert.equal(dados.dias[1].efetivo_noturno, 2);
  assert.deepEqual(dados.dias[1].dds_noturno, { inicio: '18:00', fim: '18:10', tema: 'Fadiga' });
  assert.deepEqual(dados.dias[0].dds, { inicio: '07:00', fim: '07:15', tema: 'Uso de EPI' });
});

test('fotos do dia: primeiro as do RDO, depois as dos relatórios técnicos', () => {
  assert.deepEqual(dados.dias[0].fotos.map(f => [f.origem, f.numero, f.arquivo.split('/').pop()]),
    [['RDO', 2, 'rdo2-a.jpg'], ['RDO', 2, 'rdo2-b.jpg'], ['RLQ', 4, 'rlq4.jpg']]);
  assert.equal(dados.dias[2].fotos.find(f => f.origem === 'RTP').legenda, 'Manômetro');
});

test('FDS: só os produtos citados nos RLQs, por sinônimo, com confirmação pelo romaneio', () => {
  assert.deepEqual(dados.etapas_produto, [{ etapa: 'Fase ácida', produto: 'Ácido cítrico' }, { etapa: 'Fase passivante', produto: 'Nitrito de sódio' }]);
  assert.deepEqual(dados.fds.map(f => [f.produto, f.nome_comercial, f.arquivo]),
    [['Ácido cítrico', 'Ácido Cítrico Fino Granulado', 'stockdoc:doc-acido'], ['Nitrito de sódio', 'Nitrito de Sódio', 'stockdoc:doc-nitrito']]);
  assert.equal(dados.fds[0].codigo, 'DT-LAB-100');
  assert.ok(montado.avisos.some(a => a.includes('Nitrito de sódio') && a.includes('romaneios')));
  assert.equal(montado.sugestoes.fds.find(c => c.produto === 'Ácido cítrico').confirmadoRomaneio, true);
});

test('certificados usados no intervalo viram candidatos ao Anexo C', () => {
  assert.deepEqual(dados.certificados.map(c => [c.equipamento, c.codigo, c.aplicacao, c.arquivo]),
    [['Contador de partículas', 'CP-03', 'RCPU', 'cert:cert-cp'], ['Manômetro', 'MAN-012', 'RTP', 'cert:cert-man']]);
});

test('equipe com líder e mudança de função', () => {
  assert.deepEqual(dados.equipe[0], { nome: 'Carlos Souza', funcao: 'Encarregado', observacao: 'Líder' });
  assert.deepEqual(dados.equipe[1], { nome: 'Ana Lima', funcao: 'Assistente / Técnica', observacao: 'Técnica a partir de 04/10' });
});

test('textos: rascunho cita reprovação e ocorrências; atividades com horário', () => {
  assert.match(dados.textos.resumo_executivo, /RCPU nº 4 \(06\/10\)/);
  assert.ok(dados.textos.destaques_sms.some(t => t.startsWith('03/10: Vazamento em flange')));
  assert.deepEqual(dados.dias[0].atividades[0], { hora: '07:30', texto: 'Início das atividades.' });
  assert.equal(dados.projeto.periodo, '02/10/2026 a 06/10/2026');
  assert.equal(dados.projeto.missao, 'Missão 9001 – UNIDADE EXEMPLO');
});

test('revisão de texto nunca troca palavras: só espaços, pontuação e inicial', () => {
  assert.equal(revisarTextoLivre('  troca  da tag 12-YD-0642 , pressão 315 bar  '), 'Troca da tag 12-YD-0642, pressão 315 bar');
  assert.deepEqual(quebrarAtividades('10h00 – teste\n- item sem hora'), [{ hora: '10:00', texto: 'Teste' }, { hora: null, texto: 'Item sem hora' }]);
});

test('intervalo: padrão é 1º e último RDO; datas inválidas são bloqueadas', () => {
  const padrao = { inicio: '2026-10-01', fim: '2026-10-05' };
  assert.deepEqual(validarIntervalo({ inicio: '2026-10-02', fim: '2026-10-03' }, padrao), { inicio: '2026-10-02', fim: '2026-10-03' });
  assert.throws(() => validarIntervalo({ inicio: '2026-10-04', fim: '2026-10-02' }, padrao), /anterior ou igual/);
  assert.throws(() => validarIntervalo({ inicio: '2026-09-30', fim: '2026-10-02' }, padrao), /entre o primeiro e o último RDO/);
  assert.throws(() => validarIntervalo({ inicio: '2026-10-02', fim: '' }, padrao), /Informe as datas/);
  assert.throws(() => validarIntervalo({ inicio: '2026-10-02', fim: '2026-10-03' }, null), /não tem RDO aprovado/);
});

test('intervalo parcial: só os dias escolhidos e acumulado correto', async () => {
  const parcial = await montarDadosDatabook('p1', '2026-10-04', '2026-10-04', { client: clienteFalso() });
  assert.deepEqual(parcial.dados.dias.map(x => x.data), ['04/10/2026']);
  assert.equal(parcial.dados.acumulado_inicial, 50 + 48);
  assert.equal(validar(parcial.dados), true);
});

test('edições da revisão: textos, limites, seleção de anexos e responsáveis', () => {
  const editado = aplicarEdicoes(dados, {
    servico: 'Limpeza e Flushing', textos: { escopo: ' escopo  editado ', destaques_sms: ['um', ''] },
    limites_rcpu: { iso: '16/14/11', nas: '7' }, fds: ['stockdoc:doc-acido'], certificados: [],
    aprovacoes: { elaborado: { userId: 'u1' }, aprovado: { nome: 'Fiscal do cliente', cargo: 'Fiscal' } }
  }, [{ id: 'u1', nome: 'Paula Costa', cargo: 'Coordenadora' }]);
  assert.equal(editado.projeto.servico, 'Limpeza e Flushing');
  assert.equal(editado.textos.escopo, 'Escopo editado');
  assert.deepEqual(editado.textos.destaques_sms, ['Um']);
  assert.deepEqual(editado.limites_rcpu, { iso: '16/14/11', nas: 7 });
  assert.equal(editado.fds.length, 1);
  assert.equal(editado.certificados.length, 0);
  assert.equal(editado.aprovacoes.elaborado.nome, 'Paula Costa');
  assert.equal(editado.aprovacoes.aprovado.cargo, 'Fiscal');
  assert.equal(validar(editado), true);
  assert.throws(() => aplicarEdicoes(dados, { limites_rcpu: { iso: 'abc' } }), /ISO 4406 inválido/);
  // dados dos relatórios não mudam
  assert.deepEqual(editado.dias, dados.dias);
});

test('avanço com métricas mistas segue o % ponderado do Acompanhamento', () => {
  const planned = [
    { serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: 100 }] },
    { serviceType: 'FLUSHING', weight: 1, systems: [{ systemType: 'OLEO', quantity: 1000 }] }
  ];
  const r = [rdo('x1', 1, '01', [{ id: 'a', serviceType: 'limpeza', finalized: true, extraData: { tubes: tubo(50) } }])];
  const avanco = calcularAvanco(r, planned, { dataInicio: '2026-10-01', dataFim: '2026-10-01' });
  assert.equal(avanco.escopo.unidade, '%');
  assert.equal(avanco.porServico.get('a'), 25);
  assert.deepEqual(avanco.escopos, [
    { escopo: 'Limpeza química (tubulação)', unidade: 'm', previsto: 100, realizado: 50, percentual: 50 },
    { escopo: 'Flushing (óleo)', unidade: 'L', previsto: 1000, realizado: 0, percentual: 0 }
  ]);
  const comEscopo = { ...dados, escopo_total: 100, unidade_escopo: '%', avanco_escopos: avanco.escopos };
  assert.equal(validar(comEscopo), true, JSON.stringify(validar.errors));
});
