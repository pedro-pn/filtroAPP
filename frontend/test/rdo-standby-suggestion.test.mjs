import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let suggestStandby;
let standbyMinutesAfterBreaks;
let reviewedStandbyFields;
let readStandbyReviewReceipt;
before(async () => {
  server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  ({ suggestStandby, standbyMinutesAfterBreaks, reviewedStandbyFields, readStandbyReviewReceipt } = await server.ssrLoadModule('/src/utils/standbySuggestion.ts'));
});
after(async () => { await server?.close(); });

function report(text, patch = {}) {
  return { dailyDescription: text, services: [], standby: false, standbyDuration: '', standbyMotivo: '',
    arrivalTime: '07:00', departureTime: '18:00', lunchBreak: '01:00',
    noturno: false, noturnoStart: '', noturnoEnd: '', noturnoInterval: '', ...patch };
}

for (const [text, minutes] of [
  ['Equipe parada das 08:00 às 10:30 por falta de energia.', 150],
  ['Das 8h às 10h aguardando liberação da área.', 120],
  ['Aguardamos liberação entre 8 e 10.', 120],
  ['A equipe ficou parada aguardando serviço entre as 10h e 13h atividade ocorreu normal depois', 180],
  ['Equipe parada entre às 10h e às 13h.', 180],
  ['Equipe parada entre 10h e 13h.', 180],
  ['Equipe parada entre as 10:00 e as 13:00.', 180],
  ['Stand-by: 08h30 - 10h15, por chuva.', 105],
  ['Paralisação de 2 horas e 15 minutos por chuva.', 135],
  ['Aguardando material por 1h30.', 90],
  ['Ficamos parados por 1,5 hora.', 90],
  ['Parada por uma hora e meia.', 90],
  ['Pausa de meia hora por falta de acesso.', 30],
  ['Equipe parada por trinta minutos.', 30],
  ['Equipe esperando liberação por duas horas e quinze minutos.', 135],
  ['Sem liberação das 08h às 10h.', 120],
  ['Não houve paradas de manhã, mas paramos das 14:00 às 15:00.', 60],
  ['Tempo total de standby de 02:30.', 150],
  ['Sem energia, equipe parada durante 02:00.', 120],
  ['Equipe parada das 08:00:00 às 09:15:00.', 75],
  ['Parada das 08:00 às 09:00 e das 14:00 às 15:30.', 150],
  ['Equipe parada o dia inteiro aguardando liberação.', 600]
]) {
  test(`calcula o tempo explícito: ${text}`, () => {
    const result = suggestStandby(report(text));
    assert.equal(result?.totalMinutes, minutes);
    assert.equal(result?.duration, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
    assert.equal(result?.warnings.length, 0);
    assert.ok(result.evidence.every(item => result.reason.includes(item.text)));
  });
}

test('soma atividades e observações dos serviços sem alterar o formulário', () => {
  const input = report('Parada das 08:00 às 09:00.', { services: [
    { data: { notes: 'Aguardando material das 10:00 às 11:30.' } },
    { data: { Observações: 'Parados das 15:00 às 15:30.' } }
  ] });
  const before = JSON.stringify(input);
  const result = suggestStandby(input);
  assert.equal(result.totalMinutes, 180);
  assert.deepEqual(result.evidence.map(item => item.source), ['Atividades do dia', 'Observações do serviço 1', 'Observações do serviço 2']);
  assert.equal(JSON.stringify(input), before);
});

test('não duplica a mesma anotação copiada nas atividades e nas observações', () => {
  const text = 'Equipe parada por 2 horas por falta de liberação.';
  const result = suggestStandby(report(text, { services: [{ data: { notes: text } }] }));
  assert.equal(result.totalMinutes, 120);
  assert.equal(result.evidence.length, 1);
});

test('conta intervalos coincidentes ou sobrepostos uma vez, inclusive entre serviços', () => {
  const result = suggestStandby(report('Aguardando liberação das 08:00 às 10:00.', { services: [
    { data: { notes: 'Parada das 09:00 às 11:00 por falta de acesso.' } },
    { data: { notes: 'Parados das 08:00 às 10:00.' } }
  ] }));
  assert.equal(result.totalMinutes, 180);
});

test('intervalos atravessando meia-noite também são unidos', () => {
  const result = suggestStandby(report('Parados das 23:00 às 01:00.\nParada das 00:30 às 02:00.', {
    arrivalTime: '22:00', departureTime: '06:00', lunchBreak: '00:00'
  }));
  assert.equal(result.totalMinutes, 180);
});

test('o dia inteiro usa a jornada diurna e noturna, descontando os intervalos', () => {
  const result = suggestStandby(report('Equipe parada o dia todo.', {
    arrivalTime: '07:00', departureTime: '17:00', noturno: true,
    noturnoStart: '18:00', noturnoEnd: '22:00', noturnoInterval: '00:30'
  }));
  assert.equal(result.totalMinutes, 750);
});

for (const text of [
  'Limpeza das 08:00 às 10:00.',
  'Hora de término/pausa: 17:00.',
  'Sem paradas durante 2 horas de teste.',
  'Não houve paralisação das 08:00 às 10:00.',
  'Não ficamos parados durante 2 horas de serviço.',
  'Pausa para almoço das 12:00 às 13:00.',
  'Parada de 15 minutos para café.',
  'Pausa para DDS das 07:00 às 07:15.',
  'Aguardando tempo de cura por 2 horas.',
  'Aguardando estabilização da pressão por 30 minutos.',
  'Ontem a equipe ficou parada por 2 horas.',
  'Parada prevista amanhã das 08:00 às 10:00.',
  'Se houver parada de 2 horas, avisar a supervisão.'
]) {
  test(`não sugere standby para atividade, negação ou intervalo rotineiro: ${text}`, () => {
    assert.equal(suggestStandby(report(text)), null);
  });
}

for (const text of [
  'Equipe parada aguardando liberação.',
  'Ficamos parados às 08:00.',
  'Ficamos parados às 08h.',
  'Aguardando liberação até 10h30.',
  'Equipe parada desde 08h30.',
  'Parados das 08:00 às 08:00.',
  'Parada de aproximadamente 2 horas.',
  'Parada das 25:00 às 27:00.',
  'Parada das 08:75 às 09:00.',
  'Parados por 2 horas e 1 hora esperando material.',
  'Pausa em 2 horários diferentes.',
  'Parados por 1h90.',
  'Almoço das 12:00 às 13:00 e equipe parada das 14:00 às 16:00 por falta de energia.',
  'Aguardando material por 1,333 hora.',
  'Parada das 08:00 às 09:00. Parados por 2 horas por falta de material.',
  'Parados por 12 horas.',
  'Parados o dia todo.'
]) {
  test(`pede conferência em vez de inventar um total: ${text}`, () => {
    const input = report(text, text === 'Parados o dia todo.' ? { arrivalTime: '', departureTime: '' } : {});
    const result = suggestStandby(input);
    assert.equal(result?.totalMinutes, null);
    assert.equal(result?.duration, '');
    assert.ok(result?.warnings.length > 0);
  });
}

test('resumo do total não é somado novamente aos períodos discriminados', () => {
  const result = suggestStandby(report('Parada das 08:00 às 09:00; parada das 14:00 às 15:00; total de standby de 2 horas.'));
  assert.equal(result.totalMinutes, 120);
  const conflict = suggestStandby(report('Parada das 08:00 às 09:00; total de standby de 3 horas.'));
  assert.equal(conflict.totalMinutes, null);
  assert.match(conflict.warnings.join(' '), /diverge/);
});

test('standby já preenchido é preservado e a sugestão nunca soma ao valor atual', () => {
  const text = 'Parados por 2 horas.';
  for (const standbyDuration of ['02:00', '02:00:00', '03:00']) {
    assert.equal(suggestStandby(report(text, { standby: true, standbyDuration, standbyMotivo: 'Sem energia' })), null);
  }
  const result = suggestStandby(report(text, { standby: true, standbyDuration: '01:00', standbyMotivo: 'Sem energia' }));
  assert.equal(result.duration, '02:00');
  assert.equal(suggestStandby(report(text, { standby: true, standbyDuration: '02:00' })).duration, '02:00');
});

test('dispensa local não afeta o revisor: o relatório original continua gerando a sugestão', () => {
  const input = report('Parados por 2 horas.');
  assert.deepEqual(suggestStandby(input), suggestStandby(structuredClone(input)));
  const initial = suggestStandby(input);
  assert.equal(initial.key, suggestStandby({ ...input, standby: true, standbyDuration: '00:30' }).key);
  assert.notEqual(initial.key, suggestStandby({ ...input, dailyDescription: 'Parados por 3 horas.' }).key);
});

test('10h a 13h pede confirmação e desconta 1h de almoço somente após o aceite', () => {
  const result = suggestStandby(report('A equipe ficou parada aguardando serviço entre as 10h e 13h atividade ocorreu normal depois'));
  assert.equal(result.duration, '03:00');
  assert.deepEqual(result.breaks, [{ id: 'day', label: 'Intervalo de almoço', minutes: 60, maxOverlapMinutes: 60 }]);
  assert.equal(standbyMinutesAfterBreaks(result, {}), null);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 60 }), 120);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 0 }), 180);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 30 }), 150);
});

