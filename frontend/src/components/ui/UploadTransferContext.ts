import { createContext } from 'react';
import type { ReportUploadMove } from '../../utils/reportUploadTransfer';

export const UploadTransferContext = createContext<{
  scopeId: string;
  activeTarget: string | null;
  setActiveTarget: (target: string | null) => void;
  onMove: (move: ReportUploadMove) => void;
} | null>(null);
