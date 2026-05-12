import { apiClient } from './client';

export interface SignatureValidationPayload {
  status: 'VALID' | 'SUPERSEDED' | 'REJECTED' | 'UNAVAILABLE' | 'INVALID';
  validationCode?: string | null;
  sourceDocumentHash?: string | null;
  finalDocumentHash?: string | null;
  finalPdfCreatedAt?: string | null;
  report?: {
    id: string;
    reportType: string;
    sequenceNumber?: number | null;
    reportDate?: string | null;
    status: string;
    project: {
      code: string;
      name: string;
      clientName: string;
    };
  };
  signers?: Array<{
    name: string;
    email: string;
    role: string;
    status: string;
    signedAt?: string | null;
    rejectedAt?: string | null;
  }>;
}

export async function getSignatureValidation(validationCode: string) {
  const response = await apiClient.get<SignatureValidationPayload>(
    `/reports/validate-signature/${encodeURIComponent(validationCode)}`
  );
  return response.data;
}
