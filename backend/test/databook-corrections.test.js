import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import env from '../src/config/env.js';
import { contributionServiceKey } from '../src/lib/acompanhamento/proposal-scopes.js';
import { montarDadosDatabook } from '../src/lib/databook/montar-dados.js';
import { gerarPdf } from '../src/lib/databook/python.js';
import { solicitarGeracao } from '../src/lib/databook/service.js';

const date = day => new Date(`2026-10-${day}T12:00:00Z`);
const tubes = length => [{ d: '2', unit: 'pol', c: String(length), lengthUnit: 'm' }];
const editKey = '__manualDerivedServiceReportEdit';

function fixture() {
  const project = { id: 'p1', code: '9001', name: 'Projeto', clientName: 'Cliente', contractCode: '9001 REV 0', location: 'Macaé, RJ',
    plannedServices: [{ serviceType: 'LIMPEZA_QUIMICA', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: 100 }] }] };
  const rdos = ['01', '02'].map((day, index) => ({
    id: `rdo-${day}`, projectId: project.id, reportType: 'RDO', status: 'SIGNED', sequenceNumber: index + 1,
    reportDate: date(day), createdAt: date(day), specialConditions: {}, measurementLinks: [], collaborators: [],
    services: [{ id: `s-${day}`, serviceType: 'limpeza', finalized: true, startTime: '07:00', endTime: '17:00',
      material: 'Aço carbono', system: 'Tubulação', extraData: { tubes: tubes((index + 1) * 10), drawingsTags: `TAG-${day}`, __serviceLinkKey: `link-${day}` } }]
  }));
  const correction = (day, quantity, editedDay, overrides = {}) => {
    const source = rdos.find(report => report.id === `rdo-${day}`).services[0];
    const extraData = { tubes: tubes(quantity), drawingsTags: `TAG-${day}-CORRIGIDA`, observacoes: 'Observação corrigida' };
    return {
      id: `rlq-${day}`, projectId: project.id, reportType: 'RLQ', status: 'APPROVED', sequenceNumber: Number(day),
      reportDate: date(day), specialConditions: { parentRdoId: `rdo-${day}`, serviceId: source.id,
        serviceLinkKey: `link-${day}`, serviceData: extraData, [editKey]: { editedAt: date(editedDay).toISOString() } },
      services: [{ ...source, id: `technical-${day}`, material: 'Inox', extraData }], ...overrides
    };
  };
  const reports = [correction('01', 25, '04', { reportDate: date('04') }), correction('02', 40, '05', { status: 'SIGNED' })];
  const revisions = [];
  let databook;
  const queries = [];
  const client = {
    project: { findUnique: async () => project, findFirst: async () => project },
    report: {
      findFirst: async ({ orderBy }) => orderBy[0].reportDate === 'asc' ? rdos[0] : rdos.at(-1),
      findMany: async query => {
        queries.push(query);
        const { where } = query;
        const source = where.reportType === 'RDO' ? rdos : reports;
        return source.filter(report => !report.deletedAt && where.status.in.includes(report.status)
          && (!where.specialConditions || report.specialConditions?.[editKey]?.editedAt)
          && (!where.reportDate?.gte || report.reportDate >= where.reportDate.gte)
          && (!where.reportDate?.lte || report.reportDate <= where.reportDate.lte));
      }
    },
    user: { findMany: async () => [] },
    stockItem: { findMany: async () => [] }, stockMovement: { findMany: async () => [] }, romaneioItem: { findMany: async () => [] },
    projectDatabook: {
      findUnique: async () => databook && { ...databook, revisions },
      aggregate: async () => ({ _max: { sequence: null } }),
      create: async ({ data }) => (databook = { id: 'db1', ...data })
    },
    projectDatabookRevision: { create: async ({ data }) => {
      const result = { id: `rev-${data.revision}`, ...data, status: 'PENDING', databook };
      revisions.push(result);
      return result;
    } },
    $transaction: async fn => fn(client)
  };
  return { client, rdos, reports, correction, project, queries };
}

