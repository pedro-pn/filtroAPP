import type { AccountType, ModuleRole, UserRole } from './auth';

export type UnitCategory = string;
export type ReportType = 'RDO' | 'RTP' | 'RLQ' | 'RCPU' | 'RLM' | 'RLF' | 'RLI';
export type ReportStatus = 'PENDING' | 'APPROVED' | 'RETURNED' | 'SIGNED';

export interface Collaborator {
  id: string;
  code: string;
  name: string;
  role: string;
  email: string | null;
  cpf?: string | null;
  registrationNumber?: string | null;
  admissionDate?: string | null;
  signatureImage: string | null;
  signatureNoticeAcceptedAt?: string | null;
  signatureNoticeVersion?: string | null;
  isActive: boolean;
}

export interface ProjectReportSequence {
  id: string;
  projectId: string;
  reportType: ReportType;
  nextNumber: number;
}

export interface ClientSigner {
  name: string;
  email: string;
}

export type SurveyStatus = 'ACTIVE' | 'RESPONDED' | 'EXPIRED' | 'UNKNOWN';

export interface SatisfactionSurveySummary {
  id: string;
  projectId: string;
  emailTo: string;
  expiresAt: string;
  respondedAt?: string | null;
  sentAt: string;
  lastReminderAt?: string | null;
  reminderCount: number;
  reminderOptOutAt?: string | null;
  expirationNotifiedAt?: string | null;
  followUpStatus?: 'OPEN' | 'CONTACTED' | 'RESOLVED' | 'NOT_APPLICABLE' | null;
  followUpNotes?: string | null;
  followUpUpdatedAt?: string | null;
  createdAt: string;
  status?: SurveyStatus;
}

export interface ClientSegment {
  id: string;
  label: string;
  slug: string;
  isActive: boolean;
  order: number;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  visibleToCollaborators: boolean;
  managerOnly: boolean;
  registrationPending?: boolean;
  inhibitionServiceEnabled: boolean;
  clientName: string;
  clientCnpj: string;
  clientEmailPrimary: string;
  clientEmailCc: string[];
  clientSigners: ClientSigner[];
  contractCode: string;
  location: string;
  workdayHours: string;
  weekendWorkdayHours: string;
  includesSaturday: boolean;
  includesSunday: boolean;
  operatorId: string | null;
  clientSegment?: string | null;
  operator?: Collaborator | null;
  authorizedUsers?: Array<{
    projectId?: string;
    userId: string;
    user?: InternalUserSummary;
  }>;
  reportSequences?: ProjectReportSequence[];
  surveys?: SatisfactionSurveySummary[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface Equipment {
  id: string;
  code: string;
  name: string;
  serviceTags: string[];
  isActive: boolean;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  category: UnitCategory;
}

export interface Manometer {
  id: string;
  code: string;
  scale: string;
  calibrationCertCode: string;
  calibratedAt: string;
  expiresAt: string;
  isActive: boolean;
  currentCalibrationCertificate?: CalibrationCertificate | null;
}

export interface ParticleCounter {
  id: string;
  code: string;
  serialNumber: string;
  category: UnitCategory;
  calibratedAt: string;
  expiresAt: string;
  isActive: boolean;
  currentCalibrationCertificate?: CalibrationCertificate | null;
}

export interface CalibrationCertificate {
  id: string;
  fileName: string;
  mimeType: string;
  publicToken: string;
  publicUrl: string;
  createdAt: string;
}

export interface LinkedClientProject {
  clientCnpj: string;
  code: string;
  name: string;
  contractCode: string;
  isActive: boolean;
}

export interface InternalUserSummary {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  accountType?: AccountType;
  moduleRoles?: ModuleRole[];
  isActive: boolean;
  collaboratorId?: string | null;
  collaborator?: Collaborator | null;
  linkedProjects?: LinkedClientProject[];
  clientCnpj?: string | null;
}

export interface ReportSummary {
  id: string;
  projectId: string;
  createdByUserId?: string | null;
  createdBy?: {
    id?: string;
    name?: string | null;
    collaborator?: { name?: string | null } | null;
  } | null;
  reviewedByUserId?: string | null;
  reportType: ReportType;
  sequenceNumber?: number | null;
  status: ReportStatus;
  reportSignatures?: Array<{
    id: string;
    signerName: string;
    declaredSignerName?: string | null;
    signerEmail: string;
    status: 'PENDING' | 'SIGNED' | 'REJECTED' | 'INVALIDATED' | 'EXPIRED';
    isRequired?: boolean;
    signedAt?: string | null;
    rejectedAt?: string | null;
  }>;
  clientReviews?: Array<{
    id: string;
    action: 'APPROVED' | 'REJECTED';
    comment?: string | null;
    createdAt?: string | null;
    clientUser?: {
      id?: string;
      name?: string | null;
      email?: string | null;
      username?: string | null;
    } | null;
  }>;
  reportDate: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  daytimeCount?: number;
  daytimeWorkedMinutes?: number;
  nighttimeWorkedMinutes?: number;
  daytimeOvertimeMinutes?: number;
  nighttimeOvertimeMinutes?: number;
  totalOvertimeMinutes?: number;
  overtimeReason?: string | null;
  dailyDescription?: string | null;
  reviewNotes?: string | null;
  specialConditions?: Record<string, unknown> | null;
  approvedAt?: string | null;
  returnedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  project: Project;
  collaborators?: Array<{
    collaboratorId: string;
    collaborator?: Collaborator | null;
  }>;
  services?: Array<{
    id: string;
    serviceType: string;
    equipmentId?: string | null;
    equipment?: Equipment | null;
    system?: string | null;
    material?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    finalized?: boolean | null;
    extraData?: Record<string, unknown> | null;
  }>;
}

export interface ReportServiceInput {
  id?: string;
  serviceType: string;
  equipmentId?: string | null;
  system?: string | null;
  material?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  finalized?: boolean | null;
  extraData?: Record<string, unknown>;
}

export interface ReportPayload {
  projectId: string;
  createdByUserId: string;
  reportType: ReportType;
  sequenceNumber?: number | null;
  status: ReportStatus;
  deleteUnfinalizedDerivedReports?: boolean;
  reportDate: string;
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  daytimeCount: number;
  overtimeReason?: string | null;
  dailyDescription?: string | null;
  specialConditions?: Record<string, unknown>;
  collaboratorIds: string[];
  services: ReportServiceInput[];
}

export interface ReportAuditLog {
  id: string;
  reportId: string;
  versionId?: string | null;
  userId?: string | null;
  action: string;
  description?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: UserRole;
  } | null;
  version?: {
    id: string;
    versionNumber: number;
    status: string;
    sourceDocumentHash: string;
    finalDocumentHash?: string | null;
  } | null;
}

export interface ServiceOnlyReportPayload {
  projectId: string;
  createdByUserId: string;
  reportDate: string;
  collaboratorIds: string[];
  services: ReportServiceInput[];
}

export interface ReportDraft {
  id: string;
  projectId?: string | null;
  project?: Project | null;
  title?: string | null;
  reportDate?: string | null;
  payload: Record<string, unknown>;
  updatedAt?: string;
  createdAt?: string;
}