test('tempo total escrito não recebe desconto nem pergunta sobre almoço', () => {
  for (const text of ['A equipe ficou aguardando por 5h.', 'Total de standby: 05:00.', 'Equipe parada por cinco horas.']) {
    const result = suggestStandby(report(text));
    assert.equal(result.totalMinutes, 300);
    assert.deepEqual(result.breaks, []);
    assert.equal(standbyMinutesAfterBreaks(result, {}), 300);
  }
});

test('o mesmo intervalo é descontado apenas uma vez entre anotações e serviços sobrepostos', () => {
  const result = suggestStandby(report('Parados das 10h às 13h.', { services: [
    { data: { notes: 'Equipe parada das 11h às 14h.' } }
  ] }));
  assert.equal(result.totalMinutes, 240);
  assert.equal(result.breaks.length, 1);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 60 }), 180);
});

test('dia inteiro já desconta os intervalos e não solicita novo desconto', () => {
  const result = suggestStandby(report('Parados o dia inteiro.'));
  assert.equal(result.totalMinutes, 600);
  assert.deepEqual(result.breaks, []);
});

test('período da jornada inteira mantém o bruto para confirmar o desconto, sem aviso incorreto de excesso', () => {
  const result = suggestStandby(report('Parados das 07h às 18h.'));
  assert.equal(result.totalMinutes, 660);
  assert.deepEqual(result.warnings, []);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 60 }), 600);
});

