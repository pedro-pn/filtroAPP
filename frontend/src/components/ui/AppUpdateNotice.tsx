import { useEffect, useRef, useState } from 'react';

import { watchAppUpdates } from '../../utils/appUpdates';
import { BrandLogo } from '../brand/BrandLogo';
import { Button } from './ds/Button';
import './AppUpdateNotice.css';

declare const __APP_VERSION__: string;

export function AppUpdateNotice() {
  const [available, setAvailable] = useState(false);
  const [postponed, setPostponed] = useState(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    return watchAppUpdates(__APP_VERSION__, () => setAvailable(true));
  }, []);

  useEffect(() => {
    if (!focusAfterToggle.current) return;
    actionRef.current?.focus();
    focusAfterToggle.current = false;
  }, [postponed]);

  function toggleNotice(value: boolean) {
    focusAfterToggle.current = true;
    setPostponed(value);
  }

  if (!available) return null;

  const logo = <BrandLogo variant="symbol" decorative className="fv-app-update__logo" />;

  if (postponed) {
    return (
      <aside className="fv-app-update fv-app-update--deferred fv-ds" aria-label="Atualização do aplicativo">
        <Button
          ref={actionRef}
          variant="ghost"
          size="sm"
          className="fv-app-update__deferred"
          iconLeft={logo}
          onClick={() => toggleNotice(false)}
          aria-label="Ver aviso de nova versão"
        >
          Nova versão disponível
        </Button>
      </aside>
    );
  }

  return (
    <aside className="fv-app-update fv-ds" aria-label="Atualização do aplicativo">
      <div className="fv-app-update__heading" role="status">
        <span className="fv-app-update__icon">{logo}</span>
        <div>
          <p className="fv-app-update__brand">FILTROVALI</p>
          <h2 className="fv-app-update__title">Nova versão disponível</h2>
        </div>
      </div>
      <p className="fv-app-update__reminder">Salve suas alterações antes de atualizar.</p>
      <div className="fv-app-update__actions">
        <Button variant="ghost" size="sm" className="fv-app-update__later" onClick={() => toggleNotice(true)}>
          Mais tarde
        </Button>
        <Button ref={actionRef} variant="primary" size="sm" onClick={() => window.location.reload()}>
          Atualizar
        </Button>
      </div>
    </aside>
  );
}
