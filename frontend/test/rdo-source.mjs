const sourceBundles = {
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
