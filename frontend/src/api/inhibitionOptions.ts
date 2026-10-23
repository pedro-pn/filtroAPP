import { apiClient, rdoApiPath } from './client';
import { inhibitionSystemForVessel } from '../utils/inhibitionSystem';

export interface InhibitionVessel {
  id: string;
  code: string;
}

export interface InhibitionSystem {
  id: string;
  code: string;
  description: string;
  diagram: string;
}

export interface InhibitionOptions {
  vessels: InhibitionVessel[];
  systems: InhibitionSystem[];
}

export function inhibitionSystemValue(system: Pick<InhibitionSystem, 'code' | 'description' | 'diagram'>, vesselCode = '') {
  return inhibitionSystemForVessel(`${system.code};${system.description};${system.diagram}`, vesselCode);
}

export async function listInhibitionOptions() {
  const response = await apiClient.get<InhibitionOptions>(rdoApiPath('/inhibition-options'));
  return response.data;
}
