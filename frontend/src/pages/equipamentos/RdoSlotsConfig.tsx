import { BrandLoading } from '../../components/brand/BrandLoading';
import { useMemo, useState } from 'react';

import type { EquipmentCategory, RdoEquipmentSlot } from '../../api/equipamentos';
import { useToast } from '../../components/ui/ToastContext';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { Button, EmptyState } from '../../components/ui/ds';
import { useEquipamentoMutations, useRdoSlots } from '../../hooks/useEquipamentos';

interface Props {
  categories: EquipmentCategory[];
}

const serviceLabels: Record<string, string> = {
  limpeza: 'Limpeza química',
  pressao: 'Teste de pressão',
  flushing: 'Flushing',
  filtragem: 'Filtragem'
};

const dedupe = (ids: string[]) => [...new Set(ids.filter(Boolean))];

export function RdoSlotsConfig({ categories }: Props) {
  const slotsQuery = useRdoSlots();
  const { updateSlot } = useEquipamentoMutations();
  const showToast = useToast();
  // Slots que estão mostrando o seletor extra (para acrescentar mais uma categoria).
  const [adding, setAdding] = useState<Record<string, boolean>>({});

  const slots = slotsQuery.data;
  const grouped = useMemo(() => {
    const map = new Map<string, RdoEquipmentSlot[]>();
    for (const slot of slots || []) {
      const list = map.get(slot.serviceType) || [];
      list.push(slot);
      map.set(slot.serviceType, list);
    }
    return Array.from(map.entries());
  }, [slots]);

  function save(slot: RdoEquipmentSlot, categoryIds: string[], secondary: boolean) {
    updateSlot.mutate(
      { slotKey: slot.key, categoryIds: secondary ? slot.categoryIds : dedupe(categoryIds),
        secondaryCategoryIds: secondary ? dedupe(categoryIds) : (slot.secondaryCategoryIds || []) },
      {
        onSuccess: () => showToast('Vínculo atualizado.', 'success'),
        onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
      }
    );
  }

  // Troca/remove a categoria de uma posição (valor vazio remove).
  function setAt(slot: RdoEquipmentSlot, index: number, value: string, secondary: boolean) {
    const next = [...(secondary ? slot.secondaryCategoryIds || [] : slot.categoryIds)];
    if (!value) next.splice(index, 1);
    else next[index] = value;
    save(slot, next, secondary);
  }

  // Acrescenta uma categoria nova (a partir do seletor extra).
  function addAt(slot: RdoEquipmentSlot, value: string, secondary: boolean) {
    if (!value) return;
    setAdding(prev => ({ ...prev, [`${slot.key}:${secondary}`]: false }));
    save(slot, [...(secondary ? slot.secondaryCategoryIds || [] : slot.categoryIds), value], secondary);
  }

  // Opções de um seletor: exclui categorias já usadas em outras posições do mesmo slot.
  function optionsFor(slot: RdoEquipmentSlot, currentId?: string) {
    const used = [...slot.categoryIds, ...(slot.secondaryCategoryIds || [])];
    return categories.filter(c => c.isActive !== false && (c.id === currentId || !used.includes(c.id)));
  }

  function categoryGroup(slot: RdoEquipmentSlot, secondary: boolean) {
    const ids = secondary ? slot.secondaryCategoryIds || [] : slot.categoryIds;
    const key = `${slot.key}:${secondary}`;
    const label = secondary ? 'secundária' : 'principal';
    const options = optionsFor(slot);
    return <div className="equip-slot-category-group" key={key}>
      <span className="equip-slot-category-label">{secondary ? 'Categorias secundárias' : 'Categorias principais'}</span>
      {ids.map((id, index) => <div className="equip-slot-cat" key={`${key}-${index}`}>
        <select aria-label={`${slot.label}: categoria ${label} ${index + 1}`} value={id} disabled={updateSlot.isPending}
          onChange={event => setAt(slot, index, event.target.value, secondary)}>
          {optionsFor(slot, id).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <RemoveIconButton type="button" label={`Remover categoria ${label} ${index + 1} de ${slot.label}`} disabled={updateSlot.isPending}
          onClick={() => setAt(slot, index, '', secondary)} />
      </div>)}
      {adding[key] ? <select aria-label={`Adicionar categoria ${label} em ${slot.label}`} value="" autoFocus disabled={updateSlot.isPending}
        onChange={event => addAt(slot, event.target.value, secondary)}>
        <option value="">— Selecione —</option>
        {options.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select> : options.length ? <Button variant="secondary" size="sm" type="button" className="equip-slot-add" disabled={updateSlot.isPending}
        onClick={() => setAdding(previous => ({ ...previous, [key]: true }))}>Adicionar categoria {label}</Button> : null}
    </div>;
  }

  return (
    <section className="page-card equip-rdo-slots-config">
      <div className="admin-toolbar">
        <div className="sec">Vínculo com relatórios</div>
      </div>
      <p className="rel-meta equip-slots-hint">
        Os equipamentos das categorias principais aparecem misturados na lista inicial de cada serviço.
        Adicione categorias secundárias para liberar outras opções no relatório.
        Durante o preenchimento, é possível escolher uma ou mais categorias e misturar seus equipamentos.
      </p>

      {slotsQuery.isLoading && <p className="rel-meta"><BrandLoading label="Carregando" inline size="sm" /></p>}
      {slotsQuery.isError ? <EmptyState variant="error" title="Não foi possível carregar os vínculos" action={{ label: 'Tentar novamente', onClick: () => void slotsQuery.refetch() }} /> : null}
      {!slotsQuery.isLoading && !slotsQuery.isError && grouped.length === 0 ? <EmptyState title="Nenhum vínculo de relatório disponível" description="Os pontos do formulário aparecerão aqui quando forem configurados." /> : null}

      {grouped.map(([serviceType, slots]) => (
        <div className="equip-slots-group" key={serviceType}>
          <h4 className="equip-slots-service">{serviceLabels[serviceType] || serviceType}</h4>
          <div className="equip-slots-list">
            {(slots || []).map(slot => <div className="equip-slot-row" key={slot.key}>
              <span className="equip-slot-name">{slot.label.split('·').slice(1).join('·').trim() || slot.label}</span>
              {categoryGroup(slot, false)}
              {categoryGroup(slot, true)}
            </div>)}
          </div>
        </div>
      ))}
    </section>
  );
}
