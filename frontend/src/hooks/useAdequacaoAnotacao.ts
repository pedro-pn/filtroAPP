import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchAdequacaoConfig } from '../api/anotacoes';
import { AuthContext } from '../auth/AuthContext';

/** Papéis que podem usar "Adequar para relatório" (mesma regra da rota no backend). */
export const PAPEIS_ADEQUACAO = ['rdo:manager', 'rdo:coordinator'] as const;

/** Gestor ou coordenador do RDO. Sem AuthProvider (ex.: renderização isolada) responde false. */
export function useAdequacaoPermitida() {
  const user = useContext(AuthContext)?.user;
  return Boolean(user?.moduleRoles?.some(role => (PAPEIS_ADEQUACAO as readonly string[]).includes(role)));
}

/** Configuração do servidor (chave da OpenAI presente). Usar só quando useAdequacaoPermitida() for true. */
export function useAdequacaoConfig() {
  const config = useQuery({
    queryKey: ['anotacoes', 'config'],
    queryFn: fetchAdequacaoConfig,
    staleTime: 10 * 60 * 1000,
    retry: false
  });
  return { disponivel: Boolean(config.data?.disponivel), maxCaracteres: config.data?.maxCaracteres ?? 4000 };
}
