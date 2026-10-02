import { createContext, useContext } from 'react';

export interface FieldContextValue {
  controlId: string;
  describedBy?: string;
  disabled?: boolean;
  invalid: boolean;
  required?: boolean;
}

export const FieldContext = createContext<FieldContextValue | undefined>(
  undefined
);

export function useFieldContext() {
  return useContext(FieldContext);
}
