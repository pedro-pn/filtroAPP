import type { ProjectCardCategory, ProjectCardItem } from '../../api/acompanhamentoComercial';

export type CardsView = 'andamento' | 'futuros' | 'arquivados' | 'conferidas';

const CARD_VIEWS: CardsView[] = ['andamento', 'futuros', 'arquivados', 'conferidas'];

const VIEW_CATEGORY: Record<CardsView, ProjectCardCategory> = {
  andamento: 'ANDAMENTO',
  futuros: 'FUTURO',
  arquivados: 'ARQUIVADO',
  conferidas: 'ARQUIVADO'
};

function cardCategory(card: ProjectCardItem): ProjectCardCategory {
  return card.category ?? (card.archived ? 'ARQUIVADO' : 'ANDAMENTO');
}

export function cardMatchesView(card: ProjectCardItem, view: CardsView) {
  const category = cardCategory(card);
  if (view === 'conferidas') return category === 'ARQUIVADO' && card.reviewed;
  if (view === 'arquivados') return category === 'ARQUIVADO' && !card.reviewed;
  return category === VIEW_CATEGORY[view];
}

export function parseCardsView(value: string | null): CardsView {
  return CARD_VIEWS.includes(value as CardsView) ? value as CardsView : 'andamento';
}
