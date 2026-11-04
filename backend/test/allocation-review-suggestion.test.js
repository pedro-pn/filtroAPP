import assert from 'node:assert/strict';
import test from 'node:test';

import { sourceFingerprint, suggestDay, sameAllocation } from '../src/lib/efetivo/allocation-review/suggestion.js';

const P = (extra = {}) => ({ normalHours: 8.8, he70Hours: 0, he100Hours: 0, tags: [], tagProjectIds: [], travel: false, ...extra });

test('ponto, RDO e Efetivo no mesmo projeto: tudo confirma, sem pendência', () => {
  const result = suggestDay({
    ponto: P({ tags: ['5620'], tagProjectIds: ['p5620'] }),
    rdoProjectIds: ['p5620'],
    efetivoProjectIds: ['p5620']
  });
  assert.deepEqual(result.suggestion, { kind: 'PROJECT', projectIds: ['p5620'] });
  assert.deepEqual(Object.values(result.sources).map(s => s.state), ['confirms', 'confirms', 'confirms']);
  assert.equal(result.pending, false);
});

test('RDO vence a etiqueta do ponto e o dia fica como divergência', () => {
  const result = suggestDay({
    ponto: P({ tags: ['5484'], tagProjectIds: ['p5484'] }),
    rdoProjectIds: ['p5620'],
    efetivoProjectIds: ['p5484']
  });
  assert.deepEqual(result.suggestion.projectIds, ['p5620']);
  assert.equal(result.sources.ponto.state, 'diverges');
  assert.equal(result.sources.rdo.state, 'confirms');
  assert.equal(result.sources.efetivo.state, 'diverges');
  assert.equal(result.pendingReason, 'DIVERGENCE');
});

test('ponto sem etiqueta, sem RDO e sem Efetivo vira Sede', () => {
  const result = suggestDay({ ponto: P() });
  assert.equal(result.suggestion.kind, 'SEDE');
  assert.equal(result.sources.ponto.state, 'confirms');
  assert.equal(result.pending, false);
});

test('fim de semana e feriado sem ponto viram Folga sem pendência, mesmo com missão em andamento', () => {
  assert.equal(suggestDay({ isWeekend: true, efetivoProjectIds: ['p1'] }).suggestion.kind, 'FOLGA');
  const holiday = suggestDay({ isHoliday: true });
  assert.equal(holiday.suggestion.kind, 'FOLGA');
  assert.equal(holiday.pending, false);
  assert.equal(holiday.sources.efetivo.state, 'none');
});

test('dia útil vazio é Sem informação e pendente', () => {
  const result = suggestDay({});
  assert.equal(result.suggestion.kind, 'NONE');
  assert.equal(result.pendingReason, 'NO_INFORMATION');
});

test('só o planejamento indica: sugere o projeto e pede confirmação', () => {
  const result = suggestDay({ efetivoProjectIds: ['p5812'] });
  assert.deepEqual(result.suggestion, { kind: 'PROJECT', projectIds: ['p5812'] });
  assert.equal(result.pendingReason, 'PLAN_ONLY');
});

test('ausência cadastrada vence tudo e ponto batido nesse dia diverge', () => {
  const quiet = suggestDay({ absence: { type: 'FERIAS', id: 'a1' }, efetivoProjectIds: ['p1'] });
  assert.equal(quiet.suggestion.kind, 'FERIAS');
  assert.equal(quiet.pending, false);
  const worked = suggestDay({ absence: { type: 'FERIAS', id: 'a1' }, ponto: P() });
  assert.equal(worked.sources.ponto.state, 'diverges');
  assert.equal(worked.pending, true);
  assert.equal(suggestDay({ absence: { type: 'FADIGA_OFFSHORE' } }).suggestion.kind, 'AFASTAMENTO');
});

test('ajuste manual existente vence o RDO', () => {
  const result = suggestDay({ manualProjectIds: ['pB'], rdoProjectIds: ['pA'], ponto: P() });
  assert.deepEqual(result.suggestion.projectIds, ['pB']);
  assert.equal(result.sources.rdo.state, 'diverges');
});

test('etiqueta "em viagem" usa o destino do Efetivo; sem projeto próximo fica sem informação', () => {
  const trip = suggestDay({ ponto: P({ tags: ['Em viagem'], travel: true }), efetivoProjectIds: ['p5830'] });
  assert.deepEqual(trip.suggestion, { kind: 'TRAVEL', projectIds: ['p5830'] });
  assert.equal(trip.sources.ponto.state, 'confirms');
  assert.equal(trip.sources.efetivo.state, 'confirms');
  const lost = suggestDay({ ponto: P({ tags: ['Em viagem'], travel: true }) });
  assert.equal(lost.suggestion.kind, 'NONE');
  assert.equal(lost.pending, true);
});

test('dois RDOs no mesmo dia viram um dia com dois projetos', () => {
  const result = suggestDay({ ponto: P(), rdoProjectIds: ['pB', 'pA'] });
  assert.deepEqual(result.suggestion, { kind: 'PROJECT', projectIds: ['pA', 'pB'] });
  assert.equal(result.sources.rdo.state, 'confirms');
});

test('sameAllocation ignora ordem dos projetos', () => {
  assert.equal(sameAllocation({ kind: 'PROJECT', projectIds: ['b', 'a'] }, { kind: 'PROJECT', projectIds: ['a', 'b'] }), true);
  assert.equal(sameAllocation({ kind: 'SEDE', projectIds: [] }, { kind: 'FOLGA', projectIds: [] }), false);
});

test('fingerprint muda quando uma fonte muda e é estável na ordem', () => {
  const base = { ponto: P({ tags: ['a', 'b'] }), rdoProjectIds: ['x'] };
  assert.equal(sourceFingerprint(base), sourceFingerprint({ ponto: P({ tags: ['b', 'a'] }), rdoProjectIds: ['x'] }));
  assert.notEqual(sourceFingerprint(base), sourceFingerprint({ ...base, rdoProjectIds: ['y'] }));
});

test('viagem sem Efetivo usa o projeto dos dias vizinhos; empate entre projetos diferentes pede confirmação', () => {
  const ponto = P({ tags: ['Sede/Em viagem'], travel: true, sedeTag: true });
  const back = suggestDay({ ponto, neighborProjects: { before: { distance: 1, projectIds: ['pA'] }, after: null } });
  assert.deepEqual(back.suggestion, { kind: 'TRAVEL', projectIds: ['pA'] });
  assert.equal(back.pending, false);
  const closer = suggestDay({ ponto, neighborProjects: { before: { distance: 3, projectIds: ['pA'] }, after: { distance: 1, projectIds: ['pB'] } } });
  assert.deepEqual(closer.suggestion.projectIds, ['pB']);
  const tie = suggestDay({ ponto, neighborProjects: { before: { distance: 1, projectIds: ['pA'] }, after: { distance: 1, projectIds: ['pB'] } } });
  assert.deepEqual(tie.suggestion, { kind: 'TRAVEL', projectIds: ['pB'] });
  assert.equal(tie.pendingReason, 'DIVERGENCE');
});

test('etiqueta de Sede com Efetivo planejado sugere Sede e marca o planejamento como divergente', () => {
  const result = suggestDay({ ponto: P({ tags: ['Sede'], sedeTag: true }), efetivoProjectIds: ['pA'] });
  assert.equal(result.suggestion.kind, 'SEDE');
  assert.equal(result.sources.ponto.state, 'confirms');
  assert.equal(result.sources.efetivo.state, 'diverges');
  assert.equal(result.pending, true);
});
