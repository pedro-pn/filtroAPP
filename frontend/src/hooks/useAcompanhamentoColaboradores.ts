import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  fetchAcompanhamentoColaboradores,
  type AcompanhamentoColaboradoresParams
} from '../api/acompanhamentoColaboradores';
import { queryKeys } from './queryKeys';

export function useAcompanhamentoColaboradores(params: AcompanhamentoColaboradoresParams) {
  return useQuery({
    queryKey: queryKeys.acompanhamentoColaboradores(params),
    queryFn: () => fetchAcompanhamentoColaboradores(params),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000
  });
}
