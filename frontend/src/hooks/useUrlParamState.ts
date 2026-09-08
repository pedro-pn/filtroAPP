import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useSearchParams } from 'react-router';

type UrlParamStateOptions<T extends string> = {
  param: string;
  defaultValue: T;
  parse?: (value: string | null) => T;
  serialize?: (value: T) => string | null;
  replace?: boolean;
  omitDefault?: boolean;
  cleanParams?: (params: URLSearchParams, nextValue: T, previousValue: T) => void;
};

export function useUrlParamState<T extends string>({
  param,
  defaultValue,
  parse,
  serialize,
  replace = true,
  omitDefault = true,
  cleanParams
}: UrlParamStateOptions<T>): [T, Dispatch<SetStateAction<T>>] {
  const [searchParams, setSearchParams] = useSearchParams();
  const parseValue = useCallback(
    (raw: string | null): T => (parse ? parse(raw) : (raw || defaultValue) as T),
    [defaultValue, parse]
  );
  const serializeValue = useCallback(
    (value: T) => (serialize ? serialize(value) : value),
    [serialize]
  );

  const value = useMemo(() => parseValue(searchParams.get(param)), [param, parseValue, searchParams]);

  const setValue: Dispatch<SetStateAction<T>> = useCallback((nextAction) => {
    setSearchParams(currentParams => {
      const nextParams = new URLSearchParams(currentParams);
      const previousValue = parseValue(nextParams.get(param));
      const nextValue = typeof nextAction === 'function'
        ? (nextAction as (current: T) => T)(previousValue)
        : nextAction;
      const serialized = serializeValue(nextValue);

      if (!serialized || (omitDefault && nextValue === defaultValue)) {
        nextParams.delete(param);
      } else {
        nextParams.set(param, serialized);
      }
      cleanParams?.(nextParams, nextValue, previousValue);
      return nextParams;
    }, { replace });
  }, [cleanParams, defaultValue, omitDefault, param, parseValue, replace, serializeValue, setSearchParams]);

  return [value, setValue];
}
