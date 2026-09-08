import type { DragEvent } from 'react';

export type PointerDragState = {
  pointerId: number;
  ghost: HTMLElement;
  offsetX: number;
  offsetY: number;
};

export function reorderRowsById<T>(
  rows: T[],
  fromId: string,
  targetId: string,
  getId: (row: T) => string
) {
  if (fromId === targetId) return rows;
  const fromIndex = rows.findIndex(row => getId(row) === fromId);
  const targetIndex = rows.findIndex(row => getId(row) === targetId);
  if (fromIndex < 0 || targetIndex < 0) return rows;

  const next = [...rows];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function sameStringOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function setReorderDragImage(
  event: DragEvent<HTMLElement>,
  rowSelector: string,
  ghostClassName: string
) {
  const row = event.currentTarget.closest(rowSelector);
  if (!(row instanceof HTMLElement)) return;

  const rect = row.getBoundingClientRect();
  const preview = row.cloneNode(true) as HTMLElement;
  preview.setAttribute('aria-hidden', 'true');
  preview.classList.add(ghostClassName);
  preview.style.position = 'fixed';
  preview.style.top = '-1000px';
  preview.style.left = '-1000px';
  preview.style.width = `${rect.width}px`;
  preview.style.pointerEvents = 'none';

  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(
    preview,
    Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    Math.max(0, Math.min(event.clientY - rect.top, rect.height))
  );
  window.setTimeout(() => preview.remove(), 0);
}

export function reorderIdFromPoint(clientX: number, clientY: number, rowSelector: string) {
  const element = document.elementFromPoint(clientX, clientY);
  const row = element?.closest?.(rowSelector);
  if (!(row instanceof HTMLElement)) return null;
  return row.dataset.reorderId || null;
}

export function createPointerDragGhost(
  row: HTMLElement,
  clientX: number,
  clientY: number,
  ghostClassName: string
): PointerDragState {
  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.add(ghostClassName);
  ghost.style.position = 'fixed';
  ghost.style.top = '0';
  ghost.style.left = '0';
  ghost.style.width = `${rect.width}px`;
  ghost.style.pointerEvents = 'none';
  document.body.appendChild(ghost);

  const state = {
    pointerId: -1,
    ghost,
    offsetX: clientX - rect.left,
    offsetY: clientY - rect.top
  };
  movePointerDragGhost(state, clientX, clientY);
  return state;
}

export function movePointerDragGhost(state: PointerDragState, clientX: number, clientY: number) {
  state.ghost.style.transform = `translate3d(${clientX - state.offsetX}px, ${clientY - state.offsetY}px, 0)`;
}

export function scrollReorderContainerEdge(
  container: HTMLElement | null,
  clientY: number,
  edgeSize = 88,
  scrollStep = 18
) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  if (clientY < rect.top + edgeSize) {
    container.scrollTop -= scrollStep;
  } else if (clientY > rect.bottom - edgeSize) {
    container.scrollTop += scrollStep;
  }
}
