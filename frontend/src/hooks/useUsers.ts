import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createUser, listUsers, removeUser, resendClientAccess, type UserPayload, updateUser } from '../api/users';
import { queryKeys } from './queryKeys';

export function useUsers(group?: 'internal' | 'client') {
  return useQuery({
    queryKey: queryKeys.users(group),
    queryFn: () => listUsers(group)
  });
}

export function useUserMutations() {
  const queryClient = useQueryClient();

  function invalidateUsers() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.users('internal') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.users('client') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.users(undefined) })
    ]);
  }

  const createMutation = useMutation({
    mutationFn: (payload: UserPayload) => createUser(payload),
    onSuccess: invalidateUsers
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<UserPayload> }) => updateUser(id, payload),
    onSuccess: invalidateUsers
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeUser(id),
    onSuccess: invalidateUsers
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => resendClientAccess(id)
  });

  return {
    createUser: createMutation,
    updateUser: updateMutation,
    removeUser: removeMutation,
    resendClientAccess: resendMutation
  };
}
