import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import type { DatabookCampoDocumento } from '../../api/databook';
import { Alert, Button, Spinner } from '../ui/ds';
import { campoDaAnotacaoDatabook } from '../../utils/databookPreview';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface AreaEditavel {
  campo: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fundo?: string;
}

interface EdicaoInline { pagina: number; campo: string; inicial: string }
interface EdicaoProps {
  campos: DatabookCampoDocumento[];
  edicoes: Record<string, string>;
  disabled: boolean;
  onEditarCampo: (id: string, valor: string) => void;
  onEdicaoAtiva: (id: string | null) => void;
}

/** O PDF permanece montado durante as atualizações, preservando zoom e posição de leitura. */
export function DatabookPdfViewer({ blob, campos, edicoes, disabled, onEditarCampo, onEdicaoAtiva }: EdicaoProps & { blob: Blob }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobExibido = useRef<Blob | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [camposExibidos, setCamposExibidos] = useState<DatabookCampoDocumento[]>([]);
  const [erro, setErro] = useState(false);
  const [largura, setLargura] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [destacar, setDestacar] = useState(true);
  const [edicao, setEdicao] = useState<EdicaoInline | null>(null);
  const porId = useMemo(() => new Map(camposExibidos.map(campo => [campo.id, campo])), [camposExibidos]);
  const editando = Boolean(edicao);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const medir = () => setLargura(container.clientWidth);
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onEdicaoAtiva(edicao?.campo || null);
    return () => onEdicaoAtiva(null);
  }, [edicao?.campo, onEdicaoAtiva]);

  useEffect(() => {
    // Uma resposta do servidor nunca desmonta o campo onde o usuário está digitando.
    if (editando || blobExibido.current === blob) return;
    let cancelado = false;
    let adotado = false;
    let tarefa: ReturnType<typeof getDocument> | undefined;
    setErro(false);
    void blob.arrayBuffer().then(data => {
      if (cancelado) return;
      tarefa = getDocument({ data });
      return tarefa.promise;
    }).then(documento => {
      if (documento && !cancelado) {
        adotado = true;
        blobExibido.current = blob;
        setCamposExibidos(campos);
        setPdf(documento);
      }
    }).catch(() => { if (!cancelado) setErro(true); });
    return () => { cancelado = true; if (!adotado) void tarefa?.destroy(); };
  }, [blob, editando, campos]);

  useEffect(() => () => { void pdf?.loadingTask.destroy(); }, [pdf]);

  return <div className={`databook-pdf${destacar ? ' databook-pdf--destacar' : ''}`} ref={containerRef}>
    <div className="databook-pdf__controles" aria-label="Controles da prévia contínua">
      <span aria-live="polite">{pdf ? `${pdf.numPages} páginas · rolagem contínua` : 'Carregando documento…'}</span>
      <div className="databook-pdf__zoom">
        <Button variant="secondary" size="sm" aria-label="Diminuir zoom" disabled={zoom <= 0.5} onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>−</Button>
        <span>{Math.round(zoom * 100)}%</span>
        <Button variant="secondary" size="sm" aria-label="Aumentar zoom" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2, z + 0.25))}>+</Button>
      </div>
      <Button variant="secondary" size="sm" aria-pressed={destacar} onClick={() => setDestacar(v => !v)}>Destacar campos editáveis</Button>
    </div>
    {erro ? <Alert tone="warning" title="Não foi possível carregar o PDF.">Use Abrir prévia em outra aba para conferir o documento.</Alert> : !pdf ? <Spinner label="Carregando PDF" /> : null}
    <div className="databook-pdf__paginas">
      {pdf ? Array.from({ length: pdf.numPages }, (_, i) => <PaginaDatabook key={i} pdf={pdf} numero={i + 1}
        largura={Math.min(900, Math.max(100, largura - 16)) * zoom} campos={porId} edicoes={edicoes} disabled={disabled}
        edicao={edicao?.pagina === i + 1 ? edicao : null} onEditarCampo={onEditarCampo}
        onIniciar={setEdicao} onTerminar={() => setEdicao(null)} />) : null}
    </div>
  </div>;
}

