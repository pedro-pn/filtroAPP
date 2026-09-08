import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  FormProvider,
  useFieldArray,
  useForm,
  useFormContext,
  useWatch
} from 'react-hook-form';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import {
  createOperationalReport,
  createStandaloneMaintenance,
  getOperationalContext,
  getOperationalReport,
  getStandaloneMaintenance,
  updateOperationalReport,
  updateOperationalReportStatus,
  updateStandaloneMaintenance,
  updateStandaloneMaintenanceStatus,
  type MaintenanceEquipment,
  type MaintenanceAttachment,
  type MaintenancePhotoPayload,
  type MaintenanceRecord,
  type OperationalReport,
  type OperationalStatus
} from '../../api/operationalReports';
import { accountPageStateFromPath } from '../../auth/moduleNavigation';
import {
  canAccessReportSelection,
  type ReportSelection
} from '../../auth/reportPermissions';
import { useAuth } from '../../auth/AuthContext';
import {
  ReportActivitiesCard,
  ReportCollaboratorsCard,
  ReportDateField,
  ReportFormActions,
  ReportFormStepper,
  ReportNightShiftFields,
  ReportOvertimeCard,
  ReportScheduleCard,
  ReportSummaryCard,
  RequiredMark
} from '../../components/reports/ReportCoreFields';
import { Button } from '../../components/ui/Button';
import { PdfDropzone } from '../../components/ui/PdfDropzone';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { useToast } from '../../components/ui/ToastContext';
import { UploadPreviewListItem } from '../../components/ui/UploadField';
import { useReportWorkforceAvailability } from '../../hooks/useReportWorkforcePlanning';
import { Shell } from '../../layout/Shell';
import { TopBar } from '../../layout/TopBar';
import {
  operationalReportFormSchema,
  standaloneOperationalReportFormSchema,
  standaloneMaintenanceFormSchema,
  type OperationalReportFormValues
} from '../../schemas/operationalReport';
import { calculateReportOvertimeSummary } from '../../utils/reportOvertime';

interface OperationalReportFormPageProps {
  mode: Extract<
    ReportSelection,
    'manutencao' | 'producao' | 'manutencao-avulsa'
  >;
}

type ReviewMutationAction = 'SAVE' | Extract<
  OperationalStatus,
  'APPROVED' | 'RETURNED'
>;

function operationalModuleReturnPath(mode: OperationalReportFormPageProps['mode']) {
  const tab = mode === 'producao' ? 'producao' : 'manutencao';
  return `/manutencao-producao?tab=${tab}`;
}

const materialOptions = [
  { value: 'CARBON_STEEL', label: 'Aço carbono' },
  { value: 'STAINLESS_STEEL', label: 'Inox' },
  { value: 'CUNIFE', label: 'CuNiFe' },
  { value: 'OTHER', label: 'Outros' }
] as const;

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function emptyMaintenance() {
  return {
    equipmentId: '',
    selectedServiceIds: [],
    observations: '',
    thirdPartyServices: [],
    photos: [],
    removePhotoIds: []
  };
}

function emptyChemicalCleaning() {
  return {
    description: '',
    material: 'CARBON_STEEL' as const,
    otherMaterial: '',
    quantityKg: 0
  };
}

function defaultValues(
  kind: 'MAINTENANCE' | 'PRODUCTION'
): OperationalReportFormValues {
  return {
    kind,
    reportDate: localDate(),
    arrivalTime: '',
    departureTime: '',
    lunchBreak: '01:00:00',
    collaboratorIds: [],
    nightShift: {
      enabled: false,
      arrivalTime: '',
      departureTime: '',
      breakTime: '01:00:00',
      collaboratorIds: []
    },
    overtimeReason: '',
    dailyDescription: '',
    maintenanceRecords: kind === 'MAINTENANCE' ? [emptyMaintenance()] : [],
    chemicalCleanings: kind === 'PRODUCTION' ? [emptyChemicalCleaning()] : []
  };
}

async function filesToUploads(
  files: FileList | File[] | null
): Promise<MaintenancePhotoPayload[]> {
  if (!files?.length) return [];
  return Promise.all(
    Array.from(files).map(
      (file) =>
        new Promise<MaintenancePhotoPayload>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              dataUrl: String(reader.result || '')
            });
          reader.onerror = () =>
            reject(new Error(`Não foi possível ler ${file.name}.`));
          reader.readAsDataURL(file);
        })
    )
  );
}

function equipmentAttributeText(value: unknown, type?: string) {
  if (value === undefined || value === null || value === '') return '—';
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return String(value).split('-').reverse().join('/');
  }
  if (Array.isArray(value)) return value.join(', ') || '—';
  return String(value);
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Não foi possível salvar o relatório.';
}

