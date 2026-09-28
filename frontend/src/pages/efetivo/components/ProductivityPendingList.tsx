import { Link } from 'react-router';

import type { EfetivoPendingItem } from '../../../api/efetivo';
import { Badge, Card } from '../../../components/ui/ds';

function resolutionPath(item: EfetivoPendingItem) {
  if (item.tipo === 'CARGO_NAO_CADASTRADO') return '/gestor?tab=equipe';
  return '/acompanhamento?section=custo&cost=ponto';
}

function resolutionLabel(item: EfetivoPendingItem) {
  if (item.tipo === 'CARGO_NAO_CADASTRADO') return 'Abrir cadastro da equipe';
  return 'Abrir vínculos do ponto';
}

export function ProductivityPendingList({ items }: { items: EfetivoPendingItem[] }) {
  if (!items.length) return null;
  return (
    <Card className="efetivo-productivity-section" aria-labelledby="efetivo-pending-title">
      <div className="efetivo-section-heading">
        <div>
          <h2 id="efetivo-pending-title">Pendências fora da taxa oficial</h2>
          <p>Estas pessoas permanecem visíveis até que o cadastro ou o vínculo seja resolvido.</p>
        </div>
        <Badge tone="warning">{items.length}</Badge>
      </div>
      <div className="efetivo-pending-list">
        {items.map((item, index) => (
          <article className="efetivo-pending-item" key={`${item.tipo}-${item.referencia || index}`}>
            <div>
              <strong>{item.tipo === 'SEM_DADOS_PERIODO' ? 'Sem dados no período' : item.tipo === 'PONTO_SEM_VINCULO' ? 'Ponto sem vínculo' : 'Cargo não cadastrado'}</strong>
              <p>{item.descricao}</p>
            </div>
            <Link className="efetivo-pending-link" to={resolutionPath(item)}>{resolutionLabel(item)}</Link>
          </article>
        ))}
      </div>
    </Card>
  );
}
