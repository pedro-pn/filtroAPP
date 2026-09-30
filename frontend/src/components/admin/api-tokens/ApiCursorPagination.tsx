import { useRef } from 'react';
import { Button } from '../../ui/ds';

export function ApiCursorPagination({ cursor, nextCursor, loading, onChange, label }: {
  cursor: string; nextCursor?: string | null; loading: boolean; onChange: (cursor: string) => void; label: string;
}) {
  const previous = useRef(new Map<string, string>());
  return <nav className="api-cursor-pagination" aria-label={label} aria-busy={loading}>
    <span className="api-pagination-status" aria-live="polite">{cursor ? 'Mais resultados' : 'Página inicial'}</span>
    <div className="api-pagination-actions">
      <Button variant="secondary" size="sm" disabled={!cursor || loading} onClick={() => onChange(previous.current.get(cursor) || '')}>{previous.current.has(cursor) ? 'Página anterior' : 'Primeira página'}</Button>
      <Button variant="secondary" size="sm" disabled={!nextCursor || loading} onClick={() => { if (nextCursor) { previous.current.set(nextCursor, cursor); onChange(nextCursor); } }}>Próxima página</Button>
    </div>
  </nav>;
}
