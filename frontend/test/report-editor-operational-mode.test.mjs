import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

async function loadModule(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule(path);
  } finally {
    await server.close();
  }
}

test('service-only report editor exposes the team-only mode', async () => {
  const { reportEditorOperationalMode } = await loadModule('/src/pages/reportEditorOperationalMode.ts');

  assert.equal(reportEditorOperationalMode({
    manualReport: false,
    serviceOnly: true,
    derivedServiceReport: false
  }), 'team-only');
});

test('team-only operational fields render the team picker without schedule inputs', async () => {
  const { ManualReportOperationalFields } = await loadModule('/src/components/reports/ManualReportOperationalFields.tsx');
  const markup = renderToStaticMarkup(createElement(ManualReportOperationalFields, {
    value: {
      arrivalTime: '08:00',
      departureTime: '17:00',
      lunchBreak: '01:00:00',
      collaboratorIds: [],
      noturno: false,
      noturnoStart: '',
      noturnoEnd: '',
      noturnoInterval: '01:00:00',
      noturnoCollaboratorIds: [],
      standby: false,
      standbyDuration: '',
      standbyMotivo: '',
      ddsDay: false,
      ddsDayStart: '',
      ddsDayEnd: '',
      ddsDayThemes: [],
      ddsNight: false,
      ddsNightStart: '',
      ddsNightEnd: '',
      ddsNightThemes: []
    },
    collaborators: [{ id: 'collaborator-1', name: 'Maria', role: 'Técnica', isActive: true }],
    showTimes: false,
    showNightShift: false,
    teamLabel: 'Equipe',
    onChange() {}
  }));

  assert.match(markup, />Equipe</);
  assert.match(markup, /Adicionar/);
  assert.match(markup, /Maria/);
  assert.doesNotMatch(markup, /Chegada|Saída|Intervalo de almoço/);
});

test('manual and regular reports retain full fields while linked service reports stay hidden', async () => {
  const { reportEditorOperationalMode } = await loadModule('/src/pages/reportEditorOperationalMode.ts');

  assert.equal(reportEditorOperationalMode({
    manualReport: true,
    serviceOnly: true,
    derivedServiceReport: false
  }), 'full');
  assert.equal(reportEditorOperationalMode({
    manualReport: false,
    serviceOnly: false,
    derivedServiceReport: false
  }), 'full');
  assert.equal(reportEditorOperationalMode({
    manualReport: false,
    serviceOnly: false,
    derivedServiceReport: true
  }), 'hidden');
});
