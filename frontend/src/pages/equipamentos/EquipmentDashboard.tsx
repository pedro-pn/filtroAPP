import { SortableTable } from '../../components/ui/SortableTable';
import { useMemo, useState } from 'react';

import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { AppIcon } from '../../components/icons/AppIcon';
import { SearchBar } from '../../components/ui/SearchBar';
import { useToast } from '../../components/ui/ToastContext';
import { Badge, Button, Field, Select } from '../../components/ui/ds';
import { DS_ICONS } from '../../components/ui/ds/icons';
import { downloadSpreadsheet } from '../../utils/spreadsheetExport';
import { calibrationStatus, dateInputValue, formatDate, statusLabel, statusTone, type CalibrationStatus } from './equipmentStatus';

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

function spreadsheetStatusLabel(value: CalibrationStatus) {
  return value === 'none' ? 'Sem calibração' : statusLabel[value];
}

export function EquipmentDashboard({ categories, equipment }: Props) {
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState<CalibrationStatus | 'all'>('all');
  const [exportingSheet, setExportingSheet] = useState(false);
  const showToast = useToast();

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

  async function exportSpreadsheet() {
    setExportingSheet(true);
    try {
      const toneByLabel = new Map(
        (Object.keys(statusLabel) as CalibrationStatus[]).map(key => [spreadsheetStatusLabel(key), statusTone[key]])
      );
      await downloadSpreadsheet({
        sheets: [{
          name: 'Calibração',
          title: 'Visão geral de calibração',
          subtitle: 'Equipamentos',
          meta: [
            ['Categoria', categoryId === 'all' ? 'Todas' : categoryById.get(categoryId)?.name],
            ['Calibração', statusFilters.find(filter => filter.value === status)?.label],
            ['Busca', search.trim()]
          ],
          columns: [
            { header: 'Código' },
            { header: 'Nome' },
            { header: 'Categoria' },
            { header: 'Calibração', type: 'date' },
            { header: 'Vencimento', type: 'date' },
            { header: 'Status', tone: value => toneByLabel.get(String(value ?? '')) }
          ],
          rows: rows.map(item => [
            item.code,
            item.name,
            categoryById.get(item.categoryId)?.name || '',
            dateInputValue(item.calibratedAt),
            dateInputValue(item.expiresAt),
            spreadsheetStatusLabel(calibrationStatus(item))
          ]),
          emptyMessage: 'Nenhum equipamento encontrado.'
        }]
      }, 'equipamentos-calibracao.xlsx');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível exportar a planilha.', 'error');
    } finally {
      setExportingSheet(false);
    }
  }

  return (
    <section className="page-card" data-equip-dashboard>
      <div className="admin-toolbar">
        <div className="sec">Visão geral de calibração</div>
        <div className="fv-export-actions">
          <Button variant="secondary" size="sm" onClick={exportCsv}>Exportar CSV</Button>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<AppIcon icon={DS_ICONS.spreadsheet} size="sm" />}
            loading={exportingSheet}
            onClick={() => void exportSpreadsheet()}
          >
            Exportar planilha
          </Button>
        </div>
      </div>
      <div className="equip-dashboard-filters" role="group" aria-labelledby="equip-dashboard-filters-title" data-equip-dashboard-filters>
        <div id="equip-dashboard-filters-title" className="equip-dashboard-filters-title">Filtros do Dashboard</div>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Buscar por código, nome ou categoria"
          count={{ shown: rows.length, total: equipment.length }}
        />
        <Field id="equipment-dashboard-category" label="Categoria">
          <Select id="equipment-dashboard-category" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="all">Todas as categorias</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </Field>
        <Field id="equipment-dashboard-status" label="Calibração">
          <Select id="equipment-dashboard-status" value={status} onChange={e => setStatus(e.target.value as CalibrationStatus | 'all')}>
            {statusFilters.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </Select>
        </Field>
      </div>
      <div className="equip-table-wrap" data-equip-dashboard-table>
        <SortableTable className="equip-table">
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
                  <td data-label="Calibração" data-sort-value={item.calibratedAt}>{formatDate(item.calibratedAt)}</td>
                  <td data-label="Vencimento" data-sort-value={item.expiresAt}>{formatDate(item.expiresAt)}</td>
                  <td data-label="Status">{itemStatus === 'none' ? '—' : <Badge tone={statusTone[itemStatus]} dot multiline>{statusLabel[itemStatus]}</Badge>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="rel-meta">Nenhum equipamento encontrado.</td></tr>
            )}
          </tbody>
        </SortableTable>
      </div>
    </section>
  );
}
