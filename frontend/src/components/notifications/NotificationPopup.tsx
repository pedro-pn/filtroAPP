import { Bell, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from '../icons/AppIcon';
import { IconButton } from '../ui/ds';
import type { AppNotification } from '../../api/notifications';

const VISIBLE_MS = 6_000;
const EXIT_MS = 300;

interface NotificationPopupProps {
  item: AppNotification;
  pending: boolean;
  error: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

export function NotificationPopup({ item, pending, error, onOpen, onDismiss }: NotificationPopupProps) {
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(VISIBLE_MS);
  const paused = hovering || focused || pending || error;

  useEffect(() => {
    if (paused || leaving) return;
    const started = Date.now();
    const timer = window.setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onDismiss, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onDismiss]);

  return createPortal(
    <aside className={`fv-ds notification-popup${leaving ? ' is-leaving' : ''}`}
      aria-label="Nova notificação"
      onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <div className="notification-popup-heading">
        <span className="notification-popup-icon" aria-hidden="true"><AppIcon icon={Bell} /></span>
        <span>Nova notificação<small>Agora</small></span>
        <IconButton icon={X} label="Dispensar notificação" size="sm" onClick={() => setLeaving(true)} />
      </div>
      <button type="button" className="notification-popup-content" aria-label={`Abrir notificação: ${item.title}`} onClick={onOpen} disabled={pending || leaving}>
        <span role="status"><strong>{item.title}</strong><span>{item.description}</span></span>
        <span className="notification-popup-action">{pending ? 'Abrindo…' : 'Abrir notificação →'}</span>
      </button>
      {error ? <p className="notification-center-error" role="alert">Não foi possível abrir o aviso. Clique para tentar novamente.</p> : null}
      <div className="notification-popup-progress" aria-hidden="true" style={{ animationPlayState: paused ? 'paused' : 'running' }} />
    </aside>, document.body
  );
}
