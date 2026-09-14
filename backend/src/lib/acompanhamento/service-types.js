// Normaliza os nomes dos serviços dos relatórios e do escopo para comparação.
export function normalizeRdoServiceType(raw) {
  const key = String(raw ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return null;
  if (key.startsWith('limpezaquimica') || key === 'limpeza') return 'LIMPEZA_QUIMICA';
  if (key.startsWith('testedepressao') || key === 'pressao') return 'TESTE_PRESSAO';
  if (key.startsWith('flushing')) return 'FLUSHING';
  if (key.startsWith('filtragem') || key.startsWith('unidadedefiltragem')) return 'FILTRAGEM';
  return null;
}
