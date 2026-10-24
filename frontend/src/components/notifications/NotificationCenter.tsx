import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Bell, BriefcaseBusiness, CheckCheck, DatabaseBackup, FileCheck2, FileText, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteNotification, listNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification, type NotificationPage } from '../../api/notifications';
import { useAuth } from '../../auth/AuthContext';
import { AppIcon } from '../icons/AppIcon';
import { Alert, Button, IconButton, Switch } from '../ui/ds';
import { Modal } from '../ui/Modal';
import { NotificationPopup } from './NotificationPopup';
import { useNotificationPopups } from './useNotificationPopups';
import './NotificationCenter.css';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function NotificationCenter() {
  const { user, isAuthenticated } = useAuth();
  // Remontar ao trocar de conta também fecha o painel e elimina erros da sessão anterior.
  return user && isAuthenticated ? <UserNotificationCenter key={user.id} /> : null;
}

function UserNotificationCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(() => new Set());
  const activeFilterRef = useRef<HTMLButtonElement>(null);
  const acknowledgeRef = useRef<HTMLButtonElement>(null);
  const query = useInfiniteQuery({
    queryKey: ['notifications', user, filter],
    queryFn: ({ pageParam, signal }) => listNotifications(filter, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor || undefined,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000
  });
  const firstPage = query.data?.pages[0];
  const unreadCount = query.isError && !query.isFetchNextPageError ? 0 : firstPage?.unreadCount || 0;
  const items = query.data?.pages.flatMap(page => page.items) || [];
  const critical = user?.accountType === 'ADMIN' && user.isActive && !query.isError
    ? firstPage?.criticalItems?.find(item => !acknowledgedIds.has(item.id)) : undefined;
  const popups = useNotificationPopups(user!.id, query.isError ? undefined : firstPage, !open && !critical);
  const popup = popups.popup;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const updateCachedNotification = async (item: AppNotification, removed = false) => {
    await queryClient.cancelQueries({ queryKey: ['notifications', user] });
    const readAt = item.readAt || new Date().toISOString();
    for (const value of ['all', 'unread'] as const) {
      queryClient.setQueryData<InfiniteData<NotificationPage>>(['notifications', user, value], data => data && ({
        ...data,
        pages: data.pages.map(page => ({
          ...page,
          unreadCount: Math.max(0, page.unreadCount - (item.readAt ? 0 : 1)),
          criticalItems: page.criticalItems.filter(event => event.id !== item.id),
          items: removed || value === 'unread' ? page.items.filter(event => event.id !== item.id)
            : page.items.map(event => event.id === item.id ? { ...event, readAt } : event)
        }))
      }));
    }
    popups.dismiss(item.id);
    void refresh();
  };
  const acknowledge = useMutation({
    mutationFn: async ({ item, showDetails }: { item: AppNotification; showDetails: boolean }) => {
      await markNotificationRead(item.id);
      return { item, showDetails };
    },
    onSuccess: ({ item, showDetails }) => {
      setAcknowledgedIds(ids => new Set([...ids, item.id]));
      void refresh();
      if (showDetails) { setOpen(false); navigate(item.href); }
    },
    onError: () => acknowledgeRef.current?.focus()
  });
  const acknowledgeBackup = (showDetails = false) => {
    if (critical && !acknowledge.isPending) acknowledge.mutate({ item: critical, showDetails });
  };
  const read = useMutation({
    mutationFn: async (item: AppNotification) => { await markNotificationRead(item.id); return item; },
    onSuccess: async item => {
      await updateCachedNotification(item);
      setOpen(false);
      navigate(item.href);
    },
    onError: () => activeFilterRef.current?.focus()
  });
  const remove = useMutation({
    mutationFn: async (item: AppNotification) => { await deleteNotification(item.id); return item; },
    onSuccess: item => updateCachedNotification(item, true),
    onError: () => activeFilterRef.current?.focus()
  });
  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => { await refresh(); activeFilterRef.current?.focus(); },
    onError: () => activeFilterRef.current?.focus()
  });
  const changeFilter = (value: 'all' | 'unread') => {
    setFilter(value);
    read.reset();
    readAll.reset();
    remove.reset();
  };
  const close = () => setOpen(false);
  const busy = read.isPending || readAll.isPending || remove.isPending;

  return (
    <>
      <span className="notification-center-trigger">
        <IconButton
          icon={Bell}
          label={`Notificações${unreadCount ? `, ${unreadCount} não lidas` : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setFilter('unread'); setOpen(true); read.reset(); readAll.reset(); remove.reset(); void refresh(); }}
        />
        {unreadCount > 0 ? <span className="notification-center-count" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
      </span>
      <Modal
        open={open && !critical}
        onClose={close}
        appearance="design-system"
        title="Central de notificações"
        size="md"
        closeOnBackdrop
        panelClassName="notification-center"
        headerActions={<IconButton icon={RefreshCw} label="Atualizar notificações" aria-busy={query.isFetching} onClick={() => void query.refetch()} />}
      >
        <div className="notification-center-toolbar">
          <div className="notification-center-filters" role="group" aria-label="Filtrar notificações">
            <Button ref={filter === 'unread' ? activeFilterRef : undefined} size="sm" variant={filter === 'unread' ? 'primary' : 'ghost'} aria-pressed={filter === 'unread'} onClick={() => changeFilter('unread')}>Não lidas{unreadCount > 0 ? ` (${unreadCount})` : ''}</Button>
            <Button ref={filter === 'all' ? activeFilterRef : undefined} size="sm" variant={filter === 'all' ? 'primary' : 'ghost'} aria-pressed={filter === 'all'} onClick={() => changeFilter('all')}>Todas</Button>
          </div>
          <Button size="sm" variant="ghost" disabled={!unreadCount || busy || query.isError} loading={readAll.isPending}
            iconLeft={<AppIcon icon={CheckCheck} />} onClick={() => firstPage && readAll.mutate(firstPage.snapshotAt)}>Marcar todas como lidas</Button>
        </div>
        <div className="notification-center-popup-settings">
          <Switch label="Notificações pop-up"
            checked={popups.enabled} onChange={event => popups.changeEnabled(event.target.checked)} />
        </div>
        <p className="notification-center-hint">Avisos das áreas e projetos aos quais você tem acesso.</p>
        {read.isError || readAll.isError ? <p role="alert" className="notification-center-error">{(read.error || readAll.error)?.message || 'Não foi possível salvar a leitura. Tente novamente.'}</p> : null}
        {remove.isError ? <p role="alert" className="notification-center-error">Não foi possível excluir a notificação. Tente novamente.</p> : null}
        {query.isPending ? <p role="status" className="notification-center-empty">Carregando notificações…</p>
          : query.isError && !query.isFetchNextPageError ? <div role="alert" className="notification-center-empty"><p>Não foi possível carregar as notificações.</p><Button size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button></div>
          : <>
            {items.length ? <ul className="notification-center-list">
              {items.map(item => (
                <li key={item.id} className={`notification-center-item${item.readAt ? '' : ' is-unread'}`}>
                  <button type="button" className="notification-center-link" disabled={busy} onClick={() => read.mutate(item)}>
                    <span className={`notification-center-item-icon${item.kind === 'BACKUP_FAILED' || item.kind === 'SYNC_FAILED' ? ' notification-center-item-icon--danger' : ''}`} aria-hidden="true"><AppIcon icon={item.kind === 'BACKUP_FAILED' ? DatabaseBackup : item.kind === 'SYNC_FAILED' ? TriangleAlert : item.kind === 'PROPOSAL_RECEIVED' ? FileCheck2 : item.kind.startsWith('REPORT_') ? FileText : BriefcaseBusiness} /></span>
                    <span className="notification-center-copy">
                      <strong>{item.title}{!item.readAt ? <span className="notification-center-dot" aria-label="Não lida" /> : null}</strong>
                      <span>{item.description}</span>
                      <time dateTime={item.createdAt}>{dateFormatter.format(new Date(item.createdAt))}</time>
                    </span>
                  </button>
                  <span className="notification-center-delete"><IconButton icon={X} size="sm" label={`Excluir notificação: ${item.title}`} disabled={busy}
                    onClick={() => remove.mutate(item)} /></span>
                </li>
              ))}
            </ul> : <div className="notification-center-empty" role="status"><AppIcon icon={Bell} /><strong>{filter === 'unread' ? 'Tudo em dia' : 'Nenhuma notificação por enquanto'}</strong><p>{filter === 'unread' ? 'Você não tem avisos não lidos.' : 'Novos avisos aparecerão aqui.'}</p></div>}
            {query.isFetchNextPageError ? <p role="alert" className="notification-center-error">Não foi possível carregar os avisos anteriores.</p> : null}
            {query.hasNextPage ? <Button className="notification-center-more" fullWidth size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchNextPageError ? 'Tentar carregar novamente' : 'Carregar anteriores'}</Button> : null}
          </>}
      </Modal>
      {popup && !open && !critical ? <NotificationPopup key={popup.id} item={popup}
        pending={read.isPending} error={read.isError && read.variables?.id === popup.id}
        onDismiss={() => popups.dismiss(popup.id)} onOpen={() => read.mutate(popup)} /> : null}
      <Modal
        open={Boolean(critical)}
        onClose={() => acknowledgeBackup()}
        appearance="design-system"
        title={critical?.title}
        size="sm"
        fullscreenOnMobile={false}
        backdropClassName="notification-backup-backdrop"
        panelClassName="notification-backup-dialog"
        ariaDescribedBy="notification-backup-description"
        initialFocusRef={acknowledgeRef}
        closeOnEscape={!acknowledge.isPending}
        showCloseButton={!acknowledge.isPending}
        footer={<>
          <Button ref={acknowledgeRef} variant="secondary" disabled={acknowledge.isPending} onClick={() => acknowledgeBackup()}>Entendi</Button>
          <Button loading={acknowledge.isPending} onClick={() => acknowledgeBackup(true)}>Ver diagnóstico</Button>
        </>}
      >
        <Alert tone="danger" icon={DatabaseBackup} title="A proteção dos dados precisa de atenção">
          <p id="notification-backup-description">{critical?.description}</p>
          <p>Confira o diagnóstico operacional para verificar o backup e corrigir o problema.</p>
        </Alert>
        {acknowledge.isError ? <p role="alert" className="notification-center-error">Não foi possível confirmar a leitura do alerta. Tente novamente.</p> : null}
      </Modal>
    </>
  );
}
