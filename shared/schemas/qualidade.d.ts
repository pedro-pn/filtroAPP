export type QualidadeSchema = {
  safeParse: (value: unknown) => { success: true; data: unknown } | { success: false; error: any };
  parse: (value: unknown) => any;
};

export type QualidadeOption = {
  value: string;
  label: string;
  letter?: string;
};

export type QualidadeSchemas = {
  RECORD_TYPES: readonly string[];
  EVIDENCE_KINDS: readonly string[];
  IMPACTS: readonly string[];
  DISPOSITIONS: readonly string[];
  STATUSES: readonly string[];
  TYPE_LETTERS: Record<string, string>;
  typeOptions: readonly QualidadeOption[];
  impactOptions: readonly QualidadeOption[];
  dispositionOptions: readonly QualidadeOption[];
  statusOptions: readonly QualidadeOption[];
  recordCreate: QualidadeSchema;
  recordUpdate: QualidadeSchema;
  recordUpdateForType: (type: string) => QualidadeSchema;
  natureCreate: QualidadeSchema;
  natureUpdate: QualidadeSchema;
  activePatch: QualidadeSchema;
};

export function makeQualidadeSchemas(zod: unknown): QualidadeSchemas;
