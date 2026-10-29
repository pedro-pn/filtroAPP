import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { ApiClientError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { confirmUnloading, getRomaneioLogistics, importRomaneioCte } from '../../api/logistica';
import { formatTimestampDateTime as formatDate } from '../../../../shared/modules/date-only.js';
import { Alert, Button, Input, Select } from '../ui/ds';

export function RomaneioUnloading({ romaneioId }: { romaneioId: string }) {
  const { user } = useAuth();
  const id = useId();
  const cache = useQueryClient();
  const [tipo, setTipo] = useState<'PARCIAL' | 'TOTAL'>('TOTAL');
  const [omieId, setOmieId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [attemptedImport, setAttemptedImport] = useState(false);
  // Mantém corpo e UUID após falha de rede; um novo tipo inicia outra confirmação.
  const pending = useRef<{ key: string; body: { romaneioId: string; tipo: 'PARCIAL' | 'TOTAL'; confirmadaEm: string } } | null>(null);
  const queryKey = ['romaneio-logistics', romaneioId];
  const query = useQuery({ queryKey, queryFn: () => getRomaneioLogistics(romaneioId), retry: false });
  const confirm = useMutation({ mutationFn: () => {
    if (!pending.current || pending.current.body.tipo !== tipo) pending.current = {
      key: crypto.randomUUID(), body: { romaneioId, tipo, confirmadaEm: new Date().toISOString() }
    };
    return confirmUnloading(pending.current.body, pending.current.key);
  }, onSuccess: () => { pending.current = null; void cache.invalidateQueries({ queryKey }); } });
  const importCte = useMutation({ mutationFn: () => importRomaneioCte(romaneioId, { omieId: omieId.trim(), ...(invoiceId.trim() ? { invoiceId: invoiceId.trim() } : {}) }),
    onSuccess: () => { setOmieId(''); setInvoiceId(''); setAttemptedImport(false); void cache.invalidateQueries({ queryKey }); } });
  const completed = query.data?.history.some(row => row.tipo === 'TOTAL');
  const invalidId = attemptedImport && !/^[1-9]\d{0,14}$/.test(omieId.trim());
  useEffect(() => {
    if (!query.isSuccess || !user?.id || new Date() >= new Date('2026-11-08T03:00:00Z')) return;
    const key = `filtrovali-unloading-novelty-v1:${user.id}`;
    if (localStorage.getItem(key)) return;
    const timer = window.setTimeout(() => {
      if (document.body.classList.contains('driver-active')) return;
      localStorage.setItem(key, 'seen');
      driver({ showProgress: true, nextBtnText: 'Próximo', prevBtnText: 'Voltar', doneBtnText: 'Entendi', steps: [
        { popover: { title: 'Chegada e descarga dos equipamentos', description: 'Confirme a descarga parcial ou total e consulte o histórico por romaneio de saída.' } },
        { element: document.getElementById(id + '-confirm')!, popover: { title: 'Confirmar descarga', description: 'A confirmação registra o horário atual e seu usuário. A descarga total encerra este romaneio.' } },
        { element: document.getElementById(id + '-cte')!, popover: { title: 'Vincular CT-e do Omie', description: 'Informe o ID do CT-e disponível no Omie para importar número, emissão e transportadora. Vincule antes de confirmar a descarga.' } }
      ] }).drive();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [query.isSuccess, user?.id, id]);
  if (query.isPending) return <p>Carregando descarga…</p>;
  if (query.isError) {
    if (query.error instanceof ApiClientError && [403, 422].includes(query.error.status || 0)) return null;
    return <Alert tone="danger" title="Não foi possível carregar as descargas" action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>} />;
  }
  return <section aria-label="Chegada e descarga" className="acp-romaneios-ds__unloading">
    <h4>Chegada e descarga</h4>
    {query.data.history.length ? <ul>{query.data.history.map(row => <li key={row.id}>
      {row.tipo === 'TOTAL' ? 'Total' : 'Parcial'} · {formatDate(row.confirmadaEm)} · {row.confirmadaPorEmail}
    </li>)}</ul> : <p>Nenhuma descarga confirmada.</p>}
    {query.data.ctes.map(cte => <p key={cte.id}>CT-e {cte.numero} · {formatDate(cte.emissao)} · {cte.transportadora}</p>)}
    <div id={id + '-confirm'}>
      {completed ? <p role="status">Descarga total confirmada.</p> : <>
        <label htmlFor={id + '-tipo'}>Descarga realizada</label>
        <Select id={id + '-tipo'} value={tipo} disabled={confirm.isPending} onChange={event => setTipo(event.target.value as 'PARCIAL' | 'TOTAL')}
          options={[{ value: 'TOTAL', label: 'Total' }, { value: 'PARCIAL', label: 'Parcial' }]} />
        <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate()}>Confirmar chegada e descarga</Button>
      </>}
    </div>
    {confirm.isError ? <Alert tone="danger" title={confirm.error.message} /> : null}
    {!completed ? <form id={id + '-cte'} noValidate onSubmit={event => { event.preventDefault(); setAttemptedImport(true); if (/^[1-9]\d{0,14}$/.test(omieId.trim())) importCte.mutate(); }}>
      <div className={`field-group${invalidId ? ' field-invalid' : ''}`}>
        <label htmlFor={id + '-omie'}>ID do CT-e no Omie</label>
        <Input id={id + '-omie'} value={omieId} inputMode="numeric" required aria-invalid={invalidId || undefined}
          aria-describedby={invalidId ? id + '-error' : undefined} onChange={event => setOmieId(event.target.value)} />
        {invalidId ? <p id={id + '-error'} className="field-error">Informe o ID numérico do CT-e no Omie.</p> : null}
      </div>
      <label htmlFor={id + '-nf'}>ID da nota fiscal vinculada (opcional)</label>
      <Input id={id + '-nf'} value={invoiceId} onChange={event => setInvoiceId(event.target.value)} />
      <Button type="submit" size="sm" variant="secondary" loading={importCte.isPending}>Importar CT-e</Button>
      {importCte.isError ? <Alert tone="danger" title={importCte.error.message} /> : null}
    </form> : null}
  </section>;
}