function PaginaDatabook({ pdf, numero, largura, campos, edicoes, disabled, edicao, onEditarCampo, onIniciar, onTerminar }: {
  pdf: PDFDocumentProxy;
  numero: number;
  largura: number;
  campos: Map<string, DatabookCampoDocumento>;
  edicoes: Record<string, string>;
  disabled: boolean;
  edicao: EdicaoInline | null;
  onEditarCampo: EdicaoProps['onEditarCampo'];
  onIniciar: (edicao: EdicaoInline) => void;
  onTerminar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [proxima, setProxima] = useState(numero === 1);
  const [proporcao, setProporcao] = useState(842 / 595);
  const [larguraPdf, setLarguraPdf] = useState(595);
  const [areas, setAreas] = useState<AreaEditavel[]>([]);
  const [camposRenderizados, setCamposRenderizados] = useState(campos);
  const [pronta, setPronta] = useState(false);
  const [erro, setErro] = useState(false);
  const renderizar = proxima || Boolean(edicao);

  useEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    if (typeof IntersectionObserver === 'undefined') { setProxima(true); return; }
    const observer = new IntersectionObserver(([entrada]) => setProxima(entrada.isIntersecting), {
      root: elemento.closest('.databook-previa__pdf'), rootMargin: '700px 0px'
    });
    observer.observe(elemento);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    setPronta(false);
    if (!canvas) return;
    if (!renderizar) { canvas.width = 0; canvas.height = 0; return; }
    let cancelado = false;
    let render: RenderTask | undefined;
    const destino = document.createElement('canvas');
    setErro(false);
    void pdf.getPage(numero).then(async pagina => {
      if (cancelado) return;
      const base = pagina.getViewport({ scale: 1 });
      const viewport = pagina.getViewport({ scale: largura / base.width });
      setProporcao(base.height / base.width);
      setLarguraPdf(base.width);
      const densidade = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
      destino.width = Math.ceil(viewport.width * densidade);
      destino.height = Math.ceil(viewport.height * densidade);
      render = pagina.render({ canvas: destino, viewport, transform: [densidade, 0, 0, densidade, 0, 0] });
      const [anotacoes] = await Promise.all([pagina.getAnnotations({ intent: 'display' }), render.promise]);
      if (cancelado) return;
      const novas = new Map<string, AreaEditavel>();
      for (const anotacao of anotacoes) {
        const campo = campoDaAnotacaoDatabook(anotacao.url || anotacao.unsafeUrl);
        if (!campo || !Array.isArray(anotacao.rect) || anotacao.rect.length !== 4 || !anotacao.rect.every(Number.isFinite)) continue;
        const [a, b, c, d, e, f] = base.transform;
        const [x, y, xFim, yFim] = anotacao.rect;
        const x1 = a * x + c * y + e, y1 = b * x + d * y + f;
        const x2 = a * xFim + c * yFim + e, y2 = b * xFim + d * yFim + f;
        const atual = novas.get(campo);
        const left = Math.min(Math.min(x1, x2) / base.width * 100, atual?.left ?? Infinity);
        const top = Math.min(Math.min(y1, y2) / base.height * 100, atual?.top ?? Infinity);
        const right = Math.max(Math.max(x1, x2) / base.width * 100, atual ? atual.left + atual.width : -Infinity);
        const bottom = Math.max(Math.max(y1, y2) / base.height * 100, atual ? atual.top + atual.height : -Infinity);
        novas.set(campo, { campo, left, top, width: right - left, height: bottom - top });
      }
      // Troca o bitmap e seus campos juntos, evitando branco/texto antigo durante a atualização.
      canvas.width = destino.width;
      canvas.height = destino.height;
      const contexto = canvas.getContext('2d', { willReadFrequently: true });
      contexto?.drawImage(destino, 0, 0);
      destino.width = 0;
      destino.height = 0;
      setCamposRenderizados(campos);
      const pixels = contexto?.getImageData(0, 0, canvas.width, canvas.height).data;
      setAreas([...novas.values()].map(area => ({ ...area, fundo: corDeFundo(pixels, canvas.width, canvas.height, area) }))
        .sort((a, b) => a.top - b.top || a.left - b.left));
      setPronta(true);
    }).catch(error => { if (!cancelado && error?.name !== 'RenderingCancelledException') setErro(true); });
    return () => {
      cancelado = true;
      render?.cancel();
      destino.width = 0;
      destino.height = 0;
    };
  }, [pdf, numero, largura, renderizar, campos]);

  return <div ref={ref} className="databook-pdf__pagina" data-pagina={numero} data-rendered={pronta}
    style={{ width: largura, height: largura * proporcao }} role="group" aria-label={`Página ${numero}`}>
    <canvas ref={canvasRef} aria-label={`Página ${numero} do PDF`} />
    {erro ? <p className="databook-pdf__pagina-estado" role="alert">Não foi possível exibir esta parte do documento.</p>
      : !pronta ? <span className="databook-pdf__pagina-estado">Carregando trecho do documento…</span> : null}
    {areas.filter(area => camposRenderizados.has(area.campo)).map(area => {
      const campo = camposRenderizados.get(area.campo)!;
      const valor = edicoes[campo.id] ?? campo.original;
      const ativo = edicao?.campo === campo.id;
      const alterado = valor !== campo.valor;
      const tamanho = Math.max(12, (campo.aparencia?.tamanho || 12) * largura / larguraPdf);
      const estilo: CSSProperties & { '--databook-campo-fundo': string } = {
        left: `${area.left}%`, top: `${area.top}%`, width: `${area.width}%`, minHeight: `${area.height}%`,
        color: campo.aparencia?.cor || '#1f2623', '--databook-campo-fundo': area.fundo || '#ffffff',
        fontSize: tamanho, lineHeight: campo.aparencia?.entrelinha ? `${campo.aparencia.entrelinha * largura / larguraPdf}px` : 1.2,
        fontWeight: campo.aparencia?.negrito ? 700 : 400, fontStyle: campo.aparencia?.italico ? 'italic' : 'normal',
        textAlign: campo.aparencia?.alinhamento === 1 ? 'center' : campo.aparencia?.alinhamento === 2 ? 'right' : 'left'
      };
      if (ativo) return <CampoInline key={campo.id} campo={campo} valor={valor} disabled={disabled}
        estilo={estilo} larguraDisponivel={largura * (100 - area.left) / 100 - 2} alturaDisponivel={largura * proporcao * (100 - area.top) / 100 - 2}
        onChange={novo => onEditarCampo(campo.id, novo)} onTerminar={onTerminar}
        onCancelar={() => { onEditarCampo(campo.id, edicao.inicial); onTerminar(); }} />;
      return <button key={campo.id} type="button" className={`databook-pdf__texto${alterado ? ' databook-pdf__texto--alterado' : ''}`}
        data-databook-target={campo.id} aria-label={`Editar ${campo.rotulo} · ${campo.secao}`} title={`Editar ${campo.rotulo}`}
        data-databook-renderizado={campo.valor}
        style={estilo} disabled={disabled || !pronta}
        onClick={() => onIniciar({ pagina: numero, campo: campo.id, inicial: valor })}>{alterado ? valor || '\u00a0' : null}</button>;
    })}
  </div>;
}

