import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const source = (path) => readFileSync(join(frontendRoot, path), 'utf8');

const expectedAppearance = (() => {
  const value = process.env.RDO_B6_EXPECT_APPEARANCE ?? 'design-system';
  if (value === 'legacy' || value === 'design-system') return value;
  throw new Error(`RDO_B6_EXPECT_APPEARANCE inválido: ${value}`);
})();

function sectionBetween(contents, start, end) {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `Seção inicial ausente: ${start}`);
  assert.notEqual(endIndex, -1, `Seção final ausente: ${end}`);
  return contents.slice(startIndex, endIndex);
}

function sourceFilesUnder(path) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(absolutePath);
    }
  }
  visit(join(frontendRoot, path));
  return files;
}

test('B.6 preserves monthly allocation state, queries, data order and visible totals', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const hooks = source('src/hooks/useProjectStats.ts');
  const monthly = sectionBetween(
    stats,
    'function MonthlyAllocationDashboard',
    'export function MonthlyAllocationDashboardOverlay'
  );

  assert.match(monthly, /useState\(currentYearValue\(\)\)/);
  assert.match(monthly, /useState\(currentMonthNumber\(\)\)/);
  assert.match(monthly, /useState<'summary' \| 'recipients'>\('summary'\)/);
  assert.match(
    monthly,
    /const yearMonth = `\$\{selectedYear\}-\$\{selectedMonth\}`/
  );
  assert.match(monthly, /Array\.from\(\{ length: 8 \}/);
  assert.match(monthly, /useAllocationReport\(yearMonth\)/);
  assert.match(monthly, /useAllocationReportRecipients\(\)/);
  assert.match(monthly, /useAllocationReportRecipientMutations\(\)/);
  assert.doesNotMatch(monthly, /localStorage|sessionStorage|driver\(/);
  assert.doesNotMatch(monthly, /collaborators\.(?:sort|toSorted)\(/);
  assert.match(monthly, /data\.summary\.reportCount/);
  assert.match(monthly, /data\.summary\.collaboratorCount/);
  assert.match(monthly, /data\.summary\.allocationCount/);
  assert.match(monthly, /data\.summary\.projectCount/);
  assert.match(
    monthly,
    /<AllocationTable collaborators=\{data\.collaborators\}/
  );
  assert.match(monthly, /BrandLoading label="Carregando alocações"/);
  assert.match(monthly, /Erro ao carregar alocações do mês\./);
  assert.match(stats, /Nenhuma alocação encontrada para o mês selecionado\./);

  assert.match(hooks, /queryKey: \['allocationReport', yearMonth\]/);
  assert.match(hooks, /queryFn: \(\) => fetchAllocationReport\(yearMonth\)/);
  assert.match(hooks, /staleTime: 5 \* 60 \* 1000/);
  assert.match(hooks, /enabled: Boolean\(yearMonth\)/);
  assert.match(hooks, /queryKey: \['allocationReportRecipients'\]/);
  assert.match(hooks, /queryFn: listAllocationReportRecipients/);
});

test('B.6 preserves every mutable and download contract without moving domain logic to DS', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const api = source('src/api/statistics.ts');
  const hooks = source('src/hooks/useProjectStats.ts');
  const monthly = sectionBetween(
    stats,
    'function MonthlyAllocationDashboard',
    'export function MonthlyAllocationDashboardOverlay'
  );

  assert.match(monthly, /downloadAllocationReportPdf\(yearMonth\)/);
  assert.match(
    monthly,
    /downloadBlob\(blob, allocationReportPdfFileName\(yearMonth\)\)/
  );
  assert.match(
    monthly,
    /saveRecipient\.mutateAsync\(\{\s*name: recipientName\.trim\(\) \|\| undefined,\s*email: recipientEmail\.trim\(\)\s*\}\)/
  );
  assert.match(
    monthly,
    /updateRecipient\.mutateAsync\(\{ id, payload: \{ isActive: !isActive \} \}\)/
  );
  assert.match(monthly, /removeRecipient\.mutateAsync\(id\)/);
  assert.match(monthly, /sendNow\.mutateAsync\(yearMonth\)/);
  assert.match(monthly, /setRecipientName\(''\)/);
  assert.match(monthly, /setRecipientEmail\(''\)/);
  assert.match(monthly, /Destinatário salvo\./);
  assert.match(
    monthly,
    /disabled=\{pdfLoading \|\| allocationQuery\.isLoading\}/
  );
  assert.match(
    monthly,
    /disabled=\{recipientMutations\.sendNow\.isPending \|\| recipientsQuery\.isLoading \|\| activeRecipients === 0\}/
  );
  assert.match(
    monthly,
    /disabled=\{recipientMutations\.saveRecipient\.isPending\}/
  );

  assert.match(api, /statistics\/allocation-report\/pdf/);
  assert.match(api, /responseType: 'blob'/);
  assert.match(api, /alocacao-colaboradores-\$\{yearMonth\}\.pdf/);
  assert.match(api, /statistics\/allocation-report\/send/);
  assert.match(api, /statistics\/allocation-report\/recipients/);
  assert.match(
    hooks,
    /invalidateQueries\(\{ queryKey: \['allocationReportRecipients'\] \}\)/
  );
});

test('B.6 keeps the Gestor and Coordinator on the shared design-system dashboard', () => {
  const stats = source('src/components/stats/StatsDashboard.tsx');
  const manager = source('src/pages/gestor/GestorPage.tsx');
  const coordinator = source('src/pages/coordinator/CoordinatorPage.tsx');
  const overlay = sectionBetween(
    stats,
    'export function MonthlyAllocationDashboardOverlay',
    'export function StatsOverview'
  );

  assert.match(
    coordinator,
    /<MonthlyAllocationDashboardOverlay\s+appearance="design-system"[\s\S]*?onClose=\{\(\) => setAllocationDashboardOpen\(false\)\}/
  );

  if (expectedAppearance === 'legacy') {
    assert.match(overlay, /className="survey-dash-overlay"/);
    assert.match(overlay, /<MonthlyAllocationDashboard\s*\/>/);
    assert.doesNotMatch(overlay, /appearance=/);
    assert.doesNotMatch(
      manager,
      /<MonthlyAllocationDashboardOverlay\b[^>]*appearance=/s
    );
    return;
  }

  assert.match(stats, /appearance\?: StatsDashboardAppearance/);
  assert.match(overlay, /appearance = 'legacy'/);
  assert.match(overlay, /appearance === 'design-system'/);
  assert.match(overlay, /<Modal\b/);
  assert.match(overlay, /appearance="design-system"/);
  assert.match(
    overlay,
    /<MonthlyAllocationDashboard appearance="design-system"\s*\/>/
  );
  assert.match(overlay, /<MonthlyAllocationDashboard\s*\/>/);
  assert.match(
    manager,
    /<MonthlyAllocationDashboardOverlay\s+appearance="design-system"/
  );
  assert.match(
    coordinator,
    /<MonthlyAllocationDashboardOverlay\s+appearance="design-system"/
  );

  const optIns = sourceFilesUnder('src').filter((path) =>
    /<MonthlyAllocationDashboardOverlay\b[^>]*appearance=["'{]/s.test(
      readFileSync(path, 'utf8')
    )
  );
  assert.deepEqual(optIns, [
    join(frontendRoot, 'src/pages/coordinator/CoordinatorPage.tsx'),
    join(frontendRoot, 'src/pages/gestor/GestorPage.tsx')
  ]);
});

test('B.6 DS branch uses existing responsive primitives and scoped semantic tokens', () => {
  if (expectedAppearance === 'legacy') return;

  const stats = source('src/components/stats/StatsDashboard.tsx');
  const css = source('src/components/stats/StatsDashboard.ds.css');
  const primitives = source('src/components/ui/ds/styles.css');
  const monthly = sectionBetween(
    stats,
    'function MonthlyAllocationDashboard',
    'export function MonthlyAllocationDashboardOverlay'
  );
  const responsiveTable = sectionBetween(
    stats,
    'function DesignSystemAllocationTable',
    'function DesignSystemRecipientCard'
  );

  for (const component of [
    'Alert',
    'Button',
    'Card',
    'EmptyState',
    'Field',
    'Input',
    'Select',
    'Skeleton'
  ]) {
    assert.match(monthly, new RegExp(`<${component}\\b`));
  }
  assert.match(responsiveTable, /<DataTable\b/);
  assert.match(responsiveTable, /mobile=\{\{/);
  assert.match(responsiveTable, /renderItem:/);
  assert.match(
    monthly,
    /<DesignSystemAllocationTable\s+collaborators=\{data\.collaborators\}/
  );
  assert.match(css, /rdo-stats-allocation/);
  assert.match(css, /:where\(\.fv-ds,\s*\[data-fv-ds\]\)/);
  assert.match(css, /var\(--/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(/i);
  assert.doesNotMatch(css, /!important/);
  assert.match(
    css,
    /rdo-stats-allocation\s+:where\(\.fv-input, \.fv-select\):focus-visible\s*\{\s*outline: 0;/
  );
  assert.match(
    primitives,
    /\.fv-control-shell:focus-within\s*\{[\s\S]*?outline: var\(--focus-ring-width\) solid var\(--focus-ring\)/
  );
});