test('Data Book usa as correções vigentes no serviço e no acumulado, mesmo fora do período', async () => {
  const { client, rdos, reports, queries } = fixture();
  const before = structuredClone({ rdos, reports });
  const { dados, resumo } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client });
  assert.equal(dados.acumulado_inicial, 25);
  assert.deepEqual(dados.dias.map(day => day.data), ['02/10/2026']);
  const [service] = dados.dias[0].servicos;
  assert.equal(service.quantidade, 40);
  assert.equal(service.concluidas, 40);
  assert.equal(service.tags, 'TAG-02-CORRIGIDA');
  assert.equal(service.material, 'Inox');
  assert.equal(service.obs, 'Observação corrigida');
  assert.equal(service.inicio, '07:00');
  assert.equal(resumo.rdos, 1);
  assert.equal(resumo.rlq, 1);
  const query = queries.find(query => query.where.specialConditions);
  assert.equal(query.where.reportDate, undefined, 'correções não são limitadas pela data de execução');
  assert.deepEqual(query.where.status, { in: ['APPROVED', 'SIGNED'] });
  assert.deepEqual({ rdos, reports }, before, 'RDO e técnicos assinados permanecem intactos');
});

test('nova geração relê a última alteração e conserva as entradas das revisões anteriores', async () => {
  const { client, rdos, reports } = fixture();
  const first = await solicitarGeracao('p1', { inicio: '2026-10-01', fim: '2026-10-02' }, { id: 'manager' }, { client });
  const before = structuredClone(first.input);
  assert.equal(first.input.dias[1].servicos[0].quantidade, 40);
  reports[1].services[0].extraData.tubes = tubes(18);
  reports[1].specialConditions[editKey].editedAt = date('06').toISOString();
  const latest = await solicitarGeracao('p1', { inicio: '2026-10-01', fim: '2026-10-02' }, { id: 'manager' }, { client });
  assert.equal(latest.revision, 1);
  assert.equal(latest.input.dias[1].servicos[0].quantidade, 18);
  assert.equal(latest.input.dias[1].servicos[0].concluidas, 18);
  assert.deepEqual(first.input, before);
  assert.equal(rdos[1].services[0].extraData.tubes[0].c, '20');
});

test('última edição prevalece sem duplicar o técnico e pode zerar ou remover a medição', async () => {
  const { client, reports, correction } = fixture();
  const old = correction('02', 75, '03', { id: 'old-rlq', sequenceNumber: 9 });
  reports.push(old);
  reports[1].services[0].extraData.tubes = [];
  const { dados, resumo } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client });
  assert.equal(dados.dias[0].servicos.length, 1);
  assert.equal(dados.dias[0].servicos[0].relatorio, 2);
  assert.equal(dados.dias[0].servicos[0].quantidade, 0);
  assert.equal(dados.dias[0].servicos[0].concluidas, 0);
  assert.equal(resumo.rlq, 1);
});

test('edição de texto e material com o mesmo quantitativo também entra no Data Book', async () => {
  const { client, reports } = fixture();
  reports[1].services[0].extraData.tubes = tubes(20);
  const { dados } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client });
  const [service] = dados.dias[0].servicos;
  assert.equal(service.quantidade, 20);
  assert.equal(service.tags, 'TAG-02-CORRIGIDA');
  assert.equal(service.material, 'Inox');
  assert.equal(service.obs, 'Observação corrigida');
});

test('unidades e aliases corrigidos substituem a medição original sem somar as duas fontes', async () => {
  const cases = [
    ['limpeza', 'RLQ', { 'Diâmetros e comprimentos': [{ d: '2', c: '25000', lengthUnit: 'mm' }] }, 25, 'm'],
    ['filtragem', 'RCPU', { volumeOleo: '2', volumeOleoUnit: 'm3' }, 2000, 'L'],
    ['limpeza', 'RLQ', { limpezaTubulacao: 'Não', quantidadeSistemas: 3 }, 3, 'un.'],
    ['pressao', 'RTP', { equipamentoTestado: 'mangueira', medicaoMangotes: 'UN', quantidadeMangotes: 8 }, 8, 'un.']
  ];
  for (const [serviceType, reportType, extraData, quantity, unit] of cases) {
    const { client, rdos, reports } = fixture();
    rdos[1].services[0].serviceType = serviceType;
    reports[1].reportType = reportType;
    reports[1].services[0].serviceType = serviceType;
    reports[1].services[0].extraData = extraData;
    reports[1].specialConditions.serviceData = extraData;
    const { dados } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client });
    assert.equal(dados.dias[0].servicos[0].quantidade, quantity, reportType);
    assert.equal(dados.dias[0].servicos[0].unidade_quantidade, unit, reportType);
  }
});

