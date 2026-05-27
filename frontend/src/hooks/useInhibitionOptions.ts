import { useQuery } from '@tanstack/react-query';

import { listInhibitionOptions } from '../api/inhibitionOptions';
import { queryKeys } from './queryKeys';

export function useInhibitionOptions() {
  return useQuery({
    queryKey: queryKeys.inhibitionOptions,
    queryFn: listInhibitionOptions
  });
}
