import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getOmieCostCategories,
  setOmieCostCategoryAdminOnly,
  setOmieCostCategoryIncluded,
  type OmieCostCategory
} from '../../api/acompanhamentoCusto';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../ui/ToastContext';
import { Button, Card, DataTable, EmptyState, Field, Input, Select, Skeleton } from '../ui/ds';

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

  if (isLoading) return <Card className="acp-cost-ds__panel"><Skeleton height={180} /></Card>;

  const categoryControls = (category: OmieCostCategory) => {
    const pending = toggleMutation.isPending && toggleMutation.variables?.codigo === category.codigo;
    const visibilityPending = visibilityMutation.isPending
      && visibilityMutation.variables?.codigo === category.codigo;
    return {
      inclusion: (
        <label className="acp-cost-ds__checkbox">
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
      ),
      visibility: isAdmin ? (
        <div className="acp-cost-ds__visibility">
          <Button
            variant="secondary"
            size="sm"
            loading={visibilityPending}
            onClick={() => visibilityMutation.mutate({
              codigo: category.codigo,
              adminOnly: !category.adminOnly
            })}
          >
            {category.adminOnly ? 'Liberar para todos' : 'Ocultar das demais contas'}
          </Button>
          <span>{category.adminOnly ? 'Somente administradores' : 'Todas as contas autorizadas'}</span>
        </div>
      ) : null
    };
  };

  return (
    <Card className="acp-cost-ds__panel" title="Categorias Omie">

      <div className="acp-cost-ds__fields">
        <Field label="Buscar categoria" optionalText="">
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Código ou descrição"
          />
        </Field>
        <Field label="Status" optionalText="">
          <Select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
            <option value="todas">Todas</option>
            <option value="incluidas">Incluídas</option>
            <option value="ignoradas">Ignoradas</option>
          </Select>
        </Field>
        <div className="acp-cost-ds__summary">
          <strong>Resumo</strong>
          <span>
            {includedCount} incluídas · {ignoredCount} ignoradas
            {isAdmin && adminOnlyCount ? ` · ${adminOnlyCount} só admin` : ''}
          </span>
        </div>
        <div className="acp-cost-ds__summary">
          <strong>Categorias sem custo</strong>
          <label className="acp-cost-ds__checkbox">
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
        <EmptyState title="Nenhuma categoria Omie sincronizada" />
      ) : (
        <DataTable
          ariaLabel="Categorias Omie"
          mobileBreakpoint="lg"
          rows={filtered}
          getRowId={category => category.id}
          columns={[
            { key: 'code', header: 'Código', render: category => category.codigo },
            { key: 'name', header: 'Categoria', render: category => categoryName(category) },
            { key: 'count', header: 'Compras', render: category => category.purchasesCount.toLocaleString('pt-BR') },
            { key: 'total', header: 'Total', render: category => brl(toNum(category.purchasesTotal)) },
            { key: 'included', header: 'Cálculo', render: category => categoryControls(category).inclusion },
            ...(isAdmin ? [{ key: 'visibility', header: 'Visibilidade', render: (category: OmieCostCategory) => categoryControls(category).visibility }] : [])
          ]}
          mobile={{ renderItem: category => ({
            title: categoryName(category),
            subtitle: category.codigo,
            value: brl(toNum(category.purchasesTotal)),
            metadata: [{ label: 'Compras', value: category.purchasesCount.toLocaleString('pt-BR') }],
            actions: <div className="acp-cost-ds__mobile-actions">{categoryControls(category).inclusion}{categoryControls(category).visibility}</div>
          }) }}
          emptyState={<EmptyState title="Nenhuma categoria encontrada" />}
        />
      )}
    </Card>
  );
}