test('correção de etapas, produtos e fotos substitui os dados antigos do RDO', async () => {
  const { client, rdos, reports } = fixture();
  const upload = name => [{ label: 'Imagens', files: [{ url: `/relatorios/Missão 9001 - Projeto/SERV/${name}.jpg` }] }];
  Object.assign(rdos[1].services[0].extraData, { etapas: ['Fase ácida'], chemicalProducts: ['Ácido cítrico'], __uploads__: upload('antiga') });
  Object.assign(reports[1].services[0].extraData, { materialSelection: 'Outro', material: 'PVC',
    etapas: ['Fase passivante'], chemicalProducts: ['Ácido nítrico'], __uploads__: upload('corrigida') });
  reports[1].services[0].material = 'PVC';
  const { dados } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client });
  assert.deepEqual(dados.etapas_produto, [{ etapa: 'Fase passivante', produto: 'Ácido nítrico' }]);
  assert.equal(dados.dias[0].fotos.length, 1);
  assert.match(dados.dias[0].fotos[0].arquivo, /corrigida\.jpg$/);
});

test('vínculo estável do RDO encontra correção cujo serviço teve o ID recriado', async () => {
  const { client, reports } = fixture();
  reports[1].specialConditions.serviceId = 'old-service-id';
  reports[1].reportDate = date('06');
  const { dados, resumo } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client });
  assert.equal(dados.dias[0].servicos[0].quantidade, 40);
  assert.equal(dados.dias[0].servicos[0].relatorio, 2);
  assert.equal(resumo.rlq, 1);
});

test('correção posterior mantém a proposta atribuída ao serviço original', async () => {
  const { client, rdos, project } = fixture();
  const key = 'COMERCIAL_APP:502';
  for (const report of rdos) report.contributionAssignments = {
    [contributionServiceKey(report.services[0])]: { contributionKey: key }
  };
  const context = { main: { key: 'MAIN' }, project, options: [{ key: 'MAIN' }, { key, proposalCode: '502', revision: 0 }],
    planned: project.plannedServices.map(service => ({ ...service, contributionKey: key })), plannedKey: service => service.contributionKey || 'MAIN' };
  const { dados, resumo } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client, scopeContext: context, contributionKey: key });
  assert.equal(dados.acumulado_inicial, 25);
  assert.equal(dados.dias.length, 1);
  assert.equal(dados.dias[0].servicos[0].quantidade, 40);
  assert.equal(resumo.rlq, 1);
});

test('rascunhos, exclusões e técnicos de outro RDO não substituem serviços assinados', async () => {
  for (const invalid of [{ status: 'PENDING' }, { deletedAt: date('06') }, { specialConditions: {} },
    { specialConditions: { parentRdoId: 'other-rdo', serviceId: 's-02', [editKey]: { editedAt: date('06').toISOString() } } }]) {
    const { client, reports } = fixture();
    Object.assign(reports[1], invalid);
    const { dados } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client });
    assert.equal(dados.dias[0].servicos[0].quantidade, 20);
    assert.equal(dados.dias[0].servicos[0].concluidas, 20);
  }
});

const pythonReady = spawnSync(env.databookPython, ['-c', 'import reportlab, pypdf, PIL']).status === 0;
test('PDF real contém o quantitativo e o acumulado corrigidos', { skip: !pythonReady && 'Python do Data Book ausente' }, async t => {
  const { client } = fixture();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'databook-correction-pdf-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { dados } = await montarDadosDatabook('p1', '2026-10-02', '2026-10-02', { client });
  const output = path.join(directory, 'corrigido.pdf');
  assert.ok((await gerarPdf(dados, output)).paginas > 0);
  const result = spawnSync(env.databookPython, ['-c',
    'from pypdf import PdfReader; import sys; print("\\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages))', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /40 m/);
  assert.match(result.stdout, /65\/100/);
  assert.match(result.stdout, /TAG-02-CORRIGIDA/);
});
