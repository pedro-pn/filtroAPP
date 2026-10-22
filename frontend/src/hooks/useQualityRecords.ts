import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query';

import { listQualityRecords, type QualityRecordListParams } from '../api/qualidade';

type QualityRecordFilters = Omit<QualityRecordListParams, 'page' | 'pageSize'>;

export function qualityRecordsQueryOptions(filters: QualityRecordFilters) {
  return infiniteQueryOptions({
    queryKey: ['qualidade', 'registros', 'infinite', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => listQualityRecords({ ...filters, page: pageParam, pageSize: 50 }, signal),
    getNextPageParam: lastPage => lastPage.items.length > 0 && lastPage.page * lastPage.pageSize < lastPage.total
      ? lastPage.page + 1
      : undefined
  });
}

export function useQualityRecords(filters: QualityRecordFilters) {
  return useInfiniteQuery(qualityRecordsQueryOptions(filters));
}
