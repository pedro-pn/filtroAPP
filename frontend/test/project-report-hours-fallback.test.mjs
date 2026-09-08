import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('horas dos RDOs aparecem como fallback visual das horas apropriadas', async () => {
  const [component, css] = await Promise.all([
    readSource('src/components/projects/ProjectDetailDashboard.tsx'),
    readSource('src/styles/base.css')
  ]);

  assert.match(component, /c\.horasApropriadas != null && c\.horasApropriadas > 0/);
  assert.match(component, /\) : c\.horas > 0 \? \([\s\S]{0,900}?fmtHours\(c\.horas\)/);
  assert.match(component, /className="acp-report-hours-fallback-trigger"/);
  assert.match(component, /não entram no custo apropriado/);
  assert.match(component, /<small>RDO<\/small>/);
  assert.match(css, /\.acp-report-hours-fallback-trigger\s*\{[^}]*color:\s*var\(--bl\)/s);
  assert.match(css, /\.acp-report-hours-fallback-value\s*\{[^}]*border-bottom:\s*1px dashed currentColor/s);
});
