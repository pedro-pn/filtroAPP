import { create } from 'zustand';

interface RdoServiceDraft {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface DdsThemeSnapshot {
  id: string;
  name: string;
  // Tema digitado fora da lista oficial; fica pendente de validação do gestor na revisão do RDO.
  custom?: boolean;
}

export interface RdoStoreState {
  draftId: string | null;
  serviceOnly: boolean;
  projectId: string | null;
  reportDate: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  collaboratorIds: string[];
  nightCollaboratorIds: string[];
  standby: boolean;
  noturno: boolean;
  standbyDuration: string;
  standbyMotivo: string;
  noturnoStart: string;
  noturnoEnd: string;
  noturnoInterval: string;
  ddsDay: boolean;
  ddsDayStart: string;
  ddsDayEnd: string;
  ddsDayThemes: DdsThemeSnapshot[];
  ddsNight: boolean;
  ddsNightStart: string;
  ddsNightEnd: string;
  ddsNightThemes: DdsThemeSnapshot[];
  overtimeReason: string;
  workforceJustification: string;
  dailyDescription: string;
  generalUploads: unknown[];
  services: RdoServiceDraft[];
  setHeaderField: <K extends keyof Pick<RdoStoreState, 'serviceOnly' | 'projectId' | 'reportDate' | 'arrivalTime' | 'departureTime' | 'lunchBreak' | 'standby' | 'noturno' | 'standbyDuration' | 'standbyMotivo' | 'noturnoStart' | 'noturnoEnd' | 'noturnoInterval' | 'ddsDay' | 'ddsDayStart' | 'ddsDayEnd' | 'ddsNight' | 'ddsNightStart' | 'ddsNightEnd' | 'overtimeReason' | 'workforceJustification' | 'dailyDescription'>>(field: K, value: RdoStoreState[K]) => void;
  setCollaborators: (ids: string[]) => void;
  setNightCollaborators: (ids: string[]) => void;
  addDdsTheme: (shift: 'day' | 'night', theme: DdsThemeSnapshot) => void;
  removeDdsTheme: (shift: 'day' | 'night', id: string) => void;
  setGeneralUploads: (uploads: unknown[]) => void;
  addService: (type: string, data?: Record<string, unknown>) => void;
  updateServiceType: (id: string, type: string) => void;
  updateService: (id: string, data: Record<string, unknown>) => void;
  removeService: (id: string) => void;
  hydrate: (payload: Partial<RdoStoreState> & { services?: RdoServiceDraft[] }) => void;
  setDraftId: (draftId: string | null) => void;
  reset: () => void;
}

const initialState = {
  draftId: null,
  serviceOnly: false,
  projectId: null,
  reportDate: '',
  arrivalTime: '',
  departureTime: '',
  lunchBreak: '',
  collaboratorIds: [],
  nightCollaboratorIds: [],
  standby: false,
  noturno: false,
  standbyDuration: '',
  standbyMotivo: '',
  noturnoStart: '',
  noturnoEnd: '',
  noturnoInterval: '01:00:00',
  ddsDay: false,
  ddsDayStart: '',
  ddsDayEnd: '',
  ddsDayThemes: [] as DdsThemeSnapshot[],
  ddsNight: false,
  ddsNightStart: '',
  ddsNightEnd: '',
  ddsNightThemes: [] as DdsThemeSnapshot[],
  overtimeReason: '',
  workforceJustification: '',
  dailyDescription: '',
  generalUploads: [],
  services: [] as RdoServiceDraft[]
};

function serviceId() {
  return `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useRdoStore = create<RdoStoreState>(set => ({
  ...initialState,
  setDraftId: draftId => set(state => (state.draftId === draftId ? state : { draftId })),
  setHeaderField: (field, value) => set(state => ({ ...state, [field]: value })),
  setCollaborators: collaboratorIds => set({ collaboratorIds }),
  setNightCollaborators: nightCollaboratorIds => set({ nightCollaboratorIds }),
  addDdsTheme: (shift, theme) =>
    set(state => {
      const key = shift === 'day' ? 'ddsDayThemes' : 'ddsNightThemes';
      if (state[key].some(item => item.id === theme.id)) return state;
      return { [key]: [...state[key], theme] };
    }),
  removeDdsTheme: (shift, id) =>
    set(state => {
      const key = shift === 'day' ? 'ddsDayThemes' : 'ddsNightThemes';
      return { [key]: state[key].filter(item => item.id !== id) };
    }),
  setGeneralUploads: generalUploads => set({ generalUploads }),
  addService: (type, data = {}) =>
    set(state => ({
      services: [...state.services, { id: serviceId(), type, data }]
    })),
  updateServiceType: (id, type) =>
    set(state => ({
      services: state.services.map(service => (service.id === id ? { ...service, type } : service))
    })),
  updateService: (id, data) =>
    set(state => ({
      services: state.services.map(service => (service.id === id ? { ...service, data: { ...service.data, ...data } } : service))
    })),
  removeService: id =>
    set(state => ({
      services: state.services.filter(service => service.id !== id)
    })),
  hydrate: payload =>
    set(state => ({
      ...state,
      ...payload,
      services: Array.isArray(payload.services) ? payload.services : state.services
    })),
  reset: () => set(initialState)
}));