test('período menor que o almoço permite apenas a parte efetivamente sobreposta', () => {
  const result = suggestStandby(report('Parados entre as 12h30 e 13h.'));
  assert.equal(result.breaks[0].maxOverlapMinutes, 30);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 60 }), null);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 30 }), 0);
  for (const value of [-1, 1.5, NaN, Infinity]) assert.equal(standbyMinutesAfterBreaks(result, { day: value }), null);
});

test('sem intervalo cadastrado não há pergunta ou desconto', () => {
  const result = suggestStandby(report('Parados entre as 10h e 13h.', { lunchBreak: '00:00' }));
  assert.deepEqual(result.breaks, []);
  assert.equal(standbyMinutesAfterBreaks(result, {}), 180);
});

test('pausa noturna pergunta somente sobre o intervalo do turno noturno', () => {
  const result = suggestStandby(report('Parados entre as 23h e 02h.', {
    noturno: true, noturnoStart: '22:00', noturnoEnd: '06:00', noturnoInterval: '01:00'
  }));
  assert.deepEqual(result.breaks.map(option => option.id), ['night']);
  assert.equal(standbyMinutesAfterBreaks(result, { night: 60 }), 120);
});

test('intervalos diurno e noturno exigem respostas independentes', () => {
  const result = suggestStandby(report('Parados das 10h às 13h; parados das 23h às 02h.', {
    noturno: true, noturnoStart: '22:00', noturnoEnd: '06:00', noturnoInterval: '00:30'
  }));
  assert.equal(result.breaks.length, 2);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 60 }), null);
  assert.equal(standbyMinutesAfterBreaks(result, { day: 60, night: 30 }), 270);
});

