import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';

import {
  createMaintenanceProfile,
  getEquipmentMaintenanceConfig,
  removeMaintenanceProfile,
  updateEquipamento,
  updateEquipmentCategory,
  updateEquipmentMaintenanceSupervisor,
  updateMaintenanceProfile,
  type CompanyEquipment,
  type EquipmentCategory,
  type MaintenanceProfilePayload
} from '../../api/equipamentos';
import type { MaintenanceProfileSummary } from '../../api/operationalReports';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { SearchBar } from '../../components/ui/SearchBar';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/ToastContext';
import {
  maintenanceCategoryIntervalFormSchema,
  maintenanceProfileFormSchema,
  type MaintenanceCategoryIntervalFormValues,
  type MaintenanceProfileFormValues
} from '../../schemas/operationalReport';

interface MaintenanceConfigPanelProps {
  equipment: CompanyEquipment[];
  categories: EquipmentCategory[];
}

const emptyProfile: MaintenanceProfileFormValues = {
  name: '',
  isActive: true,
  items: [{ label: '', order: 1, isActive: true }]
};

function formFromProfile(
  profile: MaintenanceProfileSummary
): MaintenanceProfileFormValues {
  return {
    name: profile.name,
    isActive: profile.isActive !== false,
    items: profile.items.map((item, index) => ({
      id: item.id,
      label: item.label,
      order: index + 1,
      isActive: item.isActive !== false
    }))
  };
}

