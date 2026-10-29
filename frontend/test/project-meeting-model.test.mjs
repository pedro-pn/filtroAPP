import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { detail } from './fixtures/project-detail.mjs';

// Cenários da proposta aprovada em 29/10/2026: a missão medida (atrasada) e uma missão em dia.
const measured = {
  ...detail, avancoPct: 10.4, alerts: [{ code: 'PARADO', level: 'danger', label: 'Parado há 7 dia(s)' }, { code: 'CUSTO', level: 'warn', label: 'Custo em risco' }],
  diasCorridos: { elapsed: 296, planned: 546, pct: 54 },
  consumo: { ...detail.consumo, gasto: 268, previsto: 1000 }, maoDeObra: { ...detail.maoDeObra, custo: 0 },
  rdoSignatures: { signed: 24, total: 130 },
  footer: { ...detail.footer, expectedEndDate: '2027-07-06T12:00:00Z', projectedEndByPace: '2033-10-22T12:00:00Z' }
};
const onTrack = {
  ...detail, avancoPct: 67.5, alerts: [], diasCorridos: { elapsed: 40, planned: 61, pct: 66 },
  rdoSignatures: { signed: 30, total: 33 },
  footer: { ...detail.footer, expectedEndDate: '2026-11-13T12:00:00Z', projectedEndByPace: '2026-11-12T12:00:00Z' }
};