/** A cor predominante sob o campo mantém legíveis inclusive letras brancas em faixas. */
function corDeFundo(pixels: Uint8ClampedArray | undefined, largura: number, altura: number, area: AreaEditavel): string {
  if (!pixels) return '#ffffff';
  const cores = new Map<string, number>();
  for (const x of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    for (const y of [0.05, 0.5, 0.95]) {
      const px = Math.max(0, Math.min(largura - 1, Math.floor((area.left + area.width * x) / 100 * largura)));
      const py = Math.max(0, Math.min(altura - 1, Math.floor((area.top + area.height * y) / 100 * altura)));
      const offset = (py * largura + px) * 4;
      const [r, g, b] = pixels.subarray(offset, offset + 3);
      const cor = `rgb(${r}, ${g}, ${b})`;
      cores.set(cor, (cores.get(cor) || 0) + 1);
    }
  }
  return [...cores].sort((a, b) => b[1] - a[1])[0][0];
}

function CampoInline({ campo, valor, disabled, estilo, larguraDisponivel, alturaDisponivel, onChange, onTerminar, onCancelar }: {
  campo: DatabookCampoDocumento;
  valor: string;
  disabled: boolean;
  estilo: CSSProperties;
  larguraDisponivel: number;
  alturaDisponivel: number;
  onChange: (valor: string) => void;
  onTerminar: () => void;
  onCancelar: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fonte = Number(estilo.fontSize);
  const larguraTexto = Math.max(...valor.split('\n').map(linha => linha.length), 1) * fonte * .6 + 8;
  const largura = Math.min(larguraDisponivel, Math.max(50, Math.min(larguraTexto, 400)));
  useEffect(() => { ref.current?.focus({ preventScroll: true }); ref.current?.select(); }, []);
  useEffect(() => {
    const revelar = () => { if (ref.current) manterCampoVisivel(ref.current); };
    window.visualViewport?.addEventListener('resize', revelar);
    return () => window.visualViewport?.removeEventListener('resize', revelar);
  }, []);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(alturaDisponivel, Math.max(fonte * 1.3 + 4, input.scrollHeight))}px`;
    manterCampoVisivel(input);
  }, [valor, largura, fonte, alturaDisponivel]);
  return <textarea ref={ref} data-databook-inline={campo.id} className="databook-pdf__edicao" aria-label={`Editar ${campo.rotulo} · ${campo.secao}`}
    title="Enter aplica; Shift+Enter quebra a linha; Esc cancela" maxLength={12000} disabled={disabled} value={valor}
    style={{ ...estilo, width: `min(${larguraDisponivel}px, max(${estilo.width}, ${largura}px))`, maxHeight: alturaDisponivel }}
    onChange={e => onChange(campo.multilinha ? e.target.value : e.target.value.replace(/\n/g, ' '))}
    onBlur={onTerminar} onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancelar(); }
      else if (e.key === 'Enter' && (!campo.multilinha || !e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); }
    }} />;
}

function manterCampoVisivel(input: HTMLTextAreaElement) {
  input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const container = input.closest('.databook-previa__pdf');
  if (!container) return;
  const quadro = container.getBoundingClientRect();
  const corpo = input.closest('.fv-modal__body')?.getBoundingClientRect();
  const topo = Math.max(container.querySelector('.databook-pdf__controles')?.getBoundingClientRect().bottom || quadro.top, corpo?.top || 0) + 8;
  const fim = Math.min(quadro.bottom, corpo?.bottom || innerHeight, window.visualViewport?.height || innerHeight) - 8;
  const caixa = input.getBoundingClientRect();
  if (caixa.top < topo || caixa.bottom > fim) container.scrollTop += caixa.top + caixa.height / 2 - (topo + fim) / 2;
}
