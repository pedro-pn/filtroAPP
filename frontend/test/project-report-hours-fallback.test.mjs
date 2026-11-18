import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('horas dos RDOs aparecem como fallback visual das horas apropriadas', async () => {
  const [component, css] = await Promise.all([
    readSource('src/components/projects/ProjectDetailPeople.tsx'),
    readSource('src/components/projects/ProjectDetailDashboard.ds.css')
  ]);

  assert.match(component, /c\.horasApropriadas != null && c\.horasApropriadas > 0/);
  assert.match(component, /\) : c\.horas > 0 \? \([\s\S]{0,900}?fmtHours\(c\.horas\)/);
  assert.match(component, /triggerClassName="acp-detail-report-hours-tip"/);
  assert.match(component, /não entram no custo apropriado/);
  assert.match(component, /<Badge tone="info">\{fmtHours\(c.horas\)\} · RDO<\/Badge>/);
  assert.match(css, /\.acp-detail-report-hours-tip[^}]*min-height: calc\(var\(--space-10\) \+ var\(--space-1\)\)/s);
});