test('resumo de reunião: selos, nota ponderada, leitura e pontos de atenção', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const model = await server.ssrLoadModule('/src/components/projects/projectMeetingModel.ts');
    const { ProjectMeetingSummary } = await server.ssrLoadModule('/src/components/projects/ProjectMeetingSummary.tsx');
    const render = props => renderToStaticMarkup(createElement(ProjectMeetingSummary, props)).replaceAll(' ', ' ');

    await t.test('missão medida: gasto à frente do avanço e nota 1,65 (Em risco)', () => {
      const meeting = model.projectMeeting(measured, measured.avancoPct);
      assert.deepEqual(meeting.cost.status, { tone: 'warning', label: 'À frente do avanço' });
      assert.deepEqual(meeting.scope.status, { tone: 'danger', label: 'Atrás do prazo' });
      assert.deepEqual(meeting.reports.status, { tone: 'danger', label: '106 pendentes' });
      assert.deepEqual(meeting.time.status, { tone: 'danger', label: 'Projeção após o término' });
      assert.equal(meeting.health.score, 1.65);
      assert.deepEqual(meeting.health.status, { tone: 'danger', label: 'Em risco' });
      assert.deepEqual(meeting.health.contributors.map(item => item.key), ['time', 'scope', 'cost', 'rdo']);
      // Abaixo de 20% de avanço a projeção fica só no detalhe.
      assert.equal(meeting.cost.projection.showInCard, false);
      assert.equal(Math.round(meeting.cost.projection.factor * 10) / 10, 2.6);
      assert.ok(meeting.readout.some(sentence => sentence.includes('43,6 p.p. atrás do prazo decorrido (54%)')));
      assert.ok(meeting.readout.some(sentence => sentence.includes('cerca de 6 anos depois do previsto')));
      assert.ok(meeting.readout.every(sentence => !sentence.includes('No ritmo atual')));
      const labels = meeting.attention.map(item => item.label);
      assert.ok(labels.includes('Gasto à frente do avanço (26,8% × 10,4%)'));
      assert.ok(labels.includes('Parado há 7 dia(s)'));
      assert.ok(!labels.includes('Custo em risco'), 'o alerta de custo do backend é coberto pelo card Gastos');
      assert.equal(meeting.attention.at(-1).tone, 'warning');
    });

    await t.test('missão em dia: custo acima do previsto, nota 0,80 (Atenção) e projeção no card', () => {
      const meeting = model.projectMeeting(onTrack, onTrack.avancoPct);
      assert.deepEqual(meeting.cost.status, { tone: 'danger', label: 'Acima do previsto' });
      assert.deepEqual(meeting.scope.status, { tone: 'success', label: 'No ritmo' });
      assert.deepEqual(meeting.reports.status, { tone: 'warning', label: '3 pendentes' });
      assert.deepEqual(meeting.time.status, { tone: 'success', label: 'Antes do previsto' });
      assert.equal(meeting.health.score, 0.8);
      assert.equal(meeting.health.status.label, 'Atenção');
      assert.equal(meeting.cost.projection.showInCard, true);
      assert.equal(Math.round(meeting.cost.projection.amount), 155556);
      const html = render({ meeting, details: { cost: 'Detalhe do custo' } });
      assert.match(html, /No ritmo atual: <strong>≈ R\$ 155\.555,56<\/strong>/);
      assert.match(html, /Estimativa/);
      assert.match(html, /\+1,5 p\.p\.<\/strong> em relação ao prazo \(66%\)/);
      assert.match(html, /avanço 67,5%/);
      assert.match(html, /prazo 66%/);
      assert.doesNotMatch(html, /Detalhe do custo/);
      const opened = render({ meeting, details: { cost: 'Detalhe do custo' }, defaultOpen: 'cost' });
      assert.match(opened, /aria-expanded="true" aria-controls="acp-meeting-detail-cost"/);
      assert.match(opened, /Gastos<span> · detalhe/);
      assert.match(opened, /custo final fica em cerca de <strong>R\$ 155\.555,56<\/strong> \(1,6× o previsto\)/);
      assert.match(opened, /Detalhe do custo/);
    });

    await t.test('tolerâncias aprovadas: ±5 p.p., −15 p.p. e 7 dias', () => {
      const scope = progress => model.meetingScope(onTrack, progress).status.label;
      assert.equal(scope(61), 'No ritmo');
      assert.equal(scope(60), 'Pouco atrás');
      assert.equal(scope(51), 'Pouco atrás');
      assert.equal(scope(50), 'Atrás do prazo');
      const cost = gasto => model.meetingCost({ ...onTrack, consumo: { ...onTrack.consumo, gasto }, maoDeObra: { ...onTrack.maoDeObra, custo: 0 } }).status.label;
      assert.equal(cost(72500), 'Proporcional ao avanço');
      assert.equal(cost(72600), 'À frente do avanço');
      const time = projectedEndByPace => model.meetingTime({ ...onTrack, footer: { ...onTrack.footer, projectedEndByPace } }).status.label;
      assert.equal(time('2026-11-20T12:00:00Z'), '7 dias após');
      assert.equal(time('2026-11-21T12:00:00Z'), 'Projeção após o término');
      assert.equal(time(null), 'Sem projeção');
      const reports = signed => model.meetingReports({ ...onTrack, rdoSignatures: { signed, total: 100 } }).status.tone;
      assert.equal(reports(100), 'success');
      assert.equal(reports(90), 'warning');
      assert.equal(reports(89), 'danger');
    });

    await t.test('apresentação e locação redistribuem os pesos sem inventar indicadores', () => {
      const presentation = model.projectMeeting({ ...onTrack, presentation: { sourceCode: '5812' } }, onTrack.avancoPct);
      assert.deepEqual(presentation.cost.status, { tone: 'neutral', label: 'Custo realizado' });
      assert.equal(presentation.cost.projection, null);
      assert.equal(presentation.health.score, Math.round(0.1 / 0.65 * 100) / 100);
      const rental = model.projectMeeting({ ...onTrack, rentalTracking: {
        startDate: '2026-09-01', endDate: '2026-09-30', plannedDays: 30, elapsedDays: 28, remainingDays: 2, status: 'ACTIVE'
      } }, onTrack.avancoPct);
      assert.equal(rental.scope, null);
      assert.deepEqual(rental.time.status, { tone: 'warning', label: 'Termina em 2 dias' });
      const html = render({ meeting: rental, details: {} });
      assert.equal((html.match(/data-acp-meeting-kpi=/g) ?? []).length, 3);
      assert.match(html, /Dias de locação/);
      const empty = model.meetingHealth({});
      assert.deepEqual(empty, { status: { tone: 'neutral', label: 'Sem dados suficientes' }, score: null, contributors: [] });
      const noBudget = model.projectMeeting({ ...onTrack, consumo: { ...onTrack.consumo, previsto: null } }, onTrack.avancoPct);
      assert.deepEqual(noBudget.cost.status, { tone: 'neutral', label: 'Sem orçamento' });
      assert.doesNotMatch(render({ meeting: noBudget, details: {} }), /NaN|Infinity/);
    });

    await t.test('prazos longos ficam legíveis', () => {
      assert.equal(model.durationLabel(1), '1 dia');
      assert.equal(model.durationLabel(59), '59 dias');
      assert.equal(model.durationLabel(90), 'cerca de 3 meses');
      assert.equal(model.durationLabel(2300), 'cerca de 6 anos');
    });
  } finally { await server.close(); }
});
