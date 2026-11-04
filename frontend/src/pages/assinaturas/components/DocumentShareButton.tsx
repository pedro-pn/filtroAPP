import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listSignatureDocumentShares, listSignatureSharingUsers, removeSignatureDocumentShare,
  saveSignatureDocumentShare, type SignatureSharePermission
} from '../../../api/assinaturas';
import { Alert, Button, Field, Input, Select, Skeleton } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/ToastContext';
import '../AssinaturasSharing.ds.css';

function PermissionOptions() {
  return <><option value="VIEW">Apenas visualizar</option><option value="EDIT">Pode editar</option></>;
}

function DocumentShareDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [permission, setPermission] = useState<SignatureSharePermission>('VIEW');
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);
  const shares = useQuery({ queryKey: ['assinaturas', 'shares', documentId], queryFn: () => listSignatureDocumentShares(documentId) });
  const users = useQuery({ queryKey: ['assinaturas', 'sharing-users', documentId, query], queryFn: () => listSignatureSharingUsers(documentId, query) });
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['assinaturas', 'shares', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['assinaturas', 'audit', documentId] })
  ]);
  const save = useMutation({
    mutationFn: ({ id, access }: { id: string; access: SignatureSharePermission }) => saveSignatureDocumentShare(documentId, id, access),
    onSuccess: invalidate
  });
  const remove = useMutation({ mutationFn: (id: string) => removeSignatureDocumentShare(documentId, id), onSuccess: invalidate });
  const busy = save.isPending || remove.isPending;
  const available = users.data?.filter(user => !shares.data?.some(share => share.userId === user.id)) || [];

  async function saveAccess(id: string, access: SignatureSharePermission, adding = false) {
    try {
      await save.mutateAsync({ id, access });
      if (adding) { setUserId(''); setPermission('VIEW'); }
      showToast(adding ? 'Documento compartilhado.' : 'Permissão atualizada.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível compartilhar o documento.', 'error');
    }
  }

  return <Modal open onClose={onClose} appearance="design-system" title="Compartilhar documento" size="md"
    closeOnEscape={!busy} showCloseButton={!busy} fullscreenOnMobile={false}
    footer={<Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>Fechar</Button>}>
    <div className="fv-ds signature-sharing">
      <p>O documento aparecerá na biblioteca do usuário selecionado.</p>
      <p>A edição permite ajustar o rascunho e os campos de assinatura. Publicação, convites e compartilhamentos ficam com o proprietário. Em lotes, os assinantes também são gerenciados pelo proprietário.</p>
      <form className="signature-sharing__form" onSubmit={event => { event.preventDefault(); if (!busy && userId) void saveAccess(userId, permission, true); }}>
        <Field id="signature-share-search" label="Buscar usuário" optionalText={null}>
          <Input value={search} onChange={event => { setSearch(event.target.value); setUserId(''); }} placeholder="Nome, usuário ou e-mail" />
        </Field>
        {users.isLoading ? <Skeleton variant="text" label="Carregando usuários..." /> : users.isError ? <Alert tone="danger">Não foi possível buscar usuários. <Button variant="ghost" size="sm" onClick={() => void users.refetch()}>Tentar novamente</Button></Alert> : <>
          <Field id="signature-share-user" label="Usuário com acesso a Assinaturas" required>
            <Select value={userId} disabled={busy || shares.isPending || shares.isError} onChange={event => setUserId(event.target.value)} required>
              <option value="">Selecione um usuário</option>
              {available.map(user => <option key={user.id} value={user.id}>{user.name} ({user.username}){user.email ? ` · ${user.email}` : ''}</option>)}
            </Select>
          </Field>
          {!available.length ? <p role="status">Nenhum usuário disponível nesta busca.</p> : null}
        </>}
        <Field id="signature-share-permission" label="Permissão" required>
          <Select value={permission} disabled={busy} onChange={event => setPermission(event.target.value as SignatureSharePermission)}><PermissionOptions /></Select>
        </Field>
        <Button type="submit" size="sm" loading={save.isPending} disabled={busy || !available.some(user => user.id === userId) || shares.isError}>Compartilhar</Button>
      </form>
      <h3>Quem tem acesso</h3>
      {shares.isPending ? <Skeleton variant="text" label="Carregando compartilhamentos..." /> : shares.isError ? <Alert tone="danger">Não foi possível carregar os acessos. <Button variant="ghost" size="sm" onClick={() => void shares.refetch()}>Tentar novamente</Button></Alert>
        : shares.data.length ? <ul className="signature-sharing__users">{shares.data.map(share => <li key={share.id}>
          <div><strong>{share.user.name}</strong><small>{share.user.username}{share.user.email ? ` · ${share.user.email}` : ''}</small></div>
          <Select aria-label={`Permissão de ${share.user.name}`} value={share.permission} disabled={busy} onChange={event => void saveAccess(share.userId, event.target.value as SignatureSharePermission)}><PermissionOptions /></Select>
          <Button variant="secondary" size="sm" disabled={busy} onClick={async () => {
            try { await remove.mutateAsync(share.userId); showToast('Acesso removido.', 'success'); }
            catch (error) { showToast(error instanceof Error ? error.message : 'Não foi possível remover o acesso.', 'error'); }
          }} aria-label={`Remover acesso de ${share.user.name}`}>Remover</Button>
        </li>)}</ul> : <p>Nenhum compartilhamento. Apenas você tem acesso.</p>}
    </div>
  </Modal>;
}

export function DocumentShareButton({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="secondary" size="sm" data-signature-share onClick={() => setOpen(true)}>Compartilhar</Button>
    {open ? <DocumentShareDialog key={documentId} documentId={documentId} onClose={() => setOpen(false)} /> : null}
  </>;
}
