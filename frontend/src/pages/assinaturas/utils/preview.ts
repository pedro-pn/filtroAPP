export type SignaturePageLoader = (pageNumber: number, signal: AbortSignal) => Promise<Blob>;

// Scans podem ter imagens muito grandes. Carrega uma página por vez para não
// renderizar várias cópias do PDF simultaneamente no servidor.
export function sequentialSignaturePageLoader(loadPage: SignaturePageLoader): SignaturePageLoader {
  let previous: Promise<void> = Promise.resolve();
  return (pageNumber, signal) => {
    const request = previous.then(() => {
      if (signal.aborted) throw new DOMException('Carregamento cancelado.', 'AbortError');
      return loadPage(pageNumber, signal);
    });
    previous = request.then(() => undefined, () => undefined);
    return request;
  };
}
