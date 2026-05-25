import { roleHomePath } from '../auth/rolePath';
import type { AuthUser, ModuleRole } from '../types/auth';

export interface HubModuleEntry {
  id: 'rdo' | 'admin' | 'romaneio' | 'epi' | 'privacy' | 'none';
  badge: string;
  title: string;
  copy: string;
  path?: string;
  disabled?: boolean;
}

function hasAnyRole(user: Pick<AuthUser, 'moduleRoles'> | null | undefined, roles: ModuleRole[]) {
  return roles.some(role => user?.moduleRoles?.includes(role));
}

export function hubModulesForUser(user: Pick<AuthUser, 'accountType' | 'moduleRoles' | 'role'> | null | undefined): HubModuleEntry[] {
  const canAccessRdo = hasAnyRole(user, ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator']);
  const canAccessRomaneio = hasAnyRole(user, ['romaneio:manager', 'romaneio:operator']);
  const canAccessEpi = hasAnyRole(user, ['epi:technician', 'epi:collaborator']);
  const canAccessPrivacy = hasAnyRole(user, ['privacy:admin']);
  const isAdmin = user?.accountType === 'ADMIN' || user?.role === 'MANAGER';
  const modules: HubModuleEntry[] = [
    ...(canAccessRdo ? [{
      id: 'rdo' as const,
      badge: 'RDO',
      title: 'Relatórios e Projetos',
      copy: 'Controle de relatórios, aprovações, clientes e estatísticas.',
      path: roleHomePath(user?.role)
    }] : []),
    ...(isAdmin ? [{
      id: 'admin' as const,
      badge: 'ADM',
      title: 'Gestão de Contas',
      copy: 'Administração inicial de usuários e acessos do hub.',
      path: '/admin/accounts'
    }] : []),
    ...(canAccessPrivacy ? [{
      id: 'privacy' as const,
      badge: 'LGPD',
      title: 'Privacidade',
      copy: 'Acompanhe solicitações de titulares e protocolos LGPD.',
      path: '/privacidade/solicitacoes'
    }] : []),
    ...(canAccessRomaneio ? [{
      id: 'romaneio' as const,
      badge: 'ROM',
      title: 'Romaneio de Equipamentos',
      copy: 'Controle de romaneios, equipamentos e notificações.',
      path: '/romaneio'
    }] : []),
    ...(canAccessEpi ? [{
      id: 'epi' as const,
      badge: 'EPI',
      title: 'Liberação de EPI',
      copy: 'Fichas de entrega, devolução e assinatura por colaborador.',
      path: '/epi'
    }] : [])
  ];

  return modules.length ? modules : [{
    id: 'none',
    badge: 'APP',
    title: 'Nenhum módulo liberado',
    copy: 'Solicite a revisão dos acessos da conta.',
    disabled: true
  }];
}
