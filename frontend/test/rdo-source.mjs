const sourceBundles = {
  'src/components/stats/StatsDashboard.tsx': [
    'src/components/stats/StatsDashboard.tsx',
    'src/components/stats/StatsCountCards.tsx',
    'src/components/stats/StatsOverview.tsx'
  ],
  'src/pages/gestor/GestorPage.tsx': [
    'src/pages/gestor/GestorPage.shared.tsx',
    'src/pages/gestor/GestorPage.tsx'
  ],
  'src/pages/ReportDetailPage.tsx': [
    'src/pages/ReportDetailPage.tsx',
    'src/components/reports/ReportDetailActions.tsx'
  ]
};

export function withRdoCompanions(path, readSource) {
  return (sourceBundles[path] || [path])
    .map(readSource)
    .join('\n');
}