function CategoryMaintenanceSettings({
  category,
  equipmentCount,
  profiles,
  profilePending,
  intervalPending,
  onProfileChange,
  onIntervalSave
}: {
  category: EquipmentCategory;
  equipmentCount: number;
  profiles: MaintenanceProfileSummary[];
  profilePending: boolean;
  intervalPending: boolean;
  onProfileChange: (maintenanceProfileId: string | null) => void;
  onIntervalSave: (maintenanceIntervalDays: number | null) => void;
}) {
  const intervalForm = useForm<MaintenanceCategoryIntervalFormValues>({
    resolver: zodResolver(maintenanceCategoryIntervalFormSchema),
    defaultValues: {
      maintenanceIntervalDays: category.maintenanceIntervalDays
        ? String(category.maintenanceIntervalDays)
        : ''
    },
    mode: 'onTouched'
  });

  useEffect(() => {
    intervalForm.reset({
      maintenanceIntervalDays: category.maintenanceIntervalDays
        ? String(category.maintenanceIntervalDays)
        : ''
    });
  }, [category.maintenanceIntervalDays, intervalForm]);

  function saveInterval(values: MaintenanceCategoryIntervalFormValues) {
    onIntervalSave(
      values.maintenanceIntervalDays
        ? Number(values.maintenanceIntervalDays)
        : null
    );
  }

  const intervalError = intervalForm.formState.errors.maintenanceIntervalDays;

  return (
    <article className="operational-category-maintenance-row">
      <div className="operational-category-maintenance-summary">
        <strong>{category.name}</strong>
        <div className="form-hint">{equipmentCount} equipamento(s)</div>
      </div>
      <div className="operational-category-maintenance-controls">
        <div className="field-group">
          <label htmlFor={`category-profile-${category.id}`}>
            Perfil padrão
          </label>
          <select
            id={`category-profile-${category.id}`}
            value={category.maintenanceProfileId || ''}
            disabled={profilePending}
            onChange={(event) => onProfileChange(event.target.value || null)}
          >
            <option value="">Sem perfil padrão</option>
            {profiles.map((profile) => (
              <option
                key={profile.id}
                value={profile.id}
                disabled={profile.isActive === false}
              >
                {profile.name}
                {profile.isActive === false ? ' (inativo)' : ''}
              </option>
            ))}
          </select>
        </div>
        <form
          className="operational-category-interval-form"
          onSubmit={intervalForm.handleSubmit(saveInterval)}
        >
          <div
            className={`field-group ${intervalError ? 'field-invalid' : ''}`}
          >
            <label htmlFor={`category-interval-${category.id}`}>
              Intervalo preventivo (dias)
            </label>
            <input
              id={`category-interval-${category.id}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              placeholder="Não configurado"
              aria-invalid={Boolean(intervalError)}
              {...intervalForm.register('maintenanceIntervalDays')}
            />
            {intervalError ? (
              <div className="field-error">{intervalError.message}</div>
            ) : null}
          </div>
          <Button type="submit" variant="mini" disabled={intervalPending}>
            {intervalPending ? 'Salvando…' : 'Salvar prazo'}
          </Button>
        </form>
      </div>
    </article>
  );
}

export function MaintenanceConfigPanel({
  equipment,
  categories
}: MaintenanceConfigPanelProps) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [supervisorId, setSupervisorId] = useState('');
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [deleteProfile, setDeleteProfile] =
    useState<MaintenanceProfileSummary | null>(null);
  const profileForm = useForm<MaintenanceProfileFormValues>({
    resolver: zodResolver(maintenanceProfileFormSchema),
    defaultValues: emptyProfile,
    mode: 'onTouched'
  });
  const profileItemFields = useFieldArray({
    control: profileForm.control,
    name: 'items',
    keyName: 'formKey'
  });
  const configQuery = useQuery({
    queryKey: ['equipamentos', 'maintenance-config'],
    queryFn: getEquipmentMaintenanceConfig
  });

  useEffect(() => {
    if (configQuery.data) setSupervisorId(configQuery.data.supervisor.id || '');
  }, [configQuery.data]);

  useEffect(() => {
    const profileId = searchParams.get('perfil');
    if (!profileId || !configQuery.data) return;
    if (profileId === 'novo') {
      setEditingProfileId(null);
      profileForm.reset(emptyProfile);
      setProfileModalOpen(true);
      return;
    }
    const profile = configQuery.data.profiles.find(
      (item) => item.id === profileId
    );
    if (profile) {
      setEditingProfileId(profile.id);
      profileForm.reset(formFromProfile(profile));
      setProfileModalOpen(true);
    }
  }, [configQuery.data, profileForm, searchParams]);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['equipamentos'] }),
      queryClient.invalidateQueries({
        queryKey: ['operational-reports', 'context']
      })
    ]);
  const supervisorMutation = useMutation({
    mutationFn: () =>
      updateEquipmentMaintenanceSupervisor(supervisorId || null),
    onSuccess: () => {
      void invalidate();
      showToast('Supervisor da manutenção atualizado.', 'success');
    },
    onError: (error) =>
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o supervisor.',
        'error'
      )
  });
  const profileMutation = useMutation({
    mutationFn: ({
      id,
      payload
    }: {
      id: string | null;
      payload: MaintenanceProfilePayload;
    }) =>
      id
        ? updateMaintenanceProfile(id, payload)
        : createMaintenanceProfile(payload),
    onSuccess: () => {
      void invalidate();
      closeProfile();
      showToast('Perfil de manutenção salvo.', 'success');
    },
    onError: (error) =>
      profileForm.setError('root', {
        type: 'server',
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível salvar o perfil.'
      })
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeMaintenanceProfile(id),
    onSuccess: () => {
      void invalidate();
      setDeleteProfile(null);
      showToast('Perfil desativado ou removido.', 'success');
    },
    onError: (error) =>
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível remover o perfil.',
        'error'
      )
  });
  const associationMutation = useMutation({
    mutationFn: ({
      id,
      maintenanceProfileId,
      maintenanceProfileOverride
    }: {
      id: string;
      maintenanceProfileId: string | null;
      maintenanceProfileOverride: boolean;
    }) =>
      updateEquipamento(id, {
        maintenanceProfileId,
        maintenanceProfileOverride
      }),
    onSuccess: () => {
      void invalidate();
      showToast('Perfil do equipamento atualizado.', 'success');
    },
    onError: (error) =>
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível associar o perfil.',
        'error'
      )
  });
  const categoryAssociationMutation = useMutation({
    mutationFn: ({
      id,
      maintenanceProfileId
    }: {
      id: string;
      maintenanceProfileId: string | null;
    }) => updateEquipmentCategory(id, { maintenanceProfileId }),
    onSuccess: () => {
      void invalidate();
      showToast('Perfil padrão da categoria atualizado.', 'success');
    },
    onError: (error) =>
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível atualizar a categoria.',
        'error'
      )
  });
  const categoryIntervalMutation = useMutation({
    mutationFn: ({
      id,
      maintenanceIntervalDays
    }: {
      id: string;
      maintenanceIntervalDays: number | null;
    }) => updateEquipmentCategory(id, { maintenanceIntervalDays }),
    onSuccess: () => {
      void Promise.all([
        invalidate(),
        queryClient.invalidateQueries({
          queryKey: ['operational-reports', 'maintenance-schedule']
        })
      ]);
      showToast('Prazo preventivo da categoria atualizado.', 'success');
    },
    onError: (error) =>
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível atualizar o prazo da categoria.',
        'error'
      )
  });
  const profileOrderMutation = useMutation({
    mutationFn: async ({
      index,
      direction
    }: {
      index: number;
      direction: -1 | 1;
    }) => {
      const profiles = configQuery.data?.profiles || [];
      const target = index + direction;
      if (!profiles[index] || !profiles[target]) return;
      const current = profiles[index];
      const other = profiles[target];
      await Promise.all([
        updateMaintenanceProfile(current.id, {
          name: current.name,
          isActive: current.isActive !== false,
          order: other.order ?? target,
          items: current.items.map((item, itemIndex) => ({
            id: item.id,
            label: item.label,
            order: itemIndex + 1,
            isActive: item.isActive !== false
          }))
        }),
        updateMaintenanceProfile(other.id, {
          name: other.name,
          isActive: other.isActive !== false,
          order: current.order ?? index,
          items: other.items.map((item, itemIndex) => ({
            id: item.id,
            label: item.label,
            order: itemIndex + 1,
            isActive: item.isActive !== false
          }))
        })
      ]);
    },
    onSuccess: () => void invalidate(),
    onError: (error) =>
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível reordenar os perfis.',
        'error'
      )
  });

  const maintenanceCategories = useMemo(
    () => categories.filter((category) => category.showInMaintenance !== false),
    [categories]
  );
  const maintenanceCategoryIds = useMemo(
    () => new Set(maintenanceCategories.map((category) => category.id)),
    [maintenanceCategories]
  );
  const maintenanceEquipment = useMemo(
    () => equipment.filter((item) => maintenanceCategoryIds.has(item.categoryId)),
    [equipment, maintenanceCategoryIds]
  );
  const filteredEquipment = useMemo(() => {
    const query = equipmentSearch.trim().toLocaleLowerCase('pt-BR');
    return maintenanceEquipment.filter(
      (item) =>
        !query ||
        `${item.code} ${item.name} ${maintenanceCategories.find((category) => category.id === item.categoryId)?.name || ''}`
          .toLocaleLowerCase('pt-BR')
          .includes(query)
    );
  }, [equipmentSearch, maintenanceCategories, maintenanceEquipment]);

  function openProfile(profile?: MaintenanceProfileSummary) {
    setEditingProfileId(profile?.id || null);
    profileForm.reset(profile ? formFromProfile(profile) : emptyProfile);
    setProfileModalOpen(true);
    const next = new URLSearchParams(searchParams);
    if (profile) next.set('perfil', profile.id);
    else next.set('perfil', 'novo');
    setSearchParams(next, { replace: true });
  }

  function closeProfile() {
    setProfileModalOpen(false);
    setEditingProfileId(null);
    profileForm.clearErrors();
    const next = new URLSearchParams(searchParams);
    next.delete('perfil');
    setSearchParams(next, { replace: true });
  }

  function saveProfile(values: MaintenanceProfileFormValues) {
    profileMutation.mutate({
      id: editingProfileId,
      payload: {
        name: values.name.trim(),
        isActive: values.isActive,
        items: values.items.map((item, index) => ({
          ...item,
          label: item.label.trim(),
          order: index + 1
        }))
      }
    });
  }

  if (configQuery.isLoading)
    return (
      <section className="page-card">
        <Skeleton lines={5} />
      </section>
    );
  if (configQuery.isError || !configQuery.data)
    return (
      <div className="inline-error">
        Não foi possível carregar a configuração de manutenção.
      </div>
    );
  const config = configQuery.data;
  const profilesById = new Map(
    config.profiles.map((profile) => [profile.id, profile])
  );
  const categoriesById = new Map(
    maintenanceCategories.map((category) => [category.id, category])
  );

  return (
    <div className="operational-config-stack">
      <section className="page-card">
        <div className="section-title">Supervisor global da manutenção</div>
        <p className="placeholder-copy">
          O nome e a assinatura deste supervisor serão usados em todos os
          documentos aprovados, inclusive quando um administrador fizer a
          aprovação.
        </p>
        <div
          className={`field-group ${supervisorId && !config.supervisor.valid ? 'field-invalid' : ''}`}
        >
          <label htmlFor="maintenance-supervisor">Supervisor</label>
          <select
            id="maintenance-supervisor"
            value={supervisorId}
            aria-invalid={Boolean(supervisorId && !config.supervisor.valid)}
            onChange={(event) => setSupervisorId(event.target.value)}
          >
            <option value="">Não configurado</option>
            {config.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code} — {candidate.name}
              </option>
            ))}
          </select>
          {!config.supervisor.valid ? (
            <div className="field-error">{config.supervisor.reason}</div>
          ) : null}
        </div>
        <div className="admin-form-actions equip-form-actions">
          <Button
            disabled={supervisorMutation.isPending}
            onClick={() => supervisorMutation.mutate()}
          >
            {supervisorMutation.isPending ? 'Salvando…' : 'Salvar supervisor'}
          </Button>
        </div>
      </section>

      <section className="page-card">
        <div className="operational-card-head">
          <div>
            <div className="section-title">Perfis de manutenção</div>
            <div className="form-hint">
              Os serviços ficam editáveis e sua ordem define a numeração no
              documento.
            </div>
          </div>
          <Button variant="mini" onClick={() => openProfile()}>
            Novo perfil
          </Button>
        </div>
        <div className="operational-profile-grid">
          {config.profiles.map((profile, index) => (
            <article className="operational-profile-card" key={profile.id}>
              <div>
                <strong>{profile.name}</strong>
                <div className="form-hint">
                  {profile.items.length} serviço(s) ·{' '}
                  {profile.isActive === false ? 'Inativo' : 'Ativo'}
                </div>
              </div>
              <div className="admin-actions">
                <Button
                  variant="mini"
                  disabled={index === 0 || profileOrderMutation.isPending}
                  aria-label={`Mover ${profile.name} para cima`}
                  onClick={() =>
                    profileOrderMutation.mutate({ index, direction: -1 })
                  }
                >
                  ↑
                </Button>
                <Button
                  variant="mini"
                  disabled={
                    index === config.profiles.length - 1 ||
                    profileOrderMutation.isPending
                  }
                  aria-label={`Mover ${profile.name} para baixo`}
                  onClick={() =>
                    profileOrderMutation.mutate({ index, direction: 1 })
                  }
                >
                  ↓
                </Button>
                <Button variant="mini" onClick={() => openProfile(profile)}>
                  Editar
                </Button>
                <Button
                  variant="mini"
                  className="danger"
                  onClick={() => setDeleteProfile(profile)}
                >
                  Remover
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="page-card">
        <div className="section-title">Perfil padrão por categoria</div>
        <p className="placeholder-copy">
          O perfil escolhido passa a valer automaticamente para todos os
          equipamentos da categoria que não possuem uma exceção individual.
        </p>
        <div className="operational-category-maintenance-list">
          {maintenanceCategories.map((category) => (
            <CategoryMaintenanceSettings
              key={category.id}
              category={category}
              equipmentCount={
                equipment.filter((item) => item.categoryId === category.id)
                  .length
              }
              profiles={config.profiles}
              profilePending={
                categoryAssociationMutation.isPending &&
                categoryAssociationMutation.variables?.id === category.id
              }
              intervalPending={
                categoryIntervalMutation.isPending &&
                categoryIntervalMutation.variables?.id === category.id
              }
              onProfileChange={(maintenanceProfileId) =>
                categoryAssociationMutation.mutate({
                  id: category.id,
                  maintenanceProfileId
                })
              }
              onIntervalSave={(maintenanceIntervalDays) =>
                categoryIntervalMutation.mutate({
                  id: category.id,
                  maintenanceIntervalDays
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="page-card">
        <div className="section-title">Exceções por equipamento</div>
        <p className="placeholder-copy">
          Por padrão, cada equipamento herda o perfil de sua categoria. Altere
          somente os equipamentos que precisam de outro perfil ou não devem ter
          manutenção.
        </p>
        <SearchBar
          value={equipmentSearch}
          onChange={setEquipmentSearch}
          placeholder="Buscar equipamento ou categoria"
          count={{ shown: filteredEquipment.length, total: maintenanceEquipment.length }}
        />
        <div className="operational-equipment-profile-list">
          {filteredEquipment.map((item) => {
            const category = categoriesById.get(item.categoryId);
            const inheritedProfile = category?.maintenanceProfileId
              ? profilesById.get(category.maintenanceProfileId)
              : null;
            const value = item.maintenanceProfileOverride
              ? item.maintenanceProfileId
                ? `profile:${item.maintenanceProfileId}`
                : 'none'
              : 'inherit';
            return (
              <div key={item.id}>
                <div>
                  <label htmlFor={`equipment-profile-${item.id}`}>
                    <strong>{item.code}</strong> — {item.name}
                  </label>
                  <div className="form-hint">
                    {category?.name || 'Categoria não encontrada'}
                  </div>
                </div>
                <select
                  id={`equipment-profile-${item.id}`}
                  value={value}
                  disabled={associationMutation.isPending}
                  onChange={(event) => {
                    const next = event.target.value;
                    associationMutation.mutate({
                      id: item.id,
                      maintenanceProfileOverride: next !== 'inherit',
                      maintenanceProfileId: next.startsWith('profile:')
                        ? next.slice('profile:'.length)
                        : null
                    });
                  }}
                >
                  <option value="inherit">
                    Usar padrão da categoria —{' '}
                    {inheritedProfile?.name || 'sem perfil'}
                  </option>
                  <option value="none">Exceção: sem perfil</option>
                  {config.profiles.map((profile) => (
                    <option
                      key={profile.id}
                      value={`profile:${profile.id}`}
                      disabled={profile.isActive === false}
                    >
                      Exceção: {profile.name}
                      {profile.isActive === false ? ' (inativo)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      <Modal
        open={profileModalOpen}
        onClose={closeProfile}
        ariaLabelledBy="maintenance-profile-title"
        panelClassName="modal-card equip-modal"
      >
        {profileModalOpen ? (
          <form
            className="equip-form"
            onSubmit={profileForm.handleSubmit(saveProfile)}
          >
            <button
              className="equip-modal-close-float icon-button"
              type="button"
              aria-label="Fechar perfil de manutenção"
              title="Fechar"
              onClick={closeProfile}
              disabled={profileMutation.isPending}
            >
              ×
            </button>
            <header className="equip-form-head has-float-close">
              <h3 id="maintenance-profile-title">
                {editingProfileId ? 'Editar perfil' : 'Novo perfil'}
              </h3>
              <span className="equip-form-sub">Manutenção</span>
            </header>
            <div
              className={`field-group ${profileForm.formState.errors.name ? 'field-invalid' : ''}`}
            >
              <label htmlFor="maintenance-profile-name">Nome</label>
              <input
                id="maintenance-profile-name"
                aria-invalid={Boolean(profileForm.formState.errors.name)}
                {...profileForm.register('name')}
              />
              {profileForm.formState.errors.name ? (
                <div className="field-error">
                  {profileForm.formState.errors.name.message}
                </div>
              ) : null}
            </div>
            <div className="equip-toggle-block">
              <label className="equip-toggle">
                <input
                  type="checkbox"
                  {...profileForm.register('isActive')}
                />
                <span>Perfil ativo</span>
              </label>
            </div>
            <div className="field-group">
              <label>Checklist de serviços</label>
              <div className="form-hint">
                A ordem abaixo define a numeração exibida no documento.
              </div>
              <div className="operational-profile-items">
                {profileItemFields.fields.map((item, index) => {
                  const itemError = profileForm.formState.errors.items?.[index];
                  return (
                    <div className="operational-profile-item" key={item.formKey}>
                      <input
                        type="hidden"
                        {...profileForm.register(`items.${index}.id`)}
                      />
                      <input
                        type="hidden"
                        value={index + 1}
                        {...profileForm.register(`items.${index}.order`, {
                          valueAsNumber: true
                        })}
                      />
                      <div
                        className={`field-group ${itemError?.label ? 'field-invalid' : ''}`}
                      >
                        <label htmlFor={`maintenance-profile-item-${index}`}>
                          Serviço {index + 1}
                        </label>
                        <input
                          id={`maintenance-profile-item-${index}`}
                          aria-invalid={Boolean(itemError?.label)}
                          placeholder="Nome do serviço"
                          {...profileForm.register(`items.${index}.label`)}
                        />
                        {itemError?.label ? (
                          <div className="field-error">
                            {itemError.label.message}
                          </div>
                        ) : null}
                      </div>
                      <label className="equip-toggle operational-profile-item-active">
                        <input
                          type="checkbox"
                          {...profileForm.register(`items.${index}.isActive`)}
                        />
                        <span>Ativo</span>
                      </label>
                      <div className="admin-actions">
                        <Button
                          variant="mini"
                          disabled={index === 0}
                          aria-label={`Mover serviço ${index + 1} para cima`}
                          onClick={() => profileItemFields.move(index, index - 1)}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="mini"
                          disabled={index === profileItemFields.fields.length - 1}
                          aria-label={`Mover serviço ${index + 1} para baixo`}
                          onClick={() => profileItemFields.move(index, index + 1)}
                        >
                          ↓
                        </Button>
                        {!item.id ? (
                          <Button
                            variant="mini"
                            className="danger"
                            disabled={profileItemFields.fields.length === 1}
                            onClick={() => profileItemFields.remove(index)}
                          >
                            Remover
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <Button
                  variant="secondary"
                  onClick={() =>
                    profileItemFields.append({
                      label: '',
                      order: profileItemFields.fields.length + 1,
                      isActive: true
                    })
                  }
                >
                  Adicionar serviço
                </Button>
              </div>
              {typeof profileForm.formState.errors.items?.message === 'string' ? (
                <div className="field-error">
                  {profileForm.formState.errors.items.message}
                </div>
              ) : null}
            </div>
            {profileForm.formState.errors.root?.message ? (
              <div className="inline-error">
                {profileForm.formState.errors.root.message}
              </div>
            ) : null}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeProfile}>
                Cancelar
              </Button>
              <Button type="submit" disabled={profileMutation.isPending}>
                {profileMutation.isPending ? 'Salvando…' : 'Salvar perfil'}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteProfile)}
        title="Remover perfil de manutenção?"
        description="Perfis já usados serão desativados para preservar o histórico."
        highlight={deleteProfile?.name}
        confirmLabel="Remover"
        onCancel={() => setDeleteProfile(null)}
        onConfirm={() =>
          deleteProfile && deleteMutation.mutate(deleteProfile.id)
        }
      />
    </div>
  );
}
