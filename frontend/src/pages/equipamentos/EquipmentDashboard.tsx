import { useMemo, useState } from 'react';

import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { SearchBar } from '../../components/ui/SearchBar';
import { calibrationStatus, formatDate, statusLabel, type CalibrationStatus } from './equipmentStatus';

interface Props {
  categories: EquipmentCategory[];
  equipment: CompanyEquipment[];
}

const statusFilters: Array<{ value: CalibrationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos os status' },
  { value: 'expired', label: 'Calibração expirada' },
  { value: 'expiring', label: 'A vencer (30 dias)' },
  { value: 'ok', label: 'Calibrado' },
  { value: 'none', label: 'Sem calibração' }
];

export function EquipmentDashboard({ categories, equipment }: Props) {
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState<CalibrationStatus | 'all'>('all');

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return equipment
      .filter(item => (categoryId === 'all' ? true : item.categoryId === categoryId))
      .filter(item => (status === 'all' ? true : calibrationStatus(item) === status))
      .filter(item => {
        if (!query) return true;
        return [item.code, item.name, categoryById.get(item.categoryId)?.name]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(query));
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [equipment, categoryId, status, search, categoryById]);

  function exportCsv() {
    const header = ['Código', 'Nome', 'Categoria', 'Calibração', 'Vencimento', 'Status'];
    const lines = rows.map(item => [
      item.code,
      item.name,
      categoryById.get(item.categoryId)?.name || '',
      formatDate(item.calibratedAt),
      formatDate(item.expiresAt),
      statusLabel[calibrationStatus(item)]
    ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'equipamentos-calibracao.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Visão geral de calibração</div>
        <button className="mini-btn alt" type="button" onClick={exportCsv}>Exportar CSV</button>
      </div>
      <div className="equip-dashboard-filters">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Buscar por código, nome ou categoria"
          count={{ shown: rows.length, total: equipment.length }}
        />
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          <option value="all">Todas as categorias</option>
          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as CalibrationStatus | 'all')}>
          {statusFilters.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
        </select>
      </div>
      <div className="equip-table-wrap">
        <table className="equip-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Categoria</th>
              <th>Calibração</th>
              <th>Vencimento</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(item => {
              const itemStatus = calibrationStatus(item);
              return (
                <tr key={item.id}>
                  <td data-label="Código">{item.code}</td>
                  <td data-label="Nome">{item.name}</td>
                  <td data-label="Categoria">{categoryById.get(item.categoryId)?.name || '—'}</td>
                  <td data-label="Calibração">{formatDate(item.calibratedAt)}</td>
                  <td data-label="Vencimento">{formatDate(item.expiresAt)}</td>
                  <td data-label="Status">{itemStatus === 'none' ? '—' : <span className={`equip-badge equip-badge-${itemStatus}`}>{statusLabel[itemStatus]}</span>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="rel-meta">Nenhum equipamento encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
