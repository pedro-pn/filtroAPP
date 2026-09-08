import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getOmieCostCategories,
  setOmieCostCategoryAdminOnly,
  setOmieCostCategoryIncluded,
  type OmieCostCategory
} from '../../api/acompanhamentoCusto';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../ui/Button';
import { useToast } from '../ui/ToastContext';

function toNum(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function brl(value: number) {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function categoryName(category: OmieCostCategory) {
  return category.descricao || category.codigo || 'Sem descrição';
}

export function OmieCostCategoriesPanel() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.accountType === 'ADMIN';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'todas' | 'incluidas' | 'ignoradas'>('todas');
  const [showZeroCost, setShowZeroCost] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['omie-cost-categories', user?.accountType ?? 'anonymous'],
    queryFn: getOmieCostCategories
  });

  const invalidateCategoryViews = () => {
    queryClient.invalidateQueries({ queryKey: ['omie-cost-categories'] });
    queryClient.invalidateQueries({ queryKey: ['realized-categories'] });
    queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['project-cards'] });
    queryClient.invalidateQueries({ queryKey: ['project-detail'] });
    queryClient.invalidateQueries({ queryKey: ['sede-costs'] });
  };

  const toggleMutation = useMutation({
    mutationFn: (payload: { codigo: string; includeInAcompanhamentoCosts: boolean }) =>
      setOmieCostCategoryIncluded(payload.codigo, payload.includeInAcompanhamentoCosts),
    onSuccess: () => {
      showToast('Categoria Omie atualizada.');
      invalidateCategoryViews();
    },
    onError: () => showToast('Não foi possível atualizar a categoria Omie.')
  });

  const visibilityMutation = useMutation({
    mutationFn: (payload: { codigo: string; adminOnly: boolean }) =>
      setOmieCostCategoryAdminOnly(payload.codigo, payload.adminOnly),
    onSuccess: category => {
      showToast(category.adminOnly
        ? 'Categoria visível somente para administradores.'
        : 'Categoria liberada para as demais contas.');
      invalidateCategoryViews();
    },
    onError: () => showToast('Não foi possível atualizar a visibilidade da categoria Omie.')
  });

  const categories = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return categories.filter(category => {
      if (!showZeroCost && toNum(category.purchasesTotal) <= 0) return false;
      if (status === 'incluidas' && !category.includeInAcompanhamentoCosts) return false;
      if (status === 'ignoradas' && category.includeInAcompanhamentoCosts) return false;
      if (!term) return true;
      const hay = `${category.codigo} ${category.descricao ?? ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [categories, search, showZeroCost, status]);

  const includedCount = categories.filter(category => category.includeInAcompanhamentoCosts).length;
  const ignoredCount = categories.length - includedCount;
  const zeroCostCount = categories.filter(category => toNum(category.purchasesTotal) <= 0).length;
  const adminOnlyCount = categories.filter(category => category.adminOnly).length;

  if (isLoading) return <div className="page-card placeholder-copy">Carregando categorias Omie…</div>;

  return (
    <div className="page-card">
      <div className="sec">Categorias Omie</div>

      <div className="admin-inline-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 12 }}>
        <div className="field-group">
          <label htmlFor="omie-category-search">Buscar categoria</label>
          <input
            id="omie-category-search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Código ou descrição"
          />
        </div>
        <div className="field-group">
          <label htmlFor="omie-category-status">Status</label>
          <select id="omie-category-status" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
            <option value="todas">Todas</option>
            <option value="incluidas">Incluídas</option>
            <option value="ignoradas">Ignoradas</option>
          </select>
        </div>
        <div className="field-group">
          <label>Resumo</label>
          <div className="det-val" style={{ minHeight: 38 }}>
            {includedCount} incluídas · {ignoredCount} ignoradas
            {isAdmin && adminOnlyCount ? ` · ${adminOnlyCount} só admin` : ''}
          </div>
        </div>
        <div className="field-group">
          <label>Categorias sem custo</label>
          <label className="equip-toggle" style={{ minHeight: 38 }}>
            <input
              type="checkbox"
              checked={showZeroCost}
              onChange={event => setShowZeroCost(event.target.checked)}
            />
            Mostrar R$0,00 ({zeroCostCount})
          </label>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="placeholder-copy" style={{ marginTop: 12 }}>Nenhuma categoria Omie sincronizada.</div>
      ) : (
        <div className="acp-table-wrap" style={{ marginTop: 12 }}>
          <table className="acp-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Categoria</th>
                <th>Compras</th>
                <th>Total</th>
                <th>Cálculo</th>
                {isAdmin ? <th>Visibilidade</th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map(category => {
                const pending = toggleMutation.isPending && toggleMutation.variables?.codigo === category.codigo;
                const visibilityPending = visibilityMutation.isPending
                  && visibilityMutation.variables?.codigo === category.codigo;
                return (
                  <tr key={category.id}>
                    <td data-label="Código">{category.codigo}</td>
                    <td data-label="Categoria">{categoryName(category)}</td>
                    <td data-label="Compras">{category.purchasesCount.toLocaleString('pt-BR')}</td>
                    <td data-label="Total">{brl(toNum(category.purchasesTotal))}</td>
                    <td data-label="Cálculo">
                      <label className="equip-toggle compact">
                        <input
                          type="checkbox"
                          checked={category.includeInAcompanhamentoCosts}
                          disabled={pending}
                          onChange={() => toggleMutation.mutate({
                            codigo: category.codigo,
                            includeInAcompanhamentoCosts: !category.includeInAcompanhamentoCosts
                          })}
                        />
                        {category.includeInAcompanhamentoCosts ? 'Incluída' : 'Ignorada'}
                      </label>
                    </td>
                    {isAdmin ? <td data-label="Visibilidade">
                      <Button
                        variant="mini"
                        disabled={visibilityPending}
                        onClick={() => visibilityMutation.mutate({
                          codigo: category.codigo,
                          adminOnly: !category.adminOnly
                        })}
                      >
                        {visibilityPending
                          ? 'Salvando…'
                          : category.adminOnly ? 'Liberar para todos' : 'Ocultar das demais contas'}
                      </Button>
                      <span className="field-hint" style={{ display: 'block', marginTop: 4 }}>
                        {category.adminOnly ? 'Somente administradores' : 'Todas as contas autorizadas'}
                      </span>
                    </td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? <div className="placeholder-copy" style={{ marginTop: 12 }}>Nenhuma categoria encontrada.</div> : null}
        </div>
      )}
    </div>
  );
}
