import { useMemo, useState } from 'react';

import type { EquipmentCategory, RdoEquipmentSlot } from '../../api/equipamentos';
import { useToast } from '../../components/ui/ToastContext';
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

  function save(slotKey: string, categoryIds: string[]) {
    updateSlot.mutate(
      { slotKey, categoryIds: dedupe(categoryIds) },
      {
        onSuccess: () => showToast('Vínculo atualizado.', 'success'),
        onError: error => showToast(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
      }
    );
  }

  // Troca/remove a categoria de uma posição (valor vazio remove).
  function setAt(slot: RdoEquipmentSlot, index: number, value: string) {
    const next = [...slot.categoryIds];
    if (!value) next.splice(index, 1);
    else next[index] = value;
    save(slot.key, next);
  }

  // Acrescenta uma categoria nova (a partir do seletor extra).
  function addAt(slot: RdoEquipmentSlot, value: string) {
    setAdding(prev => ({ ...prev, [slot.key]: false }));
    if (value) save(slot.key, [...slot.categoryIds, value]);
  }

  // Opções de um seletor: exclui categorias já usadas em outras posições do mesmo slot.
  function optionsFor(slot: RdoEquipmentSlot, currentId?: string) {
    return categories.filter(c => c.id === currentId || !slot.categoryIds.includes(c.id));
  }

  return (
    <section className="page-card">
      <div className="admin-toolbar">
        <div className="sec">Vínculo com relatórios (RDO)</div>
      </div>
      <p className="rel-meta equip-slots-hint">
        Defina qual categoria de equipamento alimenta cada ponto do formulário de relatório.
        Use “+ Adicionar categoria” para associar mais de uma — os equipamentos de todas elas
        aparecem numa lista só no preenchimento. Assim é possível editar/renomear as categorias
        sem perder o vínculo com o RDO.
      </p>

      {slotsQuery.isLoading && <p className="rel-meta">Carregando…</p>}

      {grouped.map(([serviceType, slots]) => (
        <div className="equip-slots-group" key={serviceType}>
          <h4 className="equip-slots-service">{serviceLabels[serviceType] || serviceType}</h4>
          <div className="equip-slots-list">
            {(slots || []).map(slot => {
              const canAddMore = !adding[slot.key] && slot.categoryIds.length < categories.length;
              return (
                <div className="equip-slot-row" key={slot.key}>
                  <span className="equip-slot-name">{slot.label.split('·').slice(1).join('·').trim() || slot.label}</span>

                  {slot.categoryIds.map((categoryId, index) => (
                    <div className="equip-slot-cat" key={`${slot.key}-${index}`}>
                      <select
                        value={categoryId}
                        disabled={updateSlot.isPending}
                        onChange={e => setAt(slot, index, e.target.value)}
                      >
                        {optionsFor(slot, categoryId).map(category => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="equip-slot-x"
                        aria-label="Remover categoria"
                        title="Remover categoria"
                        disabled={updateSlot.isPending}
                        onClick={() => setAt(slot, index, '')}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {slot.categoryIds.length === 0 && !adding[slot.key] && (
                    <select
                      value=""
                      disabled={updateSlot.isPending}
                      onChange={e => setAt(slot, 0, e.target.value)}
                    >
                      <option value="">— Não usar —</option>
                      {optionsFor(slot).map(category => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  )}

                  {adding[slot.key] && (
                    <select
                      value=""
                      autoFocus
                      disabled={updateSlot.isPending}
                      onChange={e => addAt(slot, e.target.value)}
                    >
                      <option value="">— Selecione —</option>
                      {optionsFor(slot).map(category => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  )}

                  {canAddMore && slot.categoryIds.length > 0 && (
                    <button
                      type="button"
                      className="mini-btn alt equip-slot-add"
                      onClick={() => setAdding(prev => ({ ...prev, [slot.key]: true }))}
                    >
                      + Adicionar categoria
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
