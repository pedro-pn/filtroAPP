import { useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  archiveSignatureDocument,
  cancelSignatureDocument,
  createSignatureDocument,
  deleteSignatureDocument,
  getPublicSignatureInvite,
  getSignatureDocument,
  listSignatureAudit,
  listSignatureDocuments,
  publishSignatureDocument,
  replaceDocumentFields,
  replaceDocumentSigners,
  renewSignatureInvite,
  resendSignatureInviteEmail,
  restoreArchivedSignatureDocument,
  restoreDeletedSignatureDocument,
  revokeSignatureInvite,
  type SignatureField,
  type SignatureSigner
} from '../api/assinaturas';

export function useSignatureDocuments(filters: Record<string, string | number | boolean | undefined>) {
  return useQuery({
    queryKey: ['assinaturas', 'list', filters],
    queryFn: () => listSignatureDocuments(filters)
  });
}

export function useSignatureDocument(id: string) {
  return useQuery({
    queryKey: ['assinaturas', 'doc', id],
    queryFn: () => getSignatureDocument(id),
    enabled: Boolean(id),
    refetchInterval: query => query.state.data?.status === 'FINALIZANDO' ? 2_000 : false
  });
}

export function useAssinaturaMutations() {
  const queryClient = useQueryClient();
  const invalidate = (id?: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['assinaturas', 'list'] }),
    ...(id ? [queryClient.invalidateQueries({ queryKey: ['assinaturas', 'doc', id] })] : [])
  ]);
  return {
    create: useMutation({ mutationFn: createSignatureDocument, onSuccess: document => invalidate(document.id) }),
    replaceSigners: useMutation({
      mutationFn: ({ id, signers }: { id: string; signers: Array<Pick<SignatureSigner, 'name' | 'email' | 'position'> & { id?: string }> }) => replaceDocumentSigners(id, signers),
      onSuccess: document => invalidate(document.id)
    }),
    replaceFields: useMutation({
      mutationFn: ({ id, fields }: { id: string; fields: SignatureField[] }) => replaceDocumentFields(id, fields),
      onSuccess: document => invalidate(document.id)
    }),
    publish: useMutation({
      mutationFn: ({ id, expiry }: { id: string; expiry: { expiresInDays: number } | { expiresAt: string } }) => publishSignatureDocument(id, expiry),
      onSuccess: (_result, variables) => invalidate(variables.id)
    }),
    renewInvite: useMutation({
      mutationFn: ({ id, signerId, expiresInDays = 15 }: { id: string; signerId: string; expiresInDays?: number }) => renewSignatureInvite(id, signerId, expiresInDays),
      onSuccess: (_result, variables) => invalidate(variables.id)
    }),
    revokeInvite: useMutation({
      mutationFn: ({ id, signerId }: { id: string; signerId: string }) => revokeSignatureInvite(id, signerId),
      onSuccess: (_result, variables) => invalidate(variables.id)
    }),
    resendInvite: useMutation({
      mutationFn: ({ id, signerId }: { id: string; signerId: string }) => resendSignatureInviteEmail(id, signerId),
      onSuccess: (_result, variables) => invalidate(variables.id)
    }),
    cancel: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string }) => cancelSignatureDocument(id, reason),
      onSuccess: (_result, variables) => invalidate(variables.id)
    }),
    archive: useMutation({
      mutationFn: ({ id }: { id: string }) => archiveSignatureDocument(id),
      onSuccess: (_result, variables) => invalidate(variables.id)
    }),
    restoreArchived: useMutation({
      mutationFn: ({ id }: { id: string }) => restoreArchivedSignatureDocument(id),
      onSuccess: (_result, variables) => invalidate(variables.id)
    }),
    deleteDocument: useMutation({
      mutationFn: ({ id }: { id: string }) => deleteSignatureDocument(id),
      onSuccess: (_result, variables) => invalidate(variables.id)
    }),
    restoreDeleted: useMutation({
      mutationFn: ({ id }: { id: string }) => restoreDeletedSignatureDocument(id),
      onSuccess: (_result, variables) => invalidate(variables.id)
    })
  };
}

export function useSignatureAudit(documentId: string, cursor = '') {
  return useQuery({
    queryKey: ['assinaturas', 'audit', documentId, cursor],
    queryFn: () => listSignatureAudit(documentId, cursor || undefined),
    enabled: Boolean(documentId)
  });
}

export function usePublicSignatureInvite(token: string, polling = false) {
  const opaqueSession = useRef(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  const queryKey = useMemo(() => ['assinaturas', 'publico', opaqueSession.current], []);
  return useQuery({
    queryKey,
    queryFn: () => getPublicSignatureInvite(token),
    enabled: Boolean(token),
    retry: false,
    refetchInterval: polling ? 2_000 : false,
    gcTime: 0
  });
}
