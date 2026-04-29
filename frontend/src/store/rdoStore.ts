import { create } from 'zustand';

interface RdoServiceDraft {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface RdoStoreState {
  draftId: string | null;
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
  overtimeReason: string;
  dailyDescription: string;
  generalUploads: unknown[];
  services: RdoServiceDraft[];
  setHeaderField: <K extends keyof Pick<RdoStoreState, 'projectId' | 'reportDate' | 'arrivalTime' | 'departureTime' | 'lunchBreak' | 'standby' | 'noturno' | 'standbyDuration' | 'standbyMotivo' | 'noturnoStart' | 'noturnoEnd' | 'noturnoInterval' | 'overtimeReason' | 'dailyDescription'>>(field: K, value: RdoStoreState[K]) => void;
  setCollaborators: (ids: string[]) => void;
  setNightCollaborators: (ids: string[]) => void;
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
  overtimeReason: '',
  dailyDescription: '',
  generalUploads: [],
  services: [] as RdoServiceDraft[]
};

function serviceId() {
  return `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useRdoStore = create<RdoStoreState>(set => ({
  ...initialState,
  setDraftId: draftId => set({ draftId }),
  setHeaderField: (field, value) => set(state => ({ ...state, [field]: value })),
  setCollaborators: collaboratorIds => set({ collaboratorIds }),
  setNightCollaborators: nightCollaboratorIds => set({ nightCollaboratorIds }),
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
