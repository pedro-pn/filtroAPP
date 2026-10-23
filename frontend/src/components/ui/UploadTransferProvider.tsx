import { useId, useState, type ReactNode } from 'react';
import type { ReportUploadMove } from '../../utils/reportUploadTransfer';
import { UploadTransferContext } from './UploadTransferContext';

/** Limita os destinos aos campos de foto deste formulário. */
export function UploadTransferProvider({ children, enabled, onMove }: {
  children: ReactNode;
  enabled: boolean;
  onMove: (move: ReportUploadMove) => void;
}) {
  const scopeId = useId();
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  return (
    <UploadTransferContext.Provider value={enabled ? { scopeId, activeTarget, setActiveTarget, onMove } : null}>
      {children}
    </UploadTransferContext.Provider>
  );
}
