import { useRef } from 'react';
import { Button } from '../../ui/Button';

export function ApiCursorPagination({ cursor, nextCursor, loading, onChange, label }: {
  cursor: string; nextCursor?: string | null; loading: boolean; onChange: (cursor: string) => void; label: string;
}) {
  // O histórico é local; após F5, a primeira página continua acessível.
  const previous = useRef(new Map<string, string>());
  return <nav className="api-cursor-pagination" aria-label={label}>
    <Button variant="secondary" disabled={!cursor || loading} onClick={() => onChange(previous.current.get(cursor) || '')}>{previous.current.has(cursor) ? 'Página anterior' : 'Primeira página'}</Button>
    <Button variant="secondary" disabled={!nextCursor || loading} onClick={() => { if (nextCursor) { previous.current.set(nextCursor, cursor); onChange(nextCursor); } }}>Próxima página</Button>
  </nav>;
}
