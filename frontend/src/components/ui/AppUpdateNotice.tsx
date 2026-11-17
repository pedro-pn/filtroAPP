import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { watchAppUpdates } from '../../utils/appUpdates';
import { Button } from './ds/Button';
import './AppUpdateNotice.css';

declare const __APP_VERSION__: string;

export function AppUpdateNotice() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    return watchAppUpdates(__APP_VERSION__, () => setAvailable(true));
  }, []);

  if (!available) return null;

  return (
    <aside className="fv-app-update fv-ds" aria-label="Atualização do aplicativo">
      <RefreshCw className="fv-app-update__icon" size={16} aria-hidden="true" />
      <span className="fv-app-update__message" role="status">Nova versão disponível.</span>
      <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
        Atualizar
      </Button>
    </aside>
  );
}