function MaintenanceCardEditor({
  index,
  equipment,
  existingPhotosByRecord
}: {
  index: number;
  equipment: MaintenanceEquipment[];
  existingPhotosByRecord: Record<string, MaintenanceAttachment[]>;
}) {
  const {
    clearErrors,
    control,
    register,
    setValue,
    formState: { errors }
  } = useFormContext<OperationalReportFormValues>();
  const [equipmentCategoryId, setEquipmentCategoryId] = useState('');
  const equipmentId = useWatch({
    control,
    name: `maintenanceRecords.${index}.equipmentId`
  });
  const recordId = useWatch({
    control,
    name: `maintenanceRecords.${index}.id`
  });
  const photos =
    useWatch({ control, name: `maintenanceRecords.${index}.photos` }) || [];
  const removePhotoIds =
    useWatch({ control, name: `maintenanceRecords.${index}.removePhotoIds` }) ||
    [];
  const existingPhotos = recordId ? existingPhotosByRecord[recordId] || [] : [];
  const selectedEquipment = equipment.find((item) => item.id === equipmentId);
  const equipmentCategories = useMemo(() => {
    const categories = new Map<string, string>();

    equipment.forEach((item) => {
      if (item.category) {
        categories.set(item.category.id, item.category.name);
      }
    });

    return Array.from(categories, ([id, name]) => ({ id, name })).sort(
      (left, right) => left.name.localeCompare(right.name, 'pt-BR')
    );
  }, [equipment]);
  const selectedEquipmentFields = [
    ...(selectedEquipment?.category?.fieldSchema || [])
  ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const cardErrors = errors.maintenanceRecords?.[index];
  const thirdParties = useFieldArray({
    control,
    name: `maintenanceRecords.${index}.thirdPartyServices`
  });
  const filteredEquipment = equipment.filter(
    (item) => item.category?.id === equipmentCategoryId
  );

  useEffect(() => {
    if (selectedEquipment?.category?.id) {
      setEquipmentCategoryId(selectedEquipment.category.id);
    }
  }, [selectedEquipment?.category?.id]);

  async function addPhotos(files: FileList | File[] | null) {
    const uploads = await filesToUploads(files);
    const retainedCount = existingPhotos.filter(
      (photo) => !removePhotoIds.includes(photo.id)
    ).length;
    setValue(
      `maintenanceRecords.${index}.photos`,
      [...photos, ...uploads].slice(0, Math.max(0, 10 - retainedCount)),
      { shouldValidate: true }
    );
  }

  return (
    <div className="operational-repeat-card">
      <div className="field-group">
        <label htmlFor={`maintenance-equipment-category-${index}`}>
          Categoria do equipamento<RequiredMark />
        </label>
        <select
          id={`maintenance-equipment-category-${index}`}
          value={equipmentCategoryId}
          required
          onChange={(event) => {
            setEquipmentCategoryId(event.target.value);
            setValue(`maintenanceRecords.${index}.equipmentId`, '', {
              shouldDirty: true
            });
            setValue(`maintenanceRecords.${index}.selectedServiceIds`, [], {
              shouldDirty: true
            });
            clearErrors(`maintenanceRecords.${index}.equipmentId`);
            clearErrors(`maintenanceRecords.${index}.selectedServiceIds`);
          }}
        >
          <option value="">Selecione uma categoria</option>
          {equipmentCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div
        className={`field-group ${cardErrors?.equipmentId ? 'field-invalid' : ''}`}
      >
        <label htmlFor={`maintenance-equipment-${index}`}>
          Equipamento<RequiredMark />
        </label>
        <select
          id={`maintenance-equipment-${index}`}
          disabled={!equipmentCategoryId}
          aria-invalid={Boolean(cardErrors?.equipmentId)}
          required
          {...register(`maintenanceRecords.${index}.equipmentId`)}
          value={equipmentId || ''}
          onChange={(event) => {
            setValue(
              `maintenanceRecords.${index}.equipmentId`,
              event.target.value,
              { shouldDirty: true, shouldValidate: true }
            );
            setValue(`maintenanceRecords.${index}.selectedServiceIds`, [], {
              shouldDirty: true
            });
            clearErrors(`maintenanceRecords.${index}.selectedServiceIds`);
          }}
        >
          <option value="">
            {equipmentCategoryId
              ? 'Selecione um equipamento'
              : 'Selecione primeiro a categoria'}
          </option>
          {filteredEquipment.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.name}
            </option>
          ))}
        </select>
        {cardErrors?.equipmentId ? (
          <div className="field-error">{cardErrors.equipmentId.message}</div>
        ) : null}
      </div>

      {selectedEquipment ? (
        <section className="operational-equipment-data" aria-live="polite">
          <strong>Dados do equipamento</strong>
          <dl>
            <div>
              <dt>Código</dt>
              <dd>{selectedEquipment.code}</dd>
            </div>
            <div>
              <dt>Identificação</dt>
              <dd>{selectedEquipment.name}</dd>
            </div>
            <div>
              <dt>Categoria</dt>
              <dd>{selectedEquipment.category?.name || '—'}</dd>
            </div>
            {selectedEquipmentFields.map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>
                  {equipmentAttributeText(
                    selectedEquipment.attributes?.[field.key],
                    field.type
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div
        className={`field-group ${cardErrors?.selectedServiceIds ? 'field-invalid' : ''}`}
      >
        <label>Serviços realizados<RequiredMark /></label>
        {selectedEquipment ? (
          <div className="operational-checklist">
            {selectedEquipment.maintenanceProfile.items.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  value={item.id}
                  {...register(
                    `maintenanceRecords.${index}.selectedServiceIds`
                  )}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="form-hint">
            Selecione um equipamento para carregar seu checklist.
          </div>
        )}
        {cardErrors?.selectedServiceIds ? (
          <div className="field-error">
            {cardErrors.selectedServiceIds.message}
          </div>
        ) : null}
      </div>

      <div className="field-group">
        <label htmlFor={`maintenance-observations-${index}`}>
          Observações (opcional)
        </label>
        <textarea
          id={`maintenance-observations-${index}`}
          rows={3}
          {...register(`maintenanceRecords.${index}.observations`)}
        />
      </div>

      <div className="operational-subsection">
        <div className="operational-card-head">
          <div>
            <strong>Serviços de terceiros</strong>
            <div className="form-hint">Adicione quantos forem necessários.</div>
          </div>
          <Button
            variant="mini"
            onClick={() =>
              thirdParties.append({
                serviceDate: localDate(),
                location: '',
                description: ''
              })
            }
          >
            Adicionar
          </Button>
        </div>
        {thirdParties.fields.map((field, thirdIndex) => (
          <div className="operational-third-party" key={field.id}>
            <div
              className={`field-group ${cardErrors?.thirdPartyServices?.[thirdIndex]?.serviceDate ? 'field-invalid' : ''}`}
            >
              <label>Data<RequiredMark /></label>
              <input
                type="date"
                aria-invalid={Boolean(
                  cardErrors?.thirdPartyServices?.[thirdIndex]?.serviceDate
                )}
                required
                {...register(
                  `maintenanceRecords.${index}.thirdPartyServices.${thirdIndex}.serviceDate`
                )}
              />
              {cardErrors?.thirdPartyServices?.[thirdIndex]?.serviceDate ? (
                <div className="field-error">
                  {
                    cardErrors.thirdPartyServices[thirdIndex]?.serviceDate
                      ?.message
                  }
                </div>
              ) : null}
            </div>
            <div
              className={`field-group ${cardErrors?.thirdPartyServices?.[thirdIndex]?.location ? 'field-invalid' : ''}`}
            >
              <label>Local<RequiredMark /></label>
              <input
                aria-invalid={Boolean(
                  cardErrors?.thirdPartyServices?.[thirdIndex]?.location
                )}
                required
                {...register(
                  `maintenanceRecords.${index}.thirdPartyServices.${thirdIndex}.location`
                )}
              />
              {cardErrors?.thirdPartyServices?.[thirdIndex]?.location ? (
                <div className="field-error">
                  {cardErrors.thirdPartyServices[thirdIndex]?.location?.message}
                </div>
              ) : null}
            </div>
            <div
              className={`field-group ${cardErrors?.thirdPartyServices?.[thirdIndex]?.description ? 'field-invalid' : ''}`}
            >
              <label>Serviço<RequiredMark /></label>
              <input
                aria-invalid={Boolean(
                  cardErrors?.thirdPartyServices?.[thirdIndex]?.description
                )}
                required
                {...register(
                  `maintenanceRecords.${index}.thirdPartyServices.${thirdIndex}.description`
                )}
              />
              {cardErrors?.thirdPartyServices?.[thirdIndex]?.description ? (
                <div className="field-error">
                  {
                    cardErrors.thirdPartyServices[thirdIndex]?.description
                      ?.message
                  }
                </div>
              ) : null}
            </div>
            <Button
              variant="mini"
              className="danger"
              onClick={() => thirdParties.remove(thirdIndex)}
            >
              Remover
            </Button>
          </div>
        ))}
      </div>

      <div className="operational-maintenance-photos">
        <PdfDropzone
          id={`maintenance-photos-${index}`}
          label="Fotos (opcional, até 10)"
          accept="image/*,.heic,.heif"
          multiple
          fileName={
            photos.length
              ? `${photos.length} nova(s) foto(s) selecionada(s)`
              : ''
          }
          emptyText="Arraste as fotos aqui"
          emptyHint="ou clique para selecionar"
          selectedHint="Clique ou solte para adicionar mais"
          error={cardErrors?.photos?.message}
          onFile={() => undefined}
          onFiles={(files) => {
            if (!files.length) {
              setValue(`maintenanceRecords.${index}.photos`, [], {
                shouldValidate: true
              });
              return;
            }
            void addPhotos(files);
          }}
        />
        {existingPhotos.length || photos.length ? (
          <div className="upload-list operational-maintenance-photo-list">
            {existingPhotos.map((photo) => {
              const removed = removePhotoIds.includes(photo.id);
              return (
                <UploadPreviewListItem
                  key={photo.id}
                  disabled={false}
                  file={{
                    label: 'Foto de manutenção',
                    fileName: photo.fileName,
                    mimeType: photo.mimeType,
                    url: photo.url
                  }}
                  index={0}
                  removed={removed}
                  onRemove={() =>
                    setValue(
                      `maintenanceRecords.${index}.removePhotoIds`,
                      removed
                        ? removePhotoIds.filter((id) => id !== photo.id)
                        : [...removePhotoIds, photo.id],
                      { shouldValidate: true }
                    )
                  }
                />
              );
            })}
            {photos.map((photo, photoIndex) => (
              <UploadPreviewListItem
                key={`${photo.fileName}-${photoIndex}`}
                disabled={false}
                file={{
                  label: 'Foto de manutenção',
                  fileName: photo.fileName,
                  mimeType: photo.mimeType,
                  url: photo.dataUrl
                }}
                index={photoIndex}
                onRemove={(itemIndex) =>
                  setValue(
                    `maintenanceRecords.${index}.photos`,
                    photos.filter((_, indexToKeep) => indexToKeep !== itemIndex)
                  )
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OperationalReportFormPage({
  mode
}: OperationalReportFormPageProps) {
  const kind = mode === 'producao' ? 'PRODUCTION' : 'MAINTENANCE';
  const standalone = mode === 'manutencao-avulsa';
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [submitError, setSubmitError] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [existingPhotosByRecord, setExistingPhotosByRecord] = useState<
    Record<string, MaintenanceAttachment[]>
  >({});
  const editId = searchParams.get('editar');
  const reviewMode = Boolean(
    editId && searchParams.get('revisao') === '1'
  );
  const currentStep = Math.min(
    standalone ? 1 : 2,
    Math.max(0, Number(searchParams.get('etapa') || 0) || 0)
  );
  const form = useForm<OperationalReportFormValues>({
    resolver: zodResolver(
      standalone
        ? standaloneOperationalReportFormSchema
        : operationalReportFormSchema
    ),
    defaultValues: defaultValues(kind),
    mode: 'onTouched'
  });
  const {
    control,
    register,
    reset,
    trigger,
    setValue,
    formState: { errors }
  } = form;
  const maintenanceFields = useFieldArray({
    control,
    name: 'maintenanceRecords'
  });
  const chemicalFields = useFieldArray({ control, name: 'chemicalCleanings' });
  const contextQuery = useQuery({
    queryKey: ['operational-reports', 'context'],
    queryFn: getOperationalContext
  });
  const editQuery = useQuery<MaintenanceRecord | OperationalReport>({
    queryKey: [
      'operational-reports',
      standalone ? 'maintenance' : 'report',
      editId
    ],
    queryFn: async () =>
      standalone
        ? await getStandaloneMaintenance(editId!)
        : await getOperationalReport(editId!),
    enabled: Boolean(editId)
  });
  const reportDate = useWatch({ control, name: 'reportDate' });
  const arrivalTime = useWatch({ control, name: 'arrivalTime' });
  const departureTime = useWatch({ control, name: 'departureTime' });
  const lunchBreak = useWatch({ control, name: 'lunchBreak' });
  const collaboratorIds = useWatch({ control, name: 'collaboratorIds' });
  const nightShift = useWatch({ control, name: 'nightShift' });
  const overtimeReason = useWatch({ control, name: 'overtimeReason' });
  const dailyDescription = useWatch({ control, name: 'dailyDescription' });
  const collaborators = useMemo(
    () => contextQuery.data?.collaborators || [],
    [contextQuery.data?.collaborators]
  );
  const selectedProject =
    kind === 'MAINTENANCE'
      ? contextQuery.data?.projects.maintenance
      : contextQuery.data?.projects.production;
  const holidayQuery = useReportWorkforceAvailability({
    reportDate: reportDate || '',
    collaboratorIds: collaboratorIds || [],
    enabled: !standalone
  });
  const serverHoliday = Boolean(
    holidayQuery.data?.holidays.some((holiday) => holiday.date === reportDate)
  );
  const overtimeSummary = useMemo(
    () =>
      calculateReportOvertimeSummary({
        policy: selectedProject,
        reportDate: reportDate || '',
        arrivalTime: arrivalTime || '',
        departureTime: departureTime || '',
        lunchBreak: lunchBreak || '',
        nightEnabled: Boolean(nightShift?.enabled),
        nightArrivalTime: nightShift?.arrivalTime || '',
        nightDepartureTime: nightShift?.departureTime || '',
        nightBreak: nightShift?.breakTime || '',
        isHoliday: serverHoliday
      }),
    [
      arrivalTime,
      departureTime,
      lunchBreak,
      nightShift,
      reportDate,
      selectedProject,
      serverHoliday
    ]
  );

  useEffect(() => {
    if (!user?.id || editId) return;
    const key = `operational-report-draft:v1:${user.id}:${mode}`;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved) {
        reset(JSON.parse(saved) as OperationalReportFormValues);
        setDraftSaved(true);
      }
    } catch {
      // Rascunho local indisponível ou inválido; o formulário continua vazio.
    }
    let saveTimer: number | null = null;
    const subscription = form.watch((values) => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        try {
          window.localStorage.setItem(key, JSON.stringify(values));
          setDraftSaved(true);
        } catch {
          // Armazenamento pode estar indisponível em modo privado.
        }
      }, 500);
    });
    return () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      subscription.unsubscribe();
    };
  }, [editId, form, mode, reset, user?.id]);

  useEffect(() => {
    if (!editQuery.data) return;
    if (standalone && 'equipmentId' in editQuery.data) {
      const record = editQuery.data;
      setExistingPhotosByRecord({ [record.id]: record.photos });
      reset({
        ...defaultValues('MAINTENANCE'),
        reportDate: record.maintenanceDate,
        maintenanceRecords: [
          {
            id: record.id,
            equipmentId: record.equipmentId,
            selectedServiceIds: record.selectedServices
              .map((item) => item.itemId)
              .filter((item): item is string => Boolean(item)),
            observations: record.observations || '',
            thirdPartyServices: record.thirdPartyServices.map((item) => ({
              serviceDate: item.serviceDate,
              location: item.location,
              description: item.description
            })),
            photos: [],
            removePhotoIds: []
          }
        ]
      });
      return;
    }
    if ('reportType' in editQuery.data) {
      const report = editQuery.data;
      setExistingPhotosByRecord(
        Object.fromEntries(
          report.maintenanceRecords.map((record) => [record.id, record.photos])
        )
      );
      const conditions = report.specialConditions as
        | {
            daytimeCollaboratorIds?: string[];
            noturnoDetails?: {
              enabled?: boolean;
              inicio?: string;
              termino?: string;
              intervalo?: string;
              collaboratorIds?: string[];
            };
          }
        | undefined;
      const night = conditions?.noturnoDetails;
      reset({
        kind: report.kind,
        reportDate: report.reportDate,
        arrivalTime: report.arrivalTime,
        departureTime: report.departureTime,
        lunchBreak: report.lunchBreak,
        collaboratorIds:
          conditions?.daytimeCollaboratorIds ||
          report.collaborators.map((item) => item.collaborator.id),
        nightShift: {
          enabled: Boolean(night?.enabled),
          arrivalTime: night?.inicio || '',
          departureTime: night?.termino || '',
          breakTime: night?.intervalo || '01:00:00',
          collaboratorIds: night?.collaboratorIds || []
        },
        overtimeReason: report.overtimeReason || '',
        dailyDescription: report.dailyDescription || '',
        maintenanceRecords: report.maintenanceRecords.map((record) => ({
          id: record.id,
          equipmentId: record.equipmentId,
          selectedServiceIds: record.selectedServices
            .map((item) => item.itemId)
            .filter((item): item is string => Boolean(item)),
          observations: record.observations || '',
          thirdPartyServices: record.thirdPartyServices.map((item) => ({
            serviceDate: item.serviceDate,
            location: item.location,
            description: item.description
          })),
          photos: [],
          removePhotoIds: []
        })),
        chemicalCleanings: report.chemicalCleanings.map((item) => ({
          description: item.description,
          material: item.material,
          otherMaterial: item.otherMaterial || '',
          quantityKg: item.quantityKg
        }))
      });
    }
  }, [editQuery.data, reset, standalone]);

  async function persistReport(values: OperationalReportFormValues) {
    if (standalone) {
      const maintenance = standaloneMaintenanceFormSchema.parse({
        ...values.maintenanceRecords[0],
        maintenanceDate: values.reportDate
      });
      return editId
        ? updateStandaloneMaintenance(editId, maintenance)
        : createStandaloneMaintenance(maintenance);
    }
    const parsed = operationalReportFormSchema.parse(values);
    return editId
      ? updateOperationalReport(editId, parsed)
      : createOperationalReport(parsed);
  }

  const mutation = useMutation({
    mutationFn: persistReport,
    onSuccess: () => {
      if (user?.id) {
        try {
          window.localStorage.removeItem(
            `operational-report-draft:v1:${user.id}:${mode}`
          );
        } catch {
          /* sem armazenamento */
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['operational-reports'] });
      showToast(
        editId ? 'Relatório atualizado.' : 'Relatório enviado para aprovação.',
        'success'
      );
      navigate(operationalModuleReturnPath(mode));
    },
    onError: (error) => setSubmitError(errorText(error))
  });

  const reviewMutation = useMutation({
    mutationFn: async ({
      action,
      reviewNotes,
      values
    }: {
      action: ReviewMutationAction;
      reviewNotes?: string;
      values?: OperationalReportFormValues;
    }) => {
      if (!editId) throw new Error('Relatório não identificado.');
      if (action === 'SAVE') {
        if (!values) throw new Error('Dados do relatório não informados.');
        return persistReport(values);
      }
      return standalone
        ? updateStandaloneMaintenanceStatus(editId, action, reviewNotes)
        : updateOperationalReportStatus(editId, action, reviewNotes);
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['operational-reports'] });
      if (variables.action === 'SAVE') {
        showToast('Relatório salvo.', 'success');
        void editQuery.refetch();
        return;
      }
      setReturnDialogOpen(false);
      showToast(
        variables.action === 'APPROVED'
          ? 'Relatório aprovado.'
          : 'Relatório devolvido.',
        'success'
      );
      navigate(operationalModuleReturnPath(mode));
    },
    onError: (error) => setSubmitError(errorText(error))
  });

  function setStep(step: number) {
    const next = new URLSearchParams(searchParams);
    next.set('etapa', String(step));
    setSearchParams(next, { replace: true });
  }

  async function nextStep() {
    const fields = standalone
      ? currentStep === 0
        ? ['reportDate']
        : ['maintenanceRecords']
      : currentStep === 0
        ? [
            'reportDate',
            'arrivalTime',
            'departureTime',
            'lunchBreak',
            'collaboratorIds',
            'nightShift'
          ]
        : kind === 'MAINTENANCE'
          ? ['maintenanceRecords']
          : ['chemicalCleanings'];
    const valid = await trigger(fields as never);
    if (valid) setStep(currentStep + 1);
    else setSubmitError('Revise os campos destacados antes de continuar.');
  }

  function withValidatedValues(
    onValid: (values: OperationalReportFormValues) => void,
    onInvalid?: () => void
  ) {
    setSubmitError('');
    void form.handleSubmit(
      onValid,
      () => {
        setSubmitError('Revise os campos destacados.');
        onInvalid?.();
      }
    )();
  }

  function requestSubmit() {
    withValidatedValues((values) => mutation.mutate(values));
  }

  function requestReview(
    action: ReviewMutationAction,
    reviewNotes?: string
  ) {
    if (action !== 'SAVE') {
      setSubmitError('');
      reviewMutation.mutate({ action, reviewNotes });
      return;
    }
    withValidatedValues((values) =>
      reviewMutation.mutate({ action, reviewNotes, values })
    );
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const title = standalone
    ? 'Manutenção avulsa'
    : kind === 'MAINTENANCE'
      ? 'RDO de manutenção'
      : 'RDO de produção';
  const canReview = standalone || kind === 'MAINTENANCE'
    ? Boolean(contextQuery.data?.canReviewMaintenance)
    : Boolean(contextQuery.data?.canReviewProduction);
  const reportStatus = editQuery.data?.status;
  const approvedReadOnly = reportStatus === 'APPROVED';
  const reportCreatorId = editQuery.data
    ? 'reportType' in editQuery.data
      ? editQuery.data.createdBy.id
      : editQuery.data.createdBy?.id
    : null;
  const canEdit = Boolean(
    !editId ||
      (user &&
        canAccessReportSelection(user.reportEmissionPermissions, mode) &&
        (user.accountType === 'ADMIN' || reportCreatorId === user.id))
  );
  const formReadOnly = approvedReadOnly || (Boolean(editId) && !canEdit);
  const hasUnsavedReviewChanges = canEdit && form.formState.isDirty;
  const canReviewCurrentStatus =
    reportStatus === 'PENDING' || reportStatus === 'RETURNED';
  const maintenanceApprovalBlocked = Boolean(
    kind === 'MAINTENANCE' &&
      !contextQuery.data?.maintenanceSupervisor.valid
  );
  const reviewPending = reviewMutation.isPending;
  const projectCode = kind === 'MAINTENANCE' ? '5002' : '5004';
  const maintenanceError =
    errors.maintenanceRecords?.root?.message ||
    errors.maintenanceRecords?.message;
  const chemicalError =
    errors.chemicalCleanings?.root?.message ||
    errors.chemicalCleanings?.message;
  const steps = standalone
    ? ['Data', 'Manutenção']
    : [
        'Cabeçalho',
        kind === 'MAINTENANCE' ? 'Manutenções' : 'Limpeza química',
        'Finalização'
      ];

  return (
    <Shell>
      <TopBar
        title={approvedReadOnly
          ? `Consultar ${title.toLowerCase()}`
          : reviewMode
            ? `Revisar ${title.toLowerCase()}`
            : title}
        subtitle={reviewMode
          ? `${projectCode} · ${approvedReadOnly ? 'Relatório aprovado' : 'Editor do relatório'}`
          : steps[currentStep]}
        step={reviewMode ? undefined : `${currentStep + 1} / ${steps.length}`}
        showLogo
        actions={
          <>
            <button
              className="topbar-chip"
              type="button"
              onClick={() =>
                navigate('/conta', {
                  state: accountPageStateFromPath(location)
                })
              }
            >
              Conta
            </button>
            <button
              className="topbar-chip"
              type="button"
              onClick={() => void handleLogout()}
            >
              Sair
            </button>
          </>
        }
      />
      <FormProvider {...form}>
        <main className="page-scroll operational-form-page">
          {!reviewMode ? (
            <ReportFormStepper
              steps={steps}
              currentStep={currentStep}
              onSelect={(index) => {
                if (index <= currentStep) {
                  setStep(index);
                  return;
                }
                if (index === currentStep + 1) void nextStep();
              }}
            />
          ) : null}

          {contextQuery.isLoading || editQuery.isLoading ? (
            <section className="page-card">Carregando formulário…</section>
          ) : null}
          {contextQuery.isError || editQuery.isError ? (
            <div className="inline-error">
              Não foi possível carregar os dados do formulário.
            </div>
          ) : null}

          {reviewMode && !contextQuery.isLoading && !canReview ? (
            <div className="inline-error">
              Sua conta não possui permissão para revisar este relatório.
            </div>
          ) : null}

          {approvedReadOnly ? (
            <div className="inline-warning">
              Este relatório está aprovado e disponível somente para consulta.
            </div>
          ) : null}

          <fieldset
            className="operational-review-fieldset"
            disabled={formReadOnly}
          >
          {reviewMode || currentStep === 0 ? (
            <>
              <section className="page-card">
                <div className="section-title">Identificação</div>
                <div className="admin-form-grid">
                  {!standalone ? (
                    <div className="field-group">
                      <label htmlFor="operational-project">Projeto</label>
                      <input
                        id="operational-project"
                        value={`${projectCode} - ${selectedProject?.name || title}`}
                        readOnly
                      />
                    </div>
                  ) : null}
                  <ReportDateField
                    id="operational-report-date"
                    value={reportDate || ''}
                    onChange={(value) =>
                      setValue('reportDate', value, {
                        shouldDirty: true,
                        shouldValidate: true
                      })
                    }
                    label={standalone ? 'Data da manutenção' : undefined}
                    invalid={Boolean(errors.reportDate)}
                    error={errors.reportDate?.message}
                  />
                </div>
              </section>
              {!standalone ? (
                <>
                  <ReportScheduleCard
                    idPrefix="operational"
                    arrivalTime={arrivalTime || ''}
                    departureTime={departureTime || ''}
                    lunchBreak={lunchBreak || ''}
                    lunchBreakLabel="Intervalo de almoço/janta"
                    onArrivalTimeChange={(value) =>
                      setValue('arrivalTime', value, {
                        shouldDirty: true,
                        shouldValidate: true
                      })
                    }
                    onDepartureTimeChange={(value) =>
                      setValue('departureTime', value, {
                        shouldDirty: true,
                        shouldValidate: true
                      })
                    }
                    onLunchBreakChange={(value) =>
                      setValue('lunchBreak', value, {
                        shouldDirty: true,
                        shouldValidate: true
                      })
                    }
                    arrivalError={errors.arrivalTime?.message}
                    departureError={errors.departureTime?.message}
                    lunchBreakError={errors.lunchBreak?.message}
                  />
                  <ReportCollaboratorsCard
                    collaborators={collaborators}
                    selectedIds={collaboratorIds || []}
                    onChange={(ids) =>
                      setValue('collaboratorIds', ids, {
                        shouldDirty: true,
                        shouldValidate: true
                      })
                    }
                    invalid={Boolean(errors.collaboratorIds)}
                    error={errors.collaboratorIds?.message}
                  />
                  <section className="page-card">
                    <div className="section-title">Condições especiais</div>
                    <ReportNightShiftFields
                      idPrefix="operational"
                      collaborators={collaborators}
                      enabled={Boolean(nightShift?.enabled)}
                      arrivalTime={nightShift?.arrivalTime || ''}
                      departureTime={nightShift?.departureTime || ''}
                      breakTime={nightShift?.breakTime || ''}
                      collaboratorIds={nightShift?.collaboratorIds || []}
                      onEnabledChange={(value) =>
                        setValue('nightShift.enabled', value, {
                          shouldDirty: true,
                          shouldValidate: true
                        })
                      }
                      onArrivalTimeChange={(value) =>
                        setValue('nightShift.arrivalTime', value, {
                          shouldDirty: true,
                          shouldValidate: true
                        })
                      }
                      onDepartureTimeChange={(value) =>
                        setValue('nightShift.departureTime', value, {
                          shouldDirty: true,
                          shouldValidate: true
                        })
                      }
                      onBreakTimeChange={(value) =>
                        setValue('nightShift.breakTime', value, {
                          shouldDirty: true,
                          shouldValidate: true
                        })
                      }
                      onCollaboratorIdsChange={(ids) =>
                        setValue('nightShift.collaboratorIds', ids, {
                          shouldDirty: true,
                          shouldValidate: true
                        })
                      }
                      arrivalError={errors.nightShift?.arrivalTime?.message}
                      departureError={errors.nightShift?.departureTime?.message}
                      breakTimeError={errors.nightShift?.breakTime?.message}
                      collaboratorsError={
                        errors.nightShift?.collaboratorIds?.message
                      }
                      invalidTargetPrefix="operational"
                    />
                  </section>
                </>
              ) : null}
            </>
          ) : null}

          {reviewMode || currentStep === 1 ? (
            <section className="page-card">
              {kind === 'MAINTENANCE' ? (
                <>
                  {!contextQuery.data?.maintenanceSupervisor.valid ? (
                    <div className="inline-warning">
                      O preenchimento está liberado, mas a aprovação ficará
                      bloqueada:{' '}
                      {contextQuery.data?.maintenanceSupervisor.reason}
                    </div>
                  ) : null}
                  <div className="operational-card-head operational-section-head">
                    <div>
                      <div className="section-title">Manutenções</div>
                      <div className="form-hint">
                        Cada cartão representa um equipamento.
                      </div>
                    </div>
                    {!standalone ? (
                      <Button
                        variant="mini"
                        onClick={() =>
                          maintenanceFields.append(emptyMaintenance())
                        }
                      >
                        Adicionar manutenção
                      </Button>
                    ) : null}
                  </div>
                  {maintenanceFields.fields.map((field, index) => (
                    <div key={field.id}>
                      <div className="operational-card-head">
                        <strong>Manutenção {index + 1}</strong>
                        {!standalone && maintenanceFields.fields.length > 1 ? (
                          <Button
                            variant="mini"
                            className="danger"
                            onClick={() => maintenanceFields.remove(index)}
                          >
                            Remover
                          </Button>
                        ) : null}
                      </div>
                      <MaintenanceCardEditor
                        index={index}
                        equipment={contextQuery.data?.equipment || []}
                        existingPhotosByRecord={existingPhotosByRecord}
                      />
                    </div>
                  ))}
                  {maintenanceError ? (
                    <div className="field-error">{maintenanceError}</div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="operational-card-head operational-section-head">
                    <div>
                      <div className="section-title">Limpeza química</div>
                      <div className="form-hint">
                        Informe a massa das peças decapadas em kg.
                      </div>
                    </div>
                    <Button
                      variant="mini"
                      onClick={() =>
                        chemicalFields.append(emptyChemicalCleaning())
                      }
                    >
                      Adicionar limpeza
                    </Button>
                  </div>
                  {chemicalFields.fields.map((field, index) => {
                    const itemErrors = errors.chemicalCleanings?.[index];
                    const material = form.watch(
                      `chemicalCleanings.${index}.material`
                    );
                    return (
                      <div className="operational-repeat-card" key={field.id}>
                        <div className="operational-card-head">
                          <strong>Limpeza {index + 1}</strong>
                          {chemicalFields.fields.length > 1 ? (
                            <Button
                              variant="mini"
                              className="danger"
                              onClick={() => chemicalFields.remove(index)}
                            >
                              Remover
                            </Button>
                          ) : null}
                        </div>
                        <div
                          className={`field-group ${itemErrors?.description ? 'field-invalid' : ''}`}
                        >
                          <label>Descrição<RequiredMark /></label>
                          <textarea
                            rows={3}
                            aria-invalid={Boolean(itemErrors?.description)}
                            required
                            {...register(
                              `chemicalCleanings.${index}.description`
                            )}
                          />
                          {itemErrors?.description ? (
                            <div className="field-error">
                              {itemErrors.description.message}
                            </div>
                          ) : null}
                        </div>
                        <div
                          className={`field-group ${itemErrors?.material ? 'field-invalid' : ''}`}
                        >
                          <label>Material<RequiredMark /></label>
                          <select
                            aria-invalid={Boolean(itemErrors?.material)}
                            required
                            {...register(`chemicalCleanings.${index}.material`)}
                          >
                            {materialOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          {itemErrors?.material ? (
                            <div className="field-error">
                              {itemErrors.material.message}
                            </div>
                          ) : null}
                        </div>
                        {material === 'OTHER' ? (
                          <div
                            className={`field-group ${itemErrors?.otherMaterial ? 'field-invalid' : ''}`}
                          >
                            <label>Qual material?<RequiredMark /></label>
                            <input
                              aria-invalid={Boolean(itemErrors?.otherMaterial)}
                              required
                              {...register(
                                `chemicalCleanings.${index}.otherMaterial`
                              )}
                            />
                            {itemErrors?.otherMaterial ? (
                              <div className="field-error">
                                {itemErrors.otherMaterial.message}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div
                          className={`field-group ${itemErrors?.quantityKg ? 'field-invalid' : ''}`}
                        >
                          <label>Quantidade (kg)<RequiredMark /></label>
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            inputMode="decimal"
                            aria-invalid={Boolean(itemErrors?.quantityKg)}
                            required
                            {...register(
                              `chemicalCleanings.${index}.quantityKg`,
                              { valueAsNumber: true }
                            )}
                          />
                          {itemErrors?.quantityKg ? (
                            <div className="field-error">
                              {itemErrors.quantityKg.message}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {chemicalError ? (
                    <div className="field-error">{chemicalError}</div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {!standalone && (reviewMode || currentStep === 2) ? (
            <>
              <ReportOvertimeCard
                summary={overtimeSummary}
                nightEnabled={Boolean(nightShift?.enabled)}
                reason={overtimeReason || ''}
                onReasonChange={(value) =>
                  setValue('overtimeReason', value, {
                    shouldDirty: true,
                    shouldValidate: true
                  })
                }
                error={errors.overtimeReason?.message}
              />
              {kind === 'MAINTENANCE' ? (
                <ReportActivitiesCard
                  value={dailyDescription || ''}
                  onChange={(value) =>
                    setValue('dailyDescription', value, {
                      shouldDirty: true,
                      shouldValidate: true
                    })
                  }
                  invalid={Boolean(errors.dailyDescription)}
                  error={errors.dailyDescription?.message}
                  required
                />
              ) : null}
              <ReportSummaryCard>
                {projectCode} · {reportDate} · {arrivalTime}–{departureTime} ·{' '}
                {(collaboratorIds || []).length} colaborador(es) ·{' '}
                {kind === 'MAINTENANCE'
                  ? `${maintenanceFields.fields.length} manutenção(ões)`
                  : `${chemicalFields.fields.length} limpeza(s) química(s)`}
              </ReportSummaryCard>
            </>
          ) : null}
          </fieldset>

          {submitError ? (
            <div className="inline-error">{submitError}</div>
          ) : null}
          {draftSaved && !editId ? (
            <div className="form-hint operational-draft-status">
              Rascunho salvo neste navegador.
            </div>
          ) : null}
          {reviewMode || formReadOnly ? (
            <>
              {editQuery.data?.reviewNotes ? (
                <div className="inline-warning">
                  <strong>Observação da revisão:</strong>{' '}
                  {editQuery.data.reviewNotes}
                </div>
              ) : null}
              <div className="detail-action-bar detail-manager-action-bar operational-review-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={reviewPending}
                  onClick={() => navigate(-1)}
                >
                  Voltar
                </button>
                {canEdit && canReviewCurrentStatus ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={reviewPending}
                    onClick={() => requestReview('SAVE')}
                  >
                    {reviewPending ? 'Salvando…' : 'Salvar'}
                  </button>
                ) : null}
                {canReview && canReviewCurrentStatus ? (
                  <>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={
                        reviewPending ||
                        maintenanceApprovalBlocked ||
                        hasUnsavedReviewChanges
                      }
                      title={
                        maintenanceApprovalBlocked
                          ? contextQuery.data?.maintenanceSupervisor.reason ||
                            'Configure o supervisor.'
                          : hasUnsavedReviewChanges
                            ? 'Salve as alterações antes de aprovar.'
                          : undefined
                      }
                      onClick={() => requestReview('APPROVED')}
                    >
                      Aprovar
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={reviewPending || hasUnsavedReviewChanges}
                      title={
                        hasUnsavedReviewChanges
                          ? 'Salve as alterações antes de devolver.'
                          : undefined
                      }
                      onClick={() => setReturnDialogOpen(true)}
                    >
                      Devolver
                    </button>
                  </>
                ) : null}
              </div>
              <ReasonDialog
                open={returnDialogOpen}
                title="Devolver relatório"
                description="Informe o que precisa ser corrigido antes de devolver o relatório."
                label="Motivo"
                confirmLabel="Devolver"
                requiredMessage="Informe o motivo da devolução."
                isSubmitting={reviewPending}
                onCancel={() => setReturnDialogOpen(false)}
                onConfirm={(reason) => requestReview('RETURNED', reason)}
              />
            </>
          ) : (
            <ReportFormActions
              currentStep={currentStep}
              totalSteps={steps.length}
              onBack={() =>
                currentStep ? setStep(currentStep - 1) : navigate(-1)
              }
              onNext={() => void nextStep()}
              onSubmit={requestSubmit}
              submitting={mutation.isPending}
              submitLabel={
                editId ? 'Salvar correções' : 'Enviar para aprovação'
              }
              submittingLabel="Salvando…"
            />
          )}
        </main>
      </FormProvider>
    </Shell>
  );
}
