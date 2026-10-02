import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('detalhe identifica custo sem atividade e conserva a jornada exclusiva dos relatórios', async () => {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    const { ProjectCollaboratorHoursContent } = await server.ssrLoadModule('/src/components/projects/ProjectCollaboratorHoursDialog.tsx');
    const collaborator = {
      name: 'Ana', role: 'Operador', horas: 8, horasApropriadas: 17.6,
      diasApropriados: [
        { data: '2026-09-29', horas: 8.8, horasNormais: 8.8, horasExtras: 0, semAtividade: true, emViagem: false, rdos: [] },
        { data: '2026-09-30', horas: 8.8, horasNormais: 8.8, horasExtras: 0, emViagem: false, rdos: [{ numero: 1 }] }
      ],
      horasRelatoriosPorData: [{ data: '2026-09-30', horas: 8, relatorios: [{ id: 'r1', tipo: 'RDO', numero: 1, horas: 8 }] }]
    };
    const render = source => renderToStaticMarkup(createElement(ProjectCollaboratorHoursContent, {
      collaborator, source, onSourceChange() {}
    }));
    const cost = render('POINT');
    assert.match(cost, /Dia sem atividade\/viagem/);
    assert.match(cost, /não contam como dias ou horas trabalhados/);
    assert.match(cost, /29\/09\/2026/);
    assert.match(cost, /17,6h/);
    assert.doesNotMatch(cost, />Em viagem</);
    const reports = render('REPORT');
    assert.match(reports, /30\/09\/2026/);
    assert.match(reports, />8h</);
    assert.doesNotMatch(reports, /29\/09\/2026|Dia sem atividade\/viagem/);
  } finally {
    await server.close();
  }
});
