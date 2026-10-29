export function integrationWriteSimulationFailures(operations, routeSources, testCases, testSource) {
  const failures = [];
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  for (const operation of operations.filter(item => writeMethods.has(item.method))) {
    if (operation.simulation?.strategy !== 'rollback' || !testCases.includes(operation.simulation?.testCase)
      || operation.simulation.testCase !== operation.operationId) {
      failures.push(`Escrita ${operation.operationId} exige simulação rollback declarada e caso na matriz genérica.`);
    }
  }
  for (const { path, source } of routeSources) {
    if (/router\s*\[|router\.route\s*\(|router\.all\s*\(/.test(source)) {
      failures.push(`${path}: registre métodos de escrita explicitamente com requireApiOperation.`);
    }
    for (const match of source.matchAll(/router\.(post|put|patch|delete)\s*\(([^]*?)(?=\n\s*router\.|\n\s*for\s*\(|\n\s*return router|$)/g)) {
      const [, method, handler] = match;
      const declaredPath = handler.match(/^\s*['"]([^'"]+)['"]/)?.[1];
      const id = handler.match(/requireApiOperation\(['"]([^'"]+)['"]\)/)?.[1];
      const operation = operations.find(item => item.operationId === id);
      const fullPath = path.endsWith('/qualidade.js') ? `/qualidade${declaredPath}` : declaredPath;
      if (!operation || operation.method !== method.toUpperCase() || operation.path !== fullPath) {
        failures.push(`${path}: rota ${method.toUpperCase()} ${declaredPath} exige operação correspondente no catálogo.`);
      }
      if (!/runMeteredApiOperation\(/.test(handler) || !/execute:\s*async\s+database\s*=>/.test(handler)) {
        failures.push(`${path}: escrita ${declaredPath} exige executor com cliente transacional explícito.`);
      }
    }
  }
  if (!testSource.includes('for (const id of API_WRITE_SIMULATION_CASES)') || !testSource.includes('await snapshot()')) {
    failures.push('A matriz de testes deve executar todas as escritas e comparar persistência.');
  }
  return failures;
}
