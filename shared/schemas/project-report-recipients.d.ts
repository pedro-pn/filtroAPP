export interface ProjectReportRecipients {
  clientEmailPrimary: string;
  clientSignerFirstName: string;
  clientSignerLastName: string;
  clientEmailCc: string[];
  clientSigners: Array<{
    email: string;
    name: string;
    firstName: string;
    lastName: string;
    signsServiceReports: boolean;
  }>;
}

export function makeProjectReportRecipientsSchema(z: typeof import('zod').z, extraFields?: Record<string, import('zod').ZodType>): import('zod').ZodType<ProjectReportRecipients>;
export function normalizeProjectReportRecipients(data: ProjectReportRecipients): ProjectReportRecipients;
