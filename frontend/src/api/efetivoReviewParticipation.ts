import { apiClient } from './client';

export interface ReviewParticipant {
  id: string;
  code: string;
  name: string;
  jobRole: string;
  isActive: boolean;
  rhStatus: string | null;
  allocationReviewEnabled: boolean;
  version: number;
}

const base = '/efetivo/administracao/conferencia/colaboradores';
export const REVIEW_PARTICIPANTS_QUERY_KEY = 'efetivo-review-participants';

export async function listReviewParticipants() {
  return (await apiClient.get<ReviewParticipant[]>(base)).data;
}

export async function updateReviewParticipation(id: string, allocationReviewEnabled: boolean, version: number) {
  return (await apiClient.patch<ReviewParticipant>(`${base}/${encodeURIComponent(id)}`, { allocationReviewEnabled, version })).data;
}
