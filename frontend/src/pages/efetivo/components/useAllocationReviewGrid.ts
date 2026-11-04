import { useCallback, useState, type FocusEvent, type KeyboardEvent } from 'react';

/*
 * Navegação da grade da conferência com setas (roving tabindex): Tab entra e sai da grade numa
 * parada só; setas andam entre os dias, Home/End vão ao início/fim da linha, e Enter/Espaço
 * acionam a célula (é um botão). Células desabilitadas (fora do vínculo) são puladas.
 */
export function gridCellKey(row: number, col: number) {
  return `${row}-${col}`;
}

export function useAllocationReviewGrid(validKeys: string[]) {
  const [active, setActive] = useState<string | null>(null);
  const current = active && validKeys.includes(active) ? active : validKeys[0] || null;

  const tabIndexFor = useCallback((key: string) => (key === current ? 0 : -1), [current]);

  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const key = (event.target as HTMLElement).closest('[data-grid-cell]')?.getAttribute('data-grid-cell');
    if (key) setActive(key);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const cell = (event.target as HTMLElement).closest('[data-grid-cell]');
    if (!cell) return;
    const [row, col] = (cell.getAttribute('data-grid-cell') || '0-0').split('-').map(Number);
    const container = event.currentTarget;
    const find = (r: number, c: number) => container.querySelector<HTMLButtonElement>(`[data-grid-cell="${gridCellKey(r, c)}"]:not(:disabled)`);
    let target: HTMLButtonElement | null = null;
    const walk = (dr: number, dc: number) => {
      for (let step = 1; step <= 60 && !target; step += 1) target = find(row + dr * step, col + dc * step);
    };
    switch (event.key) {
      case 'ArrowRight': walk(0, 1); break;
      case 'ArrowLeft': walk(0, -1); break;
      case 'ArrowDown': walk(1, 0); break;
      case 'ArrowUp': walk(-1, 0); break;
      case 'Home': for (let c = 0; c < col && !target; c += 1) target = find(row, c); break;
      case 'End': for (let c = 60; c > col && !target; c -= 1) target = find(row, c); break;
      default: return;
    }
    event.preventDefault();
    if (target) {
      target.focus();
      setActive(target.getAttribute('data-grid-cell'));
    }
  }, []);

  return { tabIndexFor, onFocus, onKeyDown };
}