test('aceite com desconto permanece válido ao reabrir; mudar a anotação ou a jornada exige nova revisão', () => {
  const input = report('Parados entre as 10h e 13h.');
  const result = suggestStandby(input);
  const fields = reviewedStandbyFields(result, '02:00', 'Espera de liberação, descontada uma hora de almoço.', 60);
  assert.equal(fields.standbySuggestionReview.deductedBreakMinutes, 60);
  const saved = JSON.parse(JSON.stringify({ ...input, ...fields }));
  assert.equal(suggestStandby(saved), null);
  assert.equal(suggestStandby({ ...saved, arrivalTime: '07:00:00', departureTime: '18:00:00', lunchBreak: '01:00:00' }), null);
  assert.ok(suggestStandby({ ...saved, dailyDescription: 'Parados entre as 10h e 14h.' }));
  assert.ok(suggestStandby({ ...saved, lunchBreak: '00:30' }));
  assert.ok(suggestStandby({ ...saved, standby: false, standbyDuration: '' }));
});

test('se o período era só intervalo, confirma sem standby e não reapresenta a mesma sugestão', () => {
  const input = report('Equipe parada entre as 12h e 13h.');
  const result = suggestStandby(input);
  const fields = reviewedStandbyFields(result, '00:00', result.reason, 60);
  assert.equal(fields.standby, false);
  assert.equal(fields.standbyDuration, '');
  assert.equal(fields.standbyMotivo, '');
  assert.equal(suggestStandby({ ...input, ...fields }), null);
});

test('recibos antigos, incompletos ou inválidos não ocultam uma sugestão pendente', () => {
  for (const value of [undefined, null, {}, { version: 1, sourceKey: 'invalid' },
    { version: 1, sourceKey: 'a'.repeat(16), standby: false, totalMinutes: 60, deductedBreakMinutes: 0 }]) {
    assert.equal(readStandbyReviewReceipt(value), null);
    assert.ok(suggestStandby(report('Parados entre as 10h e 13h.', { standbySuggestionReview: value })));
  }
});

test('o aceite do desconto sobrevive ao rascunho e não é herdado por um rascunho antigo', async () => {
  const { reportDraftToRdoState } = await server.ssrLoadModule('/src/utils/reportDraft.ts');
  const { useRdoStore } = await server.ssrLoadModule('/src/store/rdoStore.ts');
  const input = report('Parados entre as 10h e 13h.');
  const fields = reviewedStandbyFields(suggestStandby(input), '02:00', 'Aguardando liberação.', 60);
  const draft = JSON.parse(JSON.stringify({ id: 'break-draft', payload: { ...input, ...fields } }));
  useRdoStore.getState().reset();
  useRdoStore.getState().hydrate(reportDraftToRdoState(draft));
  assert.equal(suggestStandby(useRdoStore.getState()), null);
  useRdoStore.getState().hydrate(reportDraftToRdoState({ ...draft, payload: { ...draft.payload, standbySuggestionReview: undefined, standby: false } }));
  assert.equal(useRdoStore.getState().standbySuggestionReview, null);
  assert.ok(suggestStandby(useRdoStore.getState()));
  useRdoStore.getState().reset();
});
